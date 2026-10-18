import { useSearchParams } from "next/navigation";
import BrightnessTool from "./brightness-tool";
import ContrastTool from "./contrast-tool";
import CropTool from "./crop-tool";
import ResizeTool from "./resize-tool";
import RotateTool from "./rotate-tool";
import SaturationTool from "./saturation-tool";
import BorderTool from "./border-tool";
import BinarizationTool from "./binarization-tool";
import WatermarkTool from "./watermark-tool";
import CropAITool from "./ai-crop-tool";
import BgRemovalAITool from "./ai-bg-removal";
import ObjectAITool from "./object-ai-tool";
import PeopleAITool from "./people-ai-tool";
import TextAITool from "./text-ai-tool";
import UpgradeAITool from "./upgrade-ai-tool";
import VideoTrimTool from "./video-trim-tool";
import VideoSubtitlesTool from "./video-subtitles-tool";
import { useClearProjectTools } from "@/lib/mutations/projects";
import { useSession } from "@/providers/session-provider";
import { useProjectInfo, useCurrentImage, useCanEditProject } from "@/providers/project-provider";
import { Button } from "../ui/button";
import { AppliedToolsList } from "./applied-tools-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Eraser } from "lucide-react";
import { useState } from "react";
import ExpandAITool from "./expand-ai-tool";

export function Toolbar() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "grid";
  const mode = searchParams.get("mode") ?? "edit";
  const currentImage = useCurrentImage();
  const canEdit = useCanEditProject();

  const showTools = view === "carousel" && currentImage != null;
  const disabled = !showTools || mode !== "edit" || !canEdit;

  const project = useProjectInfo();
  const session = useSession();

  const isVideo = currentImage && /\.(mp4|webm)$/i.test(currentImage.name || currentImage.url);

  const [open, setOpen] = useState<boolean>(false);
  const ownerParam = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share") ?? undefined;

  const clearTools = useClearProjectTools(
    session.user._id,
    project._id,
    session.token,
    ownerParam,
    shareId,
  );

  // The library grid uses the full workspace; tools appear beside an item
  // only after opening it in the carousel.
  if (view !== "carousel") return null;

  return (
    <fieldset
      key={disabled ? "read-only" : "editable"}
      disabled={disabled}
      inert={disabled}
      aria-label="Ferramentas de edição"
      className="flex h-full min-h-0 min-w-0 w-24 shrink-0 flex-col justify-between items-stretch overflow-y-auto border-r bg-background p-2 disabled:opacity-50"
    >
      {!showTools ? (
        <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
          Select an image or video to see its tools.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 items-center">
            <span className="text-sm text-gray-500">{isVideo ? "Video Tools" : "Tools"}</span>
            {isVideo ? (
              <>
                <VideoTrimTool disabled={disabled} />
                <VideoSubtitlesTool disabled={disabled} />
              </>
            ) : (
              <>
                <BrightnessTool disabled={disabled} />
                <ContrastTool disabled={disabled} />
                <SaturationTool disabled={disabled} />
                <BinarizationTool disabled={disabled} />
                <RotateTool disabled={disabled} />
                <CropTool disabled={disabled} />
                <ResizeTool disabled={disabled} />
                <BorderTool disabled={disabled} />
                <WatermarkTool disabled={disabled} />
                <BgRemovalAITool disabled={disabled} />
                <CropAITool disabled={disabled} />
                <ObjectAITool disabled={disabled} />
                <PeopleAITool disabled={disabled} />
                <TextAITool disabled={disabled} />
                <ExpandAITool disabled={disabled} />
                <UpgradeAITool disabled={disabled} />
                <AppliedToolsList />
              </>
            )}
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="text-red-400 size-8"
                disabled={disabled || project.tools.length === 0}
              >
                <Eraser />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear Tools?</DialogTitle>
                <DialogDescription>
                  This will remove <b>all</b> edits from the current project.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="destructive"
                  onClick={() => {
                    clearTools.mutate({
                      toolIds: project.tools.map((t) => t._id),
                      projectVersion: project.version,
                    });
                    setOpen(false);
                  }}
                >
                  Clear
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </fieldset>
  );
}
