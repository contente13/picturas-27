import { api } from "@/lib/axios";

// UC-VID-001 RN5: subtitles are exported as SRT or WebVTT, generated in the browser (no task, no quota).
export type SubtitleFormat = "srt" | "vtt";
export type SubtitleCue = { start: number; end: number; text: string };

function formatStamp(seconds: number, separator: "," | ".") {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}

export function serializeSubtitles(segments: SubtitleCue[], format: SubtitleFormat) {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const cues = ordered.map((segment, index) => {
    const timing = `${formatStamp(segment.start, format === "srt" ? "," : ".")} --> ${formatStamp(segment.end, format === "srt" ? "," : ".")}`;
    return format === "srt" ? `${index + 1}\n${timing}\n${segment.text.trim()}` : `${timing}\n${segment.text.trim()}`;
  });
  return format === "srt" ? cues.join("\n\n") : `WEBVTT\n\n${cues.join("\n\n")}`;
}

// Saves the subtitles as "<video name without extension>.<srt|vtt>".
export function downloadSubtitles(segments: SubtitleCue[], format: SubtitleFormat, videoName: string) {
  const blob = new Blob([serializeSubtitles(segments, format)], {
    type: format === "srt" ? "application/x-subrip;charset=utf-8" : "text/vtt;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${videoName.replace(/\.[^.]+$/, "") || "video"}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function fetchSavedSubtitles(
  { ownerId, projectId, imageId, token, shareId }: { ownerId: string; projectId: string; imageId: string; token: string; shareId?: string | null },
) {
  const { data } = await api.get<{ segments: SubtitleCue[] }>(`/projects/${ownerId}/${projectId}/video/${imageId}/subtitles`, {
    headers: { Authorization: `Bearer ${token}` },
    params: shareId ? { share: shareId } : undefined,
  });
  return data.segments || [];
}

// UC-VID-001 RN5: the video with its saved subtitles as a track inside the file, prepared by the
// server in seconds (no re-encoding) and saved with the name the server gives it.
export async function downloadVideoWithSubtitles(
  { ownerId, projectId, imageId, token, shareId }: { ownerId: string; projectId: string; imageId: string; token: string; shareId?: string | null },
  fallbackName: string,
) {
  const response = await api.get<Blob>(`/projects/${ownerId}/${projectId}/video/${imageId}/with-subtitles`, {
    headers: { Authorization: `Bearer ${token}` },
    params: shareId ? { share: shareId } : undefined,
    responseType: "blob",
  });
  const disposition = String(response.headers["content-disposition"] || "");
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : plain || fallbackName;
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Error text of a failed blob request (the server answers JSON, which axios returns as a Blob).
export async function blobErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    const text = await data.text();
    try { return JSON.parse(text) as string; } catch { return text || fallback; }
  }
  return typeof data === "string" ? data : fallback;
}
