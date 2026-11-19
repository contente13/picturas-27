// RNF-FIAB-01: the orchestrator fault hooks are inert by default and, when
// enabled by the test stack, fire exactly once at the armed point.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const modulePath = require.resolve("../utils/faultHooks");

function loadHooks(env) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[modulePath];
  }
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rnf-fiab-01-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function silence(t) {
  const original = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  t.after(() => { console.log = original; });
  return lines;
}

test("RNF-FIAB-01 hooks are disabled by default and touch nothing", async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "fault.json"), JSON.stringify({ id: "x", target: "projects", point: "after_receive" }));
  const hooks = loadHooks({ RNF_FIAB_01_HOOKS: undefined, RNF_FIAB_01_DIR: dir });
  const lines = silence(t);
  assert.equal(hooks.ENABLED, false);
  assert.equal(await hooks.faultPoint("after_receive", { body: "{}" }), null);
  hooks.ready();
  assert.deepEqual(fs.readdirSync(dir), ["fault.json"]);
  assert.deepEqual(lines, []);
});

test("RNF-FIAB-01 armed point fires once, logs, and blocks until released", async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "fault.json"), JSON.stringify({
    id: "r6", target: "projects", point: "after_process_delete", match: "img03", cur_pos: 2,
  }));
  const hooks = loadHooks({ RNF_FIAB_01_HOOKS: "1", RNF_FIAB_01_DIR: dir, RNF_FIAB_01_SERVICE: "projects" });
  const lines = silence(t);

  assert.equal(await hooks.faultPoint("after_process_delete", { body: "img07", cur_pos: 2 }), null);
  assert.equal(await hooks.faultPoint("after_process_delete", { body: "img03", cur_pos: 1 }), null);
  assert.equal(await hooks.faultPoint("before_commit", { body: "img03", cur_pos: 2 }), null);

  let released = false;
  const pending = hooks.faultPoint("after_process_delete", { body: "img03", cur_pos: 2, msg: "request-1" })
    .then((cfg) => { released = true; return cfg; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(released, false, "the hook must block until the release file exists");
  assert.ok(lines.some((l) => /^RNF-FIAB-01 FAULT-POINT service=projects id=r6 point=after_process_delete msg=request-1 /.test(l)));

  // One-shot: a second matching message passes straight through.
  assert.equal(await hooks.faultPoint("after_process_delete", { body: "img03", cur_pos: 2 }), null);

  fs.writeFileSync(path.join(dir, "release-r6"), "");
  const cfg = await pending;
  assert.equal(cfg.id, "r6");
  assert.ok(fs.existsSync(path.join(dir, "fired-r6")));
});

test("RNF-FIAB-01 READY and RECEIVED lines carry the reply correlation id", (t) => {
  const dir = tempDir(t);
  const hooks = loadHooks({ RNF_FIAB_01_HOOKS: "1", RNF_FIAB_01_DIR: dir });
  const lines = silence(t);
  hooks.ready();
  hooks.received({ content: Buffer.from(JSON.stringify({ correlationId: "request-9" })), fields: { redelivered: true } });
  assert.match(lines[0], /^RNF-FIAB-01 READY service=projects ts=/);
  assert.match(lines[1], /^RNF-FIAB-01 RECEIVED service=projects msg=request-9 redelivered=true ts=/);
});
