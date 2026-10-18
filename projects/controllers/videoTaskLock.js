// RNG-11: at most one active video task per project, whatever the tool. Tasks of the same user
// in other projects do not block. The unique partial index on active_project_id
// (models/videoTask.js) makes the check atomic: of two simultaneous requests only one task can be
// saved; the other fails with E11000 and is answered with projectBusyMessage.
const VideoTask = require("../models/videoTask");

const ACTIVE_STATES = ["EM_FILA", "EM_PROCESSAMENTO", "A_FINALIZAR"];
const OPERATION_LABELS = {
  trim: "um recorte",
  subtitles: "uma incorporação de legendas",
  generate_subtitles: "uma geração automática de legendas",
  concat: "uma junção de vídeos",
};

function findActiveProjectTask(projectId) {
  return VideoTask.findOne({ project_id: projectId, state: { $in: ACTIVE_STATES } }).select("operation").lean();
}

function projectBusyMessage(activeTask) {
  const label = OPERATION_LABELS[activeTask?.operation] || "outra operação de vídeo";
  return `Este projeto já tem ${label} em curso. Aguarda que termine ou cancela-a antes de iniciar outra operação de vídeo.`;
}

// Removes the lock of a task cancelled while it was running, once its worker has stopped.
function releaseCancelledLock(taskId) {
  return VideoTask.updateOne({ taskId, state: "CANCELADA" }, { $unset: { active_project_id: "" } })
    .catch((error) => console.error("Could not release the cancelled video task lock:", error.message));
}

// Tasks created before RNG-11 were locked per user (active_user_id). Active ones are moved to the
// project lock, and syncIndexes drops the old unique per-user index, which would otherwise keep
// blocking a second task of the same user in another project.
async function migrateTaskLocks() {
  await VideoTask.collection.updateMany(
    { active_user_id: { $type: "string" } },
    [{ $set: { active_project_id: { $toString: "$project_id" } } }, { $unset: "active_user_id" }],
  );
  await VideoTask.syncIndexes();
}

module.exports = {
  ACTIVE_STATES,
  findActiveProjectTask,
  migrateTaskLocks,
  projectBusyMessage,
  releaseCancelledLock,
};