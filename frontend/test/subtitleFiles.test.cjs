// Test the actual frontend serializer without a browser or external dependencies.
// TypeScript is already a frontend development dependency; axios is unused in these cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/subtitle-files.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const context = { exports: {}, require: name => {
  assert.equal(name, '@/lib/axios'); return { api: {} };
} };
vm.runInNewContext(code, context, { filename: 'subtitle-files.ts' });
const { serializeSubtitles } = context.exports;

test('REQ-VID-LEG-007: frontend SRT serializes Unicode text and exact millisecond times', () => {
  assert.equal(serializeSubtitles([{ start: 0.125, end: 1.5, text: ' São Paulo — ação ' }], 'srt'), '1\n00:00:00,125 --> 00:00:01,500\nSão Paulo — ação');
});
test('REQ-VID-LEG-007: frontend WebVTT has its header, dot timestamps and multiple lines', () => {
  assert.equal(serializeSubtitles([{ start: 0, end: 2.25, text: 'Primeira\nSegunda' }], 'vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.250\nPrimeira\nSegunda');
});
test('REQ-VID-LEG-007: chronological export does not reorder the editable input', () => {
  const cues = [{ start: 3, end: 4, text: 'depois' }, { start: 0, end: 1, text: 'antes' }];
  const snapshot = structuredClone(cues); const output = serializeSubtitles(cues, 'srt');
  assert.ok(output.indexOf('antes') < output.indexOf('depois')); assert.deepEqual(cues, snapshot);
});
test('REQ-VID-LEG-007: exports an empty list and rounds timestamps across a minute', () => {
  assert.equal(serializeSubtitles([], 'srt'), ''); assert.equal(serializeSubtitles([], 'vtt'), 'WEBVTT\n\n');
  assert.match(serializeSubtitles([{ start: 59.9999, end: 61, text: 'limite' }], 'vtt'), /00:01:00\.000 --> 00:01:01\.000/);
});
