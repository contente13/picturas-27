// RNG-11: at most one active video task per project, whatever the tool; the same user may have
// tasks in different projects. Integration tests: the real routes, model, unique index and worker
// code run against a throw-away MongoDB database. Only the users service (quota), RabbitMQ and the
// Whisper service are replaced by in-process stubs.
//
//   MONGO_TEST_URL=mongodb://projects_mongoDB:27018/picturas_test npm test
//
// Skipped when MONGO_TEST_URL is not set.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Each integration file uses its own database: node --test runs the files in parallel.
const mongoUrl = process.env.MONGO_TEST_URL;
const skip = !mongoUrl && "MONGO_TEST_URL not set";

// ---- stubs, installed before the modules that destructure them are loaded ----
const userTypes = new Map();
const quota = new Map();
const reservations = new Set();
const VideoTask = require("../models/videoTask");
const videoQuota = require("../controllers/videoQuota");
videoQuota.releaseReservation = async (taskId) => {
  const task = await VideoTask.findOne({ taskId, reservedOperation: true }).lean();
  if (!task || !reservations.delete(taskId)) return;
  const id = String(task.user_id);
  quota.set(id, (quota.get(id) ?? 5) + 1);
  await VideoTask.updateOne({ taskId, reservedOperation: true }, { $set: { reservedOperation: false } });
};
const videoUtils = require("../utils/video");
let inspectVideoImpl = videoUtils.inspectVideo;
videoUtils.inspectVideo = (...args) => inspectVideoImpl(...args);
const videoPipeline = require("../controllers/videoPipeline");
videoPipeline.downloadSource = async () => {};
const subtitlesAI = require("../controllers/subtitlesAI");
let generateImpl = async () => [{ start: 0, end: 2, text: "olá" }];
subtitlesAI.generateSubtitleSegments = (...args) => generateImpl(...args);

const videoTasks = require("../controllers/videoTasks");
videoTasks.getUserType = async (userId) => userTypes.get(String(userId));
videoTasks.enqueueTask = async () => {};
// Mirrors the users service: check and decrement happen in one atomic step per user.
videoTasks.reserveOperation = async (userId, amount, reservationId) => {
  const id = String(userId);
  if (userTypes.get(id) === "premium") return { allowed: true };
  const left = quota.get(id) ?? 5;
  if (left < amount) {
    const error = new Error("quota");
    error.response = { status: 701, data: "A quota diária foi esgotada. A quota é reposta às 00:00 (hora de Lisboa)." };
    throw error;
  }
  quota.set(id, left - amount);
  reservations.add(reservationId);
  await new Promise((resolve) => setImmediate(resolve));
  return { allowed: true };
};
// Like the users service, refunding an unknown reservation is a no-op (idempotent settlement).
videoTasks.refundOperation = async (userId, amount, reservationId) => {
  if (!reservations.delete(reservationId)) return;
  const id = String(userId);
  quota.set(id, (quota.get(id) ?? 5) + amount);
};

const express = require("express");
const ProjectModel = require("../models/project");
const { processTask, migrateTaskLocks } = require("../controllers/videoTasks");
const videoRouter = require("../routes/video");

let server;
let baseUrl;

function newUser(type, operationsLeft = 5) {
  const id = String(new mongoose.Types.ObjectId());
  userTypes.set(id, type);
  quota.set(id, operationsLeft);
  return id;
}

async function newProject(userId, duration = 30) {
  const project = await ProjectModel.create({
    name: "teste",
    user_id: userId,
    imgs: [{
      og_uri: "./images/x/src/clip.mp4",
      new_uri: "./images/x/out/clip.mp4",
      og_img_key: "missing-object.mp4",
      og_sha256: "0",
      mediaMetadata: { duration, sizeBytes: 1_000_000, audioCodec: "aac", videoCodec: "h264", format: "mp4" },
      subtitles: [{ start: 1, end: 3, text: "legenda" }],
    }],
  });
  return { id: String(project._id), imageId: String(project.imgs[0]._id) };
}

function request(method, path, userId, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-caller-id": userId },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));
}

const trim = (user, project) => request("POST", `/${user}/${project.id}/video/${project.imageId}/trim`, user, { tempoInicio: 0, tempoFim: 10 });
const embed = (user, project) => request("POST", `/${user}/${project.id}/video/${project.imageId}/subtitles/embed`, user);
const generate = (user, project) => request("POST", `/${user}/${project.id}/video/${project.imageId}/subtitles/generate`, user);
const cancel = (user, project, taskId) => request("POST", `/${user}/${project.id}/video/tasks/${taskId}/cancel`, user);
const activeTasks = (project) => VideoTask.countDocuments({ project_id: project.id, state: { $in: ["EM_FILA", "EM_PROCESSAMENTO", "A_FINALIZAR"] } });

async function waitFor(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test.describe("RNG-11: one active video operation per project", { skip }, () => {
  test.before(async () => {
    await mongoose.connect(mongoUrl, { dbName: "picturas_test_rng11" });
    await mongoose.connection.db.dropDatabase();
    await VideoTask.syncIndexes();
    const app = express();
    app.use(express.json());
    app.use("/", videoRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    server?.close();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test("same user, two different projects: both tasks are accepted", async () => {
    const user = newUser("free");
    const [a, b] = [await newProject(user), await newProject(user)];
    assert.equal((await trim(user, a)).status, 202);
    assert.equal((await trim(user, b)).status, 202);
  });

  test("same user, two tasks in the same project: only the first is accepted", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    assert.equal((await trim(user, project)).status, 202);
    const second = await trim(user, project);
    assert.equal(second.status, 409);
    assert.match(second.body, /Este projeto já tem um recorte em curso/);
    assert.equal(await activeTasks(project), 1);
  });

  test("different tools in the same project: the second operation is rejected", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    assert.equal((await generate(user, project)).status, 202);
    const second = await trim(user, project);
    const third = await embed(user, project);
    assert.equal(second.status, 409);
    assert.equal(third.status, 409);
    assert.match(third.body, /geração automática de legendas em curso/);
  });

  test("simultaneous requests for the same project: at most one is accepted and only its quota is kept", async () => {
    const user = newUser("free", 5);
    const project = await newProject(user);
    const results = await Promise.all([trim, embed, trim, embed, trim, trim].map((operation) => operation(user, project)));
    const statuses = results.map((result) => result.status);
    assert.equal(statuses.filter((status) => status === 202).length, 1, `statuses: ${statuses}`);
    assert.ok(statuses.every((status) => status === 202 || status === 409), `statuses: ${statuses}`);
    assert.equal(await activeTasks(project), 1);
    assert.equal(quota.get(user), 4, "rejected requests must not keep a reserved operation");
  });

  test("registered user with one operation left, two projects at the same time: quota allows only one", async () => {
    const user = newUser("free", 1);
    const [a, b] = [await newProject(user), await newProject(user)];
    const statuses = (await Promise.all([trim(user, a), trim(user, b)])).map((result) => result.status).sort();
    assert.deepEqual(statuses, [202, 429]);
    assert.equal(quota.get(user), 0);
  });

  test("premium user, requests in different projects: all are accepted", async () => {
    const user = newUser("premium");
    const projects = [await newProject(user), await newProject(user), await newProject(user)];
    const statuses = (await Promise.all(projects.map((project) => trim(user, project)))).map((result) => result.status);
    assert.deepEqual(statuses, [202, 202, 202]);
  });

  test("MAN-17 / REQ-VID-LEG-016: subtitle embedding enforces each profile duration boundary", async () => {
    for (const [type, allowedDuration, rejectedDuration] of [
      ["free", 60, 61],
      ["premium", 600, 601],
    ]) {
      const user = newUser(type, 5);
      const allowedProject = await newProject(user, allowedDuration);
      const accepted = await embed(user, allowedProject);
      assert.equal(accepted.status, 202, `${type}: exact limit must be accepted`);
      assert.equal(quota.get(user), type === "free" ? 4 : 5);

      const rejectedProject = await newProject(user, rejectedDuration);
      const rejected = await embed(user, rejectedProject);
      assert.equal(rejected.status, 400, `${type}: duration above limit must be refused`);
      assert.match(rejected.body, /limite de/);
      assert.equal(await activeTasks(rejectedProject), 0, "a rejected duration must not create a task");
      assert.equal(quota.get(user), type === "free" ? 4 : 5, "a rejected duration must not reserve quota");
    }
  });

  test("MAN-20 / REQ-VID-TRIM-013: an unreadable source fails without a result and refunds quota", async () => {
    const user = newUser("free", 1);
    const project = await newProject(user);
    const accepted = await trim(user, project);
    assert.equal(accepted.status, 202);
    assert.equal(quota.get(user), 0);

    const originalInspectVideo = inspectVideoImpl;
    inspectVideoImpl = async () => { throw new Error("O ficheiro de vídeo está corrompido ou não pode ser lido."); };
    try {
      await processTask(accepted.body.tarefaId);
    } finally {
      inspectVideoImpl = originalInspectVideo;
    }

    const task = await VideoTask.findOne({ taskId: accepted.body.tarefaId }).lean();
    assert.equal(task.state, "FALHADA");
    assert.match(task.error, /corrompido|não pode ser lido/);
    assert.equal(task.reservedOperation, false);
    assert.equal(quota.get(user), 1, "a failed task must refund the reserved operation");
    assert.equal(await activeTasks(project), 0);
    assert.equal((await ProjectModel.findById(project.id).lean()).imgs.length, 1, "no result video may be published");
  });

  test("a cancelled queued task frees the project", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    const { body } = await trim(user, project);
    assert.equal((await cancel(user, project, body.tarefaId)).status, 200);
    assert.equal((await trim(user, project)).status, 202);
  });

  test("a completed task frees the project", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    generateImpl = async () => [{ start: 0, end: 2, text: "olá" }];
    const { body } = await generate(user, project);
    await processTask(body.tarefaId);
    assert.equal((await VideoTask.findOne({ taskId: body.tarefaId })).state, "CONCLUIDA");
    assert.equal((await trim(user, project)).status, 202);
  });

  test("a failed task frees the project", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    generateImpl = async () => { throw new Error("falha simulada"); };
    const { body } = await generate(user, project);
    await processTask(body.tarefaId);
    assert.equal((await VideoTask.findOne({ taskId: body.tarefaId })).state, "FALHADA");
    assert.equal((await trim(user, project)).status, 202);
  });

  test("cancelling a task while it is processing frees the project and its late result is discarded", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    let release;
    generateImpl = () => new Promise((resolve) => { release = () => resolve([{ start: 0, end: 2, text: "tardio" }]); });
    const { body } = await generate(user, project);
    const running = processTask(body.tarefaId);
    assert.ok(await waitFor(async () => (await VideoTask.findOne({ taskId: body.tarefaId })).state === "EM_PROCESSAMENTO"));
    assert.equal((await cancel(user, project, body.tarefaId)).status, 200);
    release(); // the service answers after the cancellation
    await running;
    const task = await VideoTask.findOne({ taskId: body.tarefaId }).lean();
    assert.equal(task.state, "CANCELADA");
    assert.equal(task.subtitleSegments.length, 0, "a late result must not be consolidated");
    assert.equal(task.active_project_id, undefined);
    assert.equal((await trim(user, project)).status, 202);
  });

  test("editing and saving subtitles is not blocked by an active video task", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    assert.equal((await trim(user, project)).status, 202);
    const current = await request("GET", `/${user}/${project.id}/video/${project.imageId}/subtitles`, user);
    assert.equal(current.status, 200);
    const saved = await request("PUT", `/${user}/${project.id}/video/${project.imageId}/subtitles`, user, {
      segments: [{ start: 1, end: 4, text: "editada durante o recorte" }],
      projectVersion: current.body.projectVersion,
    });
    assert.equal(saved.status, 200);
  });

  test("tasks locked per user before RNG-11 are migrated to the project lock", async () => {
    const collection = VideoTask.collection;
    await collection.dropIndex("active_project_id_1").catch(() => {});
    await collection.createIndex({ active_user_id: 1 }, { unique: true, partialFilterExpression: { active_user_id: { $type: "string" } } });
    const user = newUser("premium");
    const project = await newProject(user);
    const userId = new mongoose.Types.ObjectId(user);
    await collection.insertOne({
      taskId: "legacy", operation: "trim", user_id: userId, project_id: new mongoose.Types.ObjectId(project.id),
      image_id: project.imageId, source_key: "k", source_name: "clip.mp4", tempoInicio: 0, tempoFim: 5,
      maxProcessingMs: 1000, state: "EM_PROCESSAMENTO", active_user_id: user,
    });
    await migrateTaskLocks();
    const legacy = await collection.findOne({ taskId: "legacy" });
    assert.equal(legacy.active_project_id, project.id);
    assert.equal(legacy.active_user_id, undefined);
    const indexes = (await collection.indexes()).map((index) => index.name);
    assert.ok(!indexes.includes("active_user_id_1"), "the per-user unique index must be dropped");
    assert.ok(indexes.includes("active_project_id_1"));
    assert.equal((await trim(user, project)).status, 409, "the migrated task still locks its project");
    assert.equal((await trim(user, await newProject(user))).status, 202, "and no longer locks the user's other projects");
  });
});
