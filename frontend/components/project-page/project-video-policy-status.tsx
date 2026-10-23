"use client";

import { useProjectVideoPolicy } from "@/providers/project-provider";

export default function ProjectVideoPolicyStatus() {
  const { policy, isError, retry } = useProjectVideoPolicy();
  if (policy) return null;
  return <p role="status" className="mb-3 text-xs text-muted-foreground">
    {isError ? <>Não foi possível consultar o perfil e a quota do proprietário. <button type="button" className="underline" onClick={retry}>Tentar novamente</button></>
      : "A consultar o perfil e a quota do proprietário…"}
  </p>;
}
