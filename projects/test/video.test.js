// UC-VID-000 E4/E5: an invalid upload is a client error (422/415), not a server error (500).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { inspectVideo, validateVideoCodecs } = require("../utils/video");

test("a codec that does not match the extension is rejected with 415 (E5)", () => {
  const cases = [
    ["clip.mp4", { videoCodec: "vp8", audioCodec: null }],
    ["clip.mp4", { videoCodec: "h264", audioCodec: "mp3" }],
    ["clip.webm", { videoCodec: "h264", audioCodec: null }],
    ["clip.mov", { videoCodec: "h264", audioCodec: "aac" }],
  ];
  for (const [name, metadata] of cases) {
    assert.throws(() => validateVideoCodecs(name, metadata), (error) => error.status === 415, `${name} ${metadata.videoCodec}`);
  }
});

test("accepted combinations pass, with or without audio", () => {
  assert.doesNotThrow(() => validateVideoCodecs("a.mp4", { videoCodec: "h264", audioCodec: "aac" }));
  assert.doesNotThrow(() => validateVideoCodecs("a.mp4", { videoCodec: "h264", audioCodec: null }));
  assert.doesNotThrow(() => validateVideoCodecs("a.webm", { videoCodec: "vp8", audioCodec: "vorbis" }));
});

function hasFfmpeg() {
  try { execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

test("an unreadable file or one without a video track is rejected with 422 (E4)", { skip: !hasFfmpeg() && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "video-test-"));
  try {
    const garbage = path.join(dir, "broken.mp4");
    fs.writeFileSync(garbage, "isto não é um vídeo");
    await assert.rejects(inspectVideo(garbage), (error) => error.status === 422);

    const audioOnly = path.join(dir, "audio.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", audioOnly]);
    await assert.rejects(inspectVideo(audioOnly), (error) => error.status === 422);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
