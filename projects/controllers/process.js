var Process = require("../models/process");

module.exports.getAll = async () => {
  return await Process.find().sort({ _id: 1 }).exec();
};

module.exports.getProject = async (user_id, project_id) => {
  return await Process.find({ user_id: user_id, project_id: project_id })
    .sort({ _id: 1 })
    .exec();
};

module.exports.getOne = async (user_id, project_id, process_id) => {
  return await Process.findOne({
    user_id: user_id,
    project_id: project_id,
    _id: process_id,
  }).exec();
};

module.exports.getOneByMsgId = async (msg_id) => {
  return await Process.findOne({ msg_id }).exec();
};

module.exports.create = async (process) => {
  return await Process.create(process);
};

module.exports.update = (user_id, project_id, process_id, process) => {
  return Process.updateOne(
    { user_id: user_id, project_id: project_id, _id: process_id },
    process,
  );
};

module.exports.delete = (user_id, project_id, process_id) => {
  return Process.deleteOne({
    user_id: user_id,
    project_id: project_id,
    _id: process_id,
  });
};

// Pending documents of a run: legacy ones exist until done; image jobs (RNF-FIAB-01)
// stay with a terminal state. Previews never block a run commit.
module.exports.countByProjectAndToken = async (project_id, token) => {
  return await Process.countDocuments({
    project_id, token,
    state: { $nin: ["COMPLETED", "FAILED"] },
    msg_id: { $not: /^preview-/ },
  }).exec();
};

