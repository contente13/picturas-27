"use client";

import { Captions, Plus, Save, Trash2, Download, Film, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Progress } from "../ui/progress";
import { useCanEditProject, useCurrentImage, useProjectInfo, useVideoTrim } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/axios";

type Segment = { id: string; start: number; end: number; text: string };
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

function formatStamp(seconds: number, separator: "," | ".") {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}

function serializeSubtitles(segments: Segment[], format: "srt" | "vtt") {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const cues = ordered.map((segment, index) => {
    const timing = `${formatStamp(segment.start, format === "srt" ? "," : ".")} --> ${formatStamp(segment.end, format === "srt" ? "," : ".")}`;
    return format === "srt" ? `${index + 1}\n${timing}\n${segment.text.trim()}` : `${timing}\n${segment.text.trim()}`;
  });
  return format === "srt" ? cues.join("\n\n") : `WEBVTT\n\n${cues.join("\n\n")}`;
}

function validateSegments(segments: Segment[], duration: number) {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  for (let index = 0; index < ordered.length; index += 1) {
    const segment = ordered[index];
    const lines = segment.text.trim().split(/\r?\n/);
    if (!segment.text.trim()) return `A legenda ${index + 1} não tem texto.`;
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end > duration || segment.start >= segment.end) {
      return `Os tempos da legenda ${index + 1} têm de estar dentro do vídeo.`;
    }
    if (segment.end - segment.start < 0.5 || segment.end - segment.start > 10) return `A legenda ${index + 1} deve durar entre 0,5 e 10 segundos.`;
    if (lines.length > 2 || lines.some((line) => line.length > 42)) return `A legenda ${index + 1} pode ter no máximo duas linhas de 42 caracteres.`;
    if (index > 0 && segment.start < ordered[index - 1].end) return `A legenda ${index + 1} sobrepõe-se à anterior.`;
  }
  return null;
}

function createSegment(start = 0, duration = 0): Segment {
  const end = Math.min(duration || start + 2, start + 2);
  return { id: crypto.randomUUID(), start, end: Math.min(duration || end, Math.max(start + 0.5, end)), text: "" };
}

export default function VideoSubtitlesTool({ disabled }: { disabled: boolean }) {
  const currentImage = useCurrentImage();
  const canEdit = useCanEditProject();
  const { videoSubtitlesOpen, setVideoSubtitlesOpen, setVideoTrimOpen } = useVideoTrim();
  if (!currentImage?.url || !/\.(mp4|webm)$/i.test(currentImage.name || currentImage.url)) return null;
  const isDisabled = disabled || !canEdit;
  return (
    <Button type="button" variant={videoSubtitlesOpen ? "secondary" : "ghost"} aria-pressed={videoSubtitlesOpen}
      className={`flex h-auto flex-col gap-1 px-1 py-2 text-xs ${videoSubtitlesOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
      disabled={isDisabled} title="Legendas manuais (UC-VID-001)" onClick={() => {
        const next = !videoSubtitlesOpen;
        setVideoSubtitlesOpen(next);
        if (next) setVideoTrimOpen(false);
      }}>
      <Captions className="size-5" />
      <span>Legendas</span>
    </Button>
  );
}

export function VideoSubtitlesPanel({ disabled }: { disabled: boolean }) {
  const currentImage = useCurrentImage();
  const project = useProjectInfo();
  const canEdit = useCanEditProject();
  const session = useSession();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { videoPlayerRef, videoSourceOverride, setVideoSourceOverride, setVideoSubtitlePreview } = useVideoTrim();
  const ownerId = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share");
  const projectId = project._id;
  const imageId = currentImage?._id;
  const isDisabled = disabled || !canEdit;
  const [segments, setSegments] = useState<Segment[]>([]);
  const [savedSegments, setSavedSegments] = useState<Segment[]>([]);
  const [duration, setDuration] = useState(Number(currentImage?.mediaMetadata?.duration) || 0);
  const [projectVersion, setProjectVersion] = useState(Number(project.version) || 0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [task, setTask] = useState<VideoTask | null>(null);
  const [progress, setProgress] = useState(0);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const basePath = useMemo(() => `/projects/${ownerId}/${projectId}/video`, [ownerId, projectId]);
  const shareParams = shareId ? { share: shareId } : undefined;
  const taskPath = useCallback((id: string) => `${basePath}/tasks/${encodeURIComponent(id)}`, [basePath]);
  const dirty = JSON.stringify(segments) !== JSON.stringify(savedSegments);

  useEffect(() => {
    if (!imageId || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setSegments([]);
    setSavedSegments([]);
    setProjectVersion(Number(project.version) || 0);
    setTask(null);
    setTaskError(null);
    api.get<{ segments: Segment[]; projectVersion: number }>(`${basePath}/${imageId}/subtitles`, {
      headers: { Authorization: `Bearer ${session.token}` }, params: shareParams,
    }).then(({ data }) => {
      if (cancelled) return;
      const restored = (data.segments || []).map((segment) => ({ ...segment, id: segment.id || crypto.randomUUID() }));
      setSegments(restored);
      setSavedSegments(restored);
      setProjectVersion(data.projectVersion);
    }).catch((error: any) => {
      if (!cancelled) toast({ title: "Não foi possível carregar as legendas", description: error?.response?.data || "Tenta novamente.", variant: "destructive" });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // project version is intentionally not a fetch key; changing it during local edits must not discard them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, basePath, session.token, shareId]);

  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player || !imageId) return;
    const sync = () => {
      const time = Number(player.currentTime) || 0;
      setPlayhead(time);
      const current = segments.find((segment) => time >= segment.start && time < segment.end);
      setVideoSubtitlePreview(current ? { imageId, text: current.text } : null);
    };
    player.addEventListener("timeupdate", sync);
    player.addEventListener("seeked", sync);
    player.addEventListener("loadedmetadata", sync);
    sync();
    return () => {
      player.removeEventListener("timeupdate", sync);
      player.removeEventListener("seeked", sync);
      player.removeEventListener("loadedmetadata", sync);
      setVideoSubtitlePreview(null);
    };
  }, [imageId, segments, videoPlayerRef, setVideoSubtitlePreview]);

  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player || !imageId) return;
    const setVideoDuration = () => {
      if (Number.isFinite(player.duration) && player.duration > 0) setDuration(player.duration);
    };
    player.addEventListener("loadedmetadata", setVideoDuration);
    setVideoDuration();
    return () => player.removeEventListener("loadedmetadata", setVideoDuration);
  }, [imageId, videoPlayerRef]);

  useEffect(() => {
    if (!task?.tarefaId || !["EM_FILA", "EM_PROCESSAMENTO"].includes(task.estado)) return;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const { data } = await api.get<VideoTask>(taskPath(task.tarefaId), {
          headers: { Authorization: `Bearer ${session.token}` }, params: shareParams,
        });
        setTask(data);
        setProgress(data.progresso ?? 0);
        if (data.estado === "CONCLUIDA") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.resultUrl && imageId) setVideoSourceOverride({ imageId, trimImageId: data.resultImageId ?? undefined, url: data.resultUrl, name: data.recursoSaida ?? undefined });
          queryClient.invalidateQueries({ queryKey: ["project"] });
          queryClient.invalidateQueries({ queryKey: ["projectImages"] });
          window.dispatchEvent(new Event("session-updated"));
          toast({ title: "Legendas incorporadas", description: `${data.recursoSaida || "O novo vídeo"} foi guardado no projeto.` });
        } else if (data.estado === "FALHADA" || data.estado === "CANCELADA") {
          if (pollRef.current) clearInterval(pollRef.current);
          setTaskError(data.erro || "O processamento foi interrompido.");
          window.dispatchEvent(new Event("session-updated"));
        }
      } catch { /* nova tentativa no próximo intervalo */ }
      finally { busy = false; }
    };
    pollRef.current = setInterval(() => void poll(), 1500);
    void poll();
    return () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; };
  }, [task?.tarefaId, task?.estado, taskPath, session.token, shareId, imageId, queryClient, setVideoSourceOverride, toast]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setVideoSubtitlePreview(null);
  }, [setVideoSubtitlePreview]);

  function updateSegment(id: string, patch: Partial<Segment>) {
    setSegments((current) => current.map((segment) => segment.id === id ? { ...segment, ...patch } : segment).sort((a, b) => a.start - b.start));
  }

  function addSegment() {
    const start = Math.max(0, Math.min(Math.max(0, duration - 0.5), playhead));
    setSegments((current) => [...current, createSegment(start, duration)].sort((a, b) => a.start - b.start));
  }

  async function save() {
    if (!imageId) return;
    const error = validateSegments(segments, duration);
    if (error) { toast({ title: "Verifica as legendas", description: error, variant: "destructive" }); return; }
    setSaving(true);
    try {
      const { data } = await api.put<{ segments: Segment[]; projectVersion: number }>(`${basePath}/${imageId}/subtitles`, {
        segments: segments.map(({ start, end, text }) => ({ start, end, text })), projectVersion,
      }, { headers: { Authorization: `Bearer ${session.token}` }, params: shareParams });
      const normalized = data.segments.map((segment, index) => ({ ...segment, id: segments[index]?.id || crypto.randomUUID() }));
      setSegments(normalized);
      setSavedSegments(normalized);
      setProjectVersion(data.projectVersion);
      // Persist the new optimistic-lock version without refetching the entire
      // project (which can replace the selected video's URL and reset its tool).
      queryClient.setQueriesData<{ version?: number }>(
        { queryKey: ["project", session.user._id, projectId, session.token] },
        (cached) => cached ? { ...cached, version: data.projectVersion } : cached,
      );
      toast({ title: "Legendas guardadas", description: "As legendas foram associadas a este vídeo." });
    } catch (error: any) {
      toast({ title: "Não foi possível guardar", description: error?.response?.data || "Atualiza o projeto e tenta novamente.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  function download(format: "srt" | "vtt") {
    const error = validateSegments(segments, duration);
    if (!segments.length || error) { toast({ title: "Não é possível exportar", description: error || "Adiciona pelo menos uma legenda.", variant: "destructive" }); return; }
    const blob = new Blob([serializeSubtitles(segments, format)], { type: format === "srt" ? "application/x-subrip;charset=utf-8" : "text/vtt;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentImage?.name?.replace(/\.[^.]+$/, "") || "video"}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function embed() {
    if (!imageId || !segments.length) return;
    if (dirty) { toast({ title: "Guarda primeiro", description: "Guarda as alterações antes de incorporar as legendas." }); return; }
    const error = validateSegments(segments, duration);
    if (error) { toast({ title: "Verifica as legendas", description: error, variant: "destructive" }); return; }
    try {
      const { data } = await api.post<{ tarefaId: string; estado: VideoTask["estado"] }>(`${basePath}/${imageId}/subtitles/embed`, {}, {
        headers: { Authorization: `Bearer ${session.token}` }, params: shareParams,
      });
      setTask({ tarefaId: data.tarefaId, estado: data.estado });
      setProgress(0);
      setTaskError(null);
      window.dispatchEvent(new Event("session-updated"));
      toast({ title: "Incorporação em fila", description: "O processamento decorrerá neste painel." });
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.response?.data || "Tenta novamente mais tarde.";
      setTaskError(typeof message === "string" ? message : "Não foi possível iniciar a incorporação.");
      window.dispatchEvent(new Event("session-updated"));
      toast({ title: "Não foi possível incorporar", description: typeof message === "string" ? message : "Tenta novamente.", variant: "destructive" });
    }
  }

  async function cancelTask() {
    if (!task?.tarefaId) return;
    try {
      await api.post(`${taskPath(task.tarefaId)}/cancel`, {}, { headers: { Authorization: `Bearer ${session.token}` }, params: shareParams });
      if (pollRef.current) clearInterval(pollRef.current);
      setTask({ ...task, estado: "CANCELADA" });
      setTaskError("Incorporação cancelada. As legendas guardadas foram preservadas.");
      window.dispatchEvent(new Event("session-updated"));
    } catch (error: any) {
      toast({ title: "Não foi possível cancelar", description: error?.response?.data?.message || error?.response?.data || "A tarefa pode já ter terminado.", variant: "destructive" });
    }
  }

  async function restoreLatestTask() {
    try {
      const { data } = await api.get<{ tarefa: VideoTask | null }>(`${basePath}/tasks/latest`, {
        headers: { Authorization: `Bearer ${session.token}` }, params: { ...(shareParams || {}), operation: "subtitles" },
      });
      const latestTask = data.tarefa;
      if (imageId && latestTask && latestTask.imageId === imageId && (latestTask.estado === "EM_FILA" || latestTask.estado === "EM_PROCESSAMENTO" || latestTask.estado === "CONCLUIDA")) {
        setTask(latestTask);
        if (latestTask.estado === "CONCLUIDA" && latestTask.resultUrl) {
          setVideoSourceOverride({ imageId, trimImageId: latestTask.resultImageId ?? undefined, url: latestTask.resultUrl, name: latestTask.recursoSaida ?? undefined });
        }
      }
    } catch { /* loading the editor can proceed without task restoration */ }
  }
  useEffect(() => { if (imageId) void restoreLatestTask(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [imageId]);

  if (!currentImage || !imageId) return null;
  const active = Boolean(task && ["EM_FILA", "EM_PROCESSAMENTO"].includes(task.estado));
  const resolution = currentImage.mediaMetadata?.width && currentImage.mediaMetadata?.height ? `${currentImage.mediaMetadata.width} × ${currentImage.mediaMetadata.height}` : "—";
  const format = currentImage.mediaMetadata?.format?.toUpperCase() || currentImage.name.split(".").pop()?.toUpperCase() || "—";
  const sourceIsDerived = videoSourceOverride?.imageId === imageId && Boolean(videoSourceOverride.trimImageId);

  return (
    <section className="mx-2 mb-3 shrink-0 rounded-xl border border-white/10 bg-[#131b26] p-4 shadow-lg sm:mx-4 sm:p-5" aria-label="Editor manual de legendas">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Captions className="size-5 text-primary" />Legendas manuais</h2>
          <p className="mt-1 text-sm text-muted-foreground">UC-VID-001 · Escreve e sincroniza cada segmento. O vídeo original fica intacto.</p></div>
        <div className="flex gap-4 text-xs text-muted-foreground"><span>{duration ? `${duration.toFixed(1)} s` : "a carregar…"}</span><span>{resolution}</span><span>{format}</span></div>
      </div>
      {session.user.type === "free" && session.user.remaining_operations != null && <p className="mb-3 text-xs text-muted-foreground">Operações diárias restantes: {session.user.remaining_operations}</p>}
      {loading ? <p className="text-sm text-muted-foreground">A carregar legendas…</p> : <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={isDisabled || active || !duration} onClick={addSegment}><Plus className="mr-1 size-4" />Adicionar legenda na posição atual ({playhead.toFixed(1)} s)</Button>
          <Button type="button" variant="outline" size="sm" disabled={isDisabled || saving || !dirty} onClick={save}><Save className="mr-1 size-4" />{saving ? "A guardar…" : "Guardar"}</Button>
          <Button type="button" variant="outline" size="sm" disabled={isDisabled || dirty || active || !segments.length} onClick={() => download("srt")}><Download className="mr-1 size-4" />Descarregar SRT</Button>
          <Button type="button" variant="outline" size="sm" disabled={isDisabled || dirty || active || !segments.length} onClick={() => download("vtt")}><Download className="mr-1 size-4" />Descarregar WebVTT</Button>
          <Button type="button" size="sm" disabled={isDisabled || dirty || active || !segments.length} onClick={embed}><Film className="mr-1 size-4" />Incorporar no vídeo</Button>
          {dirty && <span className="text-xs text-amber-300">Alterações por guardar</span>}
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {segments.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Ainda não há legendas. Reproduz o vídeo e adiciona o primeiro segmento.</p>}
          {segments.map((segment, index) => <div key={segment.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-white/10 bg-background/30 p-3 md:grid-cols-[minmax(180px,1fr)_100px_100px_40px]">
            <div className="space-y-1"><Label htmlFor={`subtitle-text-${segment.id}`}>Legenda {index + 1}</Label><textarea id={`subtitle-text-${segment.id}`} maxLength={85} rows={2} value={segment.text} disabled={isDisabled || active}
              onChange={(event) => updateSegment(segment.id, { text: event.target.value })}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" placeholder="Escreve o texto da legenda" /></div>
            <div className="space-y-1"><div className="flex items-center justify-between"><Label htmlFor={`subtitle-start-${segment.id}`}>Início (s)</Label><button type="button" className="text-[10px] text-primary underline underline-offset-2" disabled={isDisabled || active} onClick={() => updateSegment(segment.id, { start: Number(playhead.toFixed(1)) })}>Usar atual</button></div><Input id={`subtitle-start-${segment.id}`} type="number" min={0} max={duration} step="0.1" value={segment.start} disabled={isDisabled || active} onChange={(event) => updateSegment(segment.id, { start: Number(event.target.value) })} /></div>
            <div className="space-y-1"><div className="flex items-center justify-between"><Label htmlFor={`subtitle-end-${segment.id}`}>Fim (s)</Label><button type="button" className="text-[10px] text-primary underline underline-offset-2" disabled={isDisabled || active} onClick={() => updateSegment(segment.id, { end: Number(playhead.toFixed(1)) })}>Usar atual</button></div><Input id={`subtitle-end-${segment.id}`} type="number" min={0} max={duration} step="0.1" value={segment.end} disabled={isDisabled || active} onChange={(event) => updateSegment(segment.id, { end: Number(event.target.value) })} /></div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Apagar legenda ${index + 1}`} disabled={isDisabled || active} onClick={() => setSegments((current) => current.filter((item) => item.id !== segment.id))}><Trash2 className="size-4 text-destructive" /></Button>
          </div>)}
        </div>
      </>}
      {active && <div className="mt-3 flex flex-col gap-3 rounded-lg border border-white/10 bg-background/30 p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1 space-y-2"><div className="flex justify-between gap-3 text-xs font-medium"><span><LoaderCircle className="mr-1 inline size-3 animate-spin" />A incorporar legendas ({task?.estado === "EM_FILA" ? "em fila" : "em processamento"})</span><span>{progress}%</span></div><Progress value={progress} className="h-2" /></div><Button variant="destructive" onClick={cancelTask} disabled={progress >= 97}>{progress >= 97 ? "A guardar o resultado…" : "Cancelar tarefa"}</Button></div>}
      {taskError && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{taskError}</p>}
      {task?.estado === "CONCLUIDA" && task.resultUrl && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><span className="font-medium text-primary">Legendas incorporadas num novo vídeo.</span><a href={task.resultUrl} download className="text-xs font-medium underline underline-offset-4">Descarregar vídeo</a></div>}
      {sourceIsDerived && <p className="mt-2 text-xs text-muted-foreground">A pré-visualização atual usa um resultado derivado; seleciona o vídeo original na biblioteca para editar as legendas de origem.</p>}
    </section>
  );
}
