// UC-VID-001 RN3: validation shared by the subtitles routes and the tests.
function validateSubtitleSegments(segments, duration) {
  if (!Array.isArray(segments) || segments.length > 2000) return "A lista de legendas é inválida ou demasiado longa.";
  const ordered = [...segments].sort((a, b) => Number(a.start) - Number(b.start));
  let previousEnd = -1;
  for (const segment of ordered) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    const lines = text.split(/\r?\n/);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || start >= end) {
      return "Cada legenda precisa de texto e de tempos válidos dentro da duração do vídeo.";
    }
    if (end - start < 0.5 || end - start > 10 || lines.length > 2 || lines.some((line) => line.length > 42)) {
      return "Cada legenda deve durar entre 0,5 e 10 segundos e ter no máximo duas linhas de 42 caracteres.";
    }
    if (start < previousEnd) return "Os intervalos das legendas não podem sobrepor-se.";
    previousEnd = end;
  }
  return null;
}

function srtTimestamp(seconds) {
  const ms = Math.round(Number(seconds) * 1000);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

// SRT text of the segments, in time order (used to burn them in and to add them as a track).
function toSrt(segments) {
  return [...segments]
    .sort((a, b) => Number(a.start) - Number(b.start))
    .map((segment, index) => `${index + 1}\n${srtTimestamp(segment.start)} --> ${srtTimestamp(segment.end)}\n${String(segment.text).trim()}\n`)
    .join("\n");
}

module.exports = { toSrt, validateSubtitleSegments };
