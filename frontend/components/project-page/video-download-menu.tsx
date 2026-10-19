import { useState } from "react";
import { Captions, ChevronDown, Download, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { blobErrorMessage, downloadSubtitles, downloadVideoWithSubtitles, fetchSavedSubtitles, type SubtitleFormat } from "@/lib/subtitle-files";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";

type Props = { imageId: string; name: string; url: string; subtitleCount: number };

// Download of the video being viewed. Without saved subtitles it downloads the video directly.
// With subtitles it offers the video with the subtitles inside (a track the player shows), the
// video alone, or the subtitles as SRT/WebVTT (UC-VID-001 RN5). The plain video is downloaded
// through a link, so even a large file is never loaded into the browser memory.
export default function VideoDownloadMenu({ imageId, name, url, subtitleCount }: Props) {
  const session = useSession();
  const project = useProjectInfo();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const format = (name.split(".").pop() || "").toUpperCase();
  const [preparing, setPreparing] = useState(false);
  const context = () => ({
    ownerId: searchParams.get("owner") ?? session.user._id,
    projectId: project._id,
    imageId,
    token: session.token,
    shareId: searchParams.get("share"),
  });

  const videoLink = (label: string) => (
    <a href={url} download={name} className="flex items-center"><Download className="mr-2 size-4" />{label}</a>
  );

  if (!subtitleCount) {
    return <Button asChild size="sm" variant="outline">{videoLink("Descarregar")}</Button>;
  }

  async function downloadSaved(subtitleFormat: SubtitleFormat) {
    try {
      const segments = await fetchSavedSubtitles(context());
      if (!segments.length) throw new Error("Este vídeo já não tem legendas guardadas.");
      downloadSubtitles(segments, subtitleFormat, name);
    } catch (error) {
      toast({ title: "Não foi possível descarregar as legendas", description: (error as Error).message, variant: "destructive" });
    }
  }

  async function downloadWithSubtitles() {
    setPreparing(true);
    try {
      await downloadVideoWithSubtitles(context(), name);
    } catch (error) {
      toast({
        title: "Não foi possível descarregar o vídeo com legendas",
        description: await blobErrorMessage(error, "Tenta novamente mais tarde."),
        variant: "destructive",
      });
    } finally {
      setPreparing(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={preparing}>
          {preparing ? <LoaderCircle className="mr-1 size-4 animate-spin" /> : <Download className="mr-1 size-4" />}
          {preparing ? "A preparar…" : "Descarregar"}<ChevronDown className="ml-1 size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void downloadWithSubtitles()}>
          <Captions className="mr-2 size-4" />Vídeo com legendas ({format})
        </DropdownMenuItem>
        <DropdownMenuItem asChild>{videoLink(`Vídeo sem legendas (${format})`)}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Só as legendas</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void downloadSaved("srt")}>SRT (.srt)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void downloadSaved("vtt")}>WebVTT (.vtt)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
