// Real Nginx -> gateway -> projects -> storage/queue/worker end-to-end tests.
// Opt-in only. Creates its own accounts and projects; never changes existing user content.
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const enabled = process.env.PICTURAS_E2E === '1';
const base = process.env.PICTURAS_URL || 'https://nginx';
const fixtures = process.env.VIDEO_FIXTURES_DIR || path.join(__dirname, '.generated');
const run = crypto.randomUUID().slice(0, 8);
const agent = new https.Agent({ rejectUnauthorized: false }); // Self-signed LOCAL test certificate only.
const users = [], projects = [], results = [];
let premium, free, outsider, anonymous, main, freeProject;
const originalName = 'São Paulo — ação.mp4';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const file = name => fs.readFileSync(path.join(fixtures, name));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(method, target, user, data, headers = {}) {
  const url = new URL(target, base);
  assert.equal(url.origin, new URL(base).origin, 'requests must stay in the configured local test environment');
  let payload = Buffer.isBuffer(data) ? data : data === undefined ? undefined : Buffer.from(JSON.stringify(data));
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method, ...(url.protocol === 'https:' ? { agent } : {}),
      headers: { ...(user ? { authorization: `Bearer ${user.jwt}` } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers },
      timeout: 240000,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks); let body;
        try { body = JSON.parse(bytes.toString()); } catch { body = bytes.toString(); }
        resolve({ status: res.statusCode, headers: res.headers, body, bytes, elapsedMs: Date.now() - start });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
const api = (method, route, user, data, headers) => request(method, '/api-gateway' + route, user, data, headers);
const projectPath = p => `/projects/${p.owner.user._id}/${p._id}`;
const videoPath = (p, id) => `${projectPath(p)}/video/${id}`;
async function account(type) {
  const password = 'Video-test-only-' + run + '-2026!';
  const email = `video-test-${type}-${run}-${users.length}@example.invalid`;
  const response = await api('POST', '/users/', null, { name: `TST-VIDEO ${type} ${run}`, type, email: type === 'anonymous' ? undefined : email, password });
  assert.equal(response.status, 201, String(response.body));
  const result = { ...response.body, email, password }; users.push(result); return result;
}
async function project(owner, suffix) {
  const response = await api('POST', `/projects/${owner.user._id}`, owner, { name: `TST-VIDEO-${run}-${suffix}` });
  assert.equal(response.status, 201, String(response.body));
  const result = { ...response.body, owner }; projects.push(result); return result;
}
async function current(p) {
  const r = await api('GET', projectPath(p), p.owner); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
}
async function library(p) {
  const r = await api('GET', projectPath(p) + '/imgs', p.owner); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
}
async function upload(p, name, options = {}) {
  const version = options.version ?? (await current(p)).version;
  const boundary = 'picturas-test-' + crypto.randomUUID();
  const bytes = options.bytes || file(options.fixture || name);
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: ${name.endsWith('.webm') ? 'video/webm' : 'video/mp4'}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return api('POST', projectPath(p) + '/img' + (options.share ? '?share=' + options.share : ''), options.user || p.owner, body, { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-project-version': String(version) });
}
async function download(url) {
  const parsed = new URL(url); return request('GET', parsed.pathname + parsed.search);
}
async function remaining(user) {
  const r = await api('GET', `/users/${user.user._id}`, user); assert.equal(r.status, 200); return r.body.remaining_operations;
}
async function save(p, id, segments, user = p.owner, share) {
  const version = (await current(p)).version;
  return api('PUT', videoPath(p, id) + '/subtitles' + (share ? '?share=' + share : ''), user, { segments, projectVersion: version });
}
async function poll(p, id, timeout = 180000) {
  const deadline = Date.now() + timeout; const seen = [];
  while (Date.now() < deadline) {
    const r = await api('GET', `${projectPath(p)}/video/tasks/${id}`, p.owner);
    assert.equal(r.status, 200, JSON.stringify(r.body)); seen.push({ state: r.body.estado, progress: r.body.progresso });
    if (['CONCLUIDA', 'FALHADA', 'CANCELADA'].includes(r.body.estado)) return { ...r.body, seen };
    await wait(400);
  }
  await api('POST', `${projectPath(p)}/video/tasks/${id}/cancel`, p.owner);
  throw new Error(`Task ${id} did not finish within ${timeout} ms`);
}
async function completed(p, response) {
  assert.equal(response.status, 202, JSON.stringify(response.body));
  assert.ok(response.elapsedMs <= 2000, `task acceptance took ${response.elapsedMs} ms`);
  const task = await poll(p, response.body.tarefaId);
  assert.equal(task.estado, 'CONCLUIDA', JSON.stringify(task)); return task;
}
function probe(bytes, name) {
  const output = path.join(fixtures, `result-${run}-${name}`); fs.writeFileSync(output, bytes);
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
}
async function check(t, name, fn) {
  await t.test(name, { timeout: 240000 }, async () => {
    const start = Date.now();
    try { await fn(); results.push({ name, result: 'PASS', durationMs: Date.now() - start }); }
    catch (error) { results.push({ name, result: 'FAIL', error: error.message, durationMs: Date.now() - start }); throw error; }
  });
}

test('UC-VID-000/001/002/003 — complete local Docker stack', { skip: !enabled && 'set PICTURAS_E2E=1', timeout: 900000 }, async t => {
  assert.ok(['nginx', 'localhost', '127.0.0.1'].includes(new URL(base).hostname), 'local environment only');
  t.after(async () => {
    const cleanup = [];
    for (const p of [...projects].reverse()) {
      if (process.env.KEEP_VIDEO_TEST_DATA === '1' && p === main) continue;
      try {
        const version = (await current(p)).version;
        const r = await api('DELETE', projectPath(p), p.owner, undefined, { 'x-project-version': String(version) });
        if (![200, 204].includes(r.status)) cleanup.push({ project: p._id, status: r.status });
      } catch (error) { cleanup.push({ project: p._id, error: error.message }); }
    }
    for (const user of users) {
      if (process.env.KEEP_VIDEO_TEST_DATA === '1' && user === premium) continue;
      await api('DELETE', `/users/${user.user._id}`, user).catch(error => cleanup.push({ account: user.user._id, error: error.message }));
    }
    fs.writeFileSync(path.join(fixtures, 'run-results.json'), JSON.stringify({ run, environment: base, date: new Date().toISOString(), results, cleanup }, null, 2));
    agent.destroy();
  });
  premium = await account('premium'); free = await account('free'); outsider = await account('premium'); anonymous = await account('anonymous');
  main = await project(premium, 'premium'); freeProject = await project(free, 'registado');
  const initial = {};
  await check(t, 'UPLOAD-003/007/009/013/014: MP4, WebM, silent clip, metadata, thumbnail, SHA-256 and UTF-8 round trip', async () => {
    for (const name of [originalName, 'verde.webm', 'silencioso.mp4']) assert.equal((await upload(main, name)).status, 204);
    const videos = await library(main); assert.equal(videos.length, 3);
    for (const video of videos) {
      initial[video.name] = video;
      assert.equal(hash((await download(video.url)).bytes), hash(file(video.name)));
      assert.ok(video.thumbnailUrl); assert.equal((await download(video.thumbnailUrl)).status, 200);
      assert.ok(video.mediaMetadata.duration > 0);
    }
    assert.equal(initial['silencioso.mp4'].mediaMetadata.audioCodec, null);
    assert.equal((await upload(freeProject, originalName)).status, 204);
  });
  await check(t, 'UPLOAD-002: unauthenticated and anonymous uploads are refused', async () => {
    assert.equal((await api('POST', projectPath(main) + '/img')).status, 401);
    const p = await project(anonymous, 'anonimo'); assert.equal((await upload(p, 'silencioso.mp4')).status, 403);
  });
  await check(t, 'UPLOAD-005: corrupt, audio-only and incompatible-codec files leave the project unchanged', async () => {
    const before = (await library(main)).length;
    for (const [name, status] of [['corrompido.mp4', 422], ['apenas-audio.mp4', 422], ['codec-invalido.mp4', 415]]) {
      assert.equal((await upload(main, name)).status, status, name);
    }
    assert.equal((await library(main)).length, before);
  });
  await check(t, 'UPLOAD-006/008: duplicate names and stale versions do not overwrite an accepted video', async () => {
    assert.equal((await upload(main, originalName)).status, 400);
    assert.equal((await upload(main, 'desatualizado.mp4', { fixture: originalName, version: 0 })).status, 409);
    assert.equal(hash((await download(initial[originalName].url)).bytes), hash(file(originalName)));
  });
  await check(t, 'UPLOAD-004: real duration limits refuse 601 s for free and 3601 s for Premium', async () => {
    assert.equal((await upload(freeProject, 'longo-601s.mp4')).status, 413);
    assert.equal((await upload(main, 'longo-3601s.mp4')).status, 413);
    assert.equal((await upload(main, 'longo-601s.mp4')).status, 204);
  });
  await check(t, 'UPLOAD-010/012: a rejected item does not remove previous/following successes and upload consumes no quota', async () => {
    const before = await remaining(free);
    const statuses = [];
    for (const [name, fixture] of [['lote-a.mp4', originalName], ['lote-invalido.mp4', 'corrompido.mp4'], ['lote-b.mp4', 'silencioso.mp4']]) statuses.push((await upload(freeProject, name, { fixture })).status);
    assert.deepEqual(statuses, [204, 422, 204]);
    const names = (await library(freeProject)).map(v => v.name); assert.ok(names.includes('lote-a.mp4') && names.includes('lote-b.mp4'));
    assert.equal(await remaining(free), before);
    assert.equal((await api('GET', projectPath(freeProject) + '/video/tasks/latest', free)).body.tarefa, null);
  });
  await check(t, 'UPLOAD-003: unsupported AVI is refused by the server', async () => {
    const r = await upload(main, 'nao-suportado.avi', { fixture: originalName });
    assert.ok([400, 415, 422].includes(r.status), `unsupported AVI returned ${r.status}`);
  });
  const cues = [{ start: 0, end: 1.2, text: 'Primeira legenda' }, { start: 2, end: 3, text: 'São Paulo — ação' }, { start: 4.5, end: 6, text: 'Última legenda' }];
  await check(t, 'LEG-004/006: save and reopen editable subtitles without changing source bytes', async () => {
    assert.equal((await save(main, initial[originalName]._id, cues)).status, 200);
    const r = await api('GET', videoPath(main, initial[originalName]._id) + '/subtitles', premium);
    assert.deepEqual(r.body.segments, cues);
    assert.equal(hash((await download(initial[originalName].url)).bytes), hash(file(originalName)));
  });
  await check(t, 'LEG-005: invalid and overlapping segments are refused without replacing saved captions', async () => {
    assert.equal((await save(main, initial[originalName]._id, [{ start: 0, end: 2, text: '' }])).status, 400);
    assert.equal((await save(main, initial[originalName]._id, [{ start: 0, end: 2, text: 'a' }, { start: 1, end: 3, text: 'b' }])).status, 400);
    assert.deepEqual((await api('GET', videoPath(main, initial[originalName]._id) + '/subtitles', premium)).body.segments, cues);
  });
  await check(t, 'LEG-020: MP4/WebM downloads have a default selectable subtitle track and do not create derived videos', async () => {
    const before = (await library(main)).length;
    for (const name of [originalName, 'verde.webm']) {
      assert.equal((await save(main, initial[name]._id, cues)).status, 200);
      const r = await api('GET', videoPath(main, initial[name]._id) + '/with-subtitles', premium);
      assert.equal(r.status, 200, String(r.body)); const metadata = probe(r.bytes, 'track-' + path.extname(name).slice(1) + path.extname(name));
      const track = metadata.streams.find(s => s.codec_type === 'subtitle');
      assert.equal(track?.codec_name, name.endsWith('.mp4') ? 'mov_text' : 'webvtt'); assert.equal(track.disposition.default, 1);
    }
    assert.equal((await library(main)).length, before);
  });
  await check(t, 'LEG-013/018: automatic generation rejects free profile and videos without audio', async () => {
    const source = (await library(freeProject))[0];
    assert.equal((await api('POST', videoPath(freeProject, source._id) + '/subtitles/generate', free, {})).status, 403);
    assert.equal((await api('POST', videoPath(main, initial['silencioso.mp4']._id) + '/subtitles/generate', premium, {})).status, 422);
  });
  await check(t, 'LEG-014/015/018: real local Whisper returns valid editable English cues without overwriting saved subtitles', async () => {
    assert.equal((await upload(main, 'fala-ingles.mp4')).status, 204);
    const source = (await library(main)).find(v => v.name === 'fala-ingles.mp4');
    const saved = [{ start: 0, end: 1, text: 'Versão guardada' }]; await save(main, source._id, saved);
    const task = await completed(main, await api('POST', videoPath(main, source._id) + '/subtitles/generate', premium, {}));
    assert.ok(task.segments?.length > 0);
    const validate = require('../../projects/utils/subtitles').validateSubtitleSegments;
    assert.equal(validate(task.segments, source.mediaMetadata.duration), null);
    assert.match(task.segments.map(c => c.text).join(' '), /hello|video|subtitle|test/i);
    assert.deepEqual((await api('GET', videoPath(main, source._id) + '/subtitles', premium)).body.segments, saved);
  });
  await check(t, 'LEG-009/017/COMMON-001: real incorporation creates a new MP4 and preserves source and editable subtitles', async () => {
    const task = await completed(main, await api('POST', videoPath(main, initial[originalName]._id) + '/subtitles/embed', premium, {}));
    const output = (await library(main)).find(v => v._id === task.resultImageId); assert.ok(output?.name.endsWith('_legendas.mp4'));
    const metadata = probe((await download(output.url)).bytes, 'embed.mp4'); assert.equal(metadata.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
    assert.equal(hash((await download(initial[originalName].url)).bytes), hash(file(originalName)));
  });
  for (const [start, end] of [[0, 12], [2, 1], [-1, 3], [0, 0.5], [0, 10.25]]) {
    await check(t, `TRIM-003: interval [${start},${end}] is refused before task creation`, async () => {
      assert.equal((await api('POST', videoPath(main, initial[originalName]._id) + '/trim', premium, { tempoInicio: start, tempoFim: end })).status, 400);
    });
  }
  await check(t, 'TRIM-004: Premium cut above 600 s is refused', async () => {
    const source = (await library(main)).find(v => v.name === 'longo-601s.mp4');
    assert.equal((await api('POST', videoPath(main, source._id) + '/trim', premium, { tempoInicio: 0, tempoFim: 600.1 })).status, 400);
  });
  await check(t, 'TRIM-011/015: real cut preserves format/fps, copies adjusted subtitles, discards short intersections and keeps source hash', async () => {
    const task = await completed(main, await api('POST', videoPath(main, initial[originalName]._id) + '/trim', premium, { tempoInicio: 1, tempoFim: 5 }));
    const output = (await library(main)).find(v => v._id === task.resultImageId); assert.ok(output.name.endsWith('_recorte.mp4'));
    const m = output.mediaMetadata; assert.equal(m.videoCodec, 'h264'); assert.equal(m.width, 640); assert.equal(m.height, 360);
    assert.ok(Math.abs(m.duration - 4) <= 1 / 24 + 0.001, `duration ${m.duration}`);
    const subtitles = (await api('GET', videoPath(main, output._id) + '/subtitles', premium)).body.segments;
    assert.deepEqual(subtitles, [{ start: 1, end: 2, text: cues[1].text }, { start: 3.5, end: 4, text: cues[2].text }]);
    assert.deepEqual((await api('GET', videoPath(main, initial[originalName]._id) + '/subtitles', premium)).body.segments, cues);
    assert.equal(hash((await download(initial[originalName].url)).bytes), hash(file(originalName)));
  });
  await check(t, 'CONCAT-001/002/006: fewer than two clips and repeated clips are refused without a task', async () => {
    for (const imageIds of [[initial[originalName]._id], [initial[originalName]._id, initial[originalName]._id]]) {
      assert.equal((await api('POST', projectPath(main) + '/video/concat/validate', premium, { imageIds })).status, 400);
    }
  });
  await check(t, 'CONCAT-008/009/010/011/013/019/022: real mixed MP4/WebM concatenation normalizes output and shifts captions', async () => {
    const imageIds = [initial['verde.webm']._id, initial[originalName]._id, initial['silencioso.mp4']._id];
    const validation = await api('POST', projectPath(main) + '/video/concat/validate', premium, { imageIds });
    const durationOfFirst = initial['verde.webm'].mediaMetadata.duration;
    const expectedDuration = imageIds.reduce((sum, id) => sum + Object.values(initial).find(v => v._id === id).mediaMetadata.duration, 0);
    assert.equal(validation.status, 200); assert.ok(Math.abs(validation.body.totals.durationSeconds - expectedDuration) < 0.001);
    const task = await completed(main, await api('POST', projectPath(main) + '/video/concat', premium, { imageIds }));
    const output = (await library(main)).find(v => v._id === task.resultImageId); assert.ok(output.name.endsWith('_juncao.mp4'));
    const m = probe((await download(output.url)).bytes, 'concat.mp4');
    assert.equal(m.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
    assert.equal(m.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
    assert.ok(Math.abs(Number(m.format.duration) - expectedDuration) < 0.2);
    const subtitles = (await api('GET', videoPath(main, output._id) + '/subtitles', premium)).body.segments;
    assert.ok(subtitles.some(c => Math.abs(c.start - (durationOfFirst + 2)) < 0.1 && Math.abs(c.end - (durationOfFirst + 3)) < 0.1 && c.text === cues[1].text));
    for (const name of [originalName, 'verde.webm', 'silencioso.mp4']) assert.equal(hash((await download(initial[name].url)).bytes), hash(file(name)));
  });
  await check(t, 'TRIM-012: a real successful cut consumes exactly one free operation', async () => {
    const source = (await library(freeProject))[0]; const before = await remaining(free);
    await completed(freeProject, await api('POST', videoPath(freeProject, source._id) + '/trim', free, { tempoInicio: 1, tempoFim: 3 }));
    assert.equal(await remaining(free), before - 1);
  });
  await check(t, 'TRIM-010/COMMON-003: cancel real processing; retake state and no partial result appears', async () => {
    const p = await project(free, 'cancelar'); assert.equal((await upload(p, 'cancelar-hd.mp4')).status, 204);
    const source = (await library(p))[0]; const before = await remaining(free);
    const response = await api('POST', videoPath(p, source._id) + '/trim', free, { tempoInicio: 0, tempoFim: 19 }); assert.equal(response.status, 202);
    const id = response.body.tarefaId;
    for (let i = 0; i < 30; i++) { const status = await api('GET', `${projectPath(p)}/video/tasks/${id}`, free); if (status.body.estado !== 'EM_FILA') break; await wait(100); }
    const cancelled = await api('POST', `${projectPath(p)}/video/tasks/${id}/cancel`, free); assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    await wait(5500); assert.equal((await poll(p, id)).estado, 'CANCELADA'); assert.equal((await library(p)).length, 1); assert.equal(await remaining(free), before);
  });
  await check(t, 'UPLOAD-001/LEG-021/TRIM-005: read-only sharing permits download but rejects edit, upload and processing', async () => {
    const response = await api('POST', projectPath(main) + '/share', premium, { permission: 'read' }, { 'x-project-version': String((await current(main)).version) }); assert.equal(response.status, 201);
    const share = response.body.id; const suffix = '?share=' + share;
    assert.equal((await api('GET', videoPath(main, initial[originalName]._id) + '/subtitles' + suffix, outsider)).status, 200);
    assert.equal((await save(main, initial[originalName]._id, cues, outsider, share)).status, 403);
    assert.equal((await upload(main, 'proibido.mp4', { fixture: originalName, user: outsider, share })).status, 403);
    assert.equal((await api('POST', videoPath(main, initial[originalName]._id) + '/trim' + suffix, outsider, { tempoInicio: 1, tempoFim: 3 })).status, 403);
  });
  if (process.env.KEEP_VIDEO_TEST_DATA === '1') fs.writeFileSync(path.join(fixtures, 'manual-session.json'), JSON.stringify({ email: premium.email, password: premium.password, userId: premium.user._id, projectId: main._id }, null, 2));
});
