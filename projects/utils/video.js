const crypto = require("crypto");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function isSupportedVideoName(name) {
  return /\.(mp4|webm)$/i.test(name || "");
}

// Errors caused by the uploaded file carry the HTTP status to answer with (UC-VID-000 E4/E5).
function invalidVideo(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Rotation in degrees from the stream tag (older files) or the display matrix side data.
function rotationOf(stream) {
  const fromSideData = stream.side_data_list?.find((data) => data.rotation !== undefined)?.rotation;
  const rotation = Number(fromSideData ?? stream.tags?.rotate ?? 0);
  return Number.isFinite(rotation) ? ((rotation % 360) + 360) % 360 : 0;
}

async function inspectVideo(filePath, timeoutMs = 0) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate:stream_tags=rotate:stream_side_data=rotation",
        "-of", "json",
        filePath,
      ],
      { maxBuffer: 1024 * 1024, ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}) },
    ));
  } catch (error) {
    // A killed ffprobe is a timeout, which callers report themselves; anything else is an unreadable file.
    if (error.killed) throw error;
    throw invalidVideo("Não foi possível ler um vídeo válido neste ficheiro.", 422);
  }
  const metadata = JSON.parse(stdout);
  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  const audio = metadata.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(metadata.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) {
    throw invalidVideo("O ficheiro não contém uma pista de vídeo válida.", 422);
  }

  return {
    duration,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    width: video.width,
    height: video.height,
    frameRate: video.r_frame_rate,
    avgFrameRate: video.avg_frame_rate,
    rotation: rotationOf(video),
  };
}

function validateVideoCodecs(name, metadata) {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "mp4") {
    if (metadata.videoCodec !== "h264" || (metadata.audioCodec && metadata.audioCodec !== "aac")) {
      throw invalidVideo("O MP4 tem de usar vídeo H.264 e áudio AAC (ou não ter áudio).", 415);
    }
    return;
  }
  if (extension === "webm") {
    if (metadata.videoCodec !== "vp8" || (metadata.audioCodec && metadata.audioCodec !== "vorbis")) {
      throw invalidVideo("O WebM tem de usar vídeo VP8 e áudio Vorbis (ou não ter áudio).", 415);
    }
    return;
  }
  throw invalidVideo("Formato de vídeo não suportado. Usa MP4 ou WebM.", 415);
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