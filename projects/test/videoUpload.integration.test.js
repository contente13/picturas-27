// UC-VID-000 routes + real, isolated MongoDB. Storage, user profile, multipart parsing and
// ffprobe metadata are controlled at the service boundaries. Size cases do NOT transfer GB.
// Run: MONGO_TEST_URL=mongodb://projects_mongoDB:27018/picturas_test npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const express = require("express");
const MB = 1024 * 1024;
const profiles = new Map();
let storageFails = false, thumbnailFails = false, stored = [], deleted = [], temporaries = [];

const axios = require("axios");
axios.get = async (url) => {
  const id = url.match(/users:10001\/([^/]+)\/type/)?.[1];
  if (!id) throw new Error(`Unexpected external call: ${url}`);
  return { data: { type: profiles.get(id) || "free" } };
};
const media = require("../utils/video");
let probeMetadata;
media.inspectVideo = async () => {
  if (probeMetadata.error) throw Object.assign(new Error("Vídeo corrompido"), { status: 422 });
  return { ...probeMetadata };
};
const storage = require("../utils/imageStorage");
storage.post_image = async (_u, _p, _s, form) => {
  // Consume streams so the route can safely remove its upload temporary afterwards.
  await new Promise((resolve, reject) => { form.on("error", reject); form.on("end", resolve); form.resume(); });
  if (storageFails) throw Object.assign(new Error("Storage unavailable"), { status: 503 });
  const key = `test-${crypto.randomUUID()}.mp4`;
  stored.push(key);
  return { data: { data: { imageKey: `src/${key}` } } };
};
storage.delete_image = async (_u, _p, _s, key) => { deleted.push(key); };
storage.get_image_public_url = async () => ({ data: { url: "http://test.invalid/video" } });
const thumb = require("../utils/videoThumbnail");
thumb.createVideoThumbnail = async () => thumbnailFails ? null : "test-thumb.jpg";

// Inject a temporary upload with a declared byte count while keeping the actual route,
// version control and database updates intact. The real multipart path is covered by E2E.
const multerId = require.resolve("multer");
const fakeMulter = () => ({ single: () => async (req, _res, next) => {
  if (!req.body.missing) {
    const filePath = path.join(os.tmpdir(), `upload-integration-${crypto.randomUUID()}.mp4`);
    fs.writeFileSync(filePath, "controlled upload content");
    temporaries.push(filePath);
    req.file = { path: filePath, originalname: req.body.name || "clip.mp4", size: req.body.bytes || 100, mimetype: req.body.mimeType || "video/mp4" };
  }
  next();
} });
fakeMulter.diskStorage = () => ({});
require.cache[multerId] = { id: multerId, filename: multerId, loaded: true, exports: fakeMulter };
const Project = require("../models/project");
const { router } = require("../routes/projects");
let server, base;

test.describe("UC-VID-000 upload route / controlled service failures", { skip: !process.env.MONGO_TEST_URL && "MONGO_TEST_URL not set" }, () => {
  test.before(async () => {
    await mongoose.connect(process.env.MONGO_TEST_URL, { dbName: "picturas_test_upload" });
    await mongoose.connection.dropDatabase();
    const app = express(); app.use(express.json()); app.use(router);
    server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  test.beforeEach(() => {
    storageFails = false; thumbnailFails = false; stored = []; deleted = []; temporaries = [];
    probeMetadata = { duration: 10, width: 640, height: 360, videoCodec: "h264", audioCodec: "aac", frameRate: "24/1" };
  });
  test.afterEach(async () => {
    // The response can reach the client before the route's asynchronous finally
    // finishes unlinking the temporary. Wait for cleanup, but still fail on leaks.
    const deadline = Date.now() + 2000;
    while (temporaries.some(file => fs.existsSync(file)) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    for (const file of temporaries) assert.equal(fs.existsSync(file), false, `temporary leaked: ${file}`);
  });
  test.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  });
  async function project(type = "free") {
    const user = new mongoose.Types.ObjectId(); profiles.set(String(user), type);
    return Project.create({ name: "isolated upload test", user_id: user });
  }
  async function upload(p, data = {}, version = p.version) {
    const response = await fetch(`${base}/${p.user_id}/${p._id}/img`, {
      method: "POST", headers: { "content-type": "application/json", "x-caller-id": String(p.user_id), "x-project-version": String(version) }, body: JSON.stringify(data),
    });
    const body = await response.text();
    return { status: response.status, body, version: response.headers.get("x-project-version") };
  }
  for (const [type, maxBytes, maxDuration] of [["free", 200 * MB, 600], ["premium", 2 * 1024 * MB, 3600]]) {
    test(`REQ-VID-UPLOAD-004: ${type} accepts exact size/duration limits (metadata boundary)`, async () => {
      const p = await project(type); probeMetadata.duration = maxDuration;
      assert.equal((await upload(p, { bytes: maxBytes })).status, 204);
      const saved = await Project.findById(p._id);
      assert.equal(saved.imgs[0].mediaMetadata.sizeBytes, maxBytes);
    });
    test(`REQ-VID-UPLOAD-004: ${type} rejects one byte over its size limit before storage`, async () => {
      const p = await project(type);
      assert.equal((await upload(p, { bytes: maxBytes + 1 })).status, 413);
      assert.equal(stored.length, 0);
      assert.equal((await Project.findById(p._id)).imgs.length, 0);
    });
    test(`REQ-VID-UPLOAD-004: ${type} rejects duration above the limit before storage`, async () => {
      const p = await project(type); probeMetadata.duration = maxDuration + 0.1;
      assert.equal((await upload(p)).status, 413); assert.equal(stored.length, 0);
    });
  }
  test("REQ-VID-UPLOAD-002: anonymous profile is refused without modifying the project", async () => {
    const p = await project("anonymous"); assert.equal((await upload(p)).status, 403); assert.equal(stored.length, 0);
  });
  test("REQ-VID-UPLOAD-005: corrupted input is refused without storage objects", async () => {
    const p = await project(); probeMetadata = { error: true };
    assert.equal((await upload(p)).status, 422); assert.equal(stored.length, 0);
  });
  test("REQ-VID-UPLOAD-003: incompatible codec is refused", async () => {
    const p = await project(); probeMetadata.videoCodec = "mpeg4";
    assert.equal((await upload(p)).status, 415); assert.equal(stored.length, 0);
  });
  test("REQ-VID-UPLOAD-003: unsupported video extensions cannot fall through to image storage", async () => {
    for (const [name, mimeType] of [
      ["clip.avi", "video/mp4"],
      ["clip.mov", "image/png"],
      ["clip.AVI", "application/octet-stream"],
      ["clip.txt", "video/mp4"],
    ]) {
      const p = await project();
      const response = await upload(p, { name, mimeType });
      assert.equal(response.status, 415, `${name} declared as ${mimeType}`);
      assert.match(response.body, /MP4.*WebM/);
      const saved = await Project.findById(p._id);
      assert.equal(saved.imgs.length, 0);
      assert.equal(saved.version, 0);
      assert.equal(stored.length, 0);
    }
  });
  test("existing PNG and JPEG image uploads remain available on the shared route", async () => {
    for (const [name, mimeType] of [["imagem.png", "image/png"], ["fotografia.JPG", "image/jpeg"]]) {
      const p = await project();
      assert.equal((await upload(p, { name, mimeType })).status, 204);
      const saved = await Project.findById(p._id);
      assert.equal(path.basename(saved.imgs[0].og_uri), name);
      assert.equal(saved.imgs[0].mediaMetadata, null);
      assert.equal(saved.imgs[0].thumb_img_key, null);
      assert.equal(saved.version, 1);
    }
  });
  test("REQ-VID-UPLOAD-007/013/014: UTF-8 name, SHA-256 and metadata survive a failed thumbnail", async () => {
    const p = await project(); thumbnailFails = true;
    assert.equal((await upload(p, { name: "São Paulo — ação.mp4" })).status, 204);
    const saved = await Project.findById(p._id); const video = saved.imgs[0];
    assert.equal(path.basename(video.og_uri), "São Paulo — ação.mp4");
    assert.equal(video.og_sha256, crypto.createHash("sha256").update("controlled upload content").digest("hex"));
    assert.equal(video.thumb_img_key, null); assert.equal(saved.version, 1);
  });
  test("REQ-VID-UPLOAD-006: duplicate names never replace the original", async () => {
    const p = await project(); assert.equal((await upload(p)).status, 204);
    assert.equal((await upload(p, {}, 1)).status, 400);
    assert.equal((await Project.findById(p._id)).imgs.length, 1); assert.equal(stored.length, 1);
  });
  test("REQ-VID-UPLOAD-008: stale version removes the orphan video and its thumbnail", async () => {
    const p = await project(); await Project.updateOne({ _id: p._id }, { $set: { version: 1 } });
    assert.equal((await upload(p)).status, 409);
    assert.equal((await Project.findById(p._id)).imgs.length, 0);
    assert.deepEqual(deleted.sort(), [stored[0], "test-thumb.jpg"].sort());
  });
  test("UC-VID-000/E10: storage failure leaves the project and version unchanged", async () => {
    const p = await project(); storageFails = true;
    assert.equal((await upload(p)).status, 503);
    const saved = await Project.findById(p._id); assert.equal(saved.version, 0); assert.equal(saved.imgs.length, 0);
  });
  test("UC-VID-000/E2: missing upload is rejected", async () => {
    const p = await project(); assert.equal((await upload(p, { missing: true })).status, 400);
  });
});
