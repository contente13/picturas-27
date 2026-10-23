import { api } from "./axios";

export type ProjectVideoPolicy = {
  ownerId: string;
  userType: "anonymous" | "free" | "premium";
  remainingOperations: number | null;
};

export async function fetchProjectVideoPolicy(
  ownerId: string, projectId: string, token: string, shareId?: string,
): Promise<ProjectVideoPolicy> {
  const { data } = await api.get<ProjectVideoPolicy>(`/projects/${ownerId}/${projectId}/video-policy`, {
    headers: { Authorization: `Bearer ${token}` },
    params: shareId ? { share: shareId } : undefined,
  });
  if (data.ownerId !== ownerId || !["anonymous", "free", "premium"].includes(data.userType)
    || (data.userType === "free" && (!Number.isInteger(data.remainingOperations) || data.remainingOperations! < 0))) {
    throw new Error("Não foi possível obter as condições do proprietário do projeto.");
  }
  return data;
}

export function validateProjectTrimDuration(duration: number, policy?: ProjectVideoPolicy): string | null {
  if (!policy) return "Aguarda pela consulta do perfil do proprietário do projeto.";
  const limit = policy.userType === "premium" ? 600 : 60;
  return duration > limit ? `O limite do perfil do proprietário é ${limit} segundos.` : null;
}
