import type { GenerationLog } from "@/lib/generation-log";
import type { CanvasNode } from "@/lib/canvas/types";

export type CanvasGenerationLogKind = "image" | "video" | "audio" | "llm";

export const CANVAS_TASK_STALE_AFTER_MS = 15 * 60 * 1000;

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

export type CanvasActivityEmptyState = {
  title: string;
  detail: string;
  taskScope: "project" | "all" | null;
};

export function deriveCanvasActivityEmptyState(
  scopedTaskCount: number,
  totalTaskCount: number,
): CanvasActivityEmptyState {
  if (scopedTaskCount > 0) {
    return {
      title: "本次会话暂无独立画布操作",
      detail: `当前项目有 ${scopedTaskCount} 条创作任务记录，可在任务视图查看结果与恢复操作。`,
      taskScope: "project",
    };
  }

  if (totalTaskCount > 0) {
    return {
      title: "本项目暂无画布操作记录",
      detail: `其他项目有 ${totalTaskCount} 条创作任务记录，可切换范围查看。`,
      taskScope: "all",
    };
  }

  return {
    title: "暂无活动记录",
    detail: "生成历史会显示在任务视图；导入素材或整理画布后的操作会记录在这里。",
    taskScope: null,
  };
}

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
  log: Pick<GenerationLog, "id" | "projectId" | "canvasId" | "nodeId" | "taskId">,
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
  const taskId = String(log.taskId || log.id || "").trim();
  return Boolean(
    (projectId && log.projectId === projectId) ||
    (canvasId && log.canvasId === canvasId) ||
    (nodeId && scope.nodeIds?.has(nodeId)) ||
    (taskId && scope.taskIds?.has(taskId)),
  );
}

/** Project persisted Canvas failures that have no matching server task log. */
export function canvasFailureTaskLogs(
  logs: readonly GenerationLog[],
  nodes: readonly CanvasNode[],
  scope: { projectId?: string; canvasId?: string } = {},
): GenerationLog[] {
  const loggedTaskIds = new Set(logs.flatMap((log) => [log.id, log.taskId || ""]));
  const loggedNodeIds = new Set(logs.map((log) => String(log.nodeId || "").trim()).filter(Boolean));

  return nodes.flatMap((node) => {
    const data = node.data;
    if (data.status !== "failed" || data.taskTracking === "stale" || data.taskTracking === "stopped" || data.url) return [];
    if (loggedNodeIds.has(node.id)) return [];

    const taskId = String(data.generation?.taskId || data.jobId || data.upscaleRequestId || "").trim();
    if (taskId && loggedTaskIds.has(taskId)) return [];

    const id = taskId || `canvas-node-failure-${node.id}`;
    const createdAtValue = data.generation?.createdAt || data.speechGeneration?.createdAt || data.processingStartedAt || data.taskUpdatedAt || 0;
    const createdAt = new Date(Number(createdAtValue) || 0).toISOString();
    const kind = data.kind === "video" || data.kind === "audio" ? data.kind : node.type === "upscale" ? "image" : data.kind || "image";
    const mode: GenerationLog["mode"] = node.type === "prompt"
      ? "agent"
      : node.type === "upscale" || data.generation?.operation === "upscale"
        ? "upscale"
        : kind === "video" || kind === "audio"
          ? kind
          : data.generation?.operation === "edit" ? "edit" : "generate";
    const prompt = String(data.generation?.prompt || data.agentPrompt || data.prompt || data.text || data.name || "").trim();

    return [{
      id,
      taskId: id,
      createdAt,
      status: "error",
      mode,
      ...(node.type === "prompt" ? { taskKind: "llm" as const } : {}),
      ...(kind === "image" || kind === "video" || kind === "audio" ? { mediaKind: kind } : {}),
      source: "canvas",
      prompt,
      ...(data.generation?.operation ? { operation: data.generation.operation === "upscale" ? "generate" as const : data.generation.operation } : {}),
      ...(data.model || data.generation?.params?.model ? { modelName: data.model || data.generation?.params?.model } : {}),
      ...(data.providerName ? { providerName: data.providerName } : {}),
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(scope.canvasId ? { canvasId: scope.canvasId } : {}),
      nodeId: node.id,
      ...(data.generation?.durationMs ? { durationMs: data.generation.durationMs } : {}),
      error: data.statusLabel || "画布任务失败",
    }];
  });
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
    status?: "all" | GenerationLog["status"] | "recoverable" | "attention";
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
        : filters.status === "attention"
          ? generationLogNeedsAttention(log)
          : filters.status === "pending"
            ? generationLogDisplayStatus(log) === "pending" && !generationLogNeedsAttention(log)
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

export function generationLogNeedsAttention(
  log: Pick<GenerationLog, "status" | "errorCode" | "createdAt">,
  now = Date.now(),
) {
  if (displayGenerationLogStatus(log) !== "pending") return false;
  const createdAt = Date.parse(log.createdAt);
  return Number.isFinite(createdAt) && now - createdAt >= CANVAS_TASK_STALE_AFTER_MS;
}

export function generationLogDuration(log: GenerationLog, now = Date.now()) {
  if (displayGenerationLogStatus(log) === "pending") {
    if (!generationLogNeedsAttention(log, now)) return "计时中";
    const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(log.createdAt)) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    const elapsed = hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `等待 ${elapsed}`;
  }
  if (log.durationMs == null) return "未记录";
  return `${(log.durationMs / 1000).toFixed(1)}s`;
}

export function generationLogOutputUrls(log: GenerationLog) {
  const kind = generationLogKind(log);
  return kind === "video" ? log.videoUrls || [] : kind === "llm" || kind === "audio" ? [] : log.imageUrls || [];
}
