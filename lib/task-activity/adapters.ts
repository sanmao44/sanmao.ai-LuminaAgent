import type { GenerationLog } from "@/lib/generation-log";
import type { UpscaleTask } from "@/lib/upscale-task-store";
import type { VideoTask } from "@/lib/video-task-store";
import type { ActivityTask, ActivityTaskKind, ActivityTaskStatus } from "./types";

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function generationKind(log: GenerationLog): ActivityTaskKind {
  if (log.mode === "video") return "video";
  if (log.mode === "upscale") return "upscale";
  if (log.mode === "agent" || log.mode === "llm") return "agent";
  if (log.mode === "generate" || log.mode === "edit") return "image";
  return "artifact";
}

function generationStatus(status: GenerationLog["status"]): ActivityTaskStatus {
  if (status === "pending") return "running";
  if (status === "success") return "succeeded";
  return "failed";
}

export function activityTaskFromGenerationLog(log: GenerationLog): ActivityTask {
  const kind = generationKind(log);
  const status = generationStatus(log.status);
  return {
    id: log.id,
    kind,
    status,
    ...(log.projectId ? { projectId: log.projectId } : {}),
    ...(log.chatId ? { chatId: log.chatId } : {}),
    ...(log.canvasId ? { canvasId: log.canvasId } : {}),
    ...(log.nodeId ? { nodeId: log.nodeId } : {}),
    ...(log.providerName ? { provider: log.providerName } : {}),
    ...(log.modelName ? { model: log.modelName } : {}),
    ...(log.createdAt ? { startedAt: Date.parse(log.createdAt) || undefined } : {}),
    ...(log.durationMs && log.createdAt ? { finishedAt: (Date.parse(log.createdAt) || 0) + log.durationMs } : {}),
    canRetry: status === "failed",
    canCancel: status === "running",
    ...(log.imageUrls?.length || log.videoUrls?.length ? { outputIds: [...(log.imageUrls || []), ...(log.videoUrls || [])] } : {}),
    ...(log.error ? { error: { ...(log.errorCode ? { code: log.errorCode } : {}), message: log.error } } : {}),
    sourceId: log.taskId || log.id,
  };
}

function videoStatus(status: VideoTask["status"]): ActivityTaskStatus {
  if (status === "pending") return "queued";
  if (status === "running") return "running";
  if (status === "done") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

export function activityTaskFromVideoTask(task: VideoTask): ActivityTask {
  const status = videoStatus(task.status);
  return {
    id: task.id,
    kind: "video",
    status,
    ...(task.projectId ? { projectId: task.projectId } : {}),
    ...(task.chatId ? { chatId: task.chatId } : {}),
    ...(task.canvasId ? { canvasId: task.canvasId } : {}),
    ...(task.nodeId ? { nodeId: task.nodeId } : {}),
    ...(task.providerId ? { provider: task.providerId } : {}),
    ...(task.modelName || task.modelId ? { model: task.modelName || task.modelId } : {}),
    ...(task.createdAt ? { startedAt: Date.parse(task.createdAt) || undefined } : {}),
    ...(task.completedAt ? { finishedAt: Date.parse(task.completedAt) || undefined } : {}),
    ...(typeof task.providerProgress === "number" ? { progress: Math.max(0, Math.min(100, task.providerProgress)) } : {}),
    ...(task.providerStatus ? { stage: task.providerStatus } : {}),
    canRetry: status === "failed",
    canCancel: status === "queued" || status === "running",
    ...(task.videoUrls.length ? { outputIds: task.videoUrls } : {}),
    ...(task.error ? { error: { ...(task.errorCode ? { code: task.errorCode } : {}), message: task.error } } : {}),
  };
}

function upscaleStatus(status: UpscaleTask["status"]): ActivityTaskStatus {
  if (status === "queued") return "queued";
  if (status === "processing") return "running";
  if (status === "succeeded") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

export function activityTaskFromUpscaleTask(task: UpscaleTask): ActivityTask {
  const status = upscaleStatus(task.status);
  return {
    id: task.id,
    kind: "upscale",
    status,
    ...(task.projectId ? { projectId: task.projectId } : {}),
    ...(task.chatId ? { chatId: task.chatId } : {}),
    ...(task.canvasId ? { canvasId: task.canvasId } : {}),
    ...(task.nodeId ? { nodeId: task.nodeId } : {}),
    provider: task.provider,
    model: task.model,
    ...(task.createdAt ? { startedAt: Date.parse(task.createdAt) || undefined } : {}),
    ...(task.completedAt ? { finishedAt: Date.parse(task.completedAt) || undefined } : {}),
    ...(task.localImageUrl ? { outputIds: [task.localImageUrl] } : {}),
    canRetry: status === "failed",
    canCancel: status === "queued" || status === "running",
    ...(task.error ? { error: { ...(task.errorCode ? { code: task.errorCode } : {}), message: task.error } } : {}),
  };
}

export function sortActivityTasks(tasks: readonly ActivityTask[]) {
  return [...tasks].sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0));
}
