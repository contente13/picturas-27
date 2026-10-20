const assert = require("node:assert/strict");
const test = require("node:test");

const {
  trimSubtitleSegments,
  validateTrimInterval,
  validateTrimProfileDuration,
} = require("../utils/videoTrim");

// UC-VID-002 / REQ-TRIM-003: boundaries and the minimum interval are inclusive
// only where the use case says they are (1 s minimum, but not the whole video).
test("REQ-TRIM-003: accepts a valid one-second interval at tenth-second precision", () => {
  assert.equal(validateTrimInterval(0.1, 1.1, 30), null);
});

test("REQ-TRIM-003: accepts an interval that ends exactly at the video duration", () => {
  assert.equal(validateTrimInterval(29, 30, 30), null);
});

test("REQ-TRIM-003: rejects non-numeric times and invalid video duration", () => {
  const error = "Os tempos de início e fim têm de ser números válidos.";
  assert.equal(validateTrimInterval(Number.NaN, 4, 30), error);
  assert.equal(validateTrimInterval(1, Number.POSITIVE_INFINITY, 30), error);
  assert.equal(validateTrimInterval(1, 2, 0), error);
});

test("REQ-TRIM-003: rejects times that are not multiples of 0.1 seconds", () => {
  assert.match(validateTrimInterval(10.25, 20, 30), /múltiplos de 0,1/);
});

test("REQ-TRIM-003: rejects negative, reversed, equal, or out-of-video times", () => {
  for (const [start, end] of [[-0.1, 2], [5, 4], [4, 4], [0, 30.1]]) {
    assert.match(validateTrimInterval(start, end, 30), /dentro da duração/);
  }
});

test("REQ-TRIM-003: rejects intervals shorter than one second", () => {
  assert.match(validateTrimInterval(1, 1.9, 30), /mínima.*1 segundo/);
});

test("REQ-TRIM-003: rejects an interval equal to the full source duration", () => {
  assert.match(validateTrimInterval(0, 30, 30), /mais curto do que o vídeo original/);
});

// UC-VID-002 / REQ-TRIM-004: profile duration limits are inclusive.
test("REQ-TRIM-004: accepts a registered user's 60-second limit and rejects longer trims", () => {
  assert.equal(validateTrimProfileDuration(10, 70, "free"), null);
  assert.match(validateTrimProfileDuration(10, 70.1, "free"), /limite de 60 segundos/);
});

test("REQ-TRIM-004: accepts a Premium user's 600-second limit and rejects longer trims", () => {
  assert.equal(validateTrimProfileDuration(10, 610, "premium"), null);
  assert.match(validateTrimProfileDuration(10, 610.1, "premium"), /limite de 600 segundos/);
});

// UC-VID-002 / REQ-TRIM-015: intersecting captions are clipped, shifted and
// copied; short intersections are discarded without changing the input array.
test("REQ-TRIM-015: clips intersecting subtitles and shifts their times to the new video", () => {
  const original = [
    { start: 9, end: 10.3, text: "discard: under half a second" },
    { start: 12, end: 15, text: "inside" },
    { start: 19, end: 22, text: "clipped at end" },
    { start: 1, end: 2, text: "outside" },
  ];

  assert.deepEqual(trimSubtitleSegments(original, 10, 20), [
    { start: 2, end: 5, text: "inside" },
    { start: 9, end: 10, text: "clipped at end" },
  ]);
  assert.deepEqual(original[1], { start: 12, end: 15, text: "inside" });
});

test("REQ-TRIM-015: retains an intersection of exactly 0.5 seconds", () => {
  assert.deepEqual(trimSubtitleSegments([{ start: 9.5, end: 10.5, text: "boundary" }], 10, 20), [
    { start: 0, end: 0.5, text: "boundary" },
  ]);
});

test("REQ-TRIM-015: returns no copied subtitles when the source has none", () => {
  assert.deepEqual(trimSubtitleSegments([], 10, 20), []);
  assert.deepEqual(trimSubtitleSegments(undefined, 10, 20), []);
});
