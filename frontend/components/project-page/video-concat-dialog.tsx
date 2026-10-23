import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Film, Info, LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { useConcatTask } from "@/hooks/use-concat-task";
import { cn } from "@/lib/utils";
import type { ProjectImage } from "@/lib/projects";
import {
  CONCAT_LIMITS,
  ConcatRequestError,
  formatDuration,
  formatSize,
  sequenceTotals,
  validateConcat,
  type ConcatContext,
  type ConcatProblem,
  type ConcatValidation,
} from "@/lib/video-concat";
import VideoConcatClipRow from "./video-concat-clip-row";
import { useProjectVideoPolicy } from "@/providers/project-provider";
import ProjectVideoPolicyStatus from "./project-video-policy-status";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ConcatContext;
  sequence: ProjectImage[];
  onSequenceChange: (sequence: ProjectImage[]) => void;
  projectVideos: ProjectImage[];
  concat: ReturnType<typeof useConcatTask>;
  onOpenResult: (imageId: string) => void;
};

type Validation = { key: string; result?: ConcatValidation; message?: string; problems?: ConcatProblem[] };

// UC-VID-003 — Juntar vídeos: order the selected clips (passo 3), confirm the sequence and see the
// normalization plan (passos 4–5), generate (passo 6), follow or cancel (passo 7, FA8) and preview,
// download or open the result (passo 10).
export default function VideoConcatDialog({
  open, onOpenChange, context, sequence, onSequenceChange, projectVideos, concat, onOpenResult,
}: Props) {
  const { toast } = useToast();
  const { policy } = useProjectVideoPolicy();
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validating, setValidating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const { task, active } = concat;
  const locked = active || starting;
  const sequenceKey = sequence.map((image) => image._id).join(",");
  const confirmed = validation?.key === sequenceKey && Boolean(validation.result);
  const limits = policy ? (policy.userType === "premium" ? CONCAT_LIMITS.premium : CONCAT_LIMITS.free) : null;
  const totals = sequenceTotals(sequence);
  const available = useMemo(
    () => projectVideos.filter((video) => !sequence.some((image) => image._id === video._id)),
    [projectVideos, sequence],
  );
  const problemsById = useMemo(() => {
    const map = new Map<string, string>();
    if (validation?.key === sequenceKey) validation.problems?.forEach((problem) => map.set(problem.imageId, problem.reason));
    return map;
  }, [validation, sequenceKey]);

  // Any change to the sequence requires confirming it again (FA1–FA3).
  useEffect(() => {
    setValidation((current) => (current && current.key !== sequenceKey ? null : current));
  }, [sequenceKey]);

  function move(from: number, to: number) {
    if (to < 0 || to >= sequence.length || from === to) return;
    const next = [...sequence];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onSequenceChange(next);
  }

  async function confirmSequence() {
    if (!policy) return;
    setValidating(true);
    try {
      const result = await validateConcat(context, sequence.map((image) => image._id));
      setValidation({ key: sequenceKey, result });
    } catch (error) {
      const failure = error instanceof ConcatRequestError ? error : new ConcatRequestError("Não foi possível validar a sequência.");
      setValidation({ key: sequenceKey, message: failure.message, problems: failure.problems });
    } finally {
      setValidating(false);
    }
  }

  async function generate() {
    if (!policy) return;
    setStarting(true);
    try {
      await concat.start(sequence.map((image) => image._id));
      window.dispatchEvent(new Event("session-updated"));
      toast({ title: "Junção em fila", description: "Podes continuar a usar a aplicação enquanto o vídeo é gerado." });
    } catch (error) {
      const failure = error instanceof ConcatRequestError ? error : new ConcatRequestError("Não foi possível iniciar a junção.");
      setValidation({ key: sequenceKey, message: failure.message, problems: failure.problems });
      toast({ title: "Não foi possível juntar os vídeos", description: failure.message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    try {
      await concat.cancel();
    } catch (error) {
      toast({ title: "Não foi possível cancelar", description: (error as Error).message, variant: "destructive" });
    }
  }

  function startOver() {
    concat.dismiss();
    setValidation(null);
  }

  const finished = task && !active ? task : null;
  const overLimit = {
    count: Boolean(limits && totals.count > limits.maxVideos),
    duration: Boolean(limits && totals.durationSeconds > limits.maxDurationSeconds),
    size: Boolean(limits && totals.sizeBytes > limits.maxSizeBytes),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl grid-cols-1 overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Film className="size-5 text-primary" />Juntar vídeos</DialogTitle>
          <DialogDescription>
            Ordena os vídeos (arrasta ou usa as setas), confirma a sequência e gera um novo vídeo. Os originais não são alterados.
          </DialogDescription>
        </DialogHeader>

        {finished?.estado === "CONCLUIDA" && (
          <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3" aria-label="Resultado">
            <p className="flex items-center gap-2 text-sm font-medium text-primary"><CheckCircle2 className="size-4" />Vídeo gerado: {finished.recursoSaida}</p>
            {finished.resultUrl && <video src={finished.resultUrl} controls playsInline className="max-h-72 w-full rounded bg-black" />}
            <div className="flex flex-wrap gap-2">
              {finished.resultUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={finished.resultUrl} download={finished.recursoSaida ?? undefined}><Download className="mr-1 size-4" />Descarregar</a>
                </Button>
              )}
              {finished.resultImageId && (
                <Button size="sm" variant="outline" onClick={() => onOpenResult(finished.resultImageId!)}>Abrir no projeto</Button>
              )}
              <Button size="sm" variant="ghost" onClick={startOver}><RotateCcw className="mr-1 size-4" />Nova junção</Button>
            </div>
          </section>
        )}
        {(finished?.estado === "FALHADA" || finished?.estado === "CANCELADA") && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <span>{finished.estado === "CANCELADA" ? "Junção cancelada. Os vídeos originais e a sequência foram mantidos." : finished.erro || "A junção falhou."}</span>
            <Button size="sm" variant="ghost" onClick={startOver}>Fechar aviso</Button>
          </div>
        )}

        <ol className="space-y-2" onDragLeave={() => setOverIndex(null)}>
          {sequence.map((image, index) => (
            <VideoConcatClipRow
              key={image._id}
              image={image}
              index={index}
              count={sequence.length}
              locked={locked}
              problem={problemsById.get(image._id)}
              dragOver={overIndex === index && dragIndex !== index}
              onMove={move}
              onRemove={() => onSequenceChange(sequence.filter((item) => item._id !== image._id))}
              onDragStart={() => setDragIndex(index)}
              onDragOver={() => setOverIndex(index)}
              onDrop={() => { if (dragIndex !== null) move(dragIndex, index); setDragIndex(null); setOverIndex(null); }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
            />
          ))}
        </ol>

        {!locked && available.length > 0 && (
          <Select value="" onValueChange={(id) => {
            const video = available.find((item) => item._id === id);
            if (video) onSequenceChange([...sequence, video]);
          }}>
            <SelectTrigger className="w-full justify-start gap-2 sm:w-80 [&>svg:last-child]:ml-auto" aria-label="Adicionar outro vídeo do projeto">
              <Plus className="size-4 shrink-0" />
              <SelectValue placeholder="Adicionar outro vídeo do projeto" />
            </SelectTrigger>
            <SelectContent>
              {available.map((video) => <SelectItem key={video._id} value={video._id} className="max-w-[min(32rem,80vw)]"><span className="block truncate">{video.name}</span></SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <ProjectVideoPolicyStatus />
        {limits && <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm" aria-label="Totais da sequência">
          <span className={cn(overLimit.count && "text-destructive")}>{totals.count} vídeos <span className="text-muted-foreground">(máx. {limits.maxVideos})</span></span>
          <span className={cn("tabular-nums", overLimit.duration && "text-destructive")}>Duração total {formatDuration(totals.durationSeconds)} <span className="text-muted-foreground">(máx. {formatDuration(limits.maxDurationSeconds)})</span></span>
          <span className={cn(overLimit.size && "text-destructive")}>{formatSize(totals.sizeBytes)} <span className="text-muted-foreground">(máx. {formatSize(limits.maxSizeBytes)})</span></span>
          {policy?.userType === "free" && <span className="text-muted-foreground">Operações diárias restantes do proprietário: {policy.remainingOperations}</span>}
        </div>}
        {sequence.length < 2 && (
          <p className="flex items-center gap-2 text-sm text-amber-400"><Info className="size-4" />São necessários pelo menos dois vídeos para os juntar.</p>
        )}

        {validation?.key === sequenceKey && validation.message && (
          <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{validation.message}</span>
          </div>
        )}
        {confirmed && validation?.result && !active && finished?.estado !== "CONCLUIDA" && (
          <section className="space-y-1 rounded-lg border p-3 text-sm" aria-label="Ajustes técnicos">
            <p className="font-medium">Sequência confirmada — {formatDuration(validation.result.totals.durationSeconds)}, {validation.result.plan.width}×{validation.result.plan.height}, {Number(validation.result.plan.fps.toFixed(3))} fps</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {validation.result.plan.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        )}

        {active && task && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex justify-between text-sm font-medium">
              <span><LoaderCircle className="mr-1 inline size-4 animate-spin" />{task.estado === "EM_FILA" ? "Em fila" : "A juntar os vídeos"}</span>
              <span className="tabular-nums">{task.progresso ?? 0}%</span>
            </div>
            <Progress value={task.progresso ?? 0} className="h-2" />
            <p className="text-xs text-muted-foreground">Podes fechar esta janela; a junção continua no servidor.</p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {active ? (
            <Button variant="destructive" onClick={cancel} disabled={(task?.progresso ?? 0) >= 97}>
              {(task?.progresso ?? 0) >= 97 ? "A guardar o resultado…" : "Cancelar processamento"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={confirmSequence} disabled={!policy || sequence.length < 2 || validating || starting}>
                {validating ? <LoaderCircle className="mr-1 size-4 animate-spin" /> : null}Confirmar sequência
              </Button>
              <Button onClick={generate} disabled={!policy || !confirmed || starting}>
                {starting ? <LoaderCircle className="mr-1 size-4 animate-spin" /> : <Film className="mr-1 size-4" />}Gerar vídeo
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
