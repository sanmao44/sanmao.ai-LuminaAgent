import type { CanvasDocument } from "@/lib/canvas/types";

/**
 * Returns true when node changes can only affect layout geometry. Position and
 * size updates do not change reference inputs, so callers may skip expensive
 * media synchronization for this hot path.
 */
export function canvasNodesPositionOnly(
  previous: CanvasDocument,
  next: CanvasDocument,
) {
  if (next.nodes.length !== previous.nodes.length) return false;
  for (let index = 0; index < next.nodes.length; index += 1) {
    const before = previous.nodes[index];
    const after = next.nodes[index];
    if (before === after) continue;
    if (
      before.id !== after.id ||
      before.type !== after.type ||
      before.groupId !== after.groupId ||
      before.data !== after.data
    ) {
      return false;
    }
  }
  return true;
}
