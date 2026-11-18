// Unit tests of the projects fault shim (node --test). They build a fake module tree
// with the same file names as projects/ and check where each point fires.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fiab-shim-"));
const app = path.join(dir, "app");
fs.mkdirSync(path.join(app, "controllers"), { recursive: true });
fs.mkdirSync(path.join(app, "utils"), { recursive: true });
fs.writeFileSync(path.join(app, "controllers", "process.js"),
  "module.exports.create = async (p) => ({ ...p, created: true });\n");
fs.writeFileSync(path.join(app, "controllers", "result.js"),
  "module.exports.create = async (r) => ({ ...r, created: true });\n");
fs.writeFileSync(path.join(app, "controllers", "project.js"),
  "module.exports.commitRunIfActive = async () => true;\n");
fs.writeFileSync(path.join(app, "utils", "runJobs.js"), `
module.exports.mongoStore = () => ({
  transition: async (id, from, update) => ({ _id: id, img_id: "img", ...update }),
  upsertResult: async (doc) => ({ created: true, result: doc }),
});\n`);
// Like routes/projects.js: destructure at require time.
fs.writeFileSync(path.join(app, "routes.js"), `
const Process = require("./controllers/process");
const Result = require("./controllers/result");
const Project = require("./controllers/project");
const { mongoStore } = require("./utils/runJobs");
module.exports = { Process, Result, Project, store: mongoStore() };\n`);

process.env.FAULT_DIR = dir;
process.env.FAULT_SERVICE = "projects";
const kills = [];
process.kill = (pid, signal) => { kills.push(signal); throw new Error("killed"); };
require("./fault-shim.js");
const routes = require(path.join(app, "routes.js"));

const arm = (config) => fs.writeFileSync(path.join(dir, "arm-projects.json"), JSON.stringify({ trial: Math.random(), ...config }));
const events = () => fs.readFileSync(path.join(dir, "events-projects.jsonl"), "utf8").trim().split("\n").map(JSON.parse);

test("original code: successor Process.create fires, step 0 does not count", async () => {
  arm({ point: "before_successor_create", nth: 2 });
  await routes.Process.create({ cur_pos: 0, msg_id: "a" });
  await routes.Process.create({ cur_pos: 1, msg_id: "b" });
  await assert.rejects(async () => routes.Process.create({ cur_pos: 2, msg_id: "c" }), /killed/);
  assert.ok(fs.existsSync(path.join(dir, "arm-projects.fired.json")));
});

test("refactoring: fires after the transition that persists the next step", async () => {
  arm({ point: "before_successor_create", nth: 1 });
  await routes.store.transition("j", "m", { state: "COMPLETED" });          // completion: ignored
  await routes.store.transition("j", "m", { state: "FAILED" });             // failure: ignored
  await assert.rejects(async () => routes.store.transition("j", "m0", { state: "PENDING_DISPATCH", cur_pos: 1, msg_id: "m1" }), /killed/);
  const fault = events().filter((e) => e.event === "fault").pop();
  assert.strictEqual(fault.msg_id, "m1");
});

test("refactoring: upsertResult and commit points fire", async () => {
  arm({ point: "before_result_create", nth: 1 });
  await assert.rejects(async () => routes.store.upsertResult({ img_id: "i", token: 1 }), /killed/);
  arm({ point: "before_commit", nth: 1 });
  await assert.rejects(async () => routes.Project.commitRunIfActive("u", "p", 1, []), /killed/);
});

test("unarmed: everything behaves normally", async () => {
  fs.rmSync(path.join(dir, "arm-projects.json"), { force: true });
  assert.strictEqual((await routes.Result.create({ x: 1 })).created, true);
  assert.strictEqual((await routes.store.upsertResult({ img_id: "i" })).created, true);
  assert.ok(events().some((e) => e.event === "patched" && e.module === "utils/runJobs.js"));
});
