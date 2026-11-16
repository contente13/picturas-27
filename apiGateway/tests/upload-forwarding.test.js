const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const { temporaryUpload } = require("../utils/temporaryUpload");
const { forwardUpload } = require("../utils/forwardUpload");

async function server(t, app) {
  const s = app.listen(0, "0.0.0.0");
  await once(s, "listening");
  t.after(async () => { s.closeAllConnections(); await new Promise((resolve) => s.close(resolve)); });
  return `http://127.0.0.1:${s.address().port}/`;
}

test("forwarder preserves multipart, owner, caller, share, version and upstream errors", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-forward-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const upstream = express();
  let conflict = false;
  upstream.post("/owner/project/video", temporaryUpload(path.join(dir, "upstream")).single("video"), async (req, res) => {
    assert.equal(req.file.originalname, "movie.mp4");
    assert.equal(req.file.mimetype, "video/mp4");
    assert.equal(await fs.readFile(req.file.path, "utf8"), "video bytes");
    assert.equal(req.query.share, "share-id");
    assert.equal(req.headers.authorization, "Bearer token");
    assert.equal(req.headers["x-caller-id"], "caller");
    assert.equal(req.headers["x-project-version"], "4");
    res.set("X-Project-Version", "5");
    if (conflict) res.status(409).json({ message: "Project version conflict", serverVersion: 5 });
    else res.sendStatus(204);
  });
  const upstreamURL = await server(t, upstream);
  const gateway = express();
  gateway.post("/:user/:project/video", (req, res, next) => {
    req.authUserId = "caller";
    next();
  }, forwardUpload(upstreamURL, undefined, (res, error) => {
    const version = error.response.headers["x-project-version"];
    if (version) res.set("X-Project-Version", version);
    return res.status(error.response.status).json(error.response.data);
  }, "video"));
  const gatewayURL = await server(t, gateway);
  for (const status of [204, 409]) {
    conflict = status === 409;
    const data = new FormData();
    data.append("video", Buffer.from("video bytes"), { filename: "movie.mp4", contentType: "video/mp4" });
    const response = await axios.post(`${gatewayURL}caller/project/video?owner=owner&share=share-id`, data, {
      headers: { ...data.getHeaders(), Authorization: "Bearer token", "X-Project-Version": "4" },
      validateStatus: () => true,
    });
    assert.equal(response.status, status);
    assert.equal(response.headers["x-project-version"], "5");
    if (conflict) assert.equal(response.data.serverVersion, 5);
  }
});

test("upload transport disables redirect replay buffering", async (t) => {
  const original = axios.post;
  t.after(() => { axios.post = original; });
  const input = new (require("node:stream").PassThrough)();
  Object.assign(input, { params: { user: "u", project: "p" }, query: {},
    headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "123" } });
  const response = new (require("node:events").EventEmitter)();
  response.sendStatus = (status) => assert.equal(status, 204);
  axios.post = async (url, body, options) => {
    assert.equal(body, input);
    assert.equal(options.headers["Content-Type"], input.headers["content-type"]);
    assert.equal(options.headers["Content-Length"], "123");
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.maxBodyLength, Infinity);
    assert.equal(options.signal.aborted, false);
    return { headers: {} };
  };
  await forwardUpload("http://projects/", null, () => assert.fail("must succeed"), "img")(input, response);
  assert.equal(input.listenerCount("aborted"), 0);
  assert.equal(response.listenerCount("close"), 0);
});

test("client disconnect cancels the in-flight downstream request", { timeout: 30000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-cancel-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let started, cancelled;
  const ready = new Promise((resolve) => { started = resolve; });
  const stopped = new Promise((resolve) => { cancelled = resolve; });
  const upstream = express();
  upstream.post("/u/p/video", temporaryUpload(path.join(dir, "upstream")).single("video"), (req, res) => {
    req.uploadContext.signal.addEventListener("abort", cancelled, { once: true });
    started();
  });
  const upstreamURL = await server(t, upstream);
  const gateway = express();
  gateway.post("/:user/:project/video", forwardUpload(upstreamURL, undefined, () => assert.fail("disconnected client must not receive an error response"), "video"));
  const gatewayURL = await server(t, gateway);
  const form = new FormData();
  form.append("video", Buffer.alloc(1024 * 1024), { filename: "movie.mp4", contentType: "video/mp4" });
  const req = http.request(`${gatewayURL}u/p/video`, { method: "POST", headers: form.getHeaders() });
  req.on("error", () => {});
  form.pipe(req);
  await ready;
  req.destroy();
  await stopped;
});

test("forwards bytes before the client finishes the multipart body", { timeout: 30000 }, async (t) => {
  let received;
  const firstBytes = new Promise((resolve) => { received = resolve; });
  const body = Buffer.from('--test\r\nContent-Disposition: form-data; name="video"; filename="movie.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo bytes\r\n--test--\r\n');
  const upstream = express();
  upstream.post("/u/p/video", (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => { chunks.push(chunk); received(); });
    req.on("end", () => {
      assert.deepEqual(Buffer.concat(chunks), body);
      res.set("X-Project-Version", "1").sendStatus(204);
    });
  });
  const upstreamURL = await server(t, upstream);
  const gateway = express();
  gateway.post("/:user/:project/video", forwardUpload(upstreamURL, undefined,
    () => assert.fail("streaming request must succeed"), "video"));
  const gatewayURL = await server(t, gateway);
  const request = http.request(`${gatewayURL}u/p/video`, { method: "POST", headers: {
    "Content-Type": "multipart/form-data; boundary=test", "Content-Length": body.length,
  } });
  const response = once(request, "response");
  request.write(body.subarray(0, 100));
  await firstBytes;
  assert.equal(request.writableEnded, false);
  request.end(body.subarray(100));
  const [result] = await response;
  assert.equal(result.statusCode, 204);
  assert.equal(result.headers["x-project-version"], "1");
  result.resume();
});
