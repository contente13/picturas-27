import { api } from "@/lib/axios";
import type { ProjectImage } from "@/lib/projects";

// UC-VID-003 — client side of "Juntar vídeos". The server is the authority on every rule; the
// limits below only drive the live totals shown while the user edits the sequence (passo 3).
const MB = 1024 * 1024;
export const CONCAT_LIMITS = {
  free: { maxVideos: 10, maxDurationSeconds: 10 * 60, maxSizeBytes: 500 * MB },
  premium: { maxVideos: 30, maxDurationSeconds: 60 * 60, maxSizeBytes: 2048 * MB },
} as const;

export type ConcatLimits = { maxVideos: number; maxDurationSeconds: number; maxSizeBytes: number };

export type ConcatProblem = { imageId: string; name: string | null; reason: string; rule?: string };

export type ConcatValidation = {
  clips: {
    imageId: string;
    name: string;
    duration: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
  }[];
  totals: { count: number; durationSeconds: number; sizeBytes: number };
  limits: ConcatLimits;
  plan: { width: number; height: number; fps: number; notes: string[] };
};

export type ConcatTask = {
  tarefaId: string;
  estado: "EM_FILA" | "EM_PROCESSAMENTO" | "CONCLUIDA" | "FALHADA" | "CANCELADA";
  progresso?: number;
  erro?: string | null;
  resultUrl?: string | null;
  resultImageId?: string | null;
  recursoSaida?: string | null;
  operation?: string;
  imageIds?: string[];
};

export type ConcatContext = { ownerId: string; projectId: string; token: string; shareId?: string | null };

export class ConcatRequestError extends Error {
  constructor(message: string, readonly problems: ConcatProblem[] = [], readonly status?: number) {
    super(message);
  }
}

function requestConfig({ token, shareId }: ConcatContext, params: Record<string, string> = {}) {
  return {
    headers: { Authorization: `Bearer ${token}` },
    params: { ...(shareId ? { share: shareId } : {}), ...params },
  };
}

function basePath({ ownerId, projectId }: ConcatContext) {
  return `/projects/${ownerId}/${projectId}/video`;
}

// Server errors come as { message, problems } (concat routes) or as a plain string (task routes).
function toRequestError(error: unknown, fallback: string): ConcatRequestError {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  const data = response?.data as { message?: string; problems?: ConcatProblem[] } | string | undefined;
  if (typeof data === "string") return new ConcatRequestError(data, [], response?.status);
  return new ConcatRequestError(data?.message || fallback, data?.problems || [], response?.status);
}

export async function validateConcat(context: ConcatContext, imageIds: string[]) {
  try {
    const { data } = await api.post<ConcatValidation>(`${basePath(context)}/concat/validate`, { imageIds }, requestConfig(context));
    return data;
  } catch (error) {
    throw toRequestError(error, "Não foi possível validar a sequência.");
  }
}

export async function startConcat(context: ConcatContext, imageIds: string[]) {
  try {
    const { data } = await api.post<{ tarefaId: string; estado: ConcatTask["estado"] }>(`${basePath(context)}/concat`, { imageIds }, requestConfig(context));
    return data;
  } catch (error) {
    throw toRequestError(error, "Não foi possível iniciar a junção.");
  }
}

export async function getConcatTask(context: ConcatContext, taskId: string) {
  const { data } = await api.get<ConcatTask>(`${basePath(context)}/tasks/${encodeURIComponent(taskId)}`, requestConfig(context));
  return data;
}

export async function getLatestConcatTask(context: ConcatContext) {
  const { data } = await api.get<{ tarefa: ConcatTask | null }>(`${basePath(context)}/tasks/latest`, requestConfig(context, { operation: "concat" }));
  return data.tarefa;
}

export async function cancelConcatTask(context: ConcatContext, taskId: string) {
  try {
    await api.post(`${basePath(context)}/tasks/${encodeURIComponent(taskId)}/cancel`, {}, requestConfig(context));
  } catch (error) {
    throw toRequestError(error, "Não foi possível cancelar a junção.");
  }
}

export function isVideoItem(image: ProjectImage) {
  return /\.(mp4|webm)$/i.test(image.name || image.url);
}

export function formatDuration(seconds = 0) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

export function formatSize(bytes = 0) {
  return bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(1)} GB` : `${(bytes / MB).toFixed(1)} MB`;
}

export function sequenceTotals(clips: ProjectImage[]) {
  return {
    count: clips.length,
    durationSeconds: clips.reduce((sum, clip) => sum + (Number(clip.mediaMetadata?.duration) || 0), 0),
    sizeBytes: clips.reduce((sum, clip) => sum + (Number(clip.mediaMetadata?.sizeBytes) || 0), 0),
  };
}