// Video task queue and worker entry point: enqueues tasks, dispatches each one to its operation
// (trim, subtitle embedding, AI subtitle generation, concatenation), cancels and recovers them.
const fs = require("fs");
const os = require("os");
const path = require("path");
const amqp = require("amqplib");
const VideoTask = require("../models/videoTask");
const { inspectVideo, validateVideoCodecs } = require("../utils/video");
const { toSrt } = require("../utils/subtitles");
const { generateSubtitleSegments } = require("./subtitlesAI");
const {
  commitReservation,
  getUserType,
  refundOperation,
  releaseReservation,
  reserveOperation,
} = require("./videoQuota");
const { ACTIVE_STATES, migrateTaskLocks, releaseCancelledLock } = require("./videoTaskLock");
const {
  consolidateResult,
  downloadSource,
  handleTaskFailure,
  requireRemainingProcessingTime,
  spawnFfmpeg,
} = require("./videoPipeline");
const { processConcatTask } = require("./videoConcat");
const { trimSubtitleSegments } = require("../utils/videoTrim");

const videoQueue = "video.trim.tasks";
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://user:password@rabbitmq:5672";
const SUBTITLE_PROCESSING_TIMEOUT_MESSAGE = "A geração automática excedeu o limite de 900 segundos do plano Premium.";
let rabbitConnection;
let rabbitChannel;

async function getRabbitChannel() {
  if (rabbitChannel) return rabbitChannel;
  rabbitConnection = await amqp.connect(rabbitUrl);
  rabbitConnection.on("close", () => {
    rabbitConnection = null;
    rabbitChannel = null;
  });
  rabbitChannel = await rabbitConnection.createChannel();
  await rabbitChannel.assertQueue(videoQueue, { durable: true });
  return rabbitChannel;
}

function ffmpegArgsFor(task, inputPath, outputPath) {
  if (task.operation === "subtitles") {
    return [
      "-y", "-i", inputPath,
      "-vf", "subtitles=captions.srt:force_style=FontSize=20\\,Outline=2\\,Shadow=1\\,MarginV=24",
      "-map", "0:v:0", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats", outputPath,
    ];
  }
  const extension = path.extname(task.source_name).toLowerCase();
  const codecArgs = extension === ".webm"
    ? ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-c:a", "libvorbis"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
  return [
    "-y", "-i", inputPath, "-ss", String(task.tempoInicio), "-t", String(task.tempoFim - task.tempoInicio),
    "-map", "0:v:0", "-map", "0:a?", ...codecArgs,
    "-progress", "pipe:1", "-nostats", outputPath,
  ];
}

// Subtitles of the new video: a trim copies the segments inside the interval (UC-VID-002 RN7);
// an embedding keeps the segments that were burned in (UC-VID-001 RN4).
function resultSubtitlesFor(task, project) {
  const source = project.imgs.id(task.image_id);
  if (!source) throw new Error("O vídeo original já não está disponível no projeto.");
  if (task.operation === "subtitles") return task.subtitleSegments;
  if (!source.subtitles?.length) return undefined;
  return trimSubtitleSegments(source.subtitles, task.tempoInicio, task.tempoFim);
}

// Trim (UC-VID-002) and subtitle embedding (UC-VID-001): one source video, one ffmpeg run.
async function processSingleSourceTask(task) {
  const taskId = task.taskId;
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), task.operation === "subtitles" ? "picturas-subtitles-" : "picturas-trim-"));
  const sourceExtension = path.extname(task.source_name);
  const inputPath = path.join(workDir, `source${sourceExtension}`);
  const outputPath = path.join(workDir, `output${task.operation === "subtitles" ? ".mp4" : sourceExtension}`);
  const state = { outputKey: null, thumbKey: null, resultAddedToProject: false };
  const startedAt = Date.now();

  try {
    const started = await VideoTask.updateOne(
      { taskId, state: { $in: ACTIVE_STATES } },
      { $set: { state: "EM_PROCESSAMENTO", progress: 1, startedAt: new Date() } },
    );
    if (!started.matchedCount) return;
    await downloadSource(task.toObject(), inputPath, startedAt);
    const afterDownload = await VideoTask.findOne({ taskId });
    if (!afterDownload || afterDownload.state === "CANCELADA") return;
    const metadata = await inspectVideo(inputPath, requireRemainingProcessingTime(startedAt, task.maxProcessingMs));
    validateVideoCodecs(task.source_name, metadata);
    if (task.operation === "subtitles") {
      await fs.promises.writeFile(path.join(workDir, "captions.srt"), toSrt(task.subtitleSegments), "utf8");
    }
    await spawnFfmpeg({
      ...task.toObject(),
      durationSeconds: metadata.duration,
      maxProcessingMs: requireRemainingProcessingTime(startedAt, task.maxProcessingMs),
    }, ffmpegArgsFor(task, inputPath, outputPath), workDir);

    await consolidateResult(task, {
      outputPath,
      startedAt,
      buildSubtitles: (project) => resultSubtitlesFor(task, project),
    }, state);
  } catch (error) {
    await handleTaskFailure(task, error, startedAt, state);
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await releaseCancelledLock(taskId);
  }
}

async function processTask(taskId) {
  const task = await VideoTask.findOne({ taskId });
  if (!task) return;
  if (task.state === "CANCELADA") {
    await releaseCancelledLock(taskId);
    return;
  }
  if (!ACTIVE_STATES.includes(task.state)) return;
  if (task.operation === "generate_subtitles") return processSubtitleGeneration(task);
  if (task.operation === "concat") return processConcatTask(task);
  return processSingleSourceTask(task);
}

async function enqueueTask(taskId) {
  const channel = await getRabbitChannel();
  channel.sendToQueue(videoQueue, Buffer.from(JSON.stringify({ taskId })), {
    persistent: true,
    contentType: "application/json",
  });
}

async function processSubtitleGeneration(task) {
  const started = await VideoTask.updateOne(
    { taskId: task.taskId, state: { $in: ["EM_FILA", "EM_PROCESSAMENTO"] } },
    { $set: { state: "EM_PROCESSAMENTO", progress: 5, startedAt: new Date() } },
  );
  if (!started.matchedCount) return;
  const startedAt = Date.now();
  const deadlineAt = startedAt + task.maxProcessingMs;
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, task.maxProcessingMs);
  const progressTimer = setInterval(() => {
    const estimate = Math.min(90, 5 + Math.floor(((Date.now() - startedAt) / task.maxProcessingMs) * 80));
    VideoTask.updateOne({ taskId: task.taskId, state: "EM_PROCESSAMENTO" }, { $max: { progress: estimate } })
      .catch((error) => console.error("Could not update subtitle generation progress:", error.message));
  }, 10_000);
  const cancellationPoll = setInterval(async () => {
    const current = await VideoTask.findOne({ taskId: task.taskId }).select("state").lean().catch(() => null);
    if (current?.state === "CANCELADA") abortController.abort();
  }, 500);
  progressTimer.unref?.();
  cancellationPoll.unref?.();
  try {
    const segments = await generateSubtitleSegments({
      userId: task.user_id,
      projectId: task.project_id,
      source: { og_uri: task.source_name, og_img_key: task.source_key },
      duration: task.durationSeconds,
      deadlineAt,
      signal: abortController.signal,
    });
    const current = await VideoTask.findOne({ taskId: task.taskId }).select("state").lean();
    if (current?.state === "CANCELADA") return;
    if (Date.now() >= deadlineAt) throw new Error(SUBTITLE_PROCESSING_TIMEOUT_MESSAGE);
    await VideoTask.updateOne({ taskId: task.taskId, state: "EM_PROCESSAMENTO" }, {
      $set: { state: "CONCLUIDA", progress: 100, subtitleSegments: segments, error: null, completedAt: new Date() },
      $unset: { active_project_id: "" },
    });
  } catch (error) {
    const current = await VideoTask.findOne({ taskId: task.taskId }).select("state").lean().catch(() => null);
    if (current?.state !== "CANCELADA") {
      await VideoTask.updateOne({ taskId: task.taskId, state: "EM_PROCESSAMENTO" }, {
        $set: {
          state: "FALHADA",
          error: timedOut ? SUBTITLE_PROCESSING_TIMEOUT_MESSAGE : error.message || "Não foi possível gerar as legendas.",
          completedAt: new Date(),
        },
        $unset: { active_project_id: "" },
      });
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(progressTimer);
    clearInterval(cancellationPoll);
    await releaseCancelledLock(task.taskId);
  }
}

async function recoverTasks() {
  await migrateTaskLocks().catch((error) => {
    console.error("Could not migrate video task locks to the per-project policy:", error);
  });
  await recoverPendingReservations().catch((error) => {
    console.error("Could not recover video operation reservations:", error);
  });
  const queued = await VideoTask.find({ state: "EM_FILA" }).select("taskId").lean();
  await Promise.all(queued.map((task) => enqueueTask(task.taskId)));
}

async function recoverPendingReservations() {
  const unsettled = await VideoTask.find({
    reservedOperation: true,
    state: { $in: ["CONCLUIDA", "FALHADA", "CANCELADA"] },
  }).select("taskId state").lean();
  await Promise.all(unsettled.map(async (task) => {
    try {
      if (task.state === "CONCLUIDA") await commitReservation(task.taskId);
      else await releaseReservation(task.taskId);
    } catch (error) {
      console.error(`Could not settle video operation reservation for ${task.taskId}:`, error.message);
    }
  }));
}

async function cancelTask(task) {
  let updated = null;
  let previousState = null;
  for (let attempt = 0; attempt < 3 && !updated; attempt += 1) {
    const current = await VideoTask.findOne({ taskId: task.taskId }).select("state").lean();
    if (!current || !["EM_FILA", "EM_PROCESSAMENTO"].includes(current.state)) return false;
    previousState = current.state;
    updated = await VideoTask.findOneAndUpdate(
      { taskId: task.taskId, state: previousState },
      { $set: { state: "CANCELADA", error: "Cancelado pelo utilizador.", completedAt: new Date() } },
      { new: true },
    );
  }
  if (!updated) return false;
  if (previousState === "EM_FILA") await releaseCancelledLock(task.taskId);
  await releaseReservation(task.taskId).catch((error) => {
    console.error("Failed to refund a cancelled video operation:", error.message);
  });
  return true;
}

module.exports = {
  cancelTask,
  enqueueTask,
  getUserType,
  migrateTaskLocks,
  processTask,
  recoverPendingReservations,
  recoverTasks,
  refundOperation,
  reserveOperation,
};
