const axios = require("axios");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { pipeline } = require("stream/promises");
const FormData = require("form-data");
const { get_image_internal_url } = require("../utils/imageStorage");
const { normalizeTranscriptSegments } = require("../utils/subtitleCaptions");

const execFileAsync = promisify(execFile);
const MAX_TRANSCRIPTION_AUDIO_BYTES = 24_000_000;

async function generateSubtitleSegments({ userId, projectId, source, duration, deadlineAt, signal }) {
  const serviceUrl = process.env.SUBTITLE_AI_URL || "http://subtitles-ai:9100";
  const remainingMs = () => {
    if (signal?.aborted) throw new Error("A tarefa de geração foi cancelada ou excedeu o tempo máximo.");
    const remaining = deadlineAt ? deadlineAt - Date.now() : 900_000;
    if (remaining <= 0) throw new Error("O processamento excedeu o limite de 900 segundos do plano Premium.");
    return remaining;
  };
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picturas-transcription-"));
  const videoPath = path.join(tempDir, `source${path.extname(source.og_uri) || ".mp4"}`);
  const audioPath = path.join(tempDir, "audio.mp3");
  try {
    const internal = await get_image_internal_url(userId, projectId, "src", source.og_img_key, {
      timeout: Math.min(30_000, remainingMs()), signal,
    });
    const video = await axios.get(internal.data.url, {
      responseType: "stream", timeout: Math.min(120_000, remainingMs()), signal,
    });
    await pipeline(video.data, fs.createWriteStream(videoPath), { signal });
    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", audioPath,
      ], { timeout: Math.min(120_000, remainingMs()), maxBuffer: 2 * 1024 * 1024, signal });
    } catch {
      const error = new Error("Não foi possível extrair áudio deste vídeo. Confirma que contém uma faixa de áudio válida.");
      error.status = 422;
      throw error;
    }
    const audioStats = await fs.promises.stat(audioPath);
    if (audioStats.size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
      const error = new Error("O áudio extraído é demasiado grande para gerar legendas automaticamente.");
      error.status = 413;
      throw error;
    }
    const form = new FormData();
    form.append("file", fs.createReadStream(audioPath), { filename: "audio.mp3", contentType: "audio/mpeg", knownLength: audioStats.size });
    // Lets the service pick a faster model for long audio so it stays within the 900 s limit.
    form.append("duration", String(duration));
    let response;
    try {
      response = await axios.post(`${serviceUrl}/transcribe`, form, {
        headers: form.getHeaders(), timeout: remainingMs(), signal, maxBodyLength: MAX_TRANSCRIPTION_AUDIO_BYTES,
        maxContentLength: 5 * 1024 * 1024,
      });
    } catch (requestError) {
      const status = requestError.response?.status;
      const message = requestError.response?.data?.error;
      const error = new Error(typeof message === "string" ? message : "O serviço local de transcrição não conseguiu processar este vídeo.");
      error.status = status === 413 ? 413 : status === 422 ? 422 : 502;
      throw error;
    }
    const segments = normalizeTranscriptSegments(response.data?.segments, duration);
    if (!segments.length) {
      const error = new Error("Não foi detetada fala suficiente para criar legendas.");
      error.status = 422;
      throw error;
    }
    return segments;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { generateSubtitleSegments };
