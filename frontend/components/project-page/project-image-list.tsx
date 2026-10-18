"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { useGetSocket } from "@/lib/queries/projects";
import { useCanEditProject, useCurrentImage, useProjectInfo, useVideoTrim } from "@/providers/project-provider";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../ui/dialog";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import * as ProjectTypes from "@/lib/projects";
import { ProjectImage } from "./project-image";
import { VideoTrimPanel } from "@/components/toolbar/video-trim-tool";
import { VideoSubtitlesPanel } from "@/components/toolbar/video-subtitles-tool";
import { useQueryClient } from "@tanstack/react-query";
import ProjectText from "./project-text";
import { getAiErrorMessage, getErrorMessage } from "@/lib/error-messages";
import { usePreview } from "@/providers/project-provider";
import AppDropzone from "@/components/app-dropzone";
import { useAddProjectImages } from "@/lib/mutations/projects";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Check, Film } from "lucide-react";
import { useConcatTask } from "@/hooks/use-concat-task";
import type { ConcatTask } from "@/lib/video-concat";
import VideoConcatDialog from "./video-concat-dialog";
import VideoSelectionBar from "./video-selection-bar";

export function ProjectImageList({
  setCurrentImageId,
  results,
}: {
  setCurrentImageId: (img: ProjectTypes.ProjectImage | null) => void;
  results: {
    imgs: ProjectTypes.ProjectImage[];
    texts: ProjectTypes.ProjectImageText[];
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "grid";
  const mode = searchParams.get("mode") ?? "edit";
  const owner = searchParams.get("owner");
  const share = searchParams.get("share");  

  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [jumpTo, setJumpTo] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string[] | null>(null);
  const [mediaFilter, setMediaFilter] = useState("all");
  // UC-VID-003: videos selected for "Juntar vídeos", in selection order.
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<ProjectTypes.ProjectImage[]>([]);
  const [concatOpen, setConcatOpen] = useState(false);

  const project = useProjectInfo();
  const currentImage = useCurrentImage();
  const canEdit = useCanEditProject();
  const { videoTrimOpen, videoSubtitlesOpen } = useVideoTrim();
  const session = useSession();
  const { toast } = useToast();
  const preview = usePreview();
  const addProjectMedia = useAddProjectImages(
    session.user._id,
    project._id,
    session.token,
    owner ?? undefined,
    share ?? undefined,
  );

  const qc = useQueryClient();
  const socket = useGetSocket(session.token);
  const concat = useConcatTask(
    { ownerId: owner ?? session.user._id, projectId: project._id, token: session.token, shareId: share },
    (task: ConcatTask) => {
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["projectImages"] });
      window.dispatchEvent(new Event("session-updated"));
      if (task.estado === "CONCLUIDA") toast({ title: "Vídeos juntos", description: `${task.recursoSaida ?? "O novo vídeo"} foi guardado no projeto.` });
      else if (task.estado === "FALHADA") toast({ title: "A junção falhou", description: task.erro ?? undefined, variant: "destructive" });
    },
  );

  // Video edits are saved as project media, while image processing returns a
  // separate result. Keep every project item visible in preview in either case.
  const carouselImages = useMemo(() => {
    if (mode !== "results") return project.imgs;
    const resultsById = new Map(results.imgs.map((image) => [image._id, image]));
    return project.imgs.map((image) => resultsById.get(image._id) ?? image);
  }, [mode, project.imgs, results.imgs]);
  const carouselTexts = mode === "results" ? results.texts : [];
  const count = carouselImages.length + carouselTexts.length;

  const showVideoPanel = Boolean(
    view === "carousel" &&
      mode === "edit" &&
          (videoTrimOpen || videoSubtitlesOpen) &&
      currentImage?.url &&
      /\.(mp4|webm)$/i.test(currentImage.name || currentImage.url),
  );


useEffect(() => {
  let active = true;

  if (active && socket.data) {
    socket.data.on("preview-error", (msg: string) => {
      if (!active) return;

      try {
        const msg_content = JSON.parse(msg) as {
          error_code?: number;
          error_msg?: string;
        };

        const error_code = msg_content.error_code;
        const error_msg = msg_content.error_msg;

        console.error("preview-error", error_code, error_msg);

        const { title, description } = getAiErrorMessage(
          error_code,
          error_msg,
        );

        toast({
          title,
          description,
          variant: "destructive",
        });
      } catch (e) {

        const { title, description } = getAiErrorMessage();
        toast({
          title,
          description,
          variant: "destructive",
        });
      } finally {
          // preview falhou → limpa o estado de preview “em curso”
          preview.setWaiting("");
      }
    });

      socket.data.on("preview-ready", (msg: string) => {
        if (active) {
          const msg_content = JSON.parse(msg) as {
            imageUrl: string;
            textResults: string[];
          };
          const url = msg_content.imageUrl;
          const textResults = msg_content.textResults;
          setPreviewImage(url);
          setPreviewText(textResults);
          setPreviewOpen(true);
        }
      });
    }

    return () => {
      active = false;
      if (socket.data) {
        socket.data.off("preview-error");
        socket.data.off("preview-ready");
      }
    };
  }, [socket.data, toast]);

  useEffect(() => {
    if (view === "grid" || count === 0) {
      setApi(undefined);
      setJumpTo(null);
    }
    if (count === 0) {
      setCurrent(0);
      setCurrentImageId(null);
    }
  }, [view, count, setCurrentImageId]);

  useEffect(() => {
    if (!api || view !== "carousel" || count === 0) return;

    const handleSelect = () => {
      const index = api.selectedScrollSnap();
      setCurrent(count === 0 ? 0 : Math.min(index + 1, count));
      setCurrentImageId(carouselImages[index] ?? null);
    };

    api.on("select", handleSelect);
    api.on("reInit", handleSelect);
    api.reInit();

    if (jumpTo !== null) {
      api.scrollTo(Math.max(0, Math.min(jumpTo, count - 1)), true);
      setJumpTo(null);
    }
    handleSelect();

    return () => {
      api.off("select", handleSelect);
      api.off("reInit", handleSelect);
    };
  }, [api, view, jumpTo, carouselImages, count, setCurrentImageId]);

  const isVideo = (image: ProjectTypes.ProjectImage) =>
    image.mediaMetadata?.format === "mp4" ||
    image.mediaMetadata?.format === "webm" ||
    /\.(mp4|webm|mov|m4v)$/i.test(image.name || image.url);
  const videoImages = project.imgs.filter(isVideo);

  // Keep the selected items in sync with the project (fresh URLs, removed videos dropped).
  useEffect(() => {
    setSelection((current) => {
      const next = current.flatMap((item) => project.imgs.filter((image) => image._id === item._id));
      return next.length === current.length && next.every((image, index) => image === current[index]) ? current : next;
    });
  }, [project.imgs]);

  const toggleSelected = (image: ProjectTypes.ProjectImage) => {
    setSelection((current) => current.some((item) => item._id === image._id)
      ? current.filter((item) => item._id !== image._id)
      : [...current, image]);
  };

  const openImage = (image: ProjectTypes.ProjectImage) => {
    setCurrentImageId(image);
    setJumpTo(carouselImages.findIndex((item) => item._id === image._id));
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("view", "carousel");
    if (owner) params.set("owner", owner);
    if (share) params.set("share", share);
    router.push(`?${params.toString()}`);
    qc.invalidateQueries({ queryKey: ["socket"], refetchType: "all" });
  };

  // An active concatenation always opens with the sequence it is processing.
  const startNewConcat = () => {
    if (concat.active) {
      showRunningConcat();
      return;
    }
    concat.dismiss();
    setConcatOpen(true);
  };

  // FA9: "ver" on a running concatenation shows its progress with the sequence it is joining.
  const showRunningConcat = () => {
    if (concat.task?.imageIds?.length) {
      setSelection(concat.task.imageIds.flatMap((id) => project.imgs.filter((image) => image._id === id)));
    }
    setConcatOpen(true);
  };

  const openConcatResult = (imageId: string) => {
    const result = project.imgs.find((image) => image._id === imageId);
    if (!result) {
      toast({ title: "A atualizar a biblioteca", description: "O novo vídeo aparece no projeto dentro de instantes." });
      qc.invalidateQueries({ queryKey: ["project"] });
      return;
    }
    setConcatOpen(false);
    setSelecting(false);
    openImage(result);
  };
  const photoImages = project.imgs.filter((image) => !isVideo(image));
  const gridImages =
    mode === "results"
      ? carouselImages
      : mediaFilter === "videos"
        ? videoImages
        : mediaFilter === "images"
          ? photoImages
          : project.imgs;

  const handleGridDrop = (files: File[]) => {
    if (!canEdit || files.length === 0) return;
    addProjectMedia.mutate(
      { images: files, projectVersion: project.version },
      {
        onSuccess: (result) => {
          const uploadedNames = result.succeeded.map((file) => file.name).join(", ") || "none";
          const failureDetails = result.failed
            .map(({ file, message }) => `${file.name}: ${message}`)
            .join("; ");
          toast({
            title: result.failed.length > 0
              ? `${result.succeeded.length} uploaded; ${result.failed.length} failed`
              : "Media added successfully.",
            description: result.failed.length > 0
              ? `Uploaded: ${uploadedNames}. Failed: ${failureDetails}`
              : uploadedNames,
            variant: result.failed.length > 0 ? "destructive" : undefined,
          });
        },
        onError: (error) => {
          const { title, description } = getErrorMessage("project-upload", error);
          toast({ title, description, variant: "destructive" });
        },
      },
    );
  };

  const gridContent = (
    <div className="size-full flex flex-col items-center">
      {count > 0 ? (
        <>
          {mode !== "results" && (
            <div className="relative pt-4 pb-2 text-gray-500 text-sm after:h-2 after:bg-gradient-to-b after:from-background after:to-background/10 after:w-full after:absolute after:bottom-0 after:translate-y-2 after:z-50 w-full text-center flex flex-col">
              Select an image or video from the grid to view it. Drop media here to add it to the project.
            </div>
          )}
          {mode === "edit" && project.imgs.length > 0 && (
            <div className="flex w-full flex-wrap items-center justify-between gap-2 px-2 pt-3">
              <Tabs value={mediaFilter} onValueChange={setMediaFilter}>
                <TabsList>
                  <TabsTrigger value="all">All ({project.imgs.length})</TabsTrigger>
                  <TabsTrigger value="images">Images ({photoImages.length})</TabsTrigger>
                  <TabsTrigger value="videos">Videos ({videoImages.length})</TabsTrigger>
                </TabsList>
              </Tabs>
              {canEdit && videoImages.length > 0 && !selecting && (
                <Button size="sm" variant="outline" onClick={() => { setSelecting(true); setMediaFilter("videos"); }}>
                  <Film className="mr-1 size-4" />Selecionar vídeos para juntar
                </Button>
              )}
            </div>
          )}
          {gridImages.length > 0 || (mode === "results" && results.texts.length > 0) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 p-2 overflow-scroll overflow-x-hidden h-fit w-full">
              {gridImages.map((image) => {
                const order = selection.findIndex((item) => item._id === image._id);
                const selectable = selecting && isVideo(image);
                return (
                  <button
                    key={image._id}
                    className={`relative aspect-square ${selecting && !selectable ? "pointer-events-none opacity-40" : ""}`}
                    aria-pressed={selecting ? order >= 0 : undefined}
                    onClick={() => (selecting ? selectable && toggleSelected(image) : openImage(image))}
                  >
                    <ProjectImage image={image} />
                    {selectable && (
                      <span className={`absolute bottom-10 right-2 z-40 flex size-7 items-center justify-center rounded-full border-2 text-sm font-bold shadow ${order >= 0 ? "border-primary bg-primary text-primary-foreground" : "border-white bg-black/50 text-transparent"}`}>
                        {order >= 0 ? order + 1 : <Check className="size-4" />}
                      </span>
                    )}
                  </button>
                );
              })}
              {mode === "results" &&
                results.texts.map((text, index) => (
                  <button
                    key={text._id + index}
                    className="aspect-square"
                    onClick={() => {
                      setJumpTo(carouselImages.length + index);

                      const params = new URLSearchParams();
                      params.set("mode", mode);
                      params.set("view", "carousel");
                      if (owner) params.set("owner", owner);
                      if (share) params.set("share", share);

                      router.push(`?${params.toString()}`);
                      qc.invalidateQueries({ queryKey: ["socket"], refetchType: "all" });
                    }}
                  >
                    <ProjectText text={text.text} />
                  </button>
                ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-gray-500">
              {mediaFilter === "videos" ? "No videos in this project yet." : "No images in this project yet."}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <p className="text-gray-500 text-xl">
            {mode === "results"
              ? "No results found. Apply your changes and try again."
              : "Add images or videos to this project to get started."}
          </p>
          {mode === "edit" && canEdit && (
            <p className="mt-2 text-sm text-muted-foreground">Drop an image or MP4/WebM video anywhere in this area, or choose Add Media.</p>
          )}
        </div>
      )}
      {mode === "edit" && (
        <>
          <VideoSelectionBar
            selecting={selecting}
            selectedCount={selection.length}
            onJoin={startNewConcat}
            onCancelSelection={() => { setSelecting(false); setSelection([]); }}
            concatActive={concat.active}
            concatProgress={concat.task?.progresso}
            onShowConcat={showRunningConcat}
          />
          <VideoConcatDialog
            open={concatOpen}
            onOpenChange={setConcatOpen}
            context={{ ownerId: owner ?? session.user._id, projectId: project._id, token: session.token, shareId: share }}
            sequence={selection}
            onSequenceChange={setSelection}
            projectVideos={videoImages}
            concat={concat}
            userType={session.user.type}
            remainingOperations={session.user.remaining_operations}
            onOpenResult={openConcatResult}
          />
        </>
      )}
    </div>
  );

  return (
    <Dialog
      open={previewOpen}
      onOpenChange={() => {
        setPreviewOpen(false);
        setPreviewImage(null);
      }}
    >
      <div className={showVideoPanel ? "h-full min-h-0 min-w-0 flex-1 overflow-y-auto flex flex-col" : "h-full min-w-0 flex-1"}>
        {view === "grid" || count === 0 ? (
          mode === "edit" && canEdit ? (
            <AppDropzone
              onDrop={handleGridDrop}
              noClick
              borderless={project.imgs.length > 0}
              dropzoneClassName={project.imgs.length === 0 ? "min-h-[55vh]" : ""}
            >
              {gridContent}
            </AppDropzone>
          ) : (
            gridContent
          )
        ) : (
          // Carousel view
          <>
            <div className={showVideoPanel ? "w-full shrink-0 px-2 sm:px-10 py-2" : "size-full px-2 sm:px-16 py-2"}>
              <Carousel setApi={setApi}>
                <CarouselContent
                  className="aspect-auto h-[calc(100vh-99px-0.5rem-36px)] xl:h-[calc(100vh-55px-0.5rem-36px)]"
                  style={showVideoPanel ? { height: "min(52vh, 560px)" } : undefined}
                >
                  {carouselImages.map((image) => (
                    <CarouselItem key={image._id}>
                      <ProjectImage image={image} animation={false} />
                    </CarouselItem>
                  ))}
                  {carouselTexts.map((text) => (
                    <CarouselItem key={`text-${text._id}-${text.name}`}>
                      <ProjectText text={text.text} />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="hidden sm:flex" />
                <CarouselNext className="hidden sm:flex" />
              </Carousel>
              <div className="py-2 text-center text-sm text-muted-foreground">
                {Math.min(Math.max(current, 1), count)} / {count}
              </div>
            </div>
            {showVideoPanel && videoTrimOpen && <VideoTrimPanel disabled={!canEdit} />}
            {showVideoPanel && videoSubtitlesOpen && <VideoSubtitlesPanel disabled={!canEdit} />}
          </>
        )}
      </div>
      <DialogContent className="max-w-[80%] mt-4 overflow-y-scroll overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Image Preview</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center items-center">
          {previewImage && (
            <Image
              src={previewImage}
              width={500}
              height={500}
              className={`object-contain rounded-md w-full ${previewText ? "max-h-[60vh]" : "max-h-[80vh]"}`}
              alt="Preview"
              unoptimized
            />
          )}
        </div>
        {previewText && previewText.length > 0 && (
          <DialogFooter>
            <div className="flex flex-col gap-2 w-full h-96">
              {previewText.map((text, index) => (
                <iframe
                  src={text}
                  key={index}
                  className="text-sm text-center font-medium size-full"
                />
              ))}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
