const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { mediaUpload } = require("../utils/mediaUpload");
const { probeVideoFile, validateVideo } = require("../utils/video");
const { hashFile } = require("../utils/fileHash");

async function fixture(t, changes = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "media-upload-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "received");
  const bytes = Buffer.from("image upload contents");
  await fs.promises.writeFile(filePath, bytes);
  const controller = new AbortController();
  let cleaned = 0;
  const req = {
    params: { user: "owner", project: "project" }, expectedVersion: 4,
    file: { path: filePath, size: bytes.length, originalname: "photo.jpg", mimetype: "image/jpeg" },
    uploadContext: {
      signal: controller.signal,
      openStream: () => fs.createReadStream(filePath),
      cleanup: async () => { cleaned++; },
    },
  };
  const res = {
    headers: {}, statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    jsonp(value) { this.body = value; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    sendStatus(value) { this.statusCode = value; return this; },
  };
  const project = { imgs: [], version: 4 };
  let deleted = 0;
  let stored = 0;
  const deps = {
    Project: {
      getOne: async () => project,
      updateIfVersion: async (user, pid, body, version) => {
        assert.equal(version, 4);
        return { ...body, version: 5 };
      },
    },
    axios: { get: async () => ({ data: { type: "premium" } }) },
    usersURL: "https://users/", getCallerId: () => "caller",
    post_image: async (user, pid, stage, form, options) => {
      assert.equal(stage, "src");
      assert.equal(options.signal, controller.signal);
      await pipeline(form, new Writable({ write(chunk, encoding, callback) { callback(); } }));
      stored++;
      return { data: { data: { imageKey: "project/src/key.jpg" } } };
    },
    delete_image: async (user, pid, stage, key) => { assert.equal(key, "key.jpg"); deleted++; },
    ...changes,
  };
  return { req, res, deps, dir, bytes, project, controller, counts: () => ({ cleaned, deleted, stored }) };
}

test("image upload preserves hash, metadata, version and 204", async (t) => {
  const f = await fixture(t);
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 204);
  assert.equal(f.res.headers["X-Project-Version"], "5");
  assert.equal(f.project.imgs.length, 1);
  assert.equal(f.project.imgs[0].og_sha256, createHash("sha256").update(f.bytes).digest("hex"));
  assert.equal(f.project.imgs[0].media_type, "image");
  assert.match(f.project.imgs[0].og_uri, /src\/photo.jpg$/);
  assert.deepEqual(f.counts(), { cleaned: 1, deleted: 0, stored: 1 });
});

test("known version conflict removes the unassociated stored object", async (t) => {
  const f = await fixture(t);
  f.deps.Project.updateIfVersion = async () => null;
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 409);
  assert.equal(f.res.body.serverVersion, 4);
  assert.deepEqual(f.counts(), { cleaned: 1, deleted: 1, stored: 1 });
});

test("cancellation after storage but before DB write compensates storage", async (t) => {
  const f = await fixture(t);
  const store = f.deps.post_image;
  f.deps.post_image = async (...args) => { const result = await store(...args); f.controller.abort(); return result; };
  f.deps.Project.updateIfVersion = async () => assert.fail("cancelled upload must not update DB");
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.res.headers["X-Project-Version"], undefined);
  assert.deepEqual(f.counts(), { cleaned: 1, deleted: 1, stored: 1 });
});

test("uncertain DB outcome retains the potentially referenced object", async (t) => {
  const f = await fixture(t);
  f.deps.Project.updateIfVersion = async () => { throw new Error("lost database connection"); };
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 501);
  assert.equal(f.res.body, "Updating project information");
  assert.equal(f.counts().deleted, 0);
});

test("disconnect while DB write completes retains a committed object", async (t) => {
  const f = await fixture(t);
  f.deps.Project.updateIfVersion = async () => { f.controller.abort(); return { version: 5 }; };
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.counts().deleted, 0);
  assert.equal(f.res.headers["X-Project-Version"], undefined);
});

test("duplicate and wrong-kind files are rejected before storage and cleaned", async (t) => {
  const f = await fixture(t);
  f.project.imgs.push({ og_uri: "src/photo.jpg" });
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 400);
  f.req.file.originalname = "movie.mp4";
  f.req.file.mimetype = "video/mp4";
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 400);
  assert.equal(f.counts().stored, 0);
  assert.equal(f.counts().cleaned, 2);
});

test("storage failure preserves 501 and cleans local resources", async (t) => {
  const f = await fixture(t);
  f.deps.post_image = async () => { throw new Error("storage unavailable"); };
  await mediaUpload("image", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 501);
  assert.equal(f.res.body, "Error storing image");
  assert.equal(f.counts().cleaned, 1);
});

test("file hashing is incremental, cancellable and reports read failures", async (t) => {
  const f = await fixture(t);
  assert.equal(await hashFile(f.req.file.path), createHash("sha256").update(f.bytes).digest("hex"));
  await assert.rejects(hashFile(f.req.file.path, AbortSignal.abort()), { name: "AbortError" });
  await assert.rejects(hashFile(path.join(f.dir, "missing")), { code: "ENOENT" });
});

test("video probes the received path, preserves metadata and uses caller profile", { skip: process.env.SKIP_FFPROBE_TEST === "1" }, async (t) => {
  const f = await fixture(t);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=25", "-t", "0.4", "-c:v", "libx264", "-f", "mp4", "-y", f.req.file.path]);
  f.req.file.size = (await fs.promises.stat(f.req.file.path)).size;
  f.req.file.originalname = "movie.mp4";
  f.req.file.mimetype = "video/mp4";
  const meta = await probeVideoFile(f.req.file.path);
  assert.equal(meta.size_bytes, f.req.file.size);
  assert.equal(meta.video_codec, "h264");
  assert.equal(meta.audio_codec, null);
  assert.equal(meta.width, 160);
  assert.equal(meta.height, 120);
  assert.equal(meta.fps, 25);
  f.deps.axios.get = async (url) => { assert.equal(url, "https://users/caller/type"); return { data: { type: "premium" } }; };
  await mediaUpload("video", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 204);
  assert.deepEqual(f.project.imgs[0].video, meta);
  assert.match(f.project.imgs[0].new_uri, /movie.mp4$/);
  f.project.imgs = [];
  f.deps.axios.get = async () => ({ data: { type: "anonymous" } });
  await mediaUpload("video", f.deps)(f.req, f.res);
  assert.equal(f.res.statusCode, 400);
  assert.match(f.res.body, /Anonymous/);
  await assert.rejects(probeVideoFile(f.req.file.path, { signal: AbortSignal.abort() }));
});

test("video validation retains formats, caller limits, portrait support and rejections", () => {
  const meta = { video_codec: "h264", duration: 60, size_bytes: 100 * 1024 * 1024, width: 1080, height: 1920 };
  for (const [name, mime] of [["movie.mp4", "video/mp4"], ["movie.mov", "video/quicktime"], ["movie.webm", "video/webm"]]) {
    assert.equal(validateVideo(meta, name, mime, "free"), null);
  }
  assert.match(validateVideo(meta, "movie.mp4", "video/mp4", "anonymous"), /Anonymous/);
  assert.match(validateVideo({ ...meta, duration: 61 }, "movie.mp4", "video/mp4", "free"), /limit/);
  assert.match(validateVideo({ ...meta, size_bytes: meta.size_bytes + 1 }, "movie.mp4", "video/mp4", "free"), /limit/);
  assert.match(validateVideo({ ...meta, video_codec: "unsupported" }, "movie.mp4", "video/mp4", "premium"), /codec/);
  assert.match(validateVideo({ ...meta, width: 4096, height: 2160 }, "movie.mp4", "video/mp4", "premium"), /Resolution/);
  assert.match(validateVideo({ ...meta, duration: 0 }, "movie.mp4", "video/mp4", "premium"), /duration/);
});
