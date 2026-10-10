import {
  canvasBoundsIntersect,
  canvasViewportWorldBounds,
  type CanvasViewportBounds,
} from "./viewport";
import { groupBounds, nodeSize } from "./model";
import type { CanvasDocument, CanvasGroup, CanvasNode } from "./types";

export type CanvasVisibilityStage = { width: number; height: number };

/**
 * Project only cards that can contribute pixels to the current viewport.
 * Selected and actively dragged cards are retained even when they cross the
 * overscan boundary so selection and pointer gestures never lose their target.
 */
export function visibleCanvasNodeProjection(
  document: CanvasDocument,
  nodes: readonly CanvasNode[],
  stage: CanvasVisibilityStage,
  selectedIds: ReadonlySet<string>,
  draggingNodeIds: ReadonlySet<string>,
  overscan = 560,
): CanvasNode[] {
  const viewport = canvasViewportWorldBounds(document.camera, stage, overscan);
  return nodes.filter((node) =>
    selectedIds.has(node.id) ||
    draggingNodeIds.has(node.id) ||
    canvasBoundsIntersect(
      { x: node.x, y: node.y, ...nodeSize(node) },
      viewport,
    ),
  );
}

export function visibleCanvasGroupProjection(
  document: CanvasDocument,
  groups: readonly CanvasGroup[],
  stage: CanvasVisibilityStage,
  selectedGroupId: string | null,
  selectedIds: ReadonlySet<string>,
  draggingNodeIds: ReadonlySet<string>,
  overscan = 560,
): CanvasGroup[] {
  const viewport = canvasViewportWorldBounds(document.camera, stage, overscan);
  return groups.filter((group) =>
    group.id === selectedGroupId ||
    group.nodeIds.some((id) => selectedIds.has(id) || draggingNodeIds.has(id)) ||
    canvasBoundsIntersect({
      ...groupBounds(document, group.id),
    }, viewport),
  );
}

/** Shared pure predicate for group layers and future spatial indexes. */
export function isCanvasEntityVisible(
  bounds: CanvasViewportBounds,
  viewport: CanvasViewportBounds,
): boolean {
  return canvasBoundsIntersect(bounds, viewport);
}
