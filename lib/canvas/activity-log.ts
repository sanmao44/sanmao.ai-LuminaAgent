import type { GenerationLog } from "@/lib/generation-log";

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
  return kind === "llm" ? "LLM" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片";
}

export function generationLogStatusLabel(status: GenerationLog["status"]) {
  return status === "pending" ? "进行中" : status === "success" ? "成功" : "失败";
}

export function generationLogDuration(log: GenerationLog) {
  if (log.status === "pending") return "计时中";
  if (log.durationMs == null) return "未记录";
  return `${(log.durationMs / 1000).toFixed(1)}s`;
}

export function generationLogOutputUrls(log: GenerationLog) {
  const kind = generationLogKind(log);
  return kind === "video" ? log.videoUrls || [] : kind === "llm" ? [] : log.imageUrls || [];
}
