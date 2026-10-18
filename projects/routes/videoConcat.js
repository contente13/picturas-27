// UC-VID-003 — Juntar vários vídeos.
//   POST …/video/concat/validate  passos 4–5: validates the confirmed sequence and returns the
//                                  normalization plan, without creating a task or reserving quota;
//   POST …/video/concat           passo 6: validates again and queues the concatenation task.
// Progress, cancellation and recovery use the generic task routes in routes/video.js.
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Project = require("../controllers/project");
const VideoTask = require("../models/videoTask");
const { is_object_readable } = require("../utils/imageStorage");
const { planNormalization, validateConcatSelection } = require("../utils/videoConcat");
const { checkSharePermission, requireEditPermission } = require("../middleware/shareAuth");
const { requireVideoAccess } = require("../middleware/videoAccess");
const { findActiveProjectTask, projectBusyMessage } = require("../controllers/videoTaskLock");
const { enqueueTask, getUserType, refundOperation, reserveOperation } = require("../controllers/videoTasks");

const router = express.Router();

// E3: every selected clip must still be readable in storage before a task is accepted.
async function findUnavailableClips(userId, projectId, clips) {
  const checks = await Promise.all(clips.map(async (clip) => ({
    clip,
    readable: await is_object_readable(userId, projectId, "src", clip.sourceKey, { timeout: 5000 }),
  })));
  return checks.filter((check) => !check.readable).map(({ clip }) => ({
    imageId: clip.imageId,
    name: clip.name,
    reason: "não está disponível no armazenamento ou não pode ser lido",
    rule: "E3",
  }));
}

// Loads the project and the user profile and validates the ordered selection in req.body.imageIds.
async function prepareSelection(req) {
  const project = await Project.getOne(req.params.user, req.params.project);
  if (!project) return { status: 404, body: { message: "Projeto não encontrado." } };
  const userType = await getUserType(req.params.user);
  const selection = validateConcatSelection(project.imgs, req.body?.imageIds, userType);
  if (!selection.ok) return { status: selection.status, body: { message: selection.message, problems: selection.problems } };
  const unavailable = await findUnavailableClips(req.params.user, req.params.project, selection.clips);
  if (unavailable.length) {
    const names = unavailable.map((problem) => `«${problem.name}»`).join(", ");
    return {
      status: 422,
      body: { message: `Não é possível ler ${names}. Remove ou substitui esse vídeo e tenta novamente.`, problems: unavailable },
    };
  }
  return { userType, selection };
}

function clipSummary(clip) {
  const { imageId, name, format, duration, width, height, fps, videoCodec, audioCodec, hasAudio, sizeBytes } = clip;
  return { imageId, name, format, duration, width, height, fps, videoCodec, audioCodec, hasAudio, sizeBytes };
}

router.post(
  "/:user/:project/video/concat/validate",
  checkSharePermission,
  requireEditPermission,
  requireVideoAccess,
  async (req, res) => {
    try {
      const prepared = await prepareSelection(req);
      if (prepared.body) return res.status(prepared.status).json(prepared.body);
      const { clips, totals, limits } = prepared.selection;
      const plan = planNormalization(clips);
      return res.json({
        clips: clips.map(clipSummary),
        totals,
        limits: { maxVideos: limits.maxVideos, maxDurationSeconds: limits.maxDurationSeconds, maxSizeBytes: limits.maxSizeBytes },
        plan: { width: plan.width, height: plan.height, fps: plan.fps, notes: plan.notes },
      });
    } catch (error) {
      console.error("Could not validate a video concatenation:", error);
      return res.status(503).json({ message: "Não foi possível validar a sequência. Tenta novamente mais tarde." });
    }
  },
);

router.post(
  "/:user/:project/video/concat",
  checkSharePermission,
  requireEditPermission,
  requireVideoAccess,
  async (req, res) => {
    let reservationAttempted = false;
    let savedTaskId = null;
    let taskId = null;
    try {
      const prepared = await prepareSelection(req);
      if (prepared.body) return res.status(prepared.status).json(prepared.body);
      const { userType, selection } = prepared;
      const { clips, totals, limits } = selection;

      // E10 / RN18: one active video operation per project, whatever the tool.
      const activeTask = await findActiveProjectTask(req.params.project);
      if (activeTask) return res.status(409).json({ message: projectBusyMessage(activeTask) });

      // RN16: a registered user reserves one operation, consumed only if the task succeeds.
      taskId = uuidv4();
      let reserved = false;
      if (userType === "free") {
        reservationAttempted = true;
        await reserveOperation(req.params.user, 1, taskId);
        reserved = true;
      }

      const first = clips[0];
      const task = new VideoTask({
        taskId,
        operation: "concat",
        user_id: req.params.user,
        project_id: req.params.project,
        image_id: first.imageId,
        source_key: first.sourceKey,
        source_name: first.name,
        tempoInicio: 0,
        tempoFim: totals.durationSeconds,
        durationSeconds: totals.durationSeconds,
        sources: clips.map((clip) => ({
          image_id: clip.imageId,
          source_key: clip.sourceKey,
          source_name: clip.name,
          duration: clip.duration,
          sizeBytes: clip.sizeBytes,
          subtitles: clip.subtitles,
        })),
        maxProcessingMs: limits.maxProcessingMs,
        state: "EM_FILA",
        progress: 0,
        reservedOperation: reserved,
        active_project_id: String(req.params.project),
      });
      await task.save();
      savedTaskId = taskId;
      await enqueueTask(taskId);
      return res.status(202).json({ tarefaId: taskId, estado: task.state });
    } catch (error) {
      if (savedTaskId) {
        await VideoTask.updateOne({ taskId: savedTaskId, state: "EM_FILA" }, {
          $set: { state: "FALHADA", error: "Não foi possível colocar a tarefa na fila.", completedAt: new Date() },
          $unset: { active_project_id: "" },
        }).catch(() => {});
      }
      if (reservationAttempted) {
        await refundOperation(req.params.user, 1, taskId).then(async () => {
          if (savedTaskId) await VideoTask.updateOne({ taskId: savedTaskId, reservedOperation: true }, { $set: { reservedOperation: false } });
        }).catch((refundError) => console.error("Could not release the concatenation quota:", refundError.message));
      }
      if (error.code === 11000) {
        return res.status(409).json({ message: projectBusyMessage(await findActiveProjectTask(req.params.project).catch(() => null)) });
      }
      if (error.response?.status === 701) return res.status(429).json({ message: error.response.data });
      console.error("Could not create a video concatenation task:", error);
      return res.status(503).json({ message: "Não foi possível iniciar a junção. Tenta novamente mais tarde." });
    }
  },
);

module.exports = router;