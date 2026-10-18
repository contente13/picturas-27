// UC-VID-003 routes against a throw-away MongoDB database: validation without side effects
// (passos 4–5), task creation (passo 6), concurrency with other tools (E10/RN18), quota (RN16/E11),
// unavailable clips (E3) and recovery of the sequence (FA9). The users service, RabbitMQ and the
// storage read check are replaced by in-process stubs.
//
//   MONGO_TEST_URL=mongodb://projects_mongoDB:27018/picturas_test npm test
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
const unreadableKeys = new Set();
const imageStorage = require("../utils/imageStorage");
imageStorage.is_object_readable = async (_user, _project, _type, key) => !unreadableKeys.has(key);
const videoTasks = require("../controllers/videoTasks");
videoTasks.getUserType = async (userId) => userTypes.get(String(userId));
videoTasks.enqueueTask = async () => {};
videoTasks.reserveOperation = async (userId, amount, reservationId) => {
  const id = String(userId);
  const left = quota.get(id) ?? 5;
  if (left < amount) {
    const error = new Error("quota");
    error.response = { status: 701, data: "A quota diária foi esgotada. A quota é reposta às 00:00 (hora de Lisboa)." };
    throw error;
  }
  quota.set(id, left - amount);
  reservations.add(reservationId);
  await new Promise((resolve) => setImmediate(resolve));
};
videoTasks.refundOperation = async (userId, amount, reservationId) => {
  if (!reservations.delete(reservationId)) return;
  quota.set(String(userId), (quota.get(String(userId)) ?? 5) + amount);
};

const express = require("express");
const ProjectModel = require("../models/project");
const VideoTask = require("../models/videoTask");
const videoRouter = require("../routes/video");
const videoConcatRouter = require("../routes/videoConcat");

let server;
let baseUrl;
const MB = 1024 * 1024;

function newUser(type, operationsLeft = 5) {
  const id = String(new mongoose.Types.ObjectId());
  userTypes.set(id, type);
  quota.set(id, operationsLeft);
  return id;
}

function videoItem(name, metadata = {}) {
  return {
    og_uri: `./images/x/src/${name}`,
    new_uri: `./images/x/out/${name}`,
    og_img_key: `${name}-${Math.random()}.key`,
    og_sha256: "0",
    mediaMetadata: {
      duration: 20, width: 1280, height: 720, frameRate: "30/1", avgFrameRate: "30/1",
      videoCodec: name.endsWith(".webm") ? "vp8" : "h264", audioCodec: name.endsWith(".webm") ? "vorbis" : "aac",
      sizeBytes: 5 * MB, format: name.split(".").pop(), ...metadata,
    },
    subtitles: [{ start: 1, end: 3, text: `legenda de ${name}` }],
  };
}

async function newProject(userId, count = 3, metadata = {}) {
  const names = Array.from({ length: count }, (_, index) => `clip${index + 1}.${index === 1 ? "webm" : "mp4"}`);
  const project = await ProjectModel.create({ name: "junção", user_id: userId, imgs: names.map((name) => videoItem(name, metadata)) });
  return { id: String(project._id), imageIds: project.imgs.map((image) => String(image._id)), keys: project.imgs.map((image) => image.og_img_key) };
}

function request(method, path, userId, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-caller-id": userId },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));
}

const validate = (user, project, imageIds) => request("POST", `/${user}/${project.id}/video/concat/validate`, user, { imageIds });
const concat = (user, project, imageIds) => request("POST", `/${user}/${project.id}/video/concat`, user, { imageIds });
const trim = (user, project) => request("POST", `/${user}/${project.id}/video/${project.imageIds[0]}/trim`, user, { tempoInicio: 0, tempoFim: 5 });
const tasksOf = (project) => VideoTask.find({ project_id: project.id }).lean();

test.describe("UC-VID-003 routes", { skip }, () => {
  test.before(async () => {
    await mongoose.connect(mongoUrl, { dbName: "picturas_test_concat" });
    await mongoose.connection.db.dropDatabase();
    await VideoTask.syncIndexes();
    const app = express();
    app.use(express.json());
    app.use("/", videoRouter);
    app.use("/", videoConcatRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    server?.close();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test("passos 4–5: validation returns the clips, totals and plan, without creating a task or reserving quota", async () => {
    const user = newUser("free", 5);
    const project = await newProject(user);
    const order = [project.imageIds[2], project.imageIds[0], project.imageIds[1]];
    const { status, body } = await validate(user, project, order);
    assert.equal(status, 200);
    assert.deepEqual(body.clips.map((clip) => clip.imageId), order, "RN10: keeps the given order");
    assert.equal(body.totals.durationSeconds, 60);
    assert.deepEqual(body.limits, { maxVideos: 10, maxDurationSeconds: 600, maxSizeBytes: 500 * MB });
    assert.ok(body.plan.notes.some((note) => /formato intermédio comum/.test(note)), "FA6 is reported");
    assert.equal((await tasksOf(project)).length, 0);
    assert.equal(quota.get(user), 5);
  });

  test("passo 6: the task stores the confirmed order, the clip subtitles and reserves one operation", async () => {
    const user = newUser("free", 5);
    const project = await newProject(user);
    const order = [project.imageIds[1], project.imageIds[2], project.imageIds[0]];
    const { status, body } = await concat(user, project, order);
    assert.equal(status, 202);
    const task = await VideoTask.findOne({ taskId: body.tarefaId }).lean();
    assert.equal(task.operation, "concat");
    assert.deepEqual(task.sources.map((source) => source.image_id), order);
    assert.equal(task.sources[0].subtitles[0].text, "legenda de clip2.webm");
    assert.equal(task.maxProcessingMs, 600_000, "RN21");
    assert.equal(task.active_project_id, project.id);
    assert.equal(quota.get(user), 4, "RN16: one operation reserved");
  });

  test("FA9: the latest concatenation returns its state and the sequence to restore", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    const order = [project.imageIds[2], project.imageIds[0]];
    await concat(user, project, order);
    const { body } = await request("GET", `/${user}/${project.id}/video/tasks/latest?operation=concat`, user);
    assert.equal(body.tarefa.operation, "concat");
    assert.equal(body.tarefa.estado, "EM_FILA");
    assert.deepEqual(body.tarefa.imageIds, order);
  });

  test("E10 / RN18: a concatenation and a trim never run at the same time in a project", async () => {
    const user = newUser("premium");
    const first = await newProject(user);
    assert.equal((await trim(user, first)).status, 202);
    const blocked = await concat(user, first, first.imageIds);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /já tem um recorte em curso/);

    const second = await newProject(user);
    assert.equal((await concat(user, second, second.imageIds)).status, 202, "another project of the same user is accepted");
    const trimBlocked = await trim(user, second);
    assert.equal(trimBlocked.status, 409);
    assert.match(trimBlocked.body, /já tem uma junção de vídeos em curso/);
  });

  test("simultaneous concatenations in the same project: only one task, only one reservation", async () => {
    const user = newUser("free", 5);
    const project = await newProject(user);
    const results = await Promise.all(Array.from({ length: 5 }, () => concat(user, project, project.imageIds)));
    assert.equal(results.filter((result) => result.status === 202).length, 1);
    assert.equal((await tasksOf(project)).length, 1);
    assert.equal(quota.get(user), 4);
  });

  test("E11: with the daily quota used up, the request is refused without a task", async () => {
    const user = newUser("free", 0);
    const project = await newProject(user);
    const { status, body } = await concat(user, project, project.imageIds);
    assert.equal(status, 429);
    assert.match(body.message, /quota diária foi esgotada/);
    assert.equal((await tasksOf(project)).length, 0);
  });

  test("RN3 / RN4 through the route: refused before any task or reservation", async () => {
    const user = newUser("free", 5);
    const many = await newProject(user, 11, { duration: 5, sizeBytes: MB });
    assert.equal((await concat(user, many, many.imageIds)).status, 400);
    const long = await newProject(user, 2, { duration: 301 });
    const tooLong = await concat(user, long, long.imageIds);
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.message, /excede o limite de 10 min/);
    assert.equal(quota.get(user), 5);
    assert.equal((await tasksOf(many)).length + (await tasksOf(long)).length, 0);
  });

  test("E3: a clip no longer readable in storage is identified and nothing is created", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    unreadableKeys.add(project.keys[1]);
    const { status, body } = await validate(user, project, project.imageIds);
    assert.equal(status, 422);
    assert.match(body.message, /clip2\.webm/);
    assert.equal(body.problems[0].rule, "E3");
    assert.equal((await concat(user, project, project.imageIds)).status, 422);
    assert.equal((await tasksOf(project)).length, 0);
  });

  test("FA8: cancelling a queued concatenation frees the project for a new one (FA10)", async () => {
    const user = newUser("premium");
    const project = await newProject(user);
    const { body } = await concat(user, project, project.imageIds);
    const cancelled = await request("POST", `/${user}/${project.id}/video/tasks/${body.tarefaId}/cancel`, user);
    assert.equal(cancelled.status, 200);
    assert.equal((await concat(user, project, [project.imageIds[1], project.imageIds[0]])).status, 202);
  });

  test("anonymous users cannot concatenate", async () => {
    const user = newUser("anonymous");
    const project = await newProject(user);
    assert.equal((await validate(user, project, project.imageIds)).status, 403);
  });
});
