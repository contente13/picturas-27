// RNF-FIAB-01: idempotent image jobs (utils/runJobs.js) against an in-memory store with
// the same compare-and-set semantics as the MongoDB store. Each test names the window
// of docs/rnf-fiab-01/diagnostico.md or the scenario it covers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  STATES, ACTIVE, TERMINAL, MAX_HANDLE_FAILURES, requestId, parseRequestId, stepOutputUri, newJob,
  createRunJobs,
} = require('../utils/runJobs');

const P = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const U = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const imgId = (i) => `cccccccccccccccccccccc${String(i).padStart(2, '0')}`;
const TOOLS = [
  { procedure: 'border', params: { borderWidth: 12 } },
  { procedure: 'brightness', params: { brightness: 1.4 } },
  { procedure: 'rotate', params: { degrees: 90 } },
];

function memoryStore() {
  const jobs = [];
  const results = [];
  let seq = 0;
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  const byId = (id) => jobs.find((j) => j._id === id);
  return {
    jobs, results,
    faults: {},
    insert(doc) { const j = { ...clone(doc), _id: `job${++seq}` }; jobs.push(j); return clone(j); },
    async getByMsgId(msgId) { return clone(jobs.find((j) => j.msg_id === msgId)); },
    async getById(id) { return clone(byId(id)); },
    async transition(id, from, update) {
      if (this.faults.transition && this.faults.transition(update)) throw new Error('database unavailable');
      const j = byId(id);
      if (!j || j.msg_id !== from || !ACTIVE.includes(j.state)) return null;
      Object.assign(j, clone(update));
      return clone(j);
    },
    async markDispatched(id, msgId) {
      const j = byId(id);
      if (j && j.msg_id === msgId && j.state === STATES.PENDING_DISPATCH) j.state = STATES.DISPATCHED;
    },
    async incrementFailures(msgId) {
      const j = jobs.find((x) => x.msg_id === msgId && ACTIVE.includes(x.state));
      if (!j) return null;
      j.handle_failures = (j.handle_failures || 0) + 1;
      return clone(j);
    },
    async pendingCount(projectId, token) {
      return jobs.filter((j) => j.project_id === projectId && j.token === token && !TERMINAL.includes(j.state)).length;
    },
    async forRun(projectId, token) { return clone(jobs.filter((j) => j.project_id === projectId && j.token === token)); },
    async pendingDispatch(cutoff) {
      return clone(jobs.filter((j) => j.state === STATES.PENDING_DISPATCH && new Date(j.dispatch_at) <= cutoff));
    },
    async runsToCheck() {
      const runs = new Map();
      for (const j of jobs) {
        const k = `${j.project_id}:${j.token}`;
        if (!runs.has(k)) runs.set(k, []);
        runs.get(k).push(j);
      }
      return clone([...runs.values()].filter((js) => js.every((j) => TERMINAL.includes(j.state))).map((js) => js[0]));
    },
    async upsertResult(doc) {
      const existing = results.find((r) => r.run_key === doc.run_key);
      if (existing) return { created: false, result: clone(existing) };
      const r = { ...doc, _id: `res${++seq}` };
      results.push(r);
      return { created: true, result: clone(r) };
    },
    async removeResult(id) { results.splice(results.findIndex((r) => r._id === id), 1); },
  };
}

function setup({ images = 2, tools = TOOLS } = {}) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rnf-fiab-01-'));
  const store = memoryStore();
  const project = { _id: P, user_id: U, activeToken: 7, committedToken: 6, tools, cancelToken: 0 };
  const published = [];
  const uploads = [];
  const removed = [];
  const notes = { success: 0, error: [] };
  const faults = {};
  const runJobs = createRunJobs({
    store,
    appRoot,
    getProject: async () => JSON.parse(JSON.stringify(project)),
    commitRunIfActive: async (user, projectId, token) => {
      if (faults.commit && faults.commit()) throw new Error('killed before commit');
      if (project.activeToken !== token || project.committedToken === token) return null;
      project.committedToken = token;
      return { ...project };
    },
    storage: {
      upload: async (user, projectId, filePath, name) => { const key = `key${uploads.length + 1}-${name}`; uploads.push(key); return key; },
      remove: async (user, projectId, key) => { removed.push(key); },
    },
    publishTool: async (msgId, ts, input, output, tool) => {
      if (faults.publish && faults.publish(msgId)) throw new Error('broker unavailable');
      published.push({ msgId, input, output, tool });
    },
    notify: { success: () => { notes.success += 1; }, error: (user, code, message) => notes.error.push({ code, message }) },
    log: { log: () => {}, error: () => {} },
  });
  const media = Array.from({ length: images }, (_, i) => ({
    _id: imgId(i + 1),
    og_uri: `./images/users/${U}/projects/${P}/src/img${i + 1}.png`,
    new_uri: `./images/users/${U}/projects/${P}/out/img${i + 1}.png`,
  }));
  return { appRoot, store, project, published, uploads, removed, notes, faults, runJobs, media };
}

async function start(ctx) {
  for (const img of ctx.media) {
    const job = ctx.store.insert(newJob({ project: ctx.project, img, token: 7, runnerId: U,
      tools: ctx.project.tools, appRoot: ctx.appRoot }));
    await ctx.runJobs.dispatch(job);
  }
}

const success = (msg, type = 'image') => ({ correlationId: msg.msgId, status: 'success',
  output: { type, imageURI: msg.output } });

// Deliver the reply of a published request through the orchestrator path.
async function reply(ctx, msg, body = success(msg)) {
  const job = await ctx.store.getByMsgId(body.correlationId);
  if (!job) return 'no-job';
  return ctx.runJobs.handleReply(body, job, {});
}

async function runToEnd(ctx) {
  for (let i = 0; i < ctx.published.length; i += 1) await reply(ctx, ctx.published[i]);
}

test('RNF-FIAB-01 request ids are deterministic and parseable', () => {
  const id = requestId(P, 7, imgId(1), 2);
  assert.equal(id, `request-${P}-7-${imgId(1)}-2`);
  assert.deepEqual(parseRequestId(id), { projectId: P, token: 7, imgId: imgId(1), pos: 2 });
  assert.equal(parseRequestId(`request-${'0'.repeat(8)}`), null);
  assert.equal(stepOutputUri('./images/u/out/a.png', 7, 'i', 1), 'images/u/out/runs/7/i/1/a.png');
});

test('RNF-FIAB-01 R0: each step reads the previous output and the run commits once', async () => {
  const ctx = setup();
  await start(ctx);
  await runToEnd(ctx);
  assert.equal(ctx.published.length, 6);
  const first = ctx.published.filter((m) => m.msgId.endsWith(`${imgId(1)}-0`))[0];
  const second = ctx.published.find((m) => m.msgId.endsWith(`${imgId(1)}-1`));
  assert.equal(first.input, ctx.media[0].og_uri);
  assert.equal(second.input, first.output, 'step k reads the output of step k-1');
  assert.notEqual(second.output, second.input, 'input and output never coincide (W2/W3)');
  assert.ok(fs.existsSync(path.dirname(path.resolve(ctx.appRoot, second.output))));
  assert.equal(ctx.store.results.length, 2);
  assert.equal(ctx.project.committedToken, 7);
  assert.ok(ctx.store.jobs.every((j) => j.state === STATES.COMPLETED));
  assert.equal(ctx.notes.success, 6, 'one progress notification per handled step, as before');
});

test('RNF-FIAB-01 R5b: concurrent copies of an intermediate reply start one successor', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  const border = ctx.published[0];
  const outcomes = await Promise.all([reply(ctx, border), reply(ctx, border), reply(ctx, border)]);
  assert.deepEqual(outcomes.sort(), ['advanced', 'duplicate', 'duplicate']);
  assert.equal(ctx.published.length, 2);
  await reply(ctx, border); // a late sequential copy
  await runToEnd(ctx);
  assert.equal(ctx.published.length, 3);
  assert.equal(ctx.store.results.length, 1);
  assert.equal(ctx.project.committedToken, 7);
});

test('RNF-FIAB-01 R5a: concurrent copies of the final reply publish one result and one commit', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  await reply(ctx, ctx.published[0]);
  await reply(ctx, ctx.published[1]);
  const rotate = ctx.published[2];
  const outcomes = await Promise.all([reply(ctx, rotate), reply(ctx, rotate), reply(ctx, rotate)]);
  assert.deepEqual(outcomes.sort(), ['completed', 'duplicate', 'duplicate']);
  assert.equal(ctx.store.results.length, 1);
  assert.equal(ctx.uploads.length, 3);
  assert.deepEqual(ctx.removed.sort(), ctx.uploads.filter((k) => k !== ctx.store.results[0].img_key).sort(),
    'the objects uploaded by losing copies are removed');
  assert.equal(ctx.project.committedToken, 7);
  assert.equal(ctx.notes.success, 3, 'one notification per step: no extra one for the copies');
});

test('RNF-FIAB-01 R6b/R6c: a successor persisted but never published is redispatched', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  let fail = true;
  ctx.faults.publish = (msgId) => msgId.endsWith('-1') && fail;
  assert.equal(await reply(ctx, ctx.published[0]), 'advanced');
  const job = ctx.store.jobs[0];
  assert.equal(job.state, STATES.PENDING_DISPATCH);
  assert.equal(job.cur_pos, 1);
  // Redelivery of the border reply after a restart finds no job at that step (the
  // orchestrator logs JOB-DUPLICATE and acks it).
  assert.equal(await reply(ctx, ctx.published[0]), 'no-job');
  fail = false;
  const stats = await ctx.runJobs.reconcile({ startup: true });
  assert.equal(stats.redispatched, 1);
  assert.equal(job.state, STATES.DISPATCHED);
  await runToEnd(ctx);
  assert.equal(ctx.store.results.length, 1);
  assert.equal(ctx.project.committedToken, 7);
});

test('RNF-FIAB-01 periodic reconciliation leaves fresh dispatches alone', async () => {
  const ctx = setup({ images: 1 });
  ctx.faults.publish = () => true;
  await start(ctx);
  ctx.faults.publish = () => false;
  assert.equal((await ctx.runJobs.reconcile({ startup: false })).redispatched, 0);
  const later = Date.now() + 60000;
  assert.equal((await ctx.runJobs.reconcile({ startup: false, now: later })).redispatched, 1);
});

test('RNF-FIAB-01 R6d: replaying a reply after the result was stored keeps one result', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  await reply(ctx, ctx.published[0]);
  await reply(ctx, ctx.published[1]);
  let killed = false;
  ctx.store.faults.transition = (update) => update.state === STATES.COMPLETED && !killed && (killed = true);
  await assert.rejects(reply(ctx, ctx.published[2]), /database unavailable/);
  assert.equal(ctx.store.results.length, 1);
  assert.equal(ctx.project.committedToken, 6, 'not committed yet');
  assert.equal(await reply(ctx, ctx.published[2]), 'completed');
  assert.equal(ctx.store.results.length, 1);
  assert.equal(ctx.removed.length, 1, 'the second upload is discarded');
  assert.equal(ctx.project.committedToken, 7);
});

test('RNF-FIAB-01 R6e: a completed run whose commit was interrupted is committed later', async () => {
  const ctx = setup({ images: 2 });
  await start(ctx);
  let killed = false;
  ctx.faults.commit = () => !killed && (killed = true);
  await assert.rejects(runToEnd(ctx), /killed before commit/);
  assert.ok(ctx.store.jobs.every((j) => j.state === STATES.COMPLETED));
  assert.equal(ctx.project.committedToken, 6);
  const before = ctx.notes.success;
  // The unacknowledged final reply is redelivered...
  assert.equal(await reply(ctx, ctx.published[ctx.published.length - 1]), 'duplicate');
  assert.equal(ctx.project.committedToken, 7);
  assert.equal(ctx.notes.success, before + 1);
  // ...and the reconciler would have done the same, but only once.
  assert.equal((await ctx.runJobs.reconcile({ startup: true })).committed, 0);
});

test('RNF-FIAB-01 R7/K3: replies of a cancelled or replaced run are ignored', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  ctx.project.activeToken = 8; // cancel or a new POST /process
  assert.equal(await reply(ctx, ctx.published[0]), 'stale-run');
  assert.equal(ctx.published.length, 1);
  assert.equal(ctx.store.results.length, 0);
});

test('RNF-FIAB-01 K4: a job removed while its final result is stored leaves no result', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  await reply(ctx, ctx.published[0]);
  await reply(ctx, ctx.published[1]);
  const job = await ctx.store.getByMsgId(ctx.published[2].msgId);
  ctx.store.faults.transition = (update) => {
    if (update.state === STATES.COMPLETED) ctx.store.jobs.splice(0, 1); // cancel deletes the job
    return false;
  };
  assert.equal(await ctx.runJobs.handleReply(success(ctx.published[2]), job, {}), 'duplicate');
  assert.equal(ctx.store.results.length, 0);
  assert.equal(ctx.removed.length, 1);
});

test('RNF-FIAB-01 R8 (D6): a failed job is reported once and the run commits the others', async () => {
  const ctx = setup({ images: 2 });
  await start(ctx);
  const bad = ctx.published[1];
  const error = { correlationId: bad.msgId, status: 'error', error: { code: 1201, message: 'not an image' } };
  await reply(ctx, bad, error);
  await reply(ctx, bad, error); // duplicate error reply
  assert.deepEqual(ctx.notes.error, [{ code: 1201, message: 'not an image' }]);
  await runToEnd(ctx);
  assert.equal(ctx.store.jobs.find((j) => j.img_id === imgId(2)).state, STATES.FAILED);
  assert.equal(ctx.store.results.length, 1);
  assert.equal(ctx.project.committedToken, 7);
});

test('RNF-FIAB-01 R8b (D6): when every job fails the previous commit is kept', async () => {
  const ctx = setup({ images: 2 });
  await start(ctx);
  for (const msg of [...ctx.published]) {
    await reply(ctx, msg, { correlationId: msg.msgId, status: 'error', error: { code: 'unexpected_error', message: 'x' } });
  }
  assert.equal(ctx.notes.error.length, 2);
  assert.equal(ctx.project.committedToken, 6);
});

test('RNF-FIAB-01 a reply that keeps failing is requeued, then fails the job', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  const body = success(ctx.published[0]);
  for (let i = 1; i < MAX_HANDLE_FAILURES; i += 1) {
    await assert.rejects(ctx.runJobs.handleFailure(body, new Error('storage down')), /storage down/);
  }
  assert.equal(await ctx.runJobs.handleFailure(body, new Error('storage down')), 'failed');
  assert.equal(ctx.store.jobs[0].state, STATES.FAILED);
  assert.equal(ctx.notes.error[0].code, 'handling_failed');
});

test('RNF-FIAB-01 a text output is stored and the next step reads the same image', async () => {
  const tools = [{ procedure: 'text_ai', params: {} }, { procedure: 'border', params: {} }];
  const ctx = setup({ images: 1, tools });
  await start(ctx);
  const ocr = ctx.published[0];
  await reply(ctx, ocr, { correlationId: ocr.msgId, status: 'success', output: { type: 'text', imageURI: `${ocr.output}.txt` } });
  assert.equal(ctx.store.results.length, 1);
  assert.equal(ctx.published[1].input, ctx.media[0].og_uri);
  assert.equal(ctx.project.committedToken, 6, 'a text step does not end the job');
  await reply(ctx, ctx.published[1]);
  assert.equal(ctx.store.results.length, 2);
  assert.equal(ctx.project.committedToken, 7);
});

test('RNF-FIAB-01 the pipeline is a snapshot: editing tools mid-run does not change the chain', async () => {
  const ctx = setup({ images: 1 });
  await start(ctx);
  ctx.project.tools = [TOOLS[0]];
  await runToEnd(ctx);
  assert.deepEqual(ctx.published.map((m) => m.tool), ['border', 'brightness', 'rotate']);
});
