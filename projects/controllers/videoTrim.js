const axios = require("axios");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const FormData = require("form-data");
const amqp = require("amqplib");
const VideoTask = require("../models/videoTask");
const Project = require("./project");
const { httpsAgent } = require("../utils/httpsAgent");
const {
  get_image_internal_url,
  get_image_public_url,
  post_image,
  delete_image,
} = require("../utils/imageStorage");
const { inspectVideo, validateVideoCodecs } = require("../utils/video");

const usersUrl = "https://users:10001/";
const videoQueue = "video.trim.tasks";
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://user:password@rabbitmq:5672";
const PROCESSING_TIMEOUT_MESSAGE = "O processamento excedeu o limite de tempo do teu perfil. Tenta um recorte mais curto.";
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

function getUserType(userId) {
  return axios.get(`${usersUrl}${userId}/type/`, { httpsAgent })
    .then((response) => response.data?.type);
}

async function reserveOperation(userId, amount, reservationId) {
  if (!amount) return;
  const response = await axios.post(
    `${usersUrl}${userId}/process/${amount}/reserve/${encodeURIComponent(reservationId)}`,
    {},
    { httpsAgent },
  );
  return response.data;
}

async function refundOperation(userId, amount, reservationId) {
  if (!amount) return;
  await axios.post(`${usersUrl}${userId}/process/refund/${amount}`, reservationId ? { reservationId } : {}, {
    httpsAgent,
  });
}

async function commitOperation(userId, reservationId) {
  if (!reservationId) return;
  await axios.post(`${usersUrl}${userId}/process/commit/${encodeURIComponent(reservationId)}`, {}, {
    httpsAgent,
  });
}

async function releaseReservation(taskId) {
  const task = await VideoTask.findOne({ taskId, reservedOperation: true }).lean();
  if (!task) return;
  await refundOperation(task.user_id, 1, task.taskId);
  await VideoTask.updateOne({ taskId, reservedOperation: true }, { $set: { reservedOperation: false } });
}

async function commitReservation(taskId) {
  const task = await VideoTask.findOne({ taskId, reservedOperation: true }).lean();
  if (!task) return;
  await commitOperation(task.user_id, task.taskId);
  await VideoTask.updateOne({ taskId, reservedOperation: true }, { $set: { reservedOperation: false } });
}

function outputNameFor(project, sourceName) {
  const extension = path.extname(sourceName);
  const base = path.basename(sourceName, extension);
  const existingNames = new Set(project.imgs.map((image) => path.basename(image.og_uri)));
  let candidate = `${base}_recorte${extension}`;
  let suffix = 2;
  while (existingNames.has(candidate)) {
    candidate = `${base}_recorte_${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

function remainingProcessingMs(startedAt, maximumMs) {
  return maximumMs - (Date.now() - startedAt);
}

function requireRemainingProcessingTime(startedAt, maximumMs) {
  const remaining = remainingProcessingMs(startedAt, maximumMs);
  if (remaining <= 0) throw new Error(PROCESSING_TIMEOUT_MESSAGE);
  return remaining;
}

async function downloadSource(task, destination, startedAt) {
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, requireRemainingProcessingTime(startedAt, task.maxProcessingMs));
  const cancellationPoll = setInterval(async () => {
    const current = await VideoTask.findOne({ taskId: task.taskId }).select("state").lean().catch(() => null);
    if (current?.state === "CANCELADA") abortController.abort();
  }, 500);
  try {
    const response = await get_image_internal_url(
      task.user_id,
      task.project_id,
      "src",
      task.source_key,
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

function runFfmpeg(task, inputPath, outputPath) {
  const extension = path.extname(task.source_name).toLowerCase();
  const start = task.tempoInicio;
  const duration = task.tempoFim - task.tempoInicio;
  const codecArgs = extension === ".webm"
    ? ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-c:a", "libvorbis"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
  const args = [
    "-y", "-i", inputPath, "-ss", String(start), "-t", String(duration),
    "-map", "0:v:0", "-map", "0:a?", ...codecArgs,
    "-progress", "pipe:1", "-nostats", outputPath,
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdoutBuffer = "";
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
      const current = await VideoTask.findOne({ taskId: task.taskId }).select("state").lean().catch(() => null);
      if (current?.state === "CANCELADA" && !killTimer) terminateChild();
    }, 500);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      const outTime = lines.find((line) => line.startsWith("out_time_ms="));
      if (!outTime) return;
      const elapsed = Number(outTime.split("=")[1]) / 1_000_000;
      if (!Number.isFinite(elapsed)) return;
      const progress = Math.max(1, Math.min(95, Math.floor((elapsed / (task.tempoFim - task.tempoInicio)) * 100)));
      const now = Date.now();
      if (now - lastProgressWrite >= 1000) {
        lastProgressWrite = now;
        VideoTask.updateOne({ taskId: task.taskId, state: "EM_PROCESSAMENTO" }, { $set: { progress } }).catch(() => {});
      }
    });

    child.stderr.on("data", () => {});
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
      if (code === 0) return resolve();
      reject(new Error(timedOut ? PROCESSING_TIMEOUT_MESSAGE : `O FFmpeg terminou com o código ${code}.`));
    });
  });
}

async function processTask(taskId) {
  const task = await VideoTask.findOne({ taskId });
  if (!task) return;
  if (task.state === "CANCELADA") {
    await VideoTask.updateOne({ taskId, state: "CANCELADA" }, { $unset: { active_user_id: "" } });
    return;
  }
  if (!["EM_FILA", "EM_PROCESSAMENTO", "A_FINALIZAR"].includes(task.state)) return;

  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picturas-trim-"));
  const extension = path.extname(task.source_name);
  const inputPath = path.join(workDir, `source${extension}`);
  const outputPath = path.join(workDir, `trimmed${extension}`);
  let outputKey = null;
  let resultAddedToProject = false;
  const processingStartedAt = Date.now();

  try {
    const started = await VideoTask.updateOne(
      { taskId, state: { $in: ["EM_FILA", "EM_PROCESSAMENTO", "A_FINALIZAR"] } },
      { $set: { state: "EM_PROCESSAMENTO", progress: 1, startedAt: new Date() } },
    );
    if (!started.matchedCount) return;
    await downloadSource(task, inputPath, processingStartedAt);
    const afterDownload = await VideoTask.findOne({ taskId });
    if (!afterDownload || afterDownload.state === "CANCELADA") return;
    const metadata = await inspectVideo(inputPath, requireRemainingProcessingTime(processingStartedAt, task.maxProcessingMs));
    validateVideoCodecs(task.source_name, metadata);
    await runFfmpeg({
      ...task.toObject(),
      maxProcessingMs: requireRemainingProcessingTime(processingStartedAt, task.maxProcessingMs),
    }, inputPath, outputPath);

    const finalizing = await VideoTask.updateOne(
      { taskId, state: { $in: ["EM_PROCESSAMENTO", "A_FINALIZAR"] } },
      { $set: { state: "A_FINALIZAR", progress: 97 } },
    );
    if (!finalizing.matchedCount) return;

    const project = await Project.getOne(task.user_id, task.project_id);
    if (!project) throw new Error("O projeto já não está disponível.");
    const source = project.imgs.id(task.image_id);
    if (!source) throw new Error("O vídeo original já não está disponível no projeto.");

    const resultName = outputNameFor(project, task.source_name);
    const outputStream = fs.createReadStream(outputPath);
    const form = new FormData();
    form.append("file", outputStream, {
      filename: resultName,
      contentType: extension === ".webm" ? "video/webm" : "video/mp4",
      knownLength: (await fs.promises.stat(outputPath)).size,
    });
    const uploadResponse = await post_image(
      task.user_id,
      task.project_id,
      "src",
      form,
      { timeout: requireRemainingProcessingTime(processingStartedAt, task.maxProcessingMs) },
    );
    outputKey = uploadResponse.data.data.imageKey.split("/").pop();

    const sha = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(outputPath);
      stream.on("data", (chunk) => sha.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    const resultMetadata = await inspectVideo(
      outputPath,
      requireRemainingProcessingTime(processingStartedAt, task.maxProcessingMs),
    );
    const item = {
      og_uri: `./images/users/${task.user_id}/projects/${task.project_id}/src/${resultName}`,
      new_uri: `./images/users/${task.user_id}/projects/${task.project_id}/out/${resultName}`,
      og_img_key: outputKey,
      og_sha256: sha.digest("hex"),
      mediaMetadata: { ...resultMetadata, sizeBytes: (await fs.promises.stat(outputPath)).size, format: extension.slice(1) },
    };

    const publicResponse = await get_image_public_url(
      task.user_id,
      task.project_id,
      "src",
      outputKey,
      { timeout: requireRemainingProcessingTime(processingStartedAt, task.maxProcessingMs) },
    );
    const saved = await Project.updateRaw(task.user_id, task.project_id, {
      $push: { imgs: item },
      $inc: { version: 1 },
    });
    if (!saved.matchedCount) throw new Error("Não foi possível guardar o resultado no projeto.");
    resultAddedToProject = true;
    requireRemainingProcessingTime(processingStartedAt, task.maxProcessingMs);
    const updatedProject = await Project.getOne(task.user_id, task.project_id);
    const resultImage = updatedProject?.imgs.find((image) => String(image.og_img_key) === String(outputKey));
    if (!resultImage) throw new Error("Não foi possível localizar o vídeo recortado no projeto.");
    requireRemainingProcessingTime(processingStartedAt, task.maxProcessingMs);

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
      $unset: { active_user_id: "" },
    });
    if (!completed.matchedCount) {
      throw new Error("A tarefa foi interrompida antes de guardar o resultado.");
    }
    try {
      await commitReservation(taskId);
    } catch (error) {
      console.error("Could not commit the video operation reservation:", error.message);
    }
  } catch (error) {
    const taskError = error.code === "ECONNABORTED" || (error.killed && error.signal === "SIGTERM") ||
      remainingProcessingMs(processingStartedAt, task.maxProcessingMs) <= 0
      ? PROCESSING_TIMEOUT_MESSAGE
      : error.message;
    const current = await VideoTask.findOne({ taskId });
    if (current && current.state !== "CANCELADA") {
      await VideoTask.updateOne({ taskId }, {
        $set: { state: "FALHADA", error: taskError, completedAt: new Date() },
        $unset: { active_user_id: "" },
      });
      await releaseReservation(taskId).catch((releaseError) => {
        console.error("Failed to refund a video operation:", releaseError.message);
      });
    }
    if (resultAddedToProject && outputKey) {
      await Project.updateRaw(task.user_id, task.project_id, {
        $pull: { imgs: { og_img_key: outputKey } },
        $inc: { version: 1 },
      }).catch((cleanupError) => {
        console.error("Could not remove a failed video trim result from the project:", cleanupError.message);
      });
    }
    if (outputKey) await delete_image(task.user_id, task.project_id, "src", outputKey).catch(() => {});
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await VideoTask.updateOne(
      { taskId, state: "CANCELADA" },
      { $unset: { active_user_id: "" } },
    ).catch((error) => console.error("Could not release the cancelled video task lock:", error.message));
  }
}

async function enqueueTask(taskId) {
  const channel = await getRabbitChannel();
  channel.sendToQueue(videoQueue, Buffer.from(JSON.stringify({ taskId })), {
    persistent: true,
    contentType: "application/json",
  });
}

async function recoverTasks() {
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
  if (previousState === "EM_FILA") {
    await VideoTask.updateOne({ taskId: task.taskId, state: "CANCELADA" }, { $unset: { active_user_id: "" } });
  }
  await releaseReservation(task.taskId).catch((error) => {
    console.error("Failed to refund a cancelled video operation:", error.message);
  });
  return true;
}

module.exports = {
  cancelTask,
  enqueueTask,
  getUserType,
  processTask,
  recoverPendingReservations,
  recoverTasks,
  refundOperation,
  reserveOperation,
};
