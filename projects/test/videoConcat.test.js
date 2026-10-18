// UC-VID-003: validation of the selection (RN1–RN4, RN17, E1–E6), normalization plan (RN5–RN8,
// FA4–FA7) and subtitles of the result (RN20). Pure functions, no database or ffmpeg.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONCAT_LIMITS,
  normalizeClipArgs,
  planNormalization,
  shiftSubtitles,
  validateConcatSelection,
} = require("../utils/videoConcat");

const MB = 1024 * 1024;
let nextId = 1;
function video(name, metadata = {}) {
  return {
    _id: String(nextId++),
    og_uri: `./images/u/projects/p/src/${name}`,
    og_img_key: `${name}.key`,
    mediaMetadata: {
      duration: 10, width: 1280, height: 720, frameRate: "30/1", avgFrameRate: "30/1",
      videoCodec: name.endsWith(".webm") ? "vp8" : "h264", audioCodec: name.endsWith(".webm") ? "vorbis" : "aac",
      sizeBytes: 10 * MB, rotation: 0, ...metadata,
    },
    subtitles: [],
  };
}
const ids = (images) => images.map((image) => image._id);

test("RN1 / E1: fewer than two videos is refused", () => {
  const a = video("a.mp4");
  for (const selection of [[], [a._id], undefined]) {
    const result = validateConcatSelection([a], selection, "free");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.message, /pelo menos dois vídeos/);
  }
});

test("the same video cannot appear twice in the sequence", () => {
  const a = video("a.mp4");
  const b = video("b.mp4");
  assert.equal(validateConcatSelection([a, b], [a._id, b._id, a._id], "premium").ok, false);
});

test("RN3: at most 10 videos for Registado and 30 for Premium", () => {
  const eleven = Array.from({ length: 11 }, (_, index) => video(`v${index}.mp4`, { duration: 5, sizeBytes: MB }));
  assert.equal(validateConcatSelection(eleven, ids(eleven.slice(0, 10)), "free").ok, true);
  const tooMany = validateConcatSelection(eleven, ids(eleven), "free");
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.message, /no máximo 10 vídeos/);
  assert.equal(validateConcatSelection(eleven, ids(eleven), "premium").ok, true);
  const thirtyOne = Array.from({ length: 31 }, (_, index) => video(`p${index}.mp4`, { duration: 5, sizeBytes: MB }));
  assert.equal(validateConcatSelection(thirtyOne, ids(thirtyOne.slice(0, 30)), "premium").ok, true);
  assert.match(validateConcatSelection(thirtyOne, ids(thirtyOne), "premium").message, /no máximo 30 vídeos/);
});

test("RN4 / E4: total duration up to 10 min (Registado) and 60 min (Premium), limit included", () => {
  const halfLimit = (seconds) => [video("a.mp4", { duration: seconds / 2 }), video("b.mp4", { duration: seconds / 2 })];
  const atLimit = halfLimit(600);
  assert.equal(validateConcatSelection(atLimit, ids(atLimit), "free").ok, true);
  const over = halfLimit(602);
  const result = validateConcatSelection(over, ids(over), "free");
  assert.equal(result.status, 400);
  assert.match(result.message, /excede o limite de 10 min/);
  const premium = halfLimit(3600);
  assert.equal(validateConcatSelection(premium, ids(premium), "premium").ok, true);
});

test("RN4 / E5: total size up to 500 MB (Registado) and 2 GB (Premium)", () => {
  const pair = (size) => [video("a.mp4", { sizeBytes: size / 2 }), video("b.mp4", { sizeBytes: size / 2 })];
  const atLimit = pair(500 * MB);
  assert.equal(validateConcatSelection(atLimit, ids(atLimit), "free").ok, true);
  const over = pair(502 * MB);
  const result = validateConcatSelection(over, ids(over), "free");
  assert.equal(result.status, 413);
  assert.match(result.message, /excede o limite de 500 MB/);
  assert.equal(validateConcatSelection(over, ids(over), "premium").ok, true);
});

test("RN2: a video of another project is refused and identified", () => {
  const a = video("a.mp4");
  const result = validateConcatSelection([a], [a._id, "another-project-video"], "premium");
  assert.equal(result.status, 404);
  assert.equal(result.problems[0].rule, "RN2");
});

test("RN17 / E2: unsupported formats or codecs are refused, naming the video", () => {
  const good = video("ok.mp4");
  for (const bad of [video("wrong.mp4", { videoCodec: "hevc" }), video("wrong.webm", { videoCodec: "vp9" }), video("clip.mov")]) {
    const result = validateConcatSelection([good, bad], [good._id, bad._id], "premium");
    assert.equal(result.status, 415);
    assert.equal(result.problems[0].rule, "E2");
    assert.match(result.message, new RegExp(bad.og_uri.split("/").pop().replace(".", "\\.")));
  }
});

test("E3: a video without readable metadata is refused; E6: impossible resolution or frame rate", () => {
  const good = video("ok.mp4");
  const unreadable = video("broken.mp4", { duration: undefined });
  assert.equal(validateConcatSelection([good, unreadable], [good._id, unreadable._id], "premium").problems[0].rule, "E3");
  for (const metadata of [{ frameRate: "0/0", avgFrameRate: "0/0" }, { width: 0 }, { frameRate: "1000/1", avgFrameRate: "1000/1" }]) {
    const odd = video("odd.mp4", metadata);
    const result = validateConcatSelection([good, odd], [good._id, odd._id], "premium");
    assert.equal(result.status, 422);
    assert.equal(result.problems[0].rule, "E6");
  }
});

test("mixed MP4/WebM and clips without audio are accepted (RN11, RN17)", () => {
  const mp4 = video("a.mp4");
  const webm = video("b.webm");
  const silent = video("c.mp4", { audioCodec: null });
  const result = validateConcatSelection([mp4, webm, silent], ids([mp4, webm, silent]), "free");
  assert.equal(result.ok, true);
  assert.deepEqual(result.clips.map((clip) => clip.name), ["a.mp4", "b.webm", "c.mp4"], "RN10: keeps the given order");
});

test("RN6: the reference is the clip with the fewest pixels, dimensions rounded to even numbers", () => {
  const plan = planNormalization([
    { name: "big.mp4", width: 1920, height: 1080, fps: 30, frameRate: "30/1", format: "mp4", videoCodec: "h264", hasAudio: true },
    { name: "small.mp4", width: 641, height: 361, fps: 30, frameRate: "30/1", format: "mp4", videoCodec: "h264", hasAudio: true },
  ]);
  assert.equal(plan.width, 640);
  assert.equal(plan.height, 360);
  assert.match(plan.notes[0], /640×360/);
});

test("a rotated phone video counts with its displayed orientation", () => {
  const portrait = video("phone.mp4", { width: 1920, height: 1080, rotation: 90 });
  const landscape = video("cam.mp4", { width: 3840, height: 2160 });
  const result = validateConcatSelection([portrait, landscape], ids([portrait, landscape]), "premium");
  assert.equal(result.clips[0].width, 1080);
  assert.equal(result.clips[0].height, 1920);
  assert.deepEqual([planNormalization(result.clips).width, planNormalization(result.clips).height], [1080, 1920]);
});

test("RN8 / FA5: the lowest frame rate of the selection is used and the user is told", () => {
  const plan = planNormalization([
    { name: "a.mp4", width: 640, height: 360, fps: 29.97, frameRate: "30000/1001", format: "mp4", videoCodec: "h264", hasAudio: true },
    { name: "b.mp4", width: 640, height: 360, fps: 24, frameRate: "24/1", format: "mp4", videoCodec: "h264", hasAudio: true },
  ]);
  assert.equal(plan.frameRate, "24/1");
  assert.ok(plan.notes.some((note) => /24 fps/.test(note)));
});

test("FA6 / FA7: different formats and silent clips are reported in the plan", () => {
  const plan = planNormalization([
    { name: "a.mp4", width: 640, height: 360, fps: 30, frameRate: "30/1", format: "mp4", videoCodec: "h264", hasAudio: true },
    { name: "b.webm", width: 640, height: 360, fps: 30, frameRate: "30/1", format: "webm", videoCodec: "vp8", hasAudio: false },
  ]);
  assert.ok(plan.notes.some((note) => /formato intermédio comum/.test(note)));
  assert.ok(plan.notes.some((note) => /b\.webm.*silêncio/.test(note)));
});

test("normalization fits, pads, converts the frame rate and adds silence when needed", () => {
  const plan = { width: 640, height: 360, frameRate: "24/1" };
  const silent = normalizeClipArgs("in.webm", "out.mp4", { hasAudio: false }, plan).join(" ");
  assert.match(silent, /scale=640:360:force_original_aspect_ratio=decrease/);
  assert.match(silent, /pad=640:360/);
  assert.match(silent, /fps=24\/1/);
  assert.match(silent, /anullsrc/);
  assert.match(silent, /-map 1:a:0/);
  assert.match(normalizeClipArgs("in.mp4", "out.mp4", { hasAudio: true }, plan).join(" "), /-map 0:a:0/);
});

test("RN20: subtitles of each clip are shifted by the clips before it and kept inside their clip", () => {
  const result = shiftSubtitles([
    { duration: 10, subtitles: [{ start: 1, end: 3, text: "a" }, { start: 9, end: 12, text: "corta no fim" }] },
    { duration: 5, subtitles: [] },
    { duration: 8, subtitles: [{ start: 0, end: 2, text: "c" }, { start: 7.8, end: 9, text: "curta demais" }] },
  ]);
  assert.deepEqual(result, [
    { start: 1, end: 3, text: "a" },
    { start: 9, end: 10, text: "corta no fim" },
    { start: 15, end: 17, text: "c" },
  ]);
});

test("RN21: maximum processing time per profile", () => {
  assert.equal(CONCAT_LIMITS.free.maxProcessingMs, 600_000);
  assert.equal(CONCAT_LIMITS.premium.maxProcessingMs, 3_600_000);
});