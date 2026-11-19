const mongoose = require("mongoose");

const resultSchema = new mongoose.Schema({
  type: { type: String, required: true },
  file_name: { type: String, required: true },
  img_key: { type: String, required: true },
  img_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  token: { type: Number, default: 0, index: true },
  // RNF-FIAB-01 (D3): "<project>:<token>:<img>:<step>" for results of image jobs;
  // unique, so a repeated reply can never publish a second result.
  run_key: { type: String, required: false },
});

resultSchema.index({ run_key: 1 }, { unique: true, partialFilterExpression: { run_key: { $exists: true } } });

module.exports = mongoose.model("result", resultSchema);
