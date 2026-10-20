// Pure rules for the temporal trim use case (UC-VID-002). Kept separate from
// Express and the worker so interval boundaries can be tested without services.
function validateTrimInterval(start, end, duration) {
  const hasTenthPrecision = (value) => Math.abs(value * 10 - Math.round(value * 10)) < 0.001;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0) {
    return "Os tempos de início e fim têm de ser números válidos.";
  }
  if (!hasTenthPrecision(start) || !hasTenthPrecision(end)) {
    return "Os tempos têm de ser múltiplos de 0,1 segundo.";
  }
  if (start < 0 || end > duration || start >= end) {
    return "O intervalo tem de estar dentro da duração do vídeo e T_in tem de ser inferior a T_out.";
  }
  if (end - start < 1) return "A duração mínima do recorte é de 1 segundo.";
  if (end - start >= duration) return "O recorte tem de ser mais curto do que o vídeo original.";
  return null;
}

function validateTrimProfileDuration(start, end, userType) {
  const limit = userType === "premium" ? 600 : userType === "free" ? 60 : null;
  if (limit !== null && end - start > limit) {
    return `O recorte excede o limite de ${limit} segundos do teu perfil.`;
  }
  return null;
}

function trimSubtitleSegments(segments, start, end) {
  return (segments || []).flatMap((segment) => {
    const segmentStart = Math.max(Number(segment.start), start);
    const segmentEnd = Math.min(Number(segment.end), end);
    if (segmentEnd - segmentStart < 0.5) return [];
    return [{
      start: segmentStart - start,
      end: segmentEnd - start,
      text: segment.text,
    }];
  });
}

module.exports = { validateTrimInterval, validateTrimProfileDuration, trimSubtitleSegments };
