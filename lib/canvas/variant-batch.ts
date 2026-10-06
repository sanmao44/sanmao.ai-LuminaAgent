import type { CanvasVariantState } from "./types";
import { canvasVariantBatchStatus } from "./variant-status";

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
