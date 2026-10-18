const mongoose = require("mongoose");

const videoTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true, index: true },
  operation: { type: String, enum: ["trim", "subtitles", "generate_subtitles", "concat"], default: "trim", index: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  image_id: { type: String, required: true },
  source_key: { type: String, required: true },
  source_name: { type: String, required: true },
  tempoInicio: { type: Number, required: true },
  tempoFim: { type: Number, required: true },
  durationSeconds: { type: Number, default: null },
  subtitleSegments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // Concatenation (UC-VID-003): the selected clips in the confirmed order, with a snapshot of the
  // fields the worker needs ({ image_id, source_key, source_name, duration, sizeBytes, subtitles }).
  sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
  maxProcessingMs: { type: Number, required: true },
  state: {
    type: String,
    enum: ["EM_FILA", "EM_PROCESSAMENTO", "A_FINALIZAR", "CONCLUIDA", "FALHADA", "CANCELADA"],
    default: "EM_FILA",
    index: true,
  },
  progress: { type: Number, default: 0 },
  error: { type: String, default: null },
  resultName: { type: String, default: null },
  resultUrl: { type: String, default: null },
  resultImageId: { type: String, default: null },
  reservedOperation: { type: Boolean, default: false },
  // Project lock (RNG-11): set while the task is queued, processing or finalizing, and removed
  // when it ends. The unique partial index below allows at most one active video task per
  // project, whatever the tool, while the same user can have tasks in different projects.
  active_project_id: { type: String, default: undefined },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

videoTaskSchema.index(
  { active_project_id: 1 },
  { unique: true, partialFilterExpression: { active_project_id: { $type: "string" } } },
);

module.exports = mongoose.model("video_task", videoTaskSchema);