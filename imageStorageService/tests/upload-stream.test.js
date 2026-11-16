const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadUpload(s3) {
  const original = Module._load;
  Module._load = function (id, parent, isMain) {
    if (parent?.filename.endsWith("/services/uploadImage.js")) {
      if (id === "./s3Client") return s3;
      if (id === "./storage") return { BUCKET: "picturas", ensureBucket: async () => {}, objectKey: (u, p, s, n) => `users/${u}/projects/${p}/${s}/${n}` };
    }
    return original.call(this, id, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../services/uploadImage")];
    return require("../services/uploadImage");
  } finally {
    Module._load = original;
  }
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-upload-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "received");
  const bytes = Buffer.alloc(1024 * 1024, 13);
  await fs.writeFile(filePath, bytes);
  return { bytes, file: { path: filePath, size: bytes.length, mimetype: "video/mp4" } };
}

test("S3 upload reads from disk, uses a single streaming PUT and preserves key/MIME/length", async (t) => {
  const f = await fixture(t);
  let input;
  const upload = loadUpload({
    putObject(params) {
      assert.equal(params.ContentLength, f.bytes.length);
      assert.equal(params.ContentType, "video/mp4");
      assert.match(params.Key, /^users\/u\/projects\/p\/src\/.+\.mp4$/);
      assert.equal(Buffer.isBuffer(params.Body), false);
      input = params.Body;
      return { httpRequest: { endpoint: { protocol: "http:", host: "storage:9000" }, path: `/picturas/${params.Key}` }, abort() { assert.fail("successful upload must not abort"); }, async promise() {
        const chunks = [];
        for await (const chunk of input) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), f.bytes);
        return { ETag: "stored-etag" };
      } };
    },
  });
  const result = await upload("u", "p", f.file, "src");
  assert.match(result.imageKey, /^p\/src\/.+\.mp4$/);
  assert.equal(result.location, `http://storage:9000/picturas/users/u/projects/${result.imageKey}`);
  assert.equal(input.destroyed, true);
});

test("cancel while upload is active aborts SDK and closes the input", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  let input, rejectUpload, aborted = 0;
  const upload = loadUpload({ putObject(params) {
    input = params.Body;
    return {
      abort() { aborted++; rejectUpload(new Error("RequestAbortedError")); },
      promise() {
        const pending = new Promise((resolve, reject) => { rejectUpload = reject; });
        setImmediate(() => controller.abort());
        return pending;
      },
    };
  } });
  await assert.rejects(upload("u", "p", f.file, "src", { signal: controller.signal }), /RequestAbortedError/);
  assert.equal(aborted, 1);
  assert.equal(input.destroyed, true);
});

test("cancellation racing with SDK completion removes the completed object", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  let deleted = 0, storedKey;
  const upload = loadUpload({
    putObject(params) {
      storedKey = params.Key;
      return { abort() {}, async promise() { controller.abort(); return { Location: "stored" }; } };
    },
    deleteObject(params) {
      assert.equal(params.Key, storedKey);
      deleted++;
      return { promise: async () => {} };
    },
  });
  await assert.rejects(upload("u", "p", f.file, "src", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(deleted, 1);
});

test("S3 failure closes the source and propagates the error", async (t) => {
  const f = await fixture(t);
  let input;
  const upload = loadUpload({ putObject(params) {
    input = params.Body;
    return { abort() {}, promise: async () => { throw new Error("S3 unavailable"); } };
  } });
  await assert.rejects(upload("u", "p", f.file, "out"), /S3 unavailable/);
  assert.equal(input.destroyed, true);
});

test("pre-cancelled requests never start a storage upload", async (t) => {
  const f = await fixture(t);
  const upload = loadUpload({ putObject() { assert.fail("must not start S3 upload"); } });
  await assert.rejects(upload("u", "p", f.file, "src", { signal: AbortSignal.abort() }), { name: "AbortError" });
});

test("SDK setup failure also closes the source", async (t) => {
  const f = await fixture(t);
  let input;
  const upload = loadUpload({ putObject(params) {
    input = params.Body;
    throw new Error("invalid S3 configuration");
  } });
  await assert.rejects(upload("u", "p", f.file, "src"), /invalid S3 configuration/);
  assert.equal(input.destroyed, true);
});

test("a source read error fails the upload", async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.file.path);
  const upload = loadUpload({ putObject(params) {
    return { abort() {}, async promise() {
      for await (const chunk of params.Body) assert.fail("missing file must not produce bytes");
    } };
  } });
  await assert.rejects(upload("u", "p", f.file, "preview"), { code: "ENOENT" });
});

test("larger generated outputs retain bounded multipart support", async (t) => {
  const f = await fixture(t);
  f.file.size = 1024 * 1024 * 1024 + 1;
  const upload = loadUpload({
    putObject() { assert.fail("large internal output must retain multipart support"); },
    upload(params, options) {
      assert.equal(params.ContentLength, f.file.size);
      assert.equal(Buffer.isBuffer(params.Body), false);
      assert.deepEqual(options, { queueSize: 1, partSize: 8 * 1024 * 1024, leavePartsOnError: false });
      return { abort() {}, async promise() {
        for await (const chunk of params.Body) assert.ok(chunk.length);
        return { Location: "multipart-location" };
      } };
    },
  });
  const result = await upload("u", "p", f.file, "out");
  assert.equal(result.location, "multipart-location");
});
