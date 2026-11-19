// RNF-FIAB-01 fault-injection hooks for the orchestrator.
//
// Inert unless RNF_FIAB_01_HOOKS=1, which only the isolated test stack sets
// (tests/rnf-fiab-01/compose.fiab.yaml). Callers guard every call with
// `if (faultHooks.ENABLED)`, so production code paths gain no extra await.
//
// A fault is armed through <DIR>/fault.json:
//   {"id": "...", "target": "projects", "point": "<point>",
//    "match": "<substring of the reply body>", "cur_pos": 1, "action": "block"}
// It fires at most once (marker <DIR>/fired-<id>, created exclusively). "block"
// logs a FAULT-POINT line and waits for <DIR>/release-<id>; the harness kills the
// container after reading that line, so the failure window is proven by the log.
const fs = require("fs");
const path = require("path");

const ENABLED = process.env.RNF_FIAB_01_HOOKS === "1";
const SERVICE = process.env.RNF_FIAB_01_SERVICE || "projects";
const DIR = process.env.RNF_FIAB_01_DIR || "/app/images/.rnf-fiab-01";

const POINTS = [
  "after_receive",
  "after_process_delete",
  "after_result_persist",
  "before_commit",
  "before_next_publish",
];

function log(event, fields = {}) {
  const parts = Object.entries(fields).map(([key, value]) => `${key}=${value}`);
  console.log(["RNF-FIAB-01", event, `service=${SERVICE}`, ...parts, `ts=${new Date().toISOString()}`].join(" "));
}

function ready() {
  if (ENABLED) log("READY");
}

function received(msg) {
  if (!ENABLED) return;
  let id = "?";
  try {
    id = JSON.parse(msg.content.toString()).correlationId || "?";
  } catch (_) {}
  log("RECEIVED", { msg: id, redelivered: Boolean(msg.fields && msg.fields.redelivered) });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, "fault.json"), "utf8"));
  } catch (_) {
    return null;
  }
}

function armed(point, ctx) {
  const cfg = readConfig();
  if (!cfg || cfg.target !== SERVICE || cfg.point !== point || !cfg.id) return null;
  if (cfg.match && !String(ctx.body || "").includes(cfg.match)) return null;
  if (cfg.cur_pos !== undefined && cfg.cur_pos !== ctx.cur_pos) return null;
  try {
    fs.closeSync(fs.openSync(path.join(DIR, `fired-${cfg.id}`), "wx"));
  } catch (_) {
    return null;
  }
  return cfg;
}

function waitRelease(cfg) {
  const release = path.join(DIR, `release-${cfg.id}`);
  return new Promise((resolve) => {
    const poll = () => (fs.existsSync(release) ? resolve() : setTimeout(poll, 20));
    poll();
  });
}

async function faultPoint(point, ctx = {}) {
  if (!ENABLED) return null;
  const cfg = armed(point, ctx);
  if (!cfg) return null;
  log("FAULT-POINT", { id: cfg.id, point, msg: ctx.msg || "?", cur_pos: ctx.cur_pos });
  if ((cfg.action || "block") === "block") {
    await waitRelease(cfg);
    log("RELEASED", { id: cfg.id, msg: ctx.msg || "?" });
  }
  return cfg;
}

module.exports = { ENABLED, POINTS, faultPoint, ready, received, log };
