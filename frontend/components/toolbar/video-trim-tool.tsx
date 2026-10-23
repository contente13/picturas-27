"use client";

import { Scissors } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Progress } from "../ui/progress";
import { useCanEditProject, useCurrentImage, useProjectInfo, useVideoTrim } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/axios";
import { useSearchParams } from "next/navigation";

type VideoTask = {
  tarefaId: string;
  imageId?: string;
  resultImageId?: string | null;
  estado: "EM_FILA" | "EM_PROCESSAMENTO" | "CONCLUIDA" | "FALHADA" | "CANCELADA";
  progresso?: number;
  erro?: string | null;
  resultUrl?: string | null;
  recursoSaida?: string | null;
};

function floorToTenth(value: number) {
  return Math.floor((value + 1e-8) * 10) / 10;
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "loadeddata" | "seeked",
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Frame capture cancelled", "AbortError"));
      return;
    }

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, handleSuccess);
      video.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleSuccess = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Não foi possível carregar o vídeo para gerar a pré-visualização."));
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Frame capture cancelled", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo limite ao gerar a pré-visualização do vídeo."));
    }, 15_000);

    video.addEventListener(eventName, handleSuccess, { once: true });
    video.addEventListener("error", handleError, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function gerarFotogramas(
  videoElement: HTMLVideoElement,
  quantidade = 10,
  signal?: AbortSignal,
): Promise<string[]> {
  const source = videoElement.currentSrc || videoElement.src;
  if (!source || !Number.isFinite(quantidade) || quantidade < 1) return [];

  const videoAux = document.createElement("video");
  videoAux.crossOrigin = videoElement.crossOrigin || "anonymous";
  videoAux.muted = true;
  videoAux.playsInline = true;
  videoAux.preload = "auto";
  videoAux.setAttribute("aria-hidden", "true");
  videoAux.tabIndex = -1;
  videoAux.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return [];

  document.body.appendChild(videoAux);
  try {
    const metadataReady = waitForVideoEvent(videoAux, "loadedmetadata", signal);
    videoAux.src = source;
    videoAux.load();
    await metadataReady;

    if (videoAux.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(videoAux, "loadeddata", signal);
    }

    const duration = videoAux.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !videoAux.videoWidth || !videoAux.videoHeight) return [];

    const scale = Math.min(1, 240 / videoAux.videoWidth, 135 / videoAux.videoHeight);
    canvas.width = Math.max(1, Math.round(videoAux.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(videoAux.videoHeight * scale));

    const count = Math.floor(quantidade);
    const frames: string[] = [];
    for (let index = 0; index < count; index += 1) {
      if (signal?.aborted) throw new DOMException("Frame capture cancelled", "AbortError");
      const time = Math.max(0, Math.min(duration - 0.01, index * (duration / count)));
      if (Math.abs(videoAux.currentTime - time) > 0.001) {
        const seeked = waitForVideoEvent(videoAux, "seeked", signal);
        videoAux.currentTime = time;
        await seeked;
      }
      context.drawImage(videoAux, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.6));
    }
    return frames;
  } finally {
    videoAux.pause();
    videoAux.removeAttribute("src");
    videoAux.load();
    videoAux.remove();
    canvas.width = 0;
    canvas.height = 0;
  }
}

function isVideoImage(image: ReturnType<typeof useCurrentImage>) {
  return Boolean(image?.url && /\.(mp4|webm)$/i.test(image.name || image.url));
}

export default function VideoTrimTool({ disabled }: { disabled: boolean }) {
  const currentImage = useCurrentImage();
  const canEdit = useCanEditProject();
  const { videoTrimOpen, setVideoTrimOpen, setVideoSubtitlesOpen } = useVideoTrim();
  if (!isVideoImage(currentImage)) return null;

  const isDisabled = disabled || !canEdit;
  return (
    <Button
      type="button"
      variant={videoTrimOpen ? "secondary" : "ghost"}
      aria-pressed={videoTrimOpen}
      className={`flex h-auto flex-col gap-1 px-1 py-2 text-xs ${videoTrimOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
      disabled={isDisabled}
      title="Recorte Temporal"
      onClick={() => { setVideoSubtitlesOpen(false); setVideoTrimOpen(true); }}
    >
      <Scissors className="size-5" />
      <span>Recorte</span>
    </Button>
  );
}

export function VideoTrimPanel({ disabled }: { disabled: boolean }) {
  const currentImage = useCurrentImage();
  const project = useProjectInfo();
  const canEdit = useCanEditProject();
  const session = useSession();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    videoPlayerRef,
    videoTrimOpen,
    videoSourceOverride,
    setVideoSourceOverride,
  } = useVideoTrim();

  const ownerId = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share");
  const projectId = project._id;
  const isVideo = isVideoImage(currentImage);
  const isDisabled = disabled || !canEdit;
  const metadataDuration = Number(currentImage?.mediaMetadata?.duration);
  const isTrimmedSource = Boolean(currentImage && videoSourceOverride?.imageId === currentImage._id);
  const sourceUrl = currentImage && videoSourceOverride?.imageId === currentImage._id
    ? videoSourceOverride.url
    : currentImage?.url;

  const [tempoInicio, setTempoInicio] = useState(0);
  const [tempoFim, setTempoFim] = useState(0);
  const [tempoInicioInput, setTempoInicioInput] = useState("0.0");
  const [tempoFimInput, setTempoFimInput] = useState("0.0");
  const [trimErrors, setTrimErrors] = useState<{ start?: string; end?: string }>({});
  const [videoDuration, setVideoDuration] = useState(0);
  const [filmstripFrames, setFilmstripFrames] = useState<string[]>([]);
  const [filmstripUnavailable, setFilmstripUnavailable] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [taskStatus, setTaskStatus] = useState<VideoTask["estado"] | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const taskImageIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ edge: "in" | "out"; pointerId: number; moved: boolean } | null>(null);
  const suppressTimelineClickRef = useRef(false);

  const taskPath = useCallback(
    (id: string) => `/projects/${ownerId}/${projectId}/video/tasks/${encodeURIComponent(id)}`,
    [ownerId, projectId],
  );

  useEffect(() => {
    if (!isVideo || !videoTrimOpen || !sourceUrl) return;

    setVideoDuration(0);
    setTempoInicio(0);
    setTempoFim(0);
    setTempoInicioInput("0.0");
    setTempoFimInput("0.0");
    setTrimErrors({});

    const player = videoPlayerRef.current;
    const syncDuration = () => {
      if (!player || player.getAttribute("src") !== sourceUrl) return;
      const duration = player.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      setVideoDuration(duration);
      setTempoInicio(0);
      setTempoFim(floorToTenth(duration));
      setTempoInicioInput("0.0");
      setTempoFimInput(floorToTenth(duration).toFixed(1));
      setTrimErrors({});
    };

    if (!isTrimmedSource && Number.isFinite(metadataDuration) && metadataDuration > 0) {
      setVideoDuration(metadataDuration);
      setTempoFim(floorToTenth(metadataDuration));
      setTempoFimInput(floorToTenth(metadataDuration).toFixed(1));
    }

    if (!player) return;
    player.addEventListener("loadedmetadata", syncDuration);
    player.addEventListener("durationchange", syncDuration);
    syncDuration();

    return () => {
      player.removeEventListener("loadedmetadata", syncDuration);
      player.removeEventListener("durationchange", syncDuration);
    };
  }, [isVideo, isTrimmedSource, metadataDuration, sourceUrl, videoPlayerRef, videoTrimOpen]);

  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player || !isVideo || !videoTrimOpen || videoDuration <= 0) return;

    const abortController = new AbortController();
    setFilmstripFrames([]);
    setFilmstripUnavailable(false);
    void gerarFotogramas(player, 10, abortController.signal)
      .then((frames) => {
        if (!abortController.signal.aborted) setFilmstripFrames(frames);
      })
      .catch(() => {
        if (!abortController.signal.aborted) setFilmstripUnavailable(true);
      });

    return () => abortController.abort();
  }, [isVideo, sourceUrl, videoDuration, videoPlayerRef, videoTrimOpen]);

  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player || !isVideo || !videoTrimOpen) return;
    const syncPlaybackTime = () => {
      if (Number.isFinite(player.currentTime)) setPlaybackTime(player.currentTime);
    };

    syncPlaybackTime();
    player.addEventListener("timeupdate", syncPlaybackTime);
    player.addEventListener("seeking", syncPlaybackTime);
    player.addEventListener("seeked", syncPlaybackTime);
    return () => {
      player.removeEventListener("timeupdate", syncPlaybackTime);
      player.removeEventListener("seeking", syncPlaybackTime);
      player.removeEventListener("seeked", syncPlaybackTime);
    };
  }, [isVideo, sourceUrl, videoDuration, videoPlayerRef, videoTrimOpen]);

  useEffect(() => {
    if (!taskId) return;
    let polling = false;

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await api.get<VideoTask>(taskPath(taskId), {
          headers: { Authorization: `Bearer ${session.token}` },
          params: shareId ? { share: shareId } : undefined,
        });
        const task = response.data;
        setTaskStatus(task.estado);
        setProgress(task.progresso ?? 0);

        if (task.estado === "CONCLUIDA") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setSubmitting(false);
          setTaskError(null);
          setResultUrl(task.resultUrl ?? null);
          if (task.resultUrl) {
            const imageId = taskImageIdRef.current ?? task.imageId;
            if (imageId) {
              setVideoSourceOverride({
                imageId,
                trimImageId: task.resultImageId ?? undefined,
                url: task.resultUrl,
                name: task.recursoSaida ?? undefined,
              });
            }
          }
          queryClient.invalidateQueries({ queryKey: ["project"] });
          queryClient.invalidateQueries({ queryKey: ["projectImages"] });
          window.dispatchEvent(new Event("session-updated"));
          toast({
            title: "Recorte concluído",
            description: `${task.recursoSaida ?? "O novo vídeo"} foi guardado no projeto e carregado no leitor principal.`,
          });
          setTaskId(null);
        } else if (task.estado === "FALHADA" || task.estado === "CANCELADA") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setSubmitting(false);
          setTaskError(task.erro ?? "O processamento foi interrompido.");
          toast({
            title: task.estado === "FALHADA" ? "Falha no recorte" : "Recorte cancelado",
            description: task.erro || "O processamento foi interrompido.",
            variant: "destructive",
          });
          window.dispatchEvent(new Event("session-updated"));
          setTaskId(null);
        }
      } catch (error: any) {
        if (error?.response?.status === 404 && pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          setSubmitting(false);
          setTaskId(null);
        }
      } finally {
        polling = false;
      }
    };

    pollTimerRef.current = setInterval(() => void poll(), 1500);
    void poll();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [taskId, ownerId, projectId, session.token, shareId, queryClient, toast, setVideoSourceOverride, taskPath]);

  useEffect(() => {
    if (!isVideo || !projectId || !session.token) return;
    let cancelled = false;
    setTaskId(null);
    setTaskStatus(null);
    setTaskError(null);
    setProgress(0);
    setSubmitting(false);
    setResultUrl(null);
    api.get<{ tarefa: (VideoTask & { imageId?: string }) | null }>(
      `/projects/${ownerId}/${projectId}/video/tasks/latest`,
      {
        headers: { Authorization: `Bearer ${session.token}` },
        params: shareId ? { share: shareId } : undefined,
      },
    ).then((response) => {
      if (cancelled || !response.data.tarefa) return;
      const task = response.data.tarefa;
      const taskSourceId = task.imageId;
      const isCurrentOverrideSource = Boolean(
        currentImage?._id &&
        videoSourceOverride?.imageId === currentImage._id &&
        taskSourceId &&
        videoSourceOverride.trimImageId === taskSourceId
      );
      if (!currentImage?._id || (taskSourceId !== currentImage._id && !isCurrentOverrideSource)) return;
      if (
        videoSourceOverride &&
        taskSourceId &&
        videoSourceOverride.trimImageId === taskSourceId
      ) {
        taskImageIdRef.current = videoSourceOverride.imageId;
      } else {
        taskImageIdRef.current = taskSourceId ?? currentImage?._id ?? null;
      }
      setTaskStatus(task.estado);
      setTaskError(task.erro ?? null);
      setProgress(task.progresso ?? 0);
      const active = task.estado === "EM_FILA" || task.estado === "EM_PROCESSAMENTO";
      setTaskId(active ? task.tarefaId : null);
      setSubmitting(active);
      if (task.estado === "CONCLUIDA" && task.resultUrl) {
        setResultUrl(task.resultUrl);
        setVideoSourceOverride({
          imageId: taskImageIdRef.current ?? currentImage._id,
          trimImageId: task.resultImageId ?? undefined,
          url: task.resultUrl,
          name: task.recursoSaida ?? undefined,
        });
      } else if (task.estado !== "CONCLUIDA") {
        setResultUrl(null);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isVideo, currentImage?._id, ownerId, projectId, session.token, shareId, setVideoSourceOverride, videoSourceOverride?.imageId, videoSourceOverride?.trimImageId]);

  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  function seekMainVideo(time: number) {
    const player = videoPlayerRef.current;
    if (!player || !Number.isFinite(time)) return;
    const playerDuration = Number.isFinite(player.duration) ? player.duration : videoDuration;
    const maxTime = Math.max(0, Math.min(videoDuration, playerDuration) - 0.01);
    const target = Math.max(0, Math.min(maxTime, time));
    player.currentTime = target;
    setPlaybackTime(target);
  }

  function updateHandleTime(edge: "in" | "out", requestedTime: number, seek = true, preserveInput = false) {
    if (!Number.isFinite(requestedTime) || videoDuration <= 0) return;
    const snappedTime = Math.round(requestedTime * 10) / 10;
    const maxDuration = floorToTenth(videoDuration);

    if (edge === "in") {
      const maxStart = Math.max(0, floorToTenth(tempoFim - 1));
      const nextStart = Math.max(0, Math.min(maxStart, snappedTime));
      setTempoInicio(nextStart);
      if (!preserveInput) {
        setTempoInicioInput(nextStart.toFixed(1));
        setTrimErrors(validateTrimValues(nextStart.toFixed(1), tempoFimInput));
      }
      if (seek) seekMainVideo(nextStart);
      return;
    }

    const minEnd = Math.min(maxDuration, floorToTenth(tempoInicio + 1));
    const nextEnd = Math.max(minEnd, Math.min(maxDuration, snappedTime));
    setTempoFim(nextEnd);
    if (!preserveInput) {
      setTempoFimInput(nextEnd.toFixed(1));
      setTrimErrors(validateTrimValues(tempoInicioInput, nextEnd.toFixed(1)));
    }
    if (seek) seekMainVideo(nextEnd);
  }

  function validateTrimValues(startInput: string, endInput: string) {
    const errors: { start?: string; end?: string } = {};
    const start = Number(startInput);
    const end = Number(endInput);
    const hasTenthPrecision = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 0.001;

    if (!startInput.trim() || !Number.isFinite(start)) errors.start = "Indica um tempo de início válido.";
    else if (!hasTenthPrecision(start)) errors.start = "Usa passos de 0,1 segundo.";
    else if (start < 0 || start >= videoDuration) errors.start = "O início tem de estar dentro da duração do vídeo.";

    if (!endInput.trim() || !Number.isFinite(end)) errors.end = "Indica um tempo de fim válido.";
    else if (!hasTenthPrecision(end)) errors.end = "Usa passos de 0,1 segundo.";
    else if (end < 0 || end > videoDuration) errors.end = "O fim tem de estar dentro da duração do vídeo.";

    if (!errors.start && !errors.end) {
      const interval = end - start;
      if (interval <= 0) {
        errors.start = "T_in tem de ser anterior a T_out.";
        errors.end = "T_out tem de ser posterior a T_in.";
      } else if (interval < 1) {
        errors.end = "A duração mínima do recorte é de 1 segundo.";
      } else if (interval >= videoDuration) {
        errors.end = "O recorte tem de ser mais curto do que o vídeo original.";
      } else {
        const profileLimit = session.user.type === "premium" ? 600 : 60;
        if (interval > profileLimit) errors.end = `O limite do teu perfil é ${profileLimit} segundos.`;
      }
    }

    return errors;
  }

  function handleManualTimeChange(edge: "in" | "out", rawValue: string) {
    const normalizedValue = rawValue.replace(",", ".");
    const startValue = edge === "in" ? normalizedValue : tempoInicioInput;
    const endValue = edge === "out" ? normalizedValue : tempoFimInput;
    if (edge === "in") setTempoInicioInput(normalizedValue);
    else setTempoFimInput(normalizedValue);

    const errors = validateTrimValues(startValue, endValue);
    setTrimErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const start = Number(startValue);
    const end = Number(endValue);
    setTempoInicio(start);
    setTempoFim(end);
    seekMainVideo(edge === "in" ? start : end);
  }

  function normalizeManualTime(edge: "in" | "out") {
    const errors = validateTrimValues(tempoInicioInput, tempoFimInput);
    setTrimErrors(errors);
    if (errors[edge === "in" ? "start" : "end"]) return;
    const rawValue = edge === "in" ? tempoInicioInput : tempoFimInput;
    const parsedValue = Number(rawValue);
    if (edge === "in") setTempoInicioInput(parsedValue.toFixed(1));
    else setTempoFimInput(parsedValue.toFixed(1));
  }

  function getTimelineTime(clientX: number) {
    const bounds = filmstripRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || videoDuration <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    return ratio * videoDuration;
  }

  function updateHandleFromPointer(edge: "in" | "out", clientX: number) {
    const time = getTimelineTime(clientX);
    if (time !== null) updateHandleTime(edge, floorToTenth(time));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>, edge: "in" | "out") {
    if (isDisabled || submitting) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { edge, pointerId: event.pointerId, moved: false };
    filmstripRef.current?.setPointerCapture(event.pointerId);
    updateHandleFromPointer(edge, event.clientX);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.moved = true;
    updateHandleFromPointer(drag.edge, event.clientX);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) {
      suppressTimelineClickRef.current = true;
      window.setTimeout(() => { suppressTimelineClickRef.current = false; }, 0);
    }
    if (filmstripRef.current?.hasPointerCapture(event.pointerId)) {
      filmstripRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function handleTimelineClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressTimelineClickRef.current) {
      suppressTimelineClickRef.current = false;
      return;
    }
    if (event.target instanceof Element && event.target.closest("[data-trim-handle]")) return;
    const time = getTimelineTime(event.clientX);
    if (time !== null) seekMainVideo(time);
  }

  function handleHandleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, edge: "in" | "out") {
    const current = edge === "in" ? tempoInicio : tempoFim;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      updateHandleTime(edge, current - 0.1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      updateHandleTime(edge, current + 0.1);
    }
  }

  async function handleSubmit() {
    if (!currentImage?._id) return;
    const errors = validateTrimValues(tempoInicioInput, tempoFimInput);
    setTrimErrors(errors);
    if (Object.keys(errors).length > 0) {
      const message = errors.start || errors.end || "Verifica o intervalo selecionado.";
      toast({
        title: "Intervalo temporal inválido",
        description: message,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    setTaskStatus("EM_FILA");
    setTaskError(null);
    setProgress(0);
    setResultUrl(null);
    taskImageIdRef.current = currentImage._id;
    try {
      const response = await api.post<{ tarefaId: string; estado: VideoTask["estado"] }>(
        `/projects/${ownerId}/${projectId}/video/${
          videoSourceOverride &&
          videoSourceOverride.imageId === currentImage._id &&
          videoSourceOverride.trimImageId
            ? videoSourceOverride.trimImageId
            : currentImage._id
        }/trim${shareId ? `?share=${encodeURIComponent(shareId)}` : ""}`,
        { tempoInicio, tempoFim },
        { headers: { Authorization: `Bearer ${session.token}` } },
      );
      setTaskId(response.data.tarefaId);
      setTaskStatus(response.data.estado);
      window.dispatchEvent(new Event("session-updated"));
      toast({ title: "Recorte em fila", description: "O processamento decorrerá neste painel." });
    } catch (error: any) {
      setSubmitting(false);
      setTaskStatus("FALHADA");
      const description = error?.response?.data?.message || error?.response?.data || error?.message || "Tenta novamente mais tarde.";
      setTaskError(typeof description === "string" ? description : "Não foi possível iniciar o recorte.");
      window.dispatchEvent(new Event("session-updated"));
      toast({
        title: "Não foi possível iniciar o recorte",
        description,
        variant: "destructive",
      });
    }
  }

  async function handleCancel() {
    if (!taskId) return;
    try {
      await api.post(`${taskPath(taskId)}/cancel`, {}, {
        headers: { Authorization: `Bearer ${session.token}` },
        params: shareId ? { share: shareId } : undefined,
      });
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setSubmitting(false);
      setTaskStatus("CANCELADA");
      setTaskError(null);
      setTaskId(null);
      toast({ title: "Recorte cancelado", description: "A tarefa foi interrompida e a quota foi libertada, quando aplicável." });
      window.dispatchEvent(new Event("session-updated"));
    } catch (error: any) {
      toast({
        title: "Não foi possível cancelar",
        description: error?.response?.data?.message || error?.response?.data || "A tarefa pode já ter terminado.",
        variant: "destructive",
      });
    }
  }

  if (!isVideo || !videoTrimOpen) return null;

  const resolution = currentImage?.mediaMetadata?.width && currentImage?.mediaMetadata?.height
    ? `${currentImage.mediaMetadata.width} × ${currentImage.mediaMetadata.height}`
    : "—";
  const format = currentImage?.mediaMetadata?.format?.toUpperCase()
    ?? currentImage?.name.split(".").pop()?.toUpperCase()
    ?? "—";
  const isRunning = submitting && (taskStatus === "EM_FILA" || taskStatus === "EM_PROCESSAMENTO");
  const startPercent = videoDuration > 0 ? Math.max(0, Math.min(100, (tempoInicio / videoDuration) * 100)) : 0;
  const endPercent = videoDuration > 0 ? Math.max(startPercent, Math.min(100, (tempoFim / videoDuration) * 100)) : 100;
  const playheadPercent = videoDuration > 0 ? Math.max(0, Math.min(100, (playbackTime / videoDuration) * 100)) : 0;

  return (
    <section className="mx-2 mb-3 shrink-0 rounded-xl border border-white/10 bg-[#131b26] p-4 shadow-lg sm:mx-4 sm:p-5" aria-label="Recorte Temporal">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Scissors className="size-5 text-primary" />
            Recorte Temporal
          </h2>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Duração {isTrimmedSource ? "atual" : "original"}: {isTrimmedSource
            ? videoDuration > 0 ? `${videoDuration.toFixed(1)} s` : "a carregar…"
            : currentImage?.mediaMetadata?.duration != null
              ? `${Number(currentImage.mediaMetadata.duration).toFixed(1)} s`
              : videoDuration > 0 ? `${videoDuration.toFixed(1)} s` : "a carregar…"}</span>
          <span>Resolução: {resolution}</span>
          <span>Formato: {format}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tempoInicio">Instante inicial (segundos)</Label>
          <Input id="tempoInicio" type="number" step="0.1" min={0} max={Math.max(0, tempoFim - 1)} value={tempoInicioInput}
            aria-invalid={Boolean(trimErrors.start)} aria-describedby={trimErrors.start ? "tempoInicio-error" : undefined}
            className={trimErrors.start ? "border-destructive focus-visible:ring-destructive" : undefined}
            onChange={(event) => handleManualTimeChange("in", event.target.value)} onBlur={() => normalizeManualTime("in")} disabled={isDisabled || submitting || !videoDuration} />
          {trimErrors.start && <p id="tempoInicio-error" className="text-xs text-destructive">{trimErrors.start}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tempoFim">Instante final (segundos)</Label>
          <Input id="tempoFim" type="number" step="0.1" min={tempoInicio + 1} max={videoDuration} value={tempoFimInput}
            aria-invalid={Boolean(trimErrors.end)} aria-describedby={trimErrors.end ? "tempoFim-error" : undefined}
            className={trimErrors.end ? "border-destructive focus-visible:ring-destructive" : undefined}
            onChange={(event) => handleManualTimeChange("out", event.target.value)} onBlur={() => normalizeManualTime("out")} disabled={isDisabled || submitting || !videoDuration} />
          {trimErrors.end && <p id="tempoFim-error" className="text-xs text-destructive">{trimErrors.end}</p>}
        </div>
      </div>

      {videoDuration > 0 && (
        <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-background/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Linha temporal <span className="text-xs font-normal text-muted-foreground">· arrasta as pegas para ajustar o recorte</span></p>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {filmstripUnavailable ? "Pré-visualização de fotogramas indisponível" : filmstripFrames.length < 10 ? "A gerar fotogramas…" : "10 fotogramas"}
            </span>
          </div>

          <div
            ref={filmstripRef}
            className="relative h-[74px] w-full touch-none select-none overflow-hidden rounded-md border border-white/10 bg-slate-950"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onClick={handleTimelineClick}
          >
            <div className="absolute inset-0 flex overflow-hidden">
              {Array.from({ length: 10 }, (_, index) => (
                <div key={index} className="h-full min-w-0 flex-1 overflow-hidden border-r border-white/10 last:border-r-0">
                  {filmstripFrames[index] ? (
                    <div
                      aria-hidden="true"
                      className="h-full w-full bg-cover bg-center"
                      style={{ backgroundImage: `url("${filmstripFrames[index]}")` }}
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950" />
                  )}
                </div>
              ))}
            </div>

            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 bg-black/60" style={{ width: `${startPercent}%` }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 bg-black/60" style={{ left: `${endPercent}%` }} />
            <div
              className="pointer-events-none absolute inset-y-0 z-20 border-y-2 border-blue-400"
              style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
            />

            <div
              role="slider"
              tabIndex={isDisabled || submitting ? -1 : 0}
              aria-label="Pega de início do recorte"
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, floorToTenth(tempoFim - 1))}
              aria-valuenow={tempoInicio}
              data-trim-handle="in"
              className={`absolute inset-y-0 z-40 w-6 -translate-x-1/2 touch-none ${isDisabled || submitting ? "cursor-not-allowed" : "cursor-ew-resize"}`}
              style={{ left: `${startPercent}%` }}
              onPointerDown={(event) => handlePointerDown(event, "in")}
              onKeyDown={(event) => handleHandleKeyDown(event, "in")}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              <span className="absolute left-1/2 top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2 rounded border border-blue-200 bg-blue-500 shadow" />
            </div>

            <div
              role="slider"
              tabIndex={isDisabled || submitting ? -1 : 0}
              aria-label="Pega de fim do recorte"
              aria-orientation="horizontal"
              aria-valuemin={Math.min(floorToTenth(videoDuration), floorToTenth(tempoInicio + 1))}
              aria-valuemax={floorToTenth(videoDuration)}
              aria-valuenow={tempoFim}
              data-trim-handle="out"
              className={`absolute inset-y-0 z-40 w-6 -translate-x-1/2 touch-none ${isDisabled || submitting ? "cursor-not-allowed" : "cursor-ew-resize"}`}
              style={{ left: `${endPercent}%` }}
              onPointerDown={(event) => handlePointerDown(event, "out")}
              onKeyDown={(event) => handleHandleKeyDown(event, "out")}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              <span className="absolute left-1/2 top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2 rounded border border-blue-200 bg-blue-500 shadow" />
            </div>

            <div className="pointer-events-none absolute inset-y-0 z-30 -translate-x-1/2" style={{ left: `${playheadPercent}%` }}>
              <span className="block h-full w-0.5 bg-white shadow-[0_0_5px_rgba(255,255,255,0.8)]" />
            </div>
          </div>

          <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>0.0 s</span>
            <span>Reprodução: {playbackTime.toFixed(1)} s</span>
            <span>{videoDuration.toFixed(1)} s</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-background/40 p-3 text-sm">
        <span>Duração do recorte: <strong className="text-primary">{Math.max(0, tempoFim - tempoInicio).toFixed(1)} s</strong></span>
      </div>

      {taskError && (taskStatus === "FALHADA" || taskStatus === "CANCELADA") && (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {taskError}
        </p>
      )}

      {isRunning && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-white/10 bg-background/30 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex justify-between gap-3 text-xs font-medium">
              <span>A processar com FFmpeg… ({taskStatus === "EM_FILA" ? "em fila" : "em processamento"})</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          <Button variant="destructive" onClick={handleCancel} disabled={progress >= 97 || !taskId}>
            {progress >= 97 ? "A guardar o resultado…" : "Cancelar tarefa"}
          </Button>
        </div>
      )}

      {!isRunning && (
        <div className="mt-3 flex justify-end">
          <Button onClick={handleSubmit} disabled={isDisabled || !videoDuration || videoDuration <= 1}>
            <Scissors className="size-4" /> Aplicar recorte
          </Button>
        </div>
      )}
    </section>
  );
}
