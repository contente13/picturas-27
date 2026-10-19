// UC-VID-001 RN5: download of a video with its saved subtitles inside the file, as a subtitle
// track marked as default (players show it straight away and can turn it off). Streams are
// copied without re-encoding, so it takes seconds, needs no task or quota and the project video
// is not changed. Burning the subtitles into the image is the "Incorporar no vídeo" task instead.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { get_image_internal_url } = require("../utils/imageStorage");
const { toSrt } = require("../utils/subtitles");

const execFileAsync = promisify(execFile);
const MUX_TIMEOUT_MS = 5 * 60_000;
// Subtitle codec each container accepts.
const SUBTITLE_CODECS = { ".mp4": "mov_text", ".webm": "webvtt" };

function downloadNameFor(videoName) {
  const extension = path.extname(videoName);
  return `${path.basename(videoName, extension)}_com_legendas${extension}`;
}

// Writes the video with a subtitle track to a temporary file. The caller sends it and then calls
// cleanup(), which removes the temporary directory.
async function muxSubtitles({ userId, projectId, video, segments }) {
  const name = path.basename(video.og_uri);
  const extension = path.extname(name).toLowerCase();
  const subtitleCodec = SUBTITLE_CODECS[extension];
  if (!subtitleCodec) throw Object.assign(new Error("Formato de vídeo não suportado."), { status: 415 });

  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picturas-download-"));
  const cleanup = () => fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  try {
    const subtitlesPath = path.join(workDir, "legendas.srt");
    const outputPath = path.join(workDir, `output${extension}`);
    await fs.promises.writeFile(subtitlesPath, toSrt(segments), "utf8");
    // ffmpeg reads the video straight from storage through its internal URL.
    const { data } = await get_image_internal_url(userId, projectId, "src", video.og_img_key, { timeout: 30_000 });
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", data.url, "-i", subtitlesPath,
      "-map", "0:v", "-map", "0:a?", "-map", "1:0",
      "-c", "copy", "-c:s", subtitleCodec,
      "-metadata:s:s:0", "title=Legendas", "-disposition:s:0", "default",
      ...(extension === ".mp4" ? ["-movflags", "+faststart"] : []),
      outputPath,
    ], { timeout: MUX_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    return { outputPath, fileName: downloadNameFor(name), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

module.exports = { downloadNameFor, muxSubtitles };
