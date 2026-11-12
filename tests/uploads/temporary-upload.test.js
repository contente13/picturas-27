const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { createHash } = require("node:crypto");
const express = require("express");

async function fixture(t, service, handler, before, rootIsFile = false) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "upload-test-"));
  const root = path.join(parent, "files");
  if (rootIsFile) await fs.writeFile(root, "not a directory");
  const { temporaryUpload } = require(`../../${service}/utils/temporaryUpload`);
  const app = express();
  let context;
  app.post("/upload", temporaryUpload(root).single("file"), (req, res, next) => {
    context = req.uploadContext;
    if (before) before(req, res, next);
    else next();
  }, (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  });
  app.use((error, req, res, next) => res.status(500).send(error.code || error.message));
  const server = app.listen(0, "0.0.0.0");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(parent, { recursive: true, force: true });
  });
  return {
    root, port: server.address().port, context: () => context,
    async empty() {
      for (let i = 0; i < 100; i++) {
        const names = await fs.readdir(root).catch(() => []);
        if (!names.length) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(await fs.readdir(root), []);
    },
  };
}

function multipart(content, field = "file") {
  const boundary = "test-boundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="original.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, head, tail };
}

function send(port, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: "127.0.0.1", path: "/upload", method: "POST", headers: data.headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end(data.body);
  });
}

for (const service of ["apiGateway", "projects", "imageStorageService"]) {
  test(`${service}: file stays on disk, normal request close does not abort processing`, async (t) => {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 42);
    const f = await fixture(t, service, async (req, res) => {
      assert.equal(req.file.buffer, undefined);
      assert.equal(req.file.originalname, "original.bin");
      assert.equal(req.file.size, bytes.length);
      assert.equal(path.basename(req.file.path), req.file.filename);
      const hash = createHash("sha256");
      for await (const chunk of req.uploadContext.openStream()) hash.update(chunk);
      assert.equal(hash.digest("hex"), createHash("sha256").update(bytes).digest("hex"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(req.uploadContext.signal.aborted, false);
      res.sendStatus(204);
    });
    assert.equal((await send(f.port, multipart(bytes))).status, 204);
    await f.empty();
    await f.context().cleanup();
  });

  test(`${service}: authorization denial after parsing cleans the received file`, async (t) => {
    const f = await fixture(t, service, () => assert.fail("handler must not run"), (req, res) => res.sendStatus(401));
    assert.equal((await send(f.port, multipart(Buffer.from("denied")))).status, 401);
    await f.empty();
  });

  test(`${service}: malformed multipart and unexpected fields leave no files`, async (t) => {
    const f = await fixture(t, service, () => assert.fail("handler must not run"));
    const data = multipart(Buffer.alloc(4096));
    data.body = data.body.subarray(0, data.body.length - data.tail.length);
    assert.equal((await send(f.port, data)).status, 500);
    await f.empty();
    assert.equal((await send(f.port, multipart(Buffer.from("wrong"), "other"))).status, 500);
    await f.empty();
  });

  test(`${service}: disconnect during reception removes the partial file`, async (t) => {
    const f = await fixture(t, service, () => assert.fail("partial upload must not be accepted"));
    const data = multipart(Buffer.alloc(1024));
    const req = http.request({ port: f.port, host: "127.0.0.1", path: "/upload", method: "POST", headers: data.headers });
    req.on("error", () => {});
    req.write(data.head);
    req.write(Buffer.alloc(64 * 1024));
    for (let i = 0; i < 100; i++) {
      if ((await fs.readdir(f.root).catch(() => [])).length) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await f.empty();
  });

  test(`${service}: disconnect after reception signals cancellation`, async (t) => {
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const f = await fixture(t, service, async (req, res) => {
      started();
      await once(req.uploadContext.signal, "abort");
    });
    const data = multipart(Buffer.from("complete body"));
    const req = http.request({ port: f.port, host: "127.0.0.1", path: "/upload", method: "POST", headers: data.headers });
    req.on("error", () => {});
    req.end(data.body);
    await ready;
    const cancelled = once(f.context().signal, "abort");
    req.destroy();
    await cancelled;
    assert.equal(f.context().signal.aborted, true);
    await f.empty();
  });

  test(`${service}: disk errors return an error without accepting the upload`, async (t) => {
    const f = await fixture(t, service, () => assert.fail("disk error must not be accepted"), null, true);
    assert.equal((await send(f.port, multipart(Buffer.from("body")))).status, 500);
  });
}
