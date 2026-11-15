// RNF-FIAB-01 (decision C, D3–D7): idempotent image jobs of a processing run.
//
// One Process document per (project, token, image) — the job — lives for the whole
// chain. Each step has a deterministic request id and its own output path, so a
// repeated step rewrites the same file with the same content and a repeated reply
// is recognised. Every state change is a compare-and-set on (job, current request id,
// active state): of several copies of a reply only one produces an effect.
//
//   PENDING_DISPATCH --publish confirmed--> DISPATCHED --reply--> next step | COMPLETED | FAILED
//
// The next step is persisted as PENDING_DISPATCH in the same write that advances the
// job (outbox) and republished by the reconciler if the process dies before the
// broker confirms it. A run is committed once, when no job is pending and the run is
// still active; failed jobs are reported and the run commits with the completed ones
// (D6). This module has no database or broker imports: everything is injected, so it
// is unit-tested with an in-memory store (tests/run-jobs.test.js).
const fs = require("fs");
const path = require("path");

const STATES = Object.freeze({
  PENDING_DISPATCH: "PENDING_DISPATCH",
  DISPATCHED: "DISPATCHED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
});
const ACTIVE = [STATES.PENDING_DISPATCH, STATES.DISPATCHED];
const TERMINAL = [STATES.COMPLETED, STATES.FAILED];
const MAX_HANDLE_FAILURES = 5;
const SLOW_STEP_MS = 1000;
const REDISPATCH_AFTER_MS = 5000;

function requestId(projectId, token, imgId, pos) {
  return `request-${projectId}-${token}-${imgId}-${pos}`;
}

function parseRequestId(id) {
  const m = /^request-([0-9a-f]{24})-(\d+)-([0-9a-f]{24})-(\d+)$/.exec(id || "");
  return m ? { projectId: m[1], token: Number(m[2]), imgId: m[3], pos: Number(m[4]) } : null;
}

// ./images/users/u/projects/p/out/name.png -> ./images/users/u/projects/p/out/runs/<t>/<img>/<k>/name.png
function stepOutputUri(newUri, token, imgId, pos) {
  return path.posix.join(path.posix.dirname(newUri), "runs", String(token), String(imgId), String(pos),
    path.posix.basename(newUri));
}

function ensureDir(appRoot, uri) {
  fs.mkdirSync(path.dirname(path.resolve(appRoot, uri)), { recursive: true });
}

function snapshotTools(tools) {
  return tools.map((t) => ({ procedure: t.procedure, params: t.params }));
}

// Fields of the first job document of an image (step 0), before dispatch.
function newJob({ project, img, token, runnerId, tools, appRoot, now = new Date() }) {
  const pos = 0;
  const job = {
    user_id: project.user_id,
    runner_id: runnerId,
    project_id: project._id,
    img_id: img._id,
    msg_id: requestId(project._id, token, img._id, pos),
    cur_pos: pos,
    og_img_uri: img.og_uri,
    new_img_uri: stepOutputUri(img.new_uri, token, img._id, pos),
    out_uri: img.new_uri,
    cancelToken: project.cancelToken || 0,
    token,
    state: STATES.PENDING_DISPATCH,
    pipeline: snapshotTools(tools),
    dispatch_at: now,
  };
  ensureDir(appRoot, job.new_img_uri);
  return job;
}

const corrOf = (reply) => (reply && reply.correlationId) || "?";

function createRunJobs(deps) {
  const { store, getProject, commitRunIfActive, storage, publishTool, notify, appRoot } = deps;
  const hooks = deps.hooks || { ENABLED: false };
  const log = deps.log || console;
  const point = async (name, ctx) => { if (hooks.ENABLED) await hooks.faultPoint(name, ctx); };
  // Observability: report external calls of a reply that take unusually long.
  const timed = async (label, ref, fn) => {
    const started = Date.now();
    try { return await fn(); } finally {
      const ms = Date.now() - started;
      if (ms >= SLOW_STEP_MS) log.log(`[JOB-SLOW] ${label} msg=${ref} ms=${ms}`);
    }
  };

  // Publish the job's current step and mark it DISPATCHED. A failed publish leaves the
  // job PENDING_DISPATCH for the reconciler; it never loses the step.
  async function dispatch(job) {
    const tool = job.pipeline[job.cur_pos];
    try {
      await publishTool(job.msg_id, new Date().toISOString(), job.og_img_uri, job.new_img_uri,
        tool.procedure, tool.params);
    } catch (err) {
      log.error(`[JOB-DISPATCH][RETRY-LATER] msg=${job.msg_id} err=${err && err.message}`);
      return false;
    }
    await store.markDispatched(job._id, job.msg_id);
    return true;
  }

  // Commit the run if every job is terminal and the run is still active. Only the call
  // that performs the transition returns true (the store filters on committedToken).
  async function tryCommit(job, ctx = {}) {
    const pending = await timed("pending", job.msg_id, () => store.pendingCount(job.project_id, job.token));
    if (pending > 0) return false;
    const jobs = await store.forRun(job.project_id, job.token);
    const completed = jobs.filter((j) => j.state === STATES.COMPLETED).length;
    const failed = jobs.filter((j) => j.state === STATES.FAILED).length;
    if (completed === 0) {
      if (!ctx.quiet) log.log(`[COMMIT-SKIP] project=${job.project_id} token=${job.token} reason=no-completed-jobs failed=${failed}`);
      return false;
    }
    const project = await getProject(job.user_id, job.project_id);
    if (!project || (project.activeToken || 0) !== job.token || (project.committedToken || 0) === job.token) {
      return false;
    }
    await point("before_commit", ctx);
    const tools = [...(project.tools || [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((t) => ({ _id: t._id, position: t.position, procedure: t.procedure, params: t.params }));
    const committed = await timed("commit", job.msg_id, () => commitRunIfActive(job.user_id, job.project_id, job.token, tools));
    if (!committed) return false;
    log.log(`[COMMIT] project=${job.project_id} committedToken=${job.token} completed=${completed} failed=${failed}`);
    return true;
  }

  async function persistResult(job, outputUri, type) {
    const filePath = path.resolve(appRoot, outputUri);
    const fileName = path.basename(filePath);
    const key = await timed("upload", job.msg_id, () => storage.upload(job.user_id, job.project_id, filePath, fileName));
    const doc = {
      type, file_name: fileName, img_key: key, img_id: job.img_id,
      project_id: job.project_id, user_id: job.user_id, token: job.token,
      run_key: `${job.project_id}:${job.token}:${job.img_id}:${fileName}`,
    };
    const { created, result } = await timed("result", job.msg_id, () => store.upsertResult(doc));
    if (!created && result.img_key !== key) {
      // A copy of this reply already published the result: drop our duplicate object.
      await storage.remove(job.user_id, job.project_id, key).catch(() => {});
    }
    return { created, result };
  }

  async function failJob(job, corr, error, runnerId) {
    const failed = await store.transition(job._id, corr, { state: STATES.FAILED, error });
    if (!failed) return false;
    log.log(`[JOB-FAILED] msg=${corr} img=${job.img_id} code=${error.code} status=error notified=1`);
    notify.error(runnerId, error.code, error.message);
    return true;
  }

  // Handle one worker reply for a job document (job.state is set). Resolves when the
  // reply has been fully handled (the caller then acks); rejects on transient errors.
  async function handleReply(reply, job, hookCtx = {}) {
    const corr = reply.correlationId;
    const runnerId = job.runner_id || job.user_id;
    const project = await timed("project", corrOf(reply), () => getProject(job.user_id, job.project_id));
    if (!project || (project.activeToken || 0) !== job.token) {
      log.log(`[RUN-GUARD] IGNORE msg=${corr} processTok=${job.token} activeTok=${project && project.activeToken}`);
      return "stale-run";
    }
    if (job.msg_id !== corr || !ACTIVE.includes(job.state)) {
      // Repeated or late copy. If the job is already terminal, the commit may still be
      // missing (the process died between both writes): finishing it is idempotent.
      log.log(`[JOB-DUPLICATE] msg=${corr} state=${job.state} pos=${job.cur_pos}`);
      if (TERMINAL.includes(job.state) && await tryCommit(job, hookCtx)) notify.success(runnerId);
      return "duplicate";
    }

    if (reply.status === "error") {
      const error = {
        code: (reply.error && reply.error.code) || "worker_error",
        message: (reply.error && (reply.error.message || reply.error.msg)) || "The tool could not process this media",
        step: job.cur_pos,
      };
      await failJob(job, corr, error, runnerId);
      if (await tryCommit(job, hookCtx)) notify.success(runnerId);
      return "failed";
    }

    const output = reply.output || {};
    const tools = job.pipeline || [];
    const nextPos = job.cur_pos + 1;
    const chainEnd = nextPos >= tools.length;
    const isText = output.type === "text";
    hookCtx.cur_pos = job.cur_pos;

    let persisted = null;
    if (isText || chainEnd) {
      persisted = await persistResult(job, output.imageURI, output.type);
      await point("after_result_persist", hookCtx);
    }

    if (chainEnd) {
      const done = await store.transition(job._id, corr, { state: STATES.COMPLETED });
      if (!done) {
        // Lost the race to a copy, or the job was removed (cancel/undo) meanwhile.
        const still = await store.getById(job._id);
        if (!still && persisted && persisted.created) {
          await store.removeResult(persisted.result._id);
          await storage.remove(job.user_id, job.project_id, persisted.result.img_key).catch(() => {});
        }
        return "duplicate";
      }
      await point("after_process_delete", hookCtx);
      await tryCommit(job, hookCtx);
      notify.success(runnerId); // one notification per completed job, after any commit
      return "completed";
    }

    const next = {
      cur_pos: nextPos,
      msg_id: requestId(job.project_id, job.token, job.img_id, nextPos),
      og_img_uri: isText ? job.og_img_uri : output.imageURI,
      new_img_uri: stepOutputUri(job.out_uri, job.token, job.img_id, nextPos),
      state: STATES.PENDING_DISPATCH,
      dispatch_at: new Date(),
      handle_failures: 0,
    };
    ensureDir(appRoot, next.new_img_uri);
    const advanced = await store.transition(job._id, corr, next);
    if (!advanced) return "duplicate";
    await point("after_process_delete", hookCtx);
    notify.success(runnerId);
    await point("before_next_publish", hookCtx);
    await dispatch(advanced);
    return "advanced";
  }

  // A reply could not be handled: count it; after MAX_HANDLE_FAILURES the job fails
  // permanently (resolve => ack), before that the error is rethrown (=> requeue).
  async function handleFailure(reply, err) {
    const corr = reply && reply.correlationId;
    const job = corr ? await store.incrementFailures(corr) : null;
    if (!job || (job.handle_failures || 0) < MAX_HANDLE_FAILURES) throw err;
    const runnerId = job.runner_id || job.user_id;
    await failJob(job, corr, { code: "handling_failed", message: "The result of this media could not be stored", step: job.cur_pos }, runnerId);
    if (await tryCommit(job)) notify.success(runnerId);
    return "failed";
  }

  // Startup and periodic recovery: republish steps whose publish was never confirmed
  // and finish commits interrupted after the last job completed.
  async function reconcile({ startup = false, now = Date.now() } = {}) {
    const stats = { redispatched: 0, committed: 0 };
    const cutoff = new Date(startup ? now : now - REDISPATCH_AFTER_MS);
    for (const job of await store.pendingDispatch(cutoff)) {
      const project = await getProject(job.user_id, job.project_id);
      if (!project || (project.activeToken || 0) !== job.token) continue;
      log.log(`[RECONCILE][REDISPATCH] msg=${job.msg_id}`);
      if (await dispatch(job)) stats.redispatched += 1;
    }
    for (const job of await store.runsToCheck()) {
      if (await tryCommit(job, { quiet: true })) {
        log.log(`[RECONCILE][COMMIT] project=${job.project_id} token=${job.token}`);
        notify.success(job.runner_id || job.user_id);
        stats.committed += 1;
      }
    }
    return stats;
  }

  return { dispatch, tryCommit, handleReply, handleFailure, reconcile, persistResult };
}

// MongoDB-backed store (Mongoose models). Every transition filters on the expected
// request id and an active state, which makes it a compare-and-set.
function mongoStore(Process, Result) {
  const notPreview = { msg_id: { $not: /^preview-/ } };
  return {
    getByMsgId: (msgId) => Process.findOne({ msg_id: msgId }).exec(),
    getById: (id) => Process.findById(id).exec(),
    transition: (id, fromMsgId, update) => Process.findOneAndUpdate(
      { _id: id, msg_id: fromMsgId, state: { $in: ACTIVE } }, { $set: update }, { new: true }).exec(),
    markDispatched: (id, msgId) => Process.updateOne(
      { _id: id, msg_id: msgId, state: STATES.PENDING_DISPATCH },
      { $set: { state: STATES.DISPATCHED, dispatch_at: new Date() } }).exec(),
    incrementFailures: (msgId) => Process.findOneAndUpdate(
      { msg_id: msgId, state: { $in: ACTIVE } }, { $inc: { handle_failures: 1 } }, { new: true }).exec(),
    // Pending = any non-terminal document of the run, legacy ones included (a legacy
    // document has no state and is deleted when done). Previews never block a commit.
    pendingCount: (projectId, token) => Process.countDocuments(
      { project_id: projectId, token, state: { $nin: TERMINAL }, ...notPreview }).exec(),
    forRun: (projectId, token) => Process.find({ project_id: projectId, token, state: { $exists: true } }).exec(),
    pendingDispatch: (cutoff) => Process.find(
      { state: STATES.PENDING_DISPATCH, dispatch_at: { $lte: cutoff } }).exec(),
    // One job per run whose jobs were updated in the last day and are all terminal.
    runsToCheck: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const groups = await Process.aggregate([
        { $match: { state: { $exists: true }, updatedAt: { $gte: since } } },
        { $group: { _id: { project_id: "$project_id", token: "$token" },
          active: { $sum: { $cond: [{ $in: ["$state", ACTIVE] }, 1, 0] } },
          job: { $first: "$$ROOT" } } },
        { $match: { active: 0 } },
      ]);
      return groups.map((g) => g.job);
    },
    upsertResult: async (doc) => {
      try {
        const raw = await Result.findOneAndUpdate({ run_key: doc.run_key }, { $setOnInsert: doc },
          { upsert: true, new: true, includeResultMetadata: true }).exec();
        return { created: !raw.lastErrorObject.updatedExisting, result: raw.value };
      } catch (err) {
        if (err && err.code === 11000) {
          return { created: false, result: await Result.findOne({ run_key: doc.run_key }).exec() };
        }
        throw err;
      }
    },
    removeResult: (id) => Result.deleteOne({ _id: id }).exec(),
  };
}

module.exports = {
  STATES, ACTIVE, TERMINAL, MAX_HANDLE_FAILURES, REDISPATCH_AFTER_MS,
  requestId, parseRequestId, stepOutputUri, newJob, createRunJobs, mongoStore,
};
