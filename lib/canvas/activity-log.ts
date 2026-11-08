import type { GenerationLog } from "@/lib/generation-log";

export type CanvasGenerationLogKind = "image" | "video" | "audio" | "llm";

export type CanvasActivityLog = {
  id: string;
  message: string;
  createdAt: string;
  type: "canvas" | "generation" | "agent" | "asset" | "project" | "system";
  status: "ok" | "error";
  /** Optional navigation target captured when the activity is created. */
  taskId?: string;
  nodeId?: string;
};

export type CanvasActivityTarget = Pick<CanvasActivityLog, "taskId" | "nodeId">;

export function canvasActivityTarget(log: Pick<CanvasActivityLog, "taskId" | "nodeId">): CanvasActivityTarget | null {
  const taskId = String(log.taskId || "").trim();
  const nodeId = String(log.nodeId || "").trim();
  return taskId || nodeId ? { ...(taskId ? { taskId } : {}), ...(nodeId ? { nodeId } : {}) } : null;
}

export type CanvasActivityNavigation =
  | { kind: "node"; nodeId: string }
  | { kind: "task"; log: GenerationLog }
  | { kind: "none" };

export function resolveCanvasActivityNavigation(
  activity: Pick<CanvasActivityLog, "taskId" | "nodeId">,
  taskLogs: GenerationLog[],
): CanvasActivityNavigation {
  const target = canvasActivityTarget(activity);
  if (target?.nodeId) return { kind: "node", nodeId: target.nodeId };
  if (target?.taskId) {
    const log = taskLogs.find((item) => String(item.taskId || item.id).trim() === target.taskId);
    if (log) return { kind: "task", log };
  }
  return { kind: "none" };
}

export function canvasTaskBelongsToProject(
  log: Pick<GenerationLog, "projectId" | "canvasId" | "nodeId" | "taskId">,
  scope: {
    projectId?: string;
    canvasId?: string;
    nodeIds?: ReadonlySet<string>;
    taskIds?: ReadonlySet<string>;
  },
) {
  const projectId = scope.projectId?.trim();
  const canvasId = scope.canvasId?.trim();
  const nodeId = String(log.nodeId || "").trim();
  const taskId = String(log.taskId || "").trim();
  return Boolean(
    (projectId && log.projectId === projectId) ||
    (canvasId && log.canvasId === canvasId) ||
    (nodeId && scope.nodeIds?.has(nodeId)) ||
    (taskId && scope.taskIds?.has(taskId)),
  );
}

export function generationLogKind(log: GenerationLog): CanvasGenerationLogKind {
  if (log.taskKind === "llm" || log.mode === "llm") return "llm";
  if (log.mediaKind) return log.mediaKind;
  if (log.mode === "video") return "video";
  if (log.mode === "audio") return "audio";
  return "image";
}

export function filterCanvasGenerationLogs(
  logs: GenerationLog[],
  filters: {
    status?: "all" | GenerationLog["status"] | "recoverable";
    media?: "all" | CanvasGenerationLogKind;
    query?: string;
    recoverableTaskIds?: ReadonlySet<string>;
  },
) {
  const normalized = filters.query?.trim().toLowerCase() || "";
  return logs.filter((log) => {
    const matchesStatus = !filters.status || filters.status === "all"
      || (filters.status === "recoverable"
        ? filters.recoverableTaskIds?.has(log.id) === true
        : generationLogDisplayStatus(log) === filters.status);
    const matchesMedia = !filters.media || filters.media === "all" || generationLogKind(log) === filters.media;
    const matchesQuery = !normalized
      || `${log.prompt} ${log.presetName || ""} ${log.modelName || ""} ${log.providerName || ""}`
        .toLowerCase()
        .includes(normalized);
    return matchesStatus && matchesMedia && matchesQuery;
  });
}

export function generationLogKindLabel(log: GenerationLog) {
  const kind = generationLogKind(log);
  return kind === "llm" ? "LLM" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片";
}

export function generationLogStatusLabel(status: GenerationLog["status"]) {
  return status === "pending" ? "进行中" : status === "success" ? "成功" : "失败";
}

export function displayGenerationLogStatus<T extends string>(
  log: { status: T; errorCode?: string },
): T | "pending";
export function displayGenerationLogStatus<T extends string>(
  log: { status?: T; errorCode?: string },
): T | "pending" | undefined;
export function displayGenerationLogStatus<T extends string>(
  log: { status?: T; errorCode?: string },
): T | "pending" | undefined {
  return log.status === "error" && log.errorCode === "provider_result_unconfirmed"
    ? "pending"
    : log.status;
}

export function generationLogDisplayStatus(log: Pick<GenerationLog, "status" | "errorCode">): GenerationLog["status"] {
  return displayGenerationLogStatus(log);
}

export function generationLogDuration(log: GenerationLog) {
  if (displayGenerationLogStatus(log) === "pending") return "计时中";
  if (log.durationMs == null) return "未记录";
  return `${(log.durationMs / 1000).toFixed(1)}s`;
}

export function generationLogOutputUrls(log: GenerationLog) {
  const kind = generationLogKind(log);
  return kind === "video" ? log.videoUrls || [] : kind === "llm" || kind === "audio" ? [] : log.imageUrls || [];
}
