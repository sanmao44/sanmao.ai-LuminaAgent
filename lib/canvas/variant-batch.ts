import type { CanvasVariantState } from "./types";
import { canvasVariantBatchStatus } from "./variant-status";

export type CanvasVariantBatchMode = "all" | "failed" | "pending";

export function canvasVideoTaskProgress(task: {
  status: string;
  progress?: number;
  videoUrls?: readonly string[];
  error?: string;
}) {
  const hasVideoResult = Array.isArray(task.videoUrls) && task.videoUrls.some(Boolean);
  const terminal = hasVideoResult || ["done", "failed", "cancelled", "canceled"].includes(task.status);
  const status = hasVideoResult || task.status === "done"
    ? ("completed" as const)
    : terminal
      ? ("failed" as const)
      : ("running" as const);
  return {
    hasVideoResult,
    terminal,
    status,
    progress: Number(task.progress || (status === "completed" ? 100 : 0)),
    url: task.videoUrls?.[0],
  };
}

export function prepareCanvasVariantBatch(
  requirements: readonly string[],
  currentStates: readonly CanvasVariantState[],
  retryIndices: readonly number[] | undefined,
  mode: CanvasVariantBatchMode,
  now = Date.now(),
) {
  const requested = retryIndices
    ? [...new Set(retryIndices)].filter(
        (index) =>
          index >= 0 &&
          index < requirements.length &&
          currentStates[index]?.status === (mode === "pending" ? "pending" : "failed"),
      )
    : requirements.map((_, index) => index);
  const isRetry = mode === "failed";
  const isResume = mode === "pending";
  const initialStates = currentStates.map((state, index) => {
    if (!requested.includes(index)) return state;
    return {
      ...state,
      instruction: requirements[index],
      status: "pending" as const,
      resultIds: isRetry || isResume ? state.resultIds : [],
      taskIds: isRetry || isResume ? state.taskIds : undefined,
      progress: 0,
      error: undefined,
      updatedAt: now,
    };
  });
  return { requested, initialStates, isRetry, isResume };
}

export function applyCanvasVariantStatePatch(
  states: readonly CanvasVariantState[],
  requirements: readonly string[],
  index: number,
  patch: Partial<CanvasVariantState>,
  now = Date.now(),
) {
  const nextStates = states.map((state, stateIndex) =>
    stateIndex === index
      ? {
          ...state,
          ...patch,
          instruction: requirements[stateIndex],
          updatedAt: now,
        }
      : state,
  );
  return {
    states: nextStates,
    status: canvasVariantBatchStatus(nextStates),
  };
}
