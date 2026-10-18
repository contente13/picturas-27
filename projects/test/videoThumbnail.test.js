// Grid thumbnails for videos: frame choice and extraction with ffmpeg (available in the image).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { extractThumbnail, thumbnailTime } = require("../utils/videoThumbnail");

test("the thumbnail frame is taken at 10% of the video, at most 1 s in", () => {
  assert.equal(thumbnailTime(59.2), 1);
  assert.equal(thumbnailTime(4), 0.4);
  assert.equal(thumbnailTime(0), 0);
  assert.equal(thumbnailTime(undefined), 0);
});

function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

test("a JPEG of at most 480 px wide is extracted, also from a very short clip", { skip: !hasFfmpeg() && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-test-"));
  try {
    for (const [name, duration, size] of [["long.mp4", 3, "1280x720"], ["short.mp4", 0.2, "320x240"]]) {
      const video = path.join(dir, name);
      const thumb = path.join(dir, `${name}.jpg`);
      execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=25:duration=${duration}`, "-pix_fmt", "yuv420p", video]);
      await extractThumbnail(video, thumb, duration);
      const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width", "-of", "csv=p=0", thumb]).toString().trim();
      const [codec, width] = probe.split(",");
      assert.equal(codec, "mjpeg");
      assert.equal(Number(width), Math.min(480, Number(size.split("x")[0])));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
