// UC-VID-001: manual subtitles and SRT export. Existing transcription tests are unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSubtitleSegments, toSrt } = require("../utils/subtitles");
const cue = (start = 0, end = 2, text = "Olá, São Paulo!") => ({ start, end, text });

test("REQ-VID-LEG-005: an empty list and valid boundary segments can be saved", () => {
  for (const segments of [[], [cue(0, 0.5)], [cue(0, 10)], [cue(9.5, 10)], [cue(0, 1), cue(1, 2)]]) {
    assert.equal(validateSubtitleSegments(segments, 10), null);
  }
});

for (const [name, segments] of [
  ["empty text", [cue(0, 2, " \n ")]],
  ["negative start", [cue(-1, 2)]],
  ["end beyond video", [cue(0, 11)]],
  ["reversed interval", [cue(2, 1)]],
  ["zero duration", [cue(1, 1)]],
  ["duration below 0.5 s", [cue(0, 0.49)]],
  ["duration above 10 s", [cue(0, 10.01)]],
  ["more than two lines", [cue(0, 2, "a\nb\nc")]],
  ["more than 42 characters per line", [cue(0, 2, "a".repeat(43))]],
  ["overlapping intervals", [cue(0, 2), cue(1.9, 3)]],
  ["non-finite time", [cue(NaN, 2)]],
]) {
  test(`REQ-VID-LEG-005: rejects ${name}`, () => {
    assert.equal(typeof validateSubtitleSegments(segments, 20), "string");
  });
}

test("REQ-VID-LEG-005: unsorted segments are validated chronologically without mutating input", () => {
  const segments = [cue(3, 4), cue(0, 1, "a".repeat(42) + "\n" + "b".repeat(42))];
  const snapshot = structuredClone(segments);
  assert.equal(validateSubtitleSegments(segments, 10), null);
  assert.deepEqual(segments, snapshot);
});

test("REQ-VID-LEG-007: SRT preserves UTF-8, sorts cues and writes millisecond timestamps", () => {
  const segments = [cue(3661.125, 3662.5, "São Paulo — ação"), cue(0, 0.5, "Primeira\nlinha")];
  const snapshot = structuredClone(segments);
  assert.equal(toSrt(segments), "1\n00:00:00,000 --> 00:00:00,500\nPrimeira\nlinha\n\n2\n01:01:01,125 --> 01:01:02,500\nSão Paulo — ação\n");
  assert.deepEqual(segments, snapshot);
  assert.equal(toSrt([]), "");
});
