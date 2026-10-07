import type { GenerationLog } from "@/lib/generation-log";
import { projectResultStatus, usableResultUrls } from "@/lib/task-result-projection";

export type CanvasGenerationLogKind = "image" | "video" | "audio" | "llm";

export type CanvasActivityLog = {
  id: string;
  message: string;
  createdAt: string;
  type: "canvas" | "generation" | "agent" | "asset" | "project" | "system";
  status: "ok" | "error";
};

export function generationLogKind(log: GenerationLog): CanvasGenerationLogKind {
  if (log.taskKind === "llm" || log.mode === "llm") return "llm";
  if (log.mediaKind) return log.mediaKind;
  if (log.mode === "video") return "video";
  if (log.mode === "audio") return "audio";
  return "image";
}

export function generationLogKindLabel(log: GenerationLog) {
  const kind = generationLogKind(log);
  return kind === "llm" ? "LLM" : kind === "video" ? "??" : kind === "audio" ? "??" : "??";
}

export function generationLogStatusLabel(status: GenerationLog["status"]) {
  return status === "pending" ? "???" : status === "success" ? "??" : "??";
}

export function generationLogDuration(log: GenerationLog) {
  if (log.status === "pending") return "???";
  if (!log.durationMs) return "?";
  return `${(log.durationMs / 1000).toFixed(1)}s`;
}

export function generationLogOutputUrls(log: GenerationLog) {
  const kind = generationLogKind(log);
  return kind === "video" ? usableResultUrls(log.videoUrls) : kind === "llm" ? [] : usableResultUrls(log.imageUrls);
}

export function projectCanvasGenerationLog(log: GenerationLog): GenerationLog {
  const outputUrls = [...usableResultUrls(log.imageUrls), ...usableResultUrls(log.videoUrls)];
  const status = projectResultStatus(log.status, outputUrls);
  return status === "success" && (log.status !== "success" || log.error)
    ? { ...log, status: "success", error: undefined }
    : log;
}
