// UC-VID-003 worker: downloads the selected clips, checks them again, converts each one to the
// common intermediate format, joins them in the confirmed order, validates the result and saves
// it as a new project video. Every failure ends the task without a partial result (RN13/RN14).
const fs = require("fs");
const os = require("os");
const path = require("path");
const VideoTask = require("../models/videoTask");
const { inspectVideo } = require("../utils/video");
const {
  concatArgs,
  concatListContent,
  describeClip,
  normalizeClipArgs,
  planNormalization,
  requiredWorkspaceBytes,
  shiftSubtitles,
} = require("../utils/videoConcat");
const { releaseCancelledLock } = require("./videoTaskLock");
const {
  consolidateResult,
  downloadSource,
  handleTaskFailure,
  isCancelled,
  PROCESSING_TIMEOUT_MESSAGE,
  requireRemainingProcessingTime,
  spawnFfmpeg,
} = require("./videoPipeline");

// Progress (%) reserved for each phase: downloads, per-clip conversion, joining.
const DOWNLOAD_END = 10;
const NORMALIZE_END = 88;
const CONCAT_END = 95;
const LOW_SPACE_BYTES = 50 * 1024 * 1024;

class ConcatError extends Error {}

function clipError(source, reason) {
  return new ConcatError(`O vídeo «${source.source_name}» ${reason}. Remove-o ou substitui-o e tenta novamente.`);
}

async function freeBytes(directory) {
  const stats = await fs.promises.statfs(directory);
  return stats.bavail * stats.bsize;
}

function setProgress(taskId, progress) {
  return VideoTask.updateOne({ taskId, state: "EM_PROCESSAMENTO" }, { $max: { progress } }).catch(() => {});
}

// E9: refuse to start, or explain a failure, when the work directory has no room left.
async function ensureWorkspace(workDir, sources) {
  const needed = requiredWorkspaceBytes(sources.reduce((sum, source) => sum + (Number(source.sizeBytes) || 0), 0));
  if (await freeBytes(workDir) < needed) {
    throw new ConcatError("Não existe espaço de armazenamento suficiente para processar esta junção. Tenta mais tarde ou junta menos vídeos.");
  }
}

// E3/E2/E6: each clip is downloaded and probed again, since the stored metadata may be stale.
async function fetchClips(task, workDir, startedAt) {
  const clips = [];
  for (const [index, source] of task.sources.entries()) {
    if (await isCancelled(task.taskId)) return null;
    const inputPath = path.join(workDir, `clip_${index}${path.extname(source.source_name)}`);
    try {
      await downloadSource(task, inputPath, startedAt, source.source_key);
    } catch (error) {
      if (error.message === PROCESSING_TIMEOUT_MESSAGE || await isCancelled(task.taskId)) throw error;
      throw clipError(source, "deixou de estar disponível no armazenamento");
    }
    let metadata;
    try {
      metadata = await inspectVideo(inputPath, requireRemainingProcessingTime(startedAt, task.maxProcessingMs));
    } catch (error) {
      if (error.killed) throw error;
      throw clipError(source, "está corrompido ou não pode ser lido");
    }
    const described = describeClip(source.source_name, metadata);
    if (described.problem) throw clipError(source, `não pode ser usado: ${described.problem}`);
    clips.push({ ...described.clip, source, inputPath });
    await setProgress(task.taskId, Math.round(1 + (DOWNLOAD_END - 1) * (index + 1) / task.sources.length));
  }
  return clips;
}

// E7: converts each clip to the common format; returns the intermediates and their real durations.
async function normalizeClips(task, clips, plan, workDir, startedAt) {
  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const intermediates = [];
  let doneDuration = 0;
  for (const [index, clip] of clips.entries()) {
    if (await isCancelled(task.taskId)) return null;
    const outputPath = path.join(workDir, `part_${index}.mp4`);
    const from = DOWNLOAD_END + (NORMALIZE_END - DOWNLOAD_END) * (doneDuration / totalDuration);
    const to = DOWNLOAD_END + (NORMALIZE_END - DOWNLOAD_END) * ((doneDuration + clip.duration) / totalDuration);
    try {
      await spawnFfmpeg(
        { ...task, maxProcessingMs: requireRemainingProcessingTime(startedAt, task.maxProcessingMs) },
        normalizeClipArgs(clip.inputPath, outputPath, clip, plan),
        workDir,
        { duration: clip.duration, from, to },
      );
    } catch (error) {
      // Timeouts and cancellations keep their own message; any other ffmpeg exit is E7.
      if (await isCancelled(task.taskId) || !/^O FFmpeg terminou/.test(error.message)) throw error;
      throw new ConcatError(`Falhou a conversão do vídeo «${clip.name}» para o formato comum. Os vídeos originais não foram alterados.`);
    }
    const converted = await inspectVideo(outputPath, requireRemainingProcessingTime(startedAt, task.maxProcessingMs));
    intermediates.push({ path: outputPath, duration: converted.duration, source: clip.source });
    await fs.promises.rm(clip.inputPath, { force: true });
    doneDuration += clip.duration;
  }
  return intermediates;
}

// E8 + passo 9: joins the intermediates without re-encoding and checks the produced file.
async function joinClips(task, intermediates, workDir, startedAt) {
  const listPath = path.join(workDir, "list.txt");
  const outputPath = path.join(workDir, "output.mp4");
  const expectedDuration = intermediates.reduce((sum, part) => sum + part.duration, 0);
  await fs.promises.writeFile(listPath, concatListContent(intermediates.map((part) => part.path)), "utf8");
  try {
    await spawnFfmpeg(
      { ...task, maxProcessingMs: requireRemainingProcessingTime(startedAt, task.maxProcessingMs) },
      concatArgs(listPath, outputPath),
      workDir,
      { duration: expectedDuration, from: NORMALIZE_END, to: CONCAT_END },
    );
  } catch (error) {
    if (await isCancelled(task.taskId) || !/^O FFmpeg terminou/.test(error.message)) throw error;
    throw new ConcatError("Falhou a junção dos vídeos. O resultado parcial foi descartado e os originais não foram alterados.");
  }
  const result = await inspectVideo(outputPath, requireRemainingProcessingTime(startedAt, task.maxProcessingMs)).catch(() => null);
  const tolerance = Math.max(1, 0.05 * intermediates.length);
  if (!result || result.videoCodec !== "h264" || result.audioCodec !== "aac" || Math.abs(result.duration - expectedDuration) > tolerance) {
    throw new ConcatError("O vídeo produzido pela junção não é válido. O resultado foi descartado e os originais não foram alterados.");
  }
  return outputPath;
}

async function processConcatTask(task) {
  const taskId = task.taskId;
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picturas-concat-"));
  const state = { outputKey: null, thumbKey: null, resultAddedToProject: false };
  const startedAt = Date.now();
  const plainTask = task.toObject();
  try {
    const started = await VideoTask.updateOne(
      { taskId, state: { $in: ["EM_FILA", "EM_PROCESSAMENTO", "A_FINALIZAR"] } },
      { $set: { state: "EM_PROCESSAMENTO", progress: 1, startedAt: new Date() } },
    );
    if (!started.matchedCount) return;
    await ensureWorkspace(workDir, plainTask.sources);

    const clips = await fetchClips(plainTask, workDir, startedAt);
    if (!clips) return;
    // E6: the plan is recomputed from the downloaded files, which may differ from stored metadata.
    const plan = planNormalization(clips);
    const intermediates = await normalizeClips(plainTask, clips, plan, workDir, startedAt);
    if (!intermediates) return;
    const outputPath = await joinClips(plainTask, intermediates, workDir, startedAt);

    await consolidateResult(task, {
      outputPath,
      startedAt,
      buildSubtitles: () => {
        const subtitles = shiftSubtitles(intermediates.map((part) => ({ subtitles: part.source.subtitles, duration: part.duration })));
        return subtitles.length ? subtitles : undefined;
      },
    }, state);
  } catch (error) {
    // E9: a write that ran out of space surfaces as an ffmpeg or file-system error.
    const outOfSpace = error.code === "ENOSPC" || (await freeBytes(workDir).catch(() => Infinity)) < LOW_SPACE_BYTES;
    const reported = outOfSpace && !(error instanceof ConcatError)
      ? new ConcatError("Não existe espaço de armazenamento suficiente para concluir a junção. O resultado parcial foi descartado.")
      : error;
    await handleTaskFailure(task, reported, startedAt, state);
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await releaseCancelledLock(taskId);
  }
}

module.exports = { processConcatTask };