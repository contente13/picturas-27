const mongoose = require("mongoose");

var processSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  img_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  msg_id: { type: String, required: true },
  cur_pos: { type: Number, required: true },
  og_img_uri: { type: String, required: true },
  new_img_uri: { type: String, required: true },
  runner_id: { type: String, required: false },  
  cache_key: { type: String, required: false },
  cancelToken: { type: Number, required: false },
  token: { type: Number, required: true },
  // RNF-FIAB-01 (D3/D4): image jobs of a processing run keep one document for the
  // whole chain. Documents without `state` are legacy ones (previews, videos, frame
  // extraction): they exist while pending and are deleted when done.
  state: { type: String, enum: ["PENDING_DISPATCH", "DISPATCHED", "COMPLETED", "FAILED"], required: false },
  pipeline: { type: Array, default: undefined },          // image tools snapshot of the run
  out_uri: { type: String, required: false },             // media output name; steps write under out/runs/
  dispatch_at: { type: Date, required: false },           // last (re)publish of the current step
  handle_failures: { type: Number, required: false },     // transient failures handling a reply
  error: { type: mongoose.Schema.Types.Mixed, required: false },
}, { timestamps: true });

const jobsOnly = { partialFilterExpression: { state: { $exists: true } } };
processSchema.index({ project_id: 1, token: 1, img_id: 1 }, { unique: true, name: "job_unique", ...jobsOnly });
processSchema.index({ msg_id: 1 }, { unique: true, name: "job_msg_id_unique", ...jobsOnly });
processSchema.index({ msg_id: 1 });
processSchema.index({ state: 1, dispatch_at: 1 }, { name: "job_state", ...jobsOnly });

module.exports = mongoose.model("process", processSchema);
