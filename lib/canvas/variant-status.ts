import type { CanvasNodeData, CanvasVariantState } from "./types";

/** Resolve the aggregate status for a batch of canvas variant requests. */
export function canvasVariantBatchStatus(
  states: CanvasVariantState[],
): Extract<CanvasNodeData["status"], "queued" | "running" | "completed" | "failed"> {
  if (states.some((state) => state.status === "running")) return "running";
  if (states.some((state) => state.status === "failed")) return "failed";
  if (states.length && states.every((state) => state.status === "completed")) {
    return "completed";
  }
  return "queued";
}
