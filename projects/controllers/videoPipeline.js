// Steps shared by every video task that produces a new video (trim, subtitle embedding and
// concatenation): download from storage, ffmpeg with progress/cancellation/timeout, and the
// consolidation of the result into the project, plus the cleanup when a task fails.
const axios = require("axios");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const FormData = require("form-data");
const VideoTask = require("../models/videoTask");
const Project = require("./project");
const { commitReservation, releaseReservation } = require("./videoQuota");
const {
  get_image_internal_url,
  get_image_public_url,
  post_image,
  delete_image,
} = require("../utils/imageStorage");
const { inspectVideo } = require("../utils/video");
const { createVideoThumbnail, deleteThumbnail } = require("../utils/videoThumbnail");

const PROCESSING_TIMEOUT_MESSAGE = "O processamento excedeu o limite de tempo do teu perfil. Tenta um recorte mais curto.";
const TIMEOUT_MESSAGES = {
  concat: "A junção excedeu o tempo máximo de processamento do teu perfil. Tenta juntar menos vídeos ou vídeos mais curtos.",
};
// Name of the new project video: name of the (first) source plus a suffix, e.g. ferias_recorte.mp4.
const RESULT_SUFFIXES = { trim: "_recorte", subtitles: "_legendas", concat: "_juncao" };

function remainingProcessingMs(startedAt, maximumMs) {
  return maximumMs - (Date.now() - startedAt);
}

function requireRemainingProcessingTime(startedAt, maximumMs) {
  const remaining = remainingProcessingMs(startedAt, maximumMs);
  if (remaining <= 0) throw new Error(PROCESSING_TIMEOUT_MESSAGE);
  return remaining;
}

async function isCancelled(taskId) {
  const current = await VideoTask.findOne({ taskId }).select("state").lean().catch(() => null);
  return !current || current.state === "CANCELADA";
}

function timeoutMessageFor(operation) {
  return TIMEOUT_MESSAGES[operation] || PROCESSING_TIMEOUT_MESSAGE;
}

async function downloadSource(task, destination, startedAt, sourceKey = task.source_key) {
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, requireRemainingProcessingTime(startedAt, task.maxProcessingMs));
  const cancellationPoll = setInterval(async () => {
    if (await isCancelled(task.taskId)) abortController.abort();
  }, 500);
  try {
    const response = await get_image_internal_url(
      task.user_id,
      task.project_id,
      "src",
      sourceKey,
      { timeout: requireRemainingProcessingTime(startedAt, task.maxProcessingMs) },
    );
    const fileResponse = await axios.get(response.data.url, {
      responseType: "stream",
      signal: abortController.signal,
      timeout: requireRemainingProcessingTime(startedAt, task.maxProcessingMs),
    });
    await pipeline(fileResponse.data, fs.createWriteStream(destination), { signal: abortController.signal });
    requireRemainingProcessingTime(startedAt, task.maxProcessingMs);
  } catch (error) {
    if (
      timedOut ||
      error.code === "ECONNABORTED" ||
      remainingProcessingMs(startedAt, task.maxProcessingMs) <= 0
    ) {
      throw new Error(PROCESSING_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancellationPoll);
  }
}

// Runs ffmpeg (with "-progress pipe:1" in args) and maps its position to the task progress:
// `elapsed / duration` of the run is written as a percentage between `from` and `to`.
function spawnFfmpeg(task, args, cwd, progress = {}) {
  const duration = progress.duration ?? (task.operation === "subtitles"
    ? Number(task.durationSeconds)
    : task.tempoFim - task.tempoInicio);
  const from = progress.from ?? 0;
  const to = progress.to ?? 95;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("ffmpeg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdoutBuffer = "";
    let stderrTail = "";
    let outOfSpace = false;
    let lastProgressWrite = 0;
    let timedOut = false;
    let killTimer = null;
    const terminateChild = () => {
      child.kill("SIGTERM");
      if (!killTimer) {
        killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
        killTimer.unref();
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, task.maxProcessingMs);
    const cancellationPoll = setInterval(async () => {
      if (!killTimer && await isCancelled(task.taskId)) terminateChild();
    }, 500);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      const outTime = lines.find((line) => line.startsWith("out_time_ms="));
      if (!outTime) return;
      const elapsed = Number(outTime.split("=")[1]) / 1_000_000;
      if (!Number.isFinite(elapsed) || !(duration > 0)) return;
      const value = Math.max(1, Math.min(to, Math.floor(from + (to - from) * Math.min(1, elapsed / duration))));
      const now = Date.now();
      if (now - lastProgressWrite >= 1000) {
        lastProgressWrite = now;
        VideoTask.updateOne({ taskId: task.taskId, state: "EM_PROCESSAMENTO" }, { $set: { progress: value } }).catch(() => {});
      }
    });

    child.stderr.on("data", (chunk) => {
      // Keep a bounded tail so a message split across chunks is still recognized.
      const diagnostic = stderrTail + chunk.toString("utf8");
      outOfSpace ||= /no space left on device|not enough space on (?:the )?disk|ENOSPC/i.test(diagnostic);
      stderrTail = diagnostic.slice(-256);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      clearInterval(cancellationPoll);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      clearInterval(cancellationPoll);
      if (killTimer) clearTimeout(killTimer);
      if (outOfSpace && !timedOut) {
        return reject(Object.assign(new Error("O FFmpeg ficou sem espaço de armazenamento."), { code: "ENOSPC" }));
      }
      if (code === 0) return resolve();
      reject(new Error(timedOut ? timeoutMessageFor(task.operation) : `O FFmpeg terminou com o código ${code}.`));
    });
  });
}

function outputNameFor(project, sourceName, operation = "trim") {
  const extension = operation === "trim" ? path.extname(sourceName) : ".mp4";
  const base = path.basename(sourceName, path.extname(sourceName));
  const suffixName = RESULT_SUFFIXES[operation] || "_resultado";
  const existingNames = new Set(project.imgs.map((image) => path.basename(image.og_uri)));
  let candidate = `${base}${suffixName}${extension}`;
  let suffix = 2;
  while (existingNames.has(candidate)) {
    candidate = `${base}${suffixName}_${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

function sha256File(filePath) {
  const sha = crypto.createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => sha.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(sha.digest("hex")));
  });
}

// Saves `outputPath` as a new video of the project and completes the task. Results of a task
// that was cancelled or failed meanwhile are not consolidated: every step is conditional on the
// task state. `buildSubtitles(project)` returns the editable subtitles of the new video (or
// undefined) and may throw if a source disappeared. `state` records what was created so that
// handleTaskFailure can undo it. Returns false when the task stopped before finalizing.
async function consolidateResult(task, { outputPath, startedAt, buildSubtitles }, state) {
  const taskId = task.taskId;
  const remaining = () => requireRemainingProcessingTime(startedAt, task.maxProcessingMs);
  const finalizing = await VideoTask.updateOne(
    { taskId, state: { $in: ["EM_PROCESSAMENTO", "A_FINALIZAR"] } },
    { $set: { state: "A_FINALIZAR", progress: 97 } },
  );
  if (!finalizing.matchedCount) return false;

  const project = await Project.getOne(task.user_id, task.project_id);
  if (!project) throw new Error("O projeto já não está disponível.");
  const subtitles = buildSubtitles ? buildSubtitles(project) : undefined;

  const outputExtension = path.extname(outputPath);
  const resultName = outputNameFor(project, task.source_name, task.operation);
  const sizeBytes = (await fs.promises.stat(outputPath)).size;
  const form = new FormData();
  form.append("file", fs.createReadStream(outputPath), {
    filename: resultName,
    contentType: outputExtension === ".webm" ? "video/webm" : "video/mp4",
    knownLength: sizeBytes,
  });
  const uploadResponse = await post_image(task.user_id, task.project_id, "src", form, { timeout: remaining() });
  state.outputKey = uploadResponse.data.data.imageKey.split("/").pop();

  const resultMetadata = await inspectVideo(outputPath, remaining());
  state.thumbKey = await createVideoThumbnail({
    userId: task.user_id,
    projectId: task.project_id,
    videoPath: outputPath,
    duration: resultMetadata.duration,
    videoName: resultName,
    timeoutMs: Math.min(30_000, remaining()),
  });
  const item = {
    og_uri: `./images/users/${task.user_id}/projects/${task.project_id}/src/${resultName}`,
    new_uri: `./images/users/${task.user_id}/projects/${task.project_id}/out/${resultName}`,
    og_img_key: state.outputKey,
    og_sha256: await sha256File(outputPath),
    mediaMetadata: { ...resultMetadata, sizeBytes, format: outputExtension.slice(1) },
    thumb_img_key: state.thumbKey,
  };
  if (subtitles) item.subtitles = subtitles;

  const publicResponse = await get_image_public_url(task.user_id, task.project_id, "src", state.outputKey, { timeout: remaining() });
  const saved = await Project.updateRaw(task.user_id, task.project_id, {
    $push: { imgs: item },
    $inc: { version: 1 },
  });
  if (!saved.matchedCount) throw new Error("Não foi possível guardar o resultado no projeto.");
  state.resultAddedToProject = true;
  remaining();
  const updatedProject = await Project.getOne(task.user_id, task.project_id);
  const resultImage = updatedProject?.imgs.find((image) => String(image.og_img_key) === String(state.outputKey));
  if (!resultImage) throw new Error("Não foi possível localizar o vídeo resultante no projeto.");
  remaining();

  const completed = await VideoTask.updateOne({ taskId, state: "A_FINALIZAR" }, {
    $set: {
      state: "CONCLUIDA",
      progress: 100,
      resultName,
      resultUrl: publicResponse.data.url,
      resultImageId: String(resultImage._id),
      error: null,
      completedAt: new Date(),
    },
    $unset: { active_project_id: "" },
  });
  if (!completed.matchedCount) throw new Error("A tarefa foi interrompida antes de guardar o resultado.");
  try {
    await commitReservation(taskId);
  } catch (error) {
    console.error("Could not commit the video operation reservation:", error.message);
  }
  return true;
}

// Marks the task as failed (unless it was cancelled), releases its quota reservation and removes
// everything a partial consolidation created, so no partial result stays in the project.
async function handleTaskFailure(task, error, startedAt, state) {
  const taskId = task.taskId;
  const timedOut = error.code === "ECONNABORTED" || (error.killed && error.signal === "SIGTERM") ||
    remainingProcessingMs(startedAt, task.maxProcessingMs) <= 0;
  const taskError = timedOut ? timeoutMessageFor(task.operation) : error.message;
  const current = await VideoTask.findOne({ taskId });
  if (current && current.state !== "CANCELADA") {
    await VideoTask.updateOne({ taskId }, {
      $set: { state: "FALHADA", error: taskError, completedAt: new Date() },
      $unset: { active_project_id: "" },
    });
    await releaseReservation(taskId).catch((releaseError) => {
      console.error("Failed to refund a video operation:", releaseError.message);
    });
  }
  if (state.resultAddedToProject && state.outputKey) {
    await Project.updateRaw(task.user_id, task.project_id, {
      $pull: { imgs: { og_img_key: state.outputKey } },
      $inc: { version: 1 },
    }).catch((cleanupError) => {
      console.error("Could not remove a failed video result from the project:", cleanupError.message);
    });
  }
  if (state.outputKey) await delete_image(task.user_id, task.project_id, "src", state.outputKey).catch(() => {});
  await deleteThumbnail(task.user_id, task.project_id, { thumb_img_key: state.thumbKey });
}

module.exports = {
  PROCESSING_TIMEOUT_MESSAGE,
  consolidateResult,
  downloadSource,
  handleTaskFailure,
  isCancelled,
  outputNameFor,
  requireRemainingProcessingTime,
  spawnFfmpeg,
};
