// UC-VID-003 — rules of a concatenation that do not depend on storage or on the database:
// profile limits, validation of the selected sequence, the common format every clip is normalized
// to, the ffmpeg arguments that produce it, and the editable subtitles of the result.
const path = require("path");

const MB = 1024 * 1024;
// RN3 (number of videos), RN4 (total duration and size) and RN21 (maximum processing time).
const CONCAT_LIMITS = {
  free: { maxVideos: 10, maxDurationSeconds: 10 * 60, maxSizeBytes: 500 * MB, maxProcessingMs: 10 * 60_000 },
  premium: { maxVideos: 30, maxDurationSeconds: 60 * 60, maxSizeBytes: 2048 * MB, maxProcessingMs: 60 * 60_000 },
};
// RN17: accepted input containers and codecs (audio is optional, RN11).
const ACCEPTED_CODECS = { mp4: { video: "h264", audio: "aac" }, webm: { video: "vp8", audio: "vorbis" } };
const MAX_FRAME_RATE = 240;
const MIN_DIMENSION = 16;
const AUDIO_SAMPLE_RATE = 48000;

function formatOf(name) {
  return path.extname(name || "").slice(1).toLowerCase();
}

// "30000/1001" → 29.97; returns null for missing or nonsense values such as "0/0".
function parseFrameRate(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const [numerator, denominator = "1"] = value.split("/");
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

// The average rate is the real one for most files; the nominal rate is the fallback.
function frameRateOf(metadata) {
  for (const candidate of [metadata.avgFrameRate, metadata.frameRate]) {
    const rate = parseFrameRate(candidate);
    if (rate && rate <= MAX_FRAME_RATE) return { fps: rate, frameRate: String(candidate) };
  }
  return null;
}

// Size as displayed: a phone video stored as 1920×1080 with a 90° rotation is shown as 1080×1920.
function displaySize(metadata) {
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const rotated = Math.abs(Number(metadata.rotation) || 0) % 180 === 90;
  return rotated ? { width: height, height: width } : { width, height };
}

function codecProblem(format, metadata) {
  const accepted = ACCEPTED_CODECS[format];
  if (!accepted) return "formato não suportado (usa MP4 ou WebM)";
  if (metadata.videoCodec !== accepted.video || (metadata.audioCodec && metadata.audioCodec !== accepted.audio)) {
    return format === "mp4"
      ? `codec não suportado (${metadata.videoCodec}/${metadata.audioCodec || "sem áudio"}); um MP4 tem de usar H.264 e AAC`
      : `codec não suportado (${metadata.videoCodec}/${metadata.audioCodec || "sem áudio"}); um WebM tem de usar VP8 e Vorbis`;
  }
  return null;
}

// Describes one clip from its stored or freshly probed metadata, or explains why it cannot be used.
function describeClip(name, metadata) {
  const format = formatOf(name);
  const duration = Number(metadata?.duration);
  if (!metadata || !Number.isFinite(duration) || duration <= 0) {
    return { problem: "não foi possível ler o vídeo nem os seus metadados", status: 422, rule: "E3" };
  }
  const codecError = codecProblem(format, metadata);
  if (codecError) return { problem: codecError, status: 415, rule: "E2" };
  const { width, height } = displaySize(metadata);
  const rate = frameRateOf(metadata);
  if (!(width >= MIN_DIMENSION && height >= MIN_DIMENSION) || !rate) {
    return { problem: "resolução ou taxa de fotogramas inválida, impossível de normalizar", status: 422, rule: "E6" };
  }
  return {
    clip: {
      name,
      format,
      duration,
      width,
      height,
      fps: rate.fps,
      frameRate: rate.frameRate,
      videoCodec: metadata.videoCodec,
      audioCodec: metadata.audioCodec || null,
      hasAudio: Boolean(metadata.audioCodec),
      sizeBytes: Number(metadata.sizeBytes) || 0,
    },
  };
}

function rejection(status, message, problems = []) {
  return { ok: false, status, message, problems };
}

// Passo 4 / REQ-VID-CONCAT-006: validates the ordered selection of project items.
function validateConcatSelection(projectImages, imageIds, userType) {
  const limits = CONCAT_LIMITS[userType];
  if (!limits) return rejection(403, "A junção de vídeos está disponível para contas Registadas e Premium.");
  if (!Array.isArray(imageIds) || imageIds.length < 2) {
    return rejection(400, "Seleciona pelo menos dois vídeos para os juntar.");
  }
  const ids = imageIds.map(String);
  if (new Set(ids).size !== ids.length) return rejection(400, "Cada vídeo só pode aparecer uma vez na sequência.");
  if (ids.length > limits.maxVideos) {
    return rejection(400, `A junção aceita no máximo ${limits.maxVideos} vídeos no teu perfil.`);
  }

  const clips = [];
  const problems = [];
  for (const imageId of ids) {
    const image = projectImages.find((item) => String(item._id) === imageId);
    if (!image) {
      problems.push({ imageId, name: null, reason: "não pertence a este projeto ou foi removido", status: 404, rule: "RN2" });
      continue;
    }
    const name = path.basename(image.og_uri);
    const described = describeClip(name, image.mediaMetadata);
    if (described.problem) {
      problems.push({ imageId, name, reason: described.problem, status: described.status, rule: described.rule });
      continue;
    }
    clips.push({
      ...described.clip,
      imageId,
      sourceKey: image.og_img_key,
      subtitles: (image.subtitles || []).map(({ start, end, text }) => ({ start: Number(start), end: Number(end), text })),
    });
  }
  if (problems.length) {
    const list = problems.map((problem) => `«${problem.name || problem.imageId}»: ${problem.reason}`).join("; ");
    return rejection(problems[0].status, `Não é possível juntar estes vídeos. ${list}.`, problems);
  }

  const totals = {
    count: clips.length,
    durationSeconds: clips.reduce((sum, clip) => sum + clip.duration, 0),
    sizeBytes: clips.reduce((sum, clip) => sum + clip.sizeBytes, 0),
  };
  if (totals.durationSeconds > limits.maxDurationSeconds) {
    return rejection(400, `A duração total (${formatMinutes(totals.durationSeconds)}) excede o limite de ${formatMinutes(limits.maxDurationSeconds)} do teu perfil. Remove ou recorta alguns vídeos.`);
  }
  if (totals.sizeBytes > limits.maxSizeBytes) {
    return rejection(413, `O tamanho total (${formatSize(totals.sizeBytes)}) excede o limite de ${formatSize(limits.maxSizeBytes)} do teu perfil.`);
  }
  return { ok: true, clips, totals, limits };
}

function formatMinutes(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}

function formatSize(bytes) {
  return bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;
}

function even(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

// Passo 5 / RN5–RN8 / RN17: the common format every clip is converted to before joining.
// Reference resolution = clip with the fewest pixels (no clip is ever upscaled, since any clip
// with more pixels is larger in at least one dimension); frame rate = lowest of the selection.
function planNormalization(clips) {
  const reference = clips.reduce((smallest, clip) =>
    clip.width * clip.height < smallest.width * smallest.height ? clip : smallest);
  const slowest = clips.reduce((lowest, clip) => (clip.fps < lowest.fps ? clip : lowest));
  const width = even(reference.width);
  const height = even(reference.height);
  const notes = [];
  if (clips.some((clip) => clip.width !== reference.width || clip.height !== reference.height)) {
    notes.push(`Os vídeos têm resoluções diferentes: todos serão ajustados a ${width}×${height} (a menor da seleção), sem ampliar nenhum e com barras pretas quando a proporção for diferente.`);
  }
  if (clips.some((clip) => Math.abs(clip.fps - slowest.fps) > 0.01)) {
    notes.push(`Os vídeos têm taxas de fotogramas diferentes: todos serão convertidos para ${Number(slowest.fps.toFixed(3))} fps (a menor da seleção).`);
  }
  if (new Set(clips.map((clip) => `${clip.format}/${clip.videoCodec}`)).size > 1) {
    notes.push("Os vídeos têm formatos diferentes (MP4 e WebM): serão convertidos para um formato intermédio comum antes de os juntar.");
  }
  const silent = clips.filter((clip) => !clip.hasAudio).map((clip) => clip.name);
  if (silent.length) notes.push(`Sem áudio: ${silent.join(", ")}. Esses segmentos ficam em silêncio no resultado.`);
  notes.push("O resultado será um novo vídeo MP4 (H.264/AAC); os vídeos originais não são alterados.");
  return { width, height, fps: slowest.fps, frameRate: slowest.frameRate, notes };
}

// ffmpeg arguments that convert one clip to the common intermediate format: scaled to fit the
// reference size and padded (RN6/RN7), common frame rate (RN8), H.264 + AAC 48 kHz stereo (RN5),
// and a silent track for clips without audio (RN11). "apad" + "-shortest" make the audio as long
// as the video; "-fflags +shortest" with a large interleave delta makes ffmpeg honour it exactly
// (without them a WebM part kept 0.44 s of extra audio), so the container ends with the video and
// the next clip starts at the right time once joined.
function normalizeClipArgs(inputPath, outputPath, clip, plan) {
  const video = [
    `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    `fps=${plan.frameRate}`,
    "format=yuv420p",
  ].join(",");
  const silence = clip.hasAudio ? [] : ["-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`];
  return [
    "-y", "-i", inputPath, ...silence,
    "-map", "0:v:0", "-map", clip.hasAudio ? "0:a:0" : "1:a:0",
    "-vf", video, "-af", `aresample=${AUDIO_SAMPLE_RATE},apad`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "160k", "-ar", String(AUDIO_SAMPLE_RATE), "-ac", "2",
    "-shortest", "-fflags", "+shortest", "-max_interleave_delta", "100M",
    "-video_track_timescale", "90000", "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats", outputPath,
  ];
}

// All intermediates share the same parameters, so they are joined without re-encoding.
function concatListContent(paths) {
  return paths.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

function concatArgs(listPath, outputPath) {
  return [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c", "copy", "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats", outputPath,
  ];
}

// RN20: the editable subtitles of each clip are copied to the result, shifted by the duration of
// the clips before it; segments are kept inside their clip and dropped below 0.5 s (RN3).
function shiftSubtitles(parts) {
  const result = [];
  let offset = 0;
  for (const { subtitles = [], duration } of parts) {
    for (const segment of subtitles) {
      const start = Math.max(0, Number(segment.start));
      const end = Math.min(duration, Number(segment.end));
      if (!(end - start >= 0.5) || !segment.text) continue;
      result.push({
        start: Math.round((offset + start) * 1000) / 1000,
        end: Math.round((offset + end) * 1000) / 1000,
        text: segment.text,
      });
    }
    offset += duration;
  }
  return result;
}

// E9: space needed in the work directory — downloaded clips, intermediates and the result.
function requiredWorkspaceBytes(totalSizeBytes) {
  return totalSizeBytes * 3 + 100 * MB;
}

module.exports = {
  CONCAT_LIMITS,
  concatArgs,
  concatListContent,
  describeClip,
  displaySize,
  frameRateOf,
  normalizeClipArgs,
  parseFrameRate,
  planNormalization,
  requiredWorkspaceBytes,
  shiftSubtitles,
  validateConcatSelection,
};