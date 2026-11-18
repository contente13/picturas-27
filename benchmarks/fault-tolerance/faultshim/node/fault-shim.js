// Fault-injection shim for the projects orchestrator (RNF-FIAB-01 test harness only).
// Preloaded with NODE_OPTIONS="--require <this file>"; the application code is not
// modified. Inert unless FAULT_DIR is set.
//
// Control: <FAULT_DIR>/arm-<FAULT_SERVICE>.json, e.g.
//   {"trial": "R6a-01", "point": "before_successor_create", "nth": 5}
// Points (all crash the process; the window is the same in every version):
//   before_successor_create  step advance: the reply was taken and the next step is not
//                            yet published. Original code: before Process.create of a
//                            successor (cur_pos >= 1), after the old Process was deleted.
//                            RNF-FIAB-01 refactoring (utils/runJobs.js): right after the
//                            store transition that persists the next step
//                            (PENDING_DISPATCH), before it is published.
//   before_result_create     before the final output is recorded: Result.create, or
//                            mongoStore().upsertResult after the refactoring
//   before_commit            Project.commitRunIfActive (run consolidation)
// The arm file is renamed to *.fired.json before crashing, so the restarted
// process does not fire again.

const fs = require("fs");
const path = require("path");
const Module = require("module");

const FAULT_DIR = process.env.FAULT_DIR;
const SERVICE = process.env.FAULT_SERVICE || "projects";
// PIDs repeat across container restarts, so each start gets its own id.
const BOOT = require("crypto").randomBytes(6).toString("hex");

function trace(event, fields = {}) {
  const record = { ts: Date.now() / 1000, service: SERVICE, pid: process.pid, boot: BOOT, event, ...fields };
  try {
    const fd = fs.openSync(path.join(FAULT_DIR, `events-${SERVICE}.jsonl`), "a");
    fs.writeSync(fd, JSON.stringify(record) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (_) {
    // never break the service because of the harness
  }
}

const arm = { key: null, config: null, count: 0 };

function loadArm() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(FAULT_DIR, `arm-${SERVICE}.json`), "utf8"));
  } catch (_) {
    arm.key = null;
    return null;
  }
  const key = JSON.stringify([config.trial, config.point, config.nth]);
  if (key !== arm.key) Object.assign(arm, { key, config, count: 0 });
  return arm.config;
}

function maybeCrash(point, fields) {
  const config = loadArm();
  if (!config || config.point !== point) return;
  arm.count += 1;
  if (arm.count !== Number(config.nth || 1)) return;
  try {
    fs.renameSync(path.join(FAULT_DIR, `arm-${SERVICE}.json`), path.join(FAULT_DIR, `arm-${SERVICE}.fired.json`));
  } catch (_) {}
  trace("fault", { point, action: "crash", trial: config.trial, ...fields });
  process.kill(process.pid, "SIGKILL");
}

function wrap(exportsObject, name, point, select) {
  const original = exportsObject[name];
  if (typeof original !== "function") return;
  exportsObject[name] = function (...args) {
    const fields = select(...args);
    if (fields) maybeCrash(point, fields);
    return original.apply(this, args);
  };
}

const id = (value) => (value == null ? null : String(value));

// utils/runJobs.js (refactoring): wrap the store that mongoStore() returns. The patch is
// applied when the module is loaded, before routes/projects.js destructures it.
function patchRunJobs(m) {
  const original = m.mongoStore;
  if (typeof original !== "function") return;
  m.mongoStore = function (...args) {
    const store = original.apply(this, args);
    const transition = store.transition;
    if (typeof transition === "function") {
      store.transition = async function (jobId, fromMsgId, update) {
        const result = await transition.apply(this, [jobId, fromMsgId, update]);
        if (result && update && update.state === "PENDING_DISPATCH" && update.cur_pos >= 1) {
          maybeCrash("before_successor_create",
            { msg_id: update.msg_id, img_id: id(result.img_id), cur_pos: update.cur_pos });
        }
        return result;
      };
    }
    wrap(store, "upsertResult", "before_result_create", (r) => ({ img_id: id(r && r.img_id), token: r && r.token }));
    return store;
  };
}

const patches = {
  "utils/runJobs.js": patchRunJobs,
  "controllers/process.js": (m) =>
    wrap(m, "create", "before_successor_create", (p) =>
      p && p.cur_pos >= 1 ? { msg_id: p.msg_id, img_id: id(p.img_id), cur_pos: p.cur_pos } : null),
  "controllers/result.js": (m) =>
    wrap(m, "create", "before_result_create", (r) => ({ img_id: id(r && r.img_id), token: r && r.token })),
  "controllers/project.js": (m) =>
    wrap(m, "commitRunIfActive", "before_commit", (_u, projectId, token) => ({ project_id: id(projectId), token })),
};

if (FAULT_DIR) {
  const patched = new Set();
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    let filename;
    try {
      filename = Module._resolveFilename(request, parent, isMain);
    } catch (_) {
      return loaded;
    }
    for (const [suffix, patch] of Object.entries(patches)) {
      if (filename.endsWith(path.sep + suffix) && !patched.has(filename)) {
        patched.add(filename);
        patch(loaded);
        trace("patched", { module: suffix });
      }
    }
    return loaded;
  };
  trace("start", { argv: process.argv.slice(1).join(" ") });
}
