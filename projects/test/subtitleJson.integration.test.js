// Real Express app parsers and subtitle routes over loopback HTTP, with controlled
// persistence and no MongoDB/RabbitMQ startup. Both services declare Express ~4.16.1;
// the gateway loader uses projects' installed dependencies so this test needs no
// second npm installation. Unrelated routes, CORS and request logging are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const express = require("express");
const axios = require("axios");
const { tokenFor } = require("./helpers/auth");
const Project = require("../controllers/project");
const ProjectModel = require("../models/project");
const { validateSubtitleSegments } = require("../utils/subtitles");

const owner = "507f1f77bcf86cd799439011";
const collaborator = "507f1f77bcf86cd799439012";
const projectId = "507f1f77bcf86cd799439013";
const imageId = "507f1f77bcf86cd799439014";
const route = `/${owner}/${projectId}/video/${imageId}/subtitles`;
const project = {
  _id: projectId, user_id: owner, version: 0,
  imgs: { id: id => id === imageId ? { mediaMetadata: { duration: 3600 } } : null },
  sharedLinks: [{ id: "read-link", permission: "read" }],
};
const originals = { getOne: Project.getOne, getOneByShareId: Project.getOneByShareId, findOneAndUpdate: ProjectModel.findOneAndUpdate };
let writes = 0;
let forwarded = 0;
let stored;
let projectServer;
let gatewayServer;
let projectBase;
let gatewayBase;

function load(filename, overrides = {}) {
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const context = {
    module, exports: module.exports, __dirname: path.dirname(filename),
    process, console, Buffer, setInterval,
    require(name) { return Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name); },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return module.exports;
}

function loadGatewayRouter() {
  const filename = path.resolve(__dirname, "../../apiGateway/routes/projects.js");
  const commonRequire = createRequire(path.resolve(__dirname, "../package.json"));
  const gatewayAxios = Object.create(axios);
  gatewayAxios.put = (url, body, options) => {
    forwarded++;
    return axios.put(projectBase + new URL(url).pathname, body, { ...options, proxy: false });
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, __dirname: path.dirname(filename), Buffer, process, console,
    require(name) {
      if (name === "axios") return gatewayAxios;
      if (name === "../auth/auth") {
        const authPath = path.resolve(path.dirname(filename), name + ".js");
        return load(authPath, { jsonwebtoken: commonRequire("jsonwebtoken") });
      }
      return name.startsWith(".") ? createRequire(filename)(name) : commonRequire(name);
    },
  }, { filename });
  return module.exports;
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return server;
}

test.before(async () => {
  Project.getOne = async () => project;
  Project.getOneByShareId = async id => id === "read-link" ? project : null;
  ProjectModel.findOneAndUpdate = (_filter, update) => {
    writes++;
    stored = update.$set["imgs.$.subtitles"];
    return { select: () => ({ lean: async () => ({ version: 1 }) }) };
  };
  const silentLogger = () => (_req, _res, next) => next();
  const projectApp = load(path.resolve(__dirname, "../app.js"), {
    mongoose: { connect() {}, connection: { on() {}, once() {} } },
    "./routes/projects": { router: express.Router(), process_msg() {} },
    "./routes/videoConcat": express.Router(),
    morgan: silentLogger,
  });
  projectServer = await listen(projectApp);
  projectBase = `http://127.0.0.1:${projectServer.address().port}`;
  const gatewayApp = load(path.resolve(__dirname, "../../apiGateway/app.js"), {
    express, "http-errors": require("http-errors"), path, "cookie-parser": require("cookie-parser"),
    cors: silentLogger, morgan: silentLogger,
    "./routes/projects": loadGatewayRouter(),
    "./routes/users": express.Router(), "./routes/subscriptions": express.Router(),
  });
  gatewayServer = await listen(gatewayApp);
  gatewayBase = `http://127.0.0.1:${gatewayServer.address().port}`;
});

test.beforeEach(() => { writes = 0; forwarded = 0; stored = null; });
test.after(async () => {
  await Promise.all([projectServer, gatewayServer].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
  Project.getOne = originals.getOne;
  Project.getOneByShareId = originals.getOneByShareId;
  ProjectModel.findOneAndUpdate = originals.findOneAndUpdate;
});

function segments(count, text = "a".repeat(42)) {
  return Array.from({ length: count }, (_, i) => ({ start: i, end: i + 0.6, text }));
}
function bodyFor(cues) { return JSON.stringify({ segments: cues, projectVersion: 0 }); }
async function request(base, url, body, { token = tokenFor(owner), method = "PUT" } = {}) {
  return fetch(base + url, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body,
  });
}

test("B8: 1500 valid captions above 100 KiB pass through gateway and Project Service", async () => {
  const cues = segments(1500);
  const body = bodyFor(cues);
  assert.ok(Buffer.byteLength(body) > 100 * 1024);
  const response = await request(gatewayBase, "/projects" + route, body);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).segments, cues);
  assert.deepEqual(stored, cues);
  assert.equal(writes, 1);
  assert.equal(forwarded, 1);
});

for (const escaped of [false, true]) {
  test(`B8: 2000 two-line Unicode captions are saved (${escaped ? "JSON escapes" : "UTF-8"})`, async () => {
    const cues = segments(2000, "漢".repeat(42) + "\n" + "字".repeat(42));
    assert.equal(validateSubtitleSegments(cues, 3600), null);
    let body = bodyFor(cues);
    if (escaped) body = body.replace(/[^\x00-\x7f]/g, char => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
    assert.ok(Buffer.byteLength(body) > 100 * 1024);
    assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024);
    const response = await request(gatewayBase, "/projects" + route, body);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).segments, cues);
    assert.deepEqual(stored, cues);
    assert.equal(writes, 1);
  });
}

test("B8: 2001 captions still reach business validation and are rejected without writes", async () => {
  const response = await request(gatewayBase, "/projects" + route, bodyFor(segments(2001)));
  assert.equal(response.status, 400);
  assert.match(await response.json(), /demasiado longa/);
  assert.equal(forwarded, 1);
  assert.equal(writes, 0);
});

test("B8: invalid captions above 100 KiB remain rejected by RN3", async () => {
  const cues = segments(2000);
  cues[1000].start = 999;
  const response = await request(gatewayBase, "/projects" + route, bodyFor(cues));
  assert.equal(response.status, 400);
  assert.match(await response.json(), /sobrepor/);
  assert.equal(writes, 0);
});

test("B8: enlarged bodies do not bypass authentication or read-only permissions", async () => {
  const body = bodyFor(segments(1500));
  const unauthenticated = await request(gatewayBase, "/projects" + route, body, { token: null });
  assert.equal(unauthenticated.status, 401);
  await unauthenticated.text();
  assert.equal(forwarded, 0);
  const readOnly = await request(gatewayBase, "/projects" + route + "?share=read-link", body, { token: tokenFor(collaborator) });
  assert.equal(readOnly.status, 403);
  await readOnly.text();
  const direct = await request(projectBase, route, body, { token: null });
  assert.equal(direct.status, 401);
  await direct.text();
  assert.equal(writes, 0);
});

for (const service of ["gateway", "projects"]) {
  test(`B8: ${service} still rejects subtitle JSON above 2 MiB`, async () => {
    const base = service === "gateway" ? gatewayBase : projectBase;
    const url = (service === "gateway" ? "/projects" : "") + route;
    const response = await request(base, url, JSON.stringify({ padding: "a".repeat(2 * 1024 * 1024) }));
    assert.equal(response.status, 413);
    await response.text();
    assert.equal(forwarded, 0);
    assert.equal(writes, 0);
  });
  test(`B8: ${service} preserves the default parser for other routes and methods`, async () => {
    const base = service === "gateway" ? gatewayBase : projectBase;
    const prefix = service === "gateway" ? "/projects" : "";
    const body = JSON.stringify({ padding: "a".repeat(110 * 1024) });
    for (const [url, method] of [[prefix + route + "/generate", "POST"], [prefix + route, "POST"], [prefix + route + "/other", "PUT"]]) {
      const response = await request(base, url, body, { method });
      assert.equal(response.status, 413, `${method} ${url}`);
      await response.text();
    }
    assert.equal(writes, 0);
  });
}
