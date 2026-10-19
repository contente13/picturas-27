const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Project = require("../controllers/project");
const ProjectModel = require("../models/project");
const VideoTask = require("../models/videoTask");
const { validateSubtitleSegments } = require("../utils/subtitles");
const { get_image_public_url } = require("../utils/imageStorage");
const { checkSharePermission, requireEditPermission } = require("../middleware/shareAuth");
const { requireVideoAccess } = require("../middleware/videoAccess");
const { findActiveProjectTask, projectBusyMessage } = require("../controllers/videoTaskLock");
const { muxSubtitles } = require("../controllers/videoDownload");
const {
  cancelTask,
  enqueueTask,
  getUserType,
  refundOperation,
  reserveOperation,
} = require("../controllers/videoTasks");

const router = express.Router();
const CANCELLABLE_STATES = ["EM_FILA", "EM_PROCESSAMENTO"];
// UC-VID-001 RN14: source-video duration limit for subtitle embedding.
const SUBTITLE_EMBED_DURATION_LIMIT_SECONDS = { free: 60, premium: 600 };
const PREMIUM_VIDEO_SIZE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const PREMIUM_VIDEO_DURATION_LIMIT_SECONDS = 60 * 60;
router.get(
  "/:user/:project/video/:imageId/subtitles",
  checkSharePermission,
  requireVideoAccess,
  async (req, res) => {
    try {
      const project = await Project.getOne(req.params.user, req.params.project);
      if (!project) return res.status(404).jsonp("Project not found");
      const video = project.imgs.id(req.params.imageId);
      if (!video) return res.status(404).jsonp("O vídeo já não está disponível no projeto.");
      return res.json({ segments: video.subtitles || [], subtitlesUpdatedAt: video.subtitlesUpdatedAt || null, projectVersion: project.version });
    } catch (error) {
      console.error("Could not load video subtitles:", error);
      return res.status(500).jsonp("Não foi possível carregar as legendas.");
    }
  },
);

// UC-VID-001 RN5: the video with its saved subtitles as a track inside the file.
router.get(
  "/:user/:project/video/:imageId/with-subtitles",
  checkSharePermission,
  requireVideoAccess,
  async (req, res) => {
    try {
      const project = await Project.getOne(req.params.user, req.params.project);
      if (!project) return res.status(404).jsonp("Project not found");
      const video = project.imgs.id(req.params.imageId);
      const duration = Number(video?.mediaMetadata?.duration);
      if (!video || !Number.isFinite(duration)) return res.status(404).jsonp("O vídeo já não está disponível no projeto.");
      if (!video.subtitles?.length) return res.status(404).jsonp("Este vídeo não tem legendas guardadas.");
      const validationError = validateSubtitleSegments(video.subtitles, duration);
      if (validationError) return res.status(400).jsonp(validationError);

      const { outputPath, fileName, cleanup } = await muxSubtitles({
        userId: req.params.user,
        projectId: req.params.project,
        video,
        segments: video.subtitles,
      });
      return res.download(outputPath, fileName, () => cleanup());
    } catch (error) {
      console.error("Could not add the subtitles to the video download:", error);
      return res.status(error.status || 500).jsonp("Não foi possível preparar o vídeo com legendas.");
    }
  },
);

router.put(
  "/:user/:project/video/:imageId/subtitles",
  checkSharePermission,
  requireEditPermission,
  requireVideoAccess,
  async (req, res) => {
    try {
      const project = await Project.getOne(req.params.user, req.params.project);
      if (!project) return res.status(404).jsonp("Project not found");
      const video = project.imgs.id(req.params.imageId);
      const duration = Number(video?.mediaMetadata?.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) {
        return res.status(404).jsonp("O vídeo selecionado não tem metadados válidos no projeto.");
      }
      const validationError = validateSubtitleSegments(req.body?.segments, duration);
      if (validationError) return res.status(400).jsonp(validationError);
      const expectedVersion = Number(req.body?.projectVersion);
      if (!Number.isFinite(expectedVersion)) return res.status(400).jsonp("Falta a versão atual do projeto.");
      const saved = await ProjectModel.findOneAndUpdate(
        { _id: req.params.project, user_id: req.params.user, version: expectedVersion, "imgs._id": req.params.imageId },
        { $set: { "imgs.$.subtitles": req.body.segments, "imgs.$.subtitlesUpdatedAt": new Date() }, $inc: { version: 1 } },
        { new: true },
      ).select("version").lean();
      if (!saved) return res.status(409).jsonp("O projeto foi alterado noutra sessão. Atualiza os dados e tenta novamente.");
      return res.json({ segments: req.body.segments, projectVersion: saved.version });
    } catch (error) {
      console.error("Could not save video subtitles:", error);
      return res.status(500).jsonp("Não foi possível guardar as legendas.");
    }
  },
);

router.post(
  "/:user/:project/video/:imageId/subtitles/generate",
  checkSharePermission,
  requireEditPermission,
  requireVideoAccess,
  async (req, res) => {
    let savedTaskId = null;
    let taskId = null;
    try {
      const project = await Project.getOne(req.params.user, req.params.project);
      if (!project) return res.status(404).jsonp("Project not found");
      const source = project.imgs.id(req.params.imageId);
      const duration = Number(source?.mediaMetadata?.duration);
      if (!source || !Number.isFinite(duration) || duration <= 0) {
        return res.status(404).jsonp("O vídeo selecionado não tem metadados válidos no projeto.");
      }
      const sourceName = require("path").basename(source.og_uri);
      if (!/\.(mp4|webm)$/i.test(sourceName)) return res.status(415).jsonp("Formato não suportado. Usa um vídeo MP4 ou WebM compatível.");
      const sizeBytes = Number(source.mediaMetadata?.sizeBytes);
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return res.status(422).jsonp("Não foi possível validar o tamanho do vídeo para a geração automática.");
      }
      if (sizeBytes > PREMIUM_VIDEO_SIZE_LIMIT_BYTES) {
        return res.status(413).jsonp("A geração automática aceita vídeos até 2 GB, de acordo com os limites Premium.");
      }
      if (duration > PREMIUM_VIDEO_DURATION_LIMIT_SECONDS) {
        return res.status(413).jsonp("A geração automática aceita vídeos até 60 minutos, de acordo com os limites Premium.");
      }
      // UC-VID-001 E12 / UC-VID-000 FA2: a video without an audio track cannot be transcribed.
      if (source.mediaMetadata?.audioCodec === null) {
        return res.status(422).jsonp("Este vídeo não tem pista de áudio, por isso não é possível gerar legendas automaticamente. Podes criá-las manualmente.");
      }
      const userType = await getUserType(req.params.user);
      if (!["free", "premium"].includes(userType)) {
        return res.status(403).jsonp("A geração automática está disponível para contas Registadas e Premium durante a fase de testes.");
      }
      if (userType === "free" && process.env.ALLOW_FREE_SUBTITLE_AI_TESTING !== "true") {
        return res.status(403).jsonp("A geração automática requer o plano Premium.");
      }
      const activeTask = await findActiveProjectTask(req.params.project);
      if (activeTask) return res.status(409).jsonp(projectBusyMessage(activeTask));
      taskId = uuidv4();
      const task = new VideoTask({
        taskId,
        operation: "generate_subtitles",
        user_id: req.params.user,
        project_id: req.params.project,
        image_id: String(source._id),
        source_key: source.og_img_key,
        source_name: sourceName,
        tempoInicio: 0,
        tempoFim: duration,
        durationSeconds: duration,
        maxProcessingMs: 900_000,
        state: "EM_FILA",
        progress: 0,
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
      if (error.code === 11000) return res.status(409).jsonp(projectBusyMessage(await findActiveProjectTask(req.params.project).catch(() => null)));
      console.error("Could not create video subtitle generation task:", error.message);
      return res.status(503).jsonp("Não foi possível iniciar a geração automática. Tenta novamente mais tarde.");
    }
  },
);

router.post(
  "/:user/:project/video/:imageId/subtitles/embed",
  checkSharePermission,
  requireEditPermission,
  requireVideoAccess,
  async (req, res) => {
    let reservationAttempted = false;
    let savedTaskId = null;
    let taskId = null;
    try {
      const project = await Project.getOne(req.params.user, req.params.project);
      if (!project) return res.status(404).jsonp("Project not found");
      const source = project.imgs.id(req.params.imageId);
      const duration = Number(source?.mediaMetadata?.duration);
      if (!source || !Number.isFinite(duration) || duration <= 0) return res.status(404).jsonp("O vídeo selecionado não tem metadados válidos no projeto.");
      const sourceName = require("path").basename(source.og_uri);
      if (!/\.(mp4|webm)$/i.test(sourceName)) return res.status(415).jsonp("Formato não suportado. Usa um vídeo MP4 ou WebM compatível.");
      const segments = source.subtitles || [];
      const validationError = validateSubtitleSegments(segments, duration);
      if (validationError) return res.status(400).jsonp(validationError);
      if (!segments.length) return res.status(400).jsonp("Adiciona pelo menos uma legenda antes de a incorporar.");
      const userType = await getUserType(req.params.user);
      if (!["free", "premium"].includes(userType)) return res.status(403).jsonp("A incorporação de legendas está disponível para contas Registadas e Premium.");
      const limit = SUBTITLE_EMBED_DURATION_LIMIT_SECONDS[userType];
      if (duration > limit) return res.status(400).jsonp(`O vídeo excede o limite de ${limit} segundos do teu perfil.`);
      const activeTask = await findActiveProjectTask(req.params.project);
      if (activeTask) return res.status(409).jsonp(projectBusyMessage(activeTask));
      taskId = uuidv4();
      let reserved = false;
      if (userType === "free") {
        reservationAttempted = true;
        await reserveOperation(req.params.user, 1, taskId);
        reserved = true;
      }
      const task = new VideoTask({
        taskId,
        operation: "subtitles",
        user_id: req.params.user,
        project_id: req.params.project,
        image_id: String(source._id),
        source_key: source.og_img_key,
        source_name: sourceName,
        tempoInicio: 0,
        tempoFim: duration,
        durationSeconds: duration,
        subtitleSegments: segments.map(({ start, end, text }) => ({ start: Number(start), end: Number(end), text: String(text).trim() }))
          .sort((first, second) => first.start - second.start),
        maxProcessingMs: userType === "premium" ? 900_000 : 120_000,
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
        }).catch((refundError) => console.error("Could not release subtitles quota:", refundError.message));
      }
      if (error.code === 11000) return res.status(409).jsonp(projectBusyMessage(await findActiveProjectTask(req.params.project).catch(() => null)));
      console.error("Could not create video subtitle task:", error);
      return res.status(error.response?.status === 701 ? 429 : 503).jsonp(error.response?.data || "Não foi possível iniciar a incorporação. Tenta novamente mais tarde.");
    }
  },
);

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

      const activeTask = await findActiveProjectTask(req.params.project);
      if (activeTask) return res.status(409).jsonp(projectBusyMessage(activeTask));

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
      if (error.code === 11000) return res.status(409).jsonp(projectBusyMessage(await findActiveProjectTask(req.params.project).catch(() => null)));
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
      const taskFilter = {
        user_id: req.params.user,
        project_id: req.params.project,
      };
      if (req.query.operation === "subtitles") taskFilter.operation = "subtitles";
      else if (req.query.operation === "generate_subtitles") taskFilter.operation = "generate_subtitles";
      else if (req.query.operation === "concat") taskFilter.operation = "concat";
      else taskFilter.$or = [{ operation: "trim" }, { operation: { $exists: false } }];
      const task = await VideoTask.findOne(taskFilter).sort({ createdAt: -1 }).lean();
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
          segments: task.operation === "generate_subtitles" ? task.subtitleSegments : undefined,
          operation: task.operation,
          completedAt: task.completedAt,
          imageIds: task.operation === "concat" ? task.sources.map((source) => source.image_id) : undefined,
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
        segments: task.operation === "generate_subtitles" && task.state === "CONCLUIDA" ? task.subtitleSegments : undefined,
        operation: task.operation,
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