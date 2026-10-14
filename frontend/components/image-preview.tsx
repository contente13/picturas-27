import { useState, useEffect } from "react";
import Loading from "./loading";
import Image from "next/image";

const ImagePreview = ({
  file,
}: {
  file: { stream: () => ReadableStream; type?: string; name: string };
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null); // Explicitly define type

  useEffect(() => {
    const createBlobUrlFromStream = async () => {
      if (file.stream) {
        const stream = file.stream();
        // Cria o blob diretamente do stream
        const blob = await new Response(stream).blob();
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);

        return () => URL.revokeObjectURL(url);
      }
    };

    createBlobUrlFromStream();
  }, [file]);

  if (!blobUrl) return <Loading />;

  if (/\.(mp4|webm|mov|m4v)$/i.test(file.name) || file.type?.startsWith("video/")) {
    return (
      <div className="grid rounded-lg overflow-hidden shadow-md border size-full max-h-full bg-black">
        <video
          src={blobUrl}
          controls
          playsInline
          className="size-full max-h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className="grid rounded-lg overflow-hidden shadow-md border size-full max-h-full bg-background">
      <Image
        src={blobUrl}
        width={500}
        height={500}
        className="object-contain row-start-1 col-start-1 z-20 size-full"
        alt={file.name}
      />
      <Image
        src={blobUrl}
        width={500}
        height={500}
        className="object-cover row-start-1 col-start-1 size-full"
        alt={file.name}
      />
      <div className="row-start-1 col-start-1 backdrop-blur-sm z-10 size-full" />
      <p
        className="row-start-1 col-start-1 z-30 h-4 max-w-full w-fit bg-background rounded-br-md text-xs truncate line-clamp-1 px-1 flex items-center"
        title={file.name}
      >
        {file.name}
      </p>
    </div>
  );
};

export default ImagePreview;
