"use client";

import { useToast } from "@/hooks/use-toast";
import React, { useState } from "react";
import Dropzone from "react-dropzone";

interface CustomDropzoneProps {
  onDrop: (acceptedFiles: File[]) => void;
  children?: React.ReactNode;
  noClick?: boolean;
  dropzoneClassName?: string;
  borderless?: boolean;
}

export default function AppDropzone({
  onDrop,
  children,
  noClick = false,
  dropzoneClassName = "",
  borderless = false,
}: CustomDropzoneProps) {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const { toast } = useToast();

  return (
    <div className="h-full w-full flex flex-col">
      <Dropzone
        onDrop={onDrop}
        noClick={noClick}
        onDragEnter={() => setIsDragging(true)}
        onDragLeave={() => setIsDragging(false)}
        onDropAccepted={() => setIsDragging(false)}
        onDropRejected={() => {
          setIsDragging(false);
          toast({
            title: "Invalid file type!",
            description: "Please upload a .png, .jpeg, .jpg, .mp4, .webm, or .zip file",
            variant: "destructive",
          });
        }}
        accept={{
          "image/png": [".png"],
          "image/jpeg": [".jpeg", ".jpg"],
          "application/zip": [".zip"],
          "video/mp4": [".mp4"],
          "video/quicktime": [".mp4"],
          "video/x-m4v": [".mp4"],
          "video/webm": [".webm"],
          "application/octet-stream": [".mp4", ".webm"],
        }}
      >
        {({ getRootProps, getInputProps }) => (
          <div
            {...getRootProps()}
            className={`flex h-full w-full cursor-pointer items-center justify-center rounded-xl border-2 ${borderless ? "border-transparent" : "border-dashed"} ${dropzoneClassName} ${
              isDragging
                ? "border-primary bg-primary/10 text-primary"
                : borderless
                  ? "bg-transparent text-neutral-400"
                  : "border-neutral-400 hover:bg-sidebar text-neutral-400"
            } p-4 text-center transition-colors`}
          >
            <input {...getInputProps()} />
            {children}
          </div>
        )}
      </Dropzone>
    </div>
  );
}
