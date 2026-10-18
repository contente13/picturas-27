import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Download, Trash } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Image from "next/image";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeleteProjectImages,
  useDownloadProjectImage,
} from "@/lib/mutations/projects";
import { useCurrentImage, useProjectInfo, useVideoTrim } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import type { ProjectImage as ProjectImageType } from "@/lib/projects";
import { useSearchParams } from "next/navigation";
import VideoThumbnail from "./video-thumbnail";
import { getErrorMessage } from "@/lib/error-messages";

interface ImageItemProps {
  image: ProjectImageType;
  animation?: boolean;
}

export function ProjectImage({ image, animation = true }: ImageItemProps) {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") ?? "edit";

  const [loaded, setLoaded] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);

  const isVideo = /\.(mp4|webm|mov|quicktime|m4v)$/i.test(image.name || image.url);

  const projectInfo = useProjectInfo();
  const currentImage = useCurrentImage();
  const { videoPlayerRef, videoSourceOverride, videoSubtitlePreview } = useVideoTrim();
  const { _id: pid, version } = projectInfo;
  const session = useSession();
  const ownerId = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share") ?? undefined;

  const deleteImage = useDeleteProjectImages(
    session.user._id,
    pid as string,
    session.token,
    ownerId,
    shareId,
  );
  const downloadImage = useDownloadProjectImage(mode === "results");
  const { toast } = useToast();

  if (!animation && isVideo) {
    const isActiveVideo = currentImage?._id === image._id;
    const sourceUrl = videoSourceOverride?.imageId === image._id
      ? videoSourceOverride.url
      : image.url;

    return (
      <div className="relative size-full flex flex-col items-center justify-center bg-black/95 rounded-xl p-4">
        <video
          ref={isActiveVideo ? videoPlayerRef : undefined}
          src={sourceUrl}
          controls
          playsInline
          className="min-h-0 max-h-full w-full max-w-4xl flex-1 object-contain rounded-lg shadow-2xl"
        />
        {isActiveVideo && videoSubtitlePreview?.imageId === image._id && videoSubtitlePreview.text && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 max-w-[85%] -translate-x-1/2 rounded bg-black/75 px-3 py-1.5 text-center text-base font-semibold text-white shadow-lg">
            {videoSubtitlePreview.text.split("\n").map((line, index) => <span className="block" key={index}>{line}</span>)}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded font-bold uppercase">VIDEO</span>
          <span>{videoSourceOverride?.imageId === image._id ? videoSourceOverride.name ?? image.name : image.name}</span>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ContextMenu>
        <ContextMenuTrigger>
          <Card className="group relative overflow-hidden size-full">
            {/* Image or Video Thumbnail */}
            <div className="size-full relative grid z-0 grid-cols-1 grid-rows-1 items-center justify-center bg-black/60">
              {isVideo ? (
                <VideoThumbnail image={image} animation={animation} />
              ) : (
                <>
                  <Image
                    src={image.url}
                    unoptimized
                    height={500}
                    width={500}
                    alt={image.name}
                    className={cn(
                      "size-full object-contain row-start-1 col-start-1 z-30",
                      animation && "transition-all group-hover:scale-105",
                    )}
                    priority
                    onLoad={() => setLoaded(true)}
                  />
                  <Image
                    src={image.url}
                    unoptimized
                    width={500}
                    height={500}
                    className="object-cover row-start-1 col-start-1 size-full z-10"
                    alt={image.name + " blurred"}
                  />
                  <div className="row-start-1 col-start-1 backdrop-blur-sm size-full bg-black/30 z-20" />
                  {!loaded && (
                    <>
                      <div className="row-start-1 col-start-1 z-40 bg-background size-full" />
                      <Skeleton className="size-full row-start-1 col-start-1 z-50" />
                    </>
                  )}
                </>
              )}
            </div>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
            {mode !== "results" && (
              <ContextMenuItem
                className="flex justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <span>Delete</span>
                <Trash className="size-4" />
              </ContextMenuItem>
            )}
          </DialogTrigger>
          <ContextMenuItem
            className="flex justify-between"
            onClick={(e) => {
              e.stopPropagation();
              downloadImage.mutate(
                {
                  imageUrl: image.url,
                  imageName: image.name,
                },
                {
                  onSuccess: () => {
                    toast({
                      title: `Image ${image.name} downloaded.`,
                    });
                  },
                  onError: (error) => {
                    const { title, description } = getErrorMessage("project-download", error);
                    toast({
                      title,
                      description,
                      variant: "destructive",
                    });
                  },
                },
              );
            }}
          >
            <span>Download</span>
            <Download className="size-4" />
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            onClick={(e) => {
              deleteImage.mutate(
                {
                  imageIds: [image._id],
                  projectVersion: projectInfo.version,
                },
                {
                  onSuccess: () => {
                    toast({
                      title: `Image ${image.name} deleted successfully.`,
                    });
                  },
                  onError: (error) => {
                    const { title, description } = getErrorMessage("project-delete", error);
                    toast({
                      title,
                      description,
                      variant: "destructive",
                    });
                  },
                },
              );
              setOpen(false);
              e.stopPropagation();
            }}
          >
            Permanently Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
