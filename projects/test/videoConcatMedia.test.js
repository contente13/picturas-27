// UC-VID-003 with real ffmpeg: three very different clips (MP4 and WebM, three resolutions and
// frame rates, one without audio and rotated) are normalized and joined with the same arguments
// the worker uses, and the result is checked frame by frame.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { inspectVideo } = require("../utils/video");
const {
  concatArgs,
  concatListContent,
  describeClip,
  normalizeClipArgs,
  planNormalization,
} = require("../utils/videoConcat");

function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args.filter((arg) => arg !== "-progress" && arg !== "pipe:1" && arg !== "-nostats")]);
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// Average RGB of a small area around (x, y) of the frame at `seconds`.
function colorAt(file, seconds, x = "iw/2", y = "ih/2") {
  const rgb = execFileSync("ffmpeg", [
    "-loglevel", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1",
    "-vf", `crop=8:8:${x}-4:${y}-4,scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return [...rgb];
}

// Mean volume (dB) of the audio between `start` and `start + duration`.
function volumeDb(file, start, duration) {
  const result = spawnSync("ffmpeg", ["-ss", String(start), "-t", String(duration), "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const match = result.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
  return !match || match[1] === "-inf" ? -Infinity : Number(match[1]);
}

test("UC-VID-003: mixed clips are normalized and joined in order", { skip: !hasFfmpeg() && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
  try {
    const sources = [
      { name: "a_vermelho.mp4", args: ["-f", "lavfi", "-i", "color=c=red:s=1280x720:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"] },
      { name: "b_verde.webm", args: ["-f", "lavfi", "-i", "color=c=green:s=640x480:r=25:d=2", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-c:v", "libvpx", "-c:a", "libvorbis", "-shortest"] },
      { name: "c_azul.mp4", args: ["-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p"] },
    ];
    for (const source of sources) ffmpeg(["-y", ...source.args, path.join(dir, source.name)]);
    // c_azul is stored as 320×240 with a 90° display rotation, like a phone video (shown 240×320).
    ffmpeg(["-y", "-display_rotation", "90", "-i", path.join(dir, "c_azul.mp4"), "-c", "copy", path.join(dir, "c_rodado.mp4")]);
    sources[2].name = "c_rodado.mp4";
    const originalHashes = sources.map((source) => sha(path.join(dir, source.name)));

    const clips = [];
    for (const source of sources) {
      const file = path.join(dir, source.name);
      const described = describeClip(source.name, await inspectVideo(file));
      assert.ok(described.clip, `${source.name}: ${described.problem}`);
      clips.push({ ...described.clip, inputPath: file });
    }
    assert.deepEqual([clips[2].width, clips[2].height], [240, 320], "rotation is taken into account");

    const plan = planNormalization(clips);
    assert.deepEqual([plan.width, plan.height, plan.frameRate], [240, 320, "24/1"], "RN6 + RN8");

    const parts = clips.map((clip, index) => {
      const output = path.join(dir, `part_${index}.mp4`);
      ffmpeg(normalizeClipArgs(clip.inputPath, output, clip, plan));
      return output;
    });
    const listPath = path.join(dir, "list.txt");
    fs.writeFileSync(listPath, concatListContent(parts));
    const result = path.join(dir, "output.mp4");
    ffmpeg(concatArgs(listPath, result));

    const metadata = await inspectVideo(result);
    assert.equal(metadata.videoCodec, "h264", "RN17: H.264 output");
    assert.equal(metadata.audioCodec, "aac", "RN17: AAC output, also for the silent clip");
    assert.deepEqual([metadata.width, metadata.height], [240, 320]);
    assert.equal(metadata.avgFrameRate, "24/1");
    assert.ok(Math.abs(metadata.duration - 6) < 0.1, `duration ${metadata.duration} ≈ 6 s: every part ends with its video`);

    // RN10: red, then green, then blue.
    const [red, green, blue] = [colorAt(result, 1), colorAt(result, 3), colorAt(result, 5)];
    assert.ok(red[0] > 180 && red[1] < 60 && red[2] < 60, `1 s should be red, got ${red}`);
    assert.ok(green[1] > 90 && green[0] < 60 && green[2] < 60, `3 s should be green, got ${green}`);
    assert.ok(blue[2] > 180 && blue[0] < 60 && blue[1] < 60, `5 s should be blue, got ${blue}`);
    // RN7: the 16:9 red clip keeps its proportion inside 240×320, with black bars above and below.
    const bar = colorAt(result, 1, "iw/2", "20");
    assert.ok(bar.every((channel) => channel < 30), `top bar should be black, got ${bar}`);

    // RN11: the clip without audio is silent; the others are not.
    assert.ok(volumeDb(result, 0.2, 1.5) > -40, "first clip keeps its audio");
    assert.ok(volumeDb(result, 4.2, 1.5) < -80, "clip without audio becomes silence");

    // RN9: the source files are untouched.
    assert.deepEqual(sources.map((source) => sha(path.join(dir, source.name))), originalHashes);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});