import type { CanvasTaskNextAction } from "@/lib/canvas/task-next-action";
import type { CanvasProjectProgressAction } from "@/lib/canvas/project-progress";

export type CanvasWorkspaceRecommendation =
  | { kind: "task"; title: string; detail: string; buttonLabel: string; filter: "pending" | "error" | "recoverable" }
  | { kind: "project"; title: string; detail: string; action: CanvasProjectProgressAction };

export function deriveCanvasWorkspaceRecommendation(
  projectAction: CanvasProjectProgressAction,
  taskAction: CanvasTaskNextAction,
): CanvasWorkspaceRecommendation {
  if (taskAction.kind !== "ready" && taskAction.filter) {
    return {
      kind: "task",
      title: taskAction.title,
      detail: taskAction.detail,
      buttonLabel: taskAction.buttonLabel,
      filter: taskAction.filter,
    };
  }

  return {
    kind: "project",
    title: projectAction.label,
    detail: projectAction.detail,
    action: projectAction,
  };
}
