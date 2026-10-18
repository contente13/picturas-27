import { Film, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  selecting: boolean;
  selectedCount: number;
  onJoin: () => void;
  onCancelSelection: () => void;
  concatActive: boolean;
  concatProgress?: number;
  onShowConcat: () => void;
};

// Bottom bar of the library: the video selection for "Juntar vídeos" (UC-VID-003 passo 1, E1) and
// a running concatenation, also after leaving and returning to the page (FA9).
export default function VideoSelectionBar({
  selecting, selectedCount, onJoin, onCancelSelection, concatActive, concatProgress, onShowConcat,
}: Props) {
  if (!selecting && !concatActive) return null;
  return (
    <div className="sticky bottom-2 z-40 mx-2 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
      {concatActive && (
        <button type="button" onClick={onShowConcat} className="flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
          <LoaderCircle className="size-4 animate-spin" />Junção de vídeos em curso ({concatProgress ?? 0}%) — ver
        </button>
      )}
      {selecting && (
        <>
          <span className="text-sm">
            <strong>{selectedCount}</strong> {selectedCount === 1 ? "vídeo selecionado" : "vídeos selecionados"}
          </span>
          {selectedCount < 2 && <span className="text-xs text-muted-foreground">Seleciona pelo menos dois vídeos para os juntar.</span>}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={onCancelSelection}><X className="mr-1 size-4" />Cancelar seleção</Button>
            <Button size="sm" onClick={onJoin} disabled={selectedCount < 2}><Film className="mr-1 size-4" />Juntar vídeos</Button>
          </div>
        </>
      )}
    </div>
  );
}