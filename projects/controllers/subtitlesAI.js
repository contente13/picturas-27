const axios = require("axios");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { pipeline } = require("stream/promises");
const FormData = require("form-data");
const { get_image_internal_url } = require("../utils/imageStorage");

const execFileAsync = promisify(execFile);
const MAX_TRANSCRIPTION_AUDIO_BYTES = 24_000_000;

function wrapCaption(text) {
  const words = text.trim().split(/\s+/).flatMap((word) => {
    if (word.length <= 42) return [word];
    const parts = [];
    for (let i = 0; i < word.length; i += 42) parts.push(word.slice(i, i + 42));
    return parts;
  });
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > 42 && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  const captions = [];
  for (let i = 0; i < lines.length; i += 2) captions.push(lines.slice(i, i + 2).join("\n"));
  return captions;
}

function splitWords(text, count) {
  const words = text.trim().split(/\s+/);
  if (count <= 1 || words.length < count) return null;
  const chunks = [];
  let index = 0;
  while (chunks.length < count) {
    const chunksLeft = count - chunks.length;
    const targetChars = Math.ceil(words.slice(index).join(" ").length / chunksLeft);
    const current = [];
    let currentChars = 0;
    while (index < words.length && words.length - index > chunksLeft - 1) {
      const word = words[index];
      const nextLength = currentChars + (current.length ? 1 : 0) + word.length;
      if (current.length && currentChars >= targetChars) break;
      current.push(word);
      currentChars = nextLength;
      index += 1;
    }
    if (!current.length) return null;
    chunks.push(current.join(" "));
  }
  return index === words.length ? chunks : null;
}

function normalizeTranscriptSegments(rawSegments, duration) {
  if (!Array.isArray(rawSegments)) return [];
  const normalized = [];
  let previousEnd = 0;
  for (const raw of rawSegments) {
    const text = typeof raw?.text === "string" ? raw.text.trim().replace(/\s+/g, " ") : "";
    let start = Number(raw?.start);
    let end = Number(raw?.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = Math.max(previousEnd, 0, start);
    end = Math.min(duration, end);
    if (end <= start) continue;
    if (end - start < 0.5) end = Math.min(duration, start + 0.5);
    if (end - start < 0.5) continue;
    const captions = wrapCaption(text);
    if (!captions.length) continue;
    const span = end - start;
    const maxPieces = Math.max(1, Math.floor(span / 0.5));
    const wantedPieces = Math.min(maxPieces, Math.max(captions.length, Math.ceil(span / 10)));
    let pieces = captions;
    if (wantedPieces > captions.length) {
      pieces = splitWords(text, wantedPieces) || Array.from({ length: wantedPieces }, () => text);
      pieces = pieces.map((piece) => wrapCaption(piece)[0] || piece);
    } else if (captions.length > maxPieces) pieces = captions.slice(0, maxPieces);
    let cursor = start;
    pieces.forEach((caption, index) => {
      const pieceStart = cursor;
      const pieceEnd = index === pieces.length - 1 ? end : start + span * (index + 1) / pieces.length;
      if (pieceEnd - pieceStart >= 0.5 && pieceEnd - pieceStart <= 10) {
        normalized.push({ start: Number(pieceStart.toFixed(3)), end: Number(pieceEnd.toFixed(3)), text: caption });
      }
      cursor = pieceEnd;
    });
    previousEnd = end;
  }
  return normalized.slice(0, 2000);
}

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
