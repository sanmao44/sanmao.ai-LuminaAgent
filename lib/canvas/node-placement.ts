import { nodeSize } from "./model";
import type { CanvasNode } from "./types";
import type { CanvasViewportPoint } from "./viewport";

export type CanvasPlacementPoint = CanvasViewportPoint;

type CanvasPlacementRect = CanvasPlacementPoint & {
  w: number;
  h: number;
};

function rectanglesOverlap(
  first: CanvasPlacementRect,
  second: CanvasPlacementRect,
  gap = 28,
) {
  return (
    first.x < second.x + second.w + gap &&
    first.x + first.w + gap > second.x &&
    first.y < second.y + second.h + gap &&
    first.y + first.h + gap > second.y
  );
}

/** Find the first open point around an anchor without overlapping occupied nodes. */
export function findCanvasNodePlacement(
  position: CanvasPlacementPoint,
  node: CanvasNode,
  occupiedNodes: readonly CanvasNode[],
) {
  const size = nodeSize(node);
  const candidates: CanvasPlacementPoint[] = [{ x: position.x, y: position.y }];
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ];
  for (let ring = 1; ring <= 32; ring += 1) {
    const distance = 70 + ring * 30;
    directions.forEach((direction) =>
      candidates.push({
        x: position.x + direction.x * distance,
        y: position.y + direction.y * distance,
      }),
    );
  }
  const occupied = occupiedNodes.map((item) => {
    const metric = nodeSize(item);
    return { x: item.x, y: item.y, w: metric.w, h: metric.h };
  });
  return (
    candidates.find(
      (candidate) =>
        !rectanglesOverlap(
          { ...candidate, w: size.w, h: size.h },
          occupied[0] || { x: Infinity, y: Infinity, w: 0, h: 0 },
        ) &&
        occupied.every(
          (item) =>
            !rectanglesOverlap({ ...candidate, w: size.w, h: size.h }, item),
        ),
    ) || position
  );
}
