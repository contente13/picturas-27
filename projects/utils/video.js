const crypto = require("crypto");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function isSupportedVideoName(name) {
  return /\.(mp4|webm)$/i.test(name || "");
}

async function inspectVideo(filePath, timeoutMs = 0) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
      "-of", "json",
      filePath,
    ],
    { maxBuffer: 1024 * 1024, ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}) },
  );
  const metadata = JSON.parse(stdout);
  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  const audio = metadata.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(metadata.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("O ficheiro não contém uma pista de vídeo válida.");
  }

  return {
    duration,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    width: video.width,
    height: video.height,
    frameRate: video.r_frame_rate,
  };
}

function validateVideoCodecs(name, metadata) {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "mp4") {
    if (metadata.videoCodec !== "h264" || (metadata.audioCodec && metadata.audioCodec !== "aac")) {
      throw new Error("O MP4 tem de usar vídeo H.264 e áudio AAC (ou não ter áudio).");
    }
    return;
  }
  if (extension === "webm") {
    if (metadata.videoCodec !== "vp8" || (metadata.audioCodec && metadata.audioCodec !== "vorbis")) {
      throw new Error("O WebM tem de usar vídeo VP8 e áudio Vorbis (ou não ter áudio).");
    }
    return;
  }
  throw new Error("Formato de vídeo não suportado. Usa MP4 ou WebM.");
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

module.exports = { hashFile, inspectVideo, isSupportedVideoName, validateVideoCodecs };
