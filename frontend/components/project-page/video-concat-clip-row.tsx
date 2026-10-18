import { ArrowDown, ArrowUp, GripVertical, Trash2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectImage } from "@/lib/projects";
import { formatDuration, formatSize } from "@/lib/video-concat";

type Props = {
  image: ProjectImage;
  index: number;
  count: number;
  locked: boolean;
  problem?: string;
  dragOver: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

// One clip of the concatenation sequence (UC-VID-003 passo 2): thumbnail, name, duration,
// resolution, format and audio, with drag and drop and move/remove controls (passo 3, FA1, FA2).
export default function VideoConcatClipRow({
  image, index, count, locked, problem, dragOver, onMove, onRemove, onDragStart, onDragOver, onDrop, onDragEnd,
}: Props) {
  const metadata = image.mediaMetadata;
  const resolution = metadata?.width && metadata?.height ? `${metadata.width}×${metadata.height}` : "—";
  const format = (metadata?.format || image.name.split(".").pop() || "").toUpperCase();
  const hasAudio = Boolean(metadata?.audioCodec);
  return (
    <li
      draggable={!locked}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragOver={(event) => { if (locked) return; event.preventDefault(); onDragOver(); }}
      onDrop={(event) => { event.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-background/40 p-2 transition-colors",
        dragOver && "border-primary bg-primary/10",
        problem && "border-destructive/60 bg-destructive/10",
      )}
      aria-label={`Clip ${index + 1}: ${image.name}`}
    >
      <GripVertical className={cn("size-4 shrink-0 text-muted-foreground", !locked && "cursor-grab")} aria-hidden />
      <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums">{index + 1}</span>
      <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-black">
        {image.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.thumbnailUrl} alt="" className="size-full object-contain" />
        ) : (
          <video src={`${image.url}#t=1`} preload="metadata" muted playsInline tabIndex={-1} className="pointer-events-none size-full object-contain" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={image.name}>{image.name}</p>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatDuration(metadata?.duration)}</span>
          <span>{resolution}</span>
          <span>{format}</span>
          <span className="inline-flex items-center gap-1">
            {hasAudio ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
            {hasAudio ? `Áudio ${String(metadata?.audioCodec).toUpperCase()}` : "Sem áudio"}
          </span>
          {metadata?.sizeBytes ? <span>{formatSize(metadata.sizeBytes)}</span> : null}
        </p>
        {problem && <p className="mt-1 text-xs text-destructive">{problem}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={locked || index === 0} onClick={() => onMove(index, index - 1)} aria-label="Mover para cima">
          <ArrowUp className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={locked || index === count - 1} onClick={() => onMove(index, index + 1)} aria-label="Mover para baixo">
          <ArrowDown className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={locked} onClick={onRemove} aria-label="Remover da sequência">
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </li>
  );
}