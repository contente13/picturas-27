const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Project = require("../controllers/project");
const VideoTask = require("../models/videoTask");
const { getCallerId } = require("../utils/caller");
const { get_image_public_url } = require("../utils/imageStorage");
const { checkSharePermission, requireEditPermission } = require("../middleware/shareAuth");
const {
  cancelTask,
  enqueueTask,
  getUserType,
  refundOperation,
  reserveOperation,
} = require("../controllers/videoTrim");

const router = express.Router();
const ACTIVE_STATES = ["EM_FILA", "EM_PROCESSAMENTO", "A_FINALIZAR"];
const CANCELLABLE_STATES = ["EM_FILA", "EM_PROCESSAMENTO"];

function requireVideoAccess(req, res, next) {
  const callerId = getCallerId(req);
  if (!callerId) return res.status(401).jsonp("Authentication required");
  if (String(callerId) !== String(req.params.user) && !req.sharedPermission) {
    return res.status(403).jsonp("Not allowed");
  }
  next();
}

function invalidInterval(start, end, duration) {
  const hasTenthPrecision = (value) => Math.abs(value * 10 - Math.round(value * 10)) < 0.001;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Os tempos de início e fim têm de ser números válidos.";
  if (!hasTenthPrecision(start) || !hasTenthPrecision(end)) return "Os tempos têm de ser múltiplos de 0,1 segundo.";
  if (start < 0 || end > duration || start >= end) return "O intervalo tem de estar dentro da duração do vídeo e T_in tem de ser inferior a T_out.";
  if (end - start < 1) return "A duração mínima do recorte é de 1 segundo.";
  if (end - start >= duration) return "O recorte tem de ser mais curto do que o vídeo original.";
  return null;
}

router.post(
  "/:user/:project/video/:imageId/trim",
  checkSharePermission,
  requireEditPermission,
  requireVideoAccess,
  async (req, res) => {
    let reserved = false;
    let reservationAttempted = false;
    let savedTaskId = null;
    let taskId = null;
    try {
      const project = await Project.getOne(req.params.user, req.params.project);
      if (!project) return res.status(404).jsonp("Project not found");
      const source = project.imgs.id(req.params.imageId);
      if (!source || !source.mediaMetadata?.duration) {
        return res.status(404).jsonp("O vídeo selecionado não tem metadados válidos no projeto.");
      }

      const sourceName = require("path").basename(source.og_uri);
      if (!/\.(mp4|webm)$/i.test(sourceName)) {
        return res.status(415).jsonp("Formato não suportado. Usa um vídeo MP4 ou WebM compatível.");
      }

      const start = Number(req.body?.tempoInicio);
      const end = Number(req.body?.tempoFim);
      const intervalError = invalidInterval(start, end, Number(source.mediaMetadata.duration));
      if (intervalError) return res.status(400).jsonp(intervalError);

      const userType = await getUserType(req.params.user);
      if (!["free", "premium"].includes(userType)) {
        return res.status(403).jsonp("O recorte de vídeo está disponível para contas Registadas e Premium.");
      }
      const durationLimit = userType === "premium" ? 600 : 60;
      if (end - start > durationLimit) {
        return res.status(400).jsonp(`O recorte excede o limite de ${durationLimit} segundos do teu perfil.`);
      }

      const activeTask = await VideoTask.findOne({ user_id: req.params.user, state: { $in: ACTIVE_STATES } });
      if (activeTask) return res.status(409).jsonp("Já tens uma tarefa de vídeo em curso. Aguarda que termine.");

      taskId = uuidv4();
      if (userType === "free") {
        reservationAttempted = true;
        await reserveOperation(req.params.user, 1, taskId);
        reserved = true;
      }

      const task = new VideoTask({
        taskId,
        user_id: req.params.user,
        project_id: req.params.project,
        image_id: String(source._id),
        source_key: source.og_img_key,
        source_name: sourceName,
        tempoInicio: start,
        tempoFim: end,
        maxProcessingMs: userType === "premium" ? 900_000 : 120_000,
        state: "EM_FILA",
        progress: 0,
        reservedOperation: reserved,
        active_user_id: String(req.params.user),
      });
      await task.save();
      savedTaskId = taskId;
      await enqueueTask(taskId);
      return res.status(202).json({ tarefaId: taskId, estado: task.state });
    } catch (error) {
      if (savedTaskId) {
        await VideoTask.updateOne({ taskId: savedTaskId, state: "EM_FILA" }, {
          $set: { state: "FALHADA", error: "Não foi possível colocar a tarefa na fila.", completedAt: new Date() },
          $unset: { active_user_id: "" },
        }).catch(() => {});
      }
      if (reservationAttempted) {
        try {
          await refundOperation(req.params.user, 1, taskId);
          if (savedTaskId) {
            await VideoTask.updateOne({ taskId: savedTaskId, reservedOperation: true }, {
              $set: { reservedOperation: false },
            });
          }
        } catch (refundError) {
          console.error("Could not release operation reservation after task creation failure:", refundError.message);
        }
      }
      if (error.code === 11000) return res.status(409).jsonp("Já tens uma tarefa de vídeo em curso. Aguarda que termine.");
      console.error("Could not create video trim task:", error);
      const status = error.response?.status === 701
        ? 429
        : error.response?.status === 404 ? 404 : 503;
      return res.status(status).jsonp(error.response?.data || error.message || "Não foi possível criar a tarefa de recorte. Tenta novamente mais tarde.");
    }
  },
);

router.get(
  "/:user/:project/video/tasks/latest",
  checkSharePermission,
  requireVideoAccess,
  async (req, res) => {
    try {
      const task = await VideoTask.findOne({
        user_id: req.params.user,
        project_id: req.params.project,
      }).sort({ createdAt: -1 }).lean();
      if (!task) return res.json({ tarefa: null });
      let resultUrl = task.resultUrl;
      if (task.state === "CONCLUIDA" && task.resultImageId) {
        const project = await Project.getOne(task.user_id, task.project_id);
        const resultImage = project?.imgs.id(task.resultImageId);
        if (resultImage?.og_img_key) {
          const publicResponse = await get_image_public_url(
            task.user_id,
            task.project_id,
            "src",
            resultImage.og_img_key,
          );
          resultUrl = publicResponse.data.url;
        }
      }
      return res.json({
        tarefa: {
          tarefaId: task.taskId,
          imageId: task.image_id,
          estado: task.state === "A_FINALIZAR" ? "EM_PROCESSAMENTO" : task.state,
          progresso: task.progress,
          erro: task.error,
          recursoSaida: task.resultName,
          resultUrl,
          resultImageId: task.resultImageId,
        },
      });
    } catch (error) {
      console.error("Could not read the latest video trim task:", error);
      return res.status(500).jsonp("Não foi possível obter a última tarefa de recorte.");
    }
  },
);

router.get(
  "/:user/:project/video/tasks/:taskId",
  checkSharePermission,
  requireVideoAccess,
  async (req, res) => {
    try {
      const task = await VideoTask.findOne({
        taskId: req.params.taskId,
        user_id: req.params.user,
        project_id: req.params.project,
      }).lean();
      if (!task) return res.status(404).jsonp("Tarefa não encontrada.");
      return res.json({
        tarefaId: task.taskId,
        imageId: task.image_id,
        estado: task.state === "A_FINALIZAR" ? "EM_PROCESSAMENTO" : task.state,
        progresso: task.progress,
        erro: task.error,
        recursoSaida: task.resultName,
        resultUrl: task.resultUrl,
        resultImageId: task.resultImageId,
        projectVersion: task.state === "CONCLUIDA"
          ? (await Project.getOne(task.user_id, task.project_id))?.version ?? null
          : null,
      });
    } catch (error) {
      console.error("Could not read video trim task:", error);
      return res.status(500).jsonp("Não foi possível obter o estado da tarefa.");
    }
  },
);

router.post(
  "/:user/:project/video/tasks/:taskId/cancel",
  checkSharePermission,
  requireEditPermission,
  requireVideoAccess,
  async (req, res) => {
    try {
      const task = await VideoTask.findOne({
        taskId: req.params.taskId,
        user_id: req.params.user,
        project_id: req.params.project,
      });
      if (!task) return res.status(404).jsonp("Tarefa não encontrada.");
      if (!CANCELLABLE_STATES.includes(task.state)) {
        return res.status(409).jsonp({ message: "A tarefa já terminou.", estado: task.state });
      }
      const cancelled = await cancelTask(task);
      if (!cancelled) return res.status(409).jsonp("A tarefa já terminou.");
      return res.json({ tarefaId: task.taskId, estado: "CANCELADA" });
    } catch (error) {
      console.error("Could not cancel video trim task:", error);
      return res.status(500).jsonp("Não foi possível cancelar a tarefa.");
    }
  },
);

module.exports = router;
