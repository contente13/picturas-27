// Daily operation quota of video tasks, kept by the users service per user: reserved when a task
// is accepted, committed when it succeeds and released on any other outcome.
const axios = require("axios");
const VideoTask = require("../models/videoTask");
const { httpsAgent } = require("../utils/httpsAgent");

const usersUrl = "https://users:10001/";
const USER_SERVICE_TIMEOUT_MS = 5000;

function userServiceOptions() {
  return {
    httpsAgent,
    timeout: USER_SERVICE_TIMEOUT_MS,
    // Also bound connection establishment and responses that never finish.
    signal: AbortSignal.timeout(USER_SERVICE_TIMEOUT_MS),
  };
}

function getUserType(userId) {
  return axios.get(`${usersUrl}${userId}/type/`, userServiceOptions())
    .then((response) => response.data?.type);
}

// Only these fields may leave the Project Service for the editor (RNG-10).
async function getProjectVideoPolicy(ownerId) {
  const { data } = await axios.get(`${usersUrl}${ownerId}`, userServiceOptions());
  if (!["anonymous", "free", "premium"].includes(data?.type)) {
    throw new Error("Invalid project owner profile");
  }
  const remaining = data.remaining_operations;
  if (data.type === "free" && (!Number.isInteger(remaining) || remaining < 0)) {
    throw new Error("Invalid project owner quota");
  }
  return {
    ownerId: String(ownerId),
    userType: data.type,
    remainingOperations: data.type === "premium" ? null : data.type === "anonymous" ? 0 : remaining,
  };
}

async function reserveOperation(userId, amount, reservationId) {
  if (!amount) return;
  const response = await axios.post(
    `${usersUrl}${userId}/process/${amount}/reserve/${encodeURIComponent(reservationId)}`,
    {},
    userServiceOptions(),
  );
  return response.data;
}

async function refundOperation(userId, amount, reservationId) {
  if (!amount) return;
  await axios.post(`${usersUrl}${userId}/process/refund/${amount}`, reservationId ? { reservationId } : {}, userServiceOptions());
}

async function commitOperation(userId, reservationId) {
  if (!reservationId) return;
  await axios.post(`${usersUrl}${userId}/process/commit/${encodeURIComponent(reservationId)}`, {}, userServiceOptions());
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

module.exports = {
  commitReservation,
  getUserType,
  getProjectVideoPolicy,
  refundOperation,
  releaseReservation,
  reserveOperation,
};
