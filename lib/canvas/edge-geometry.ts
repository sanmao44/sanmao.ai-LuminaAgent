import {
  canvasEdgeEndpoints,
  edgeRouteLaneOffset,
  entityPortPoint,
} from "./model";
import type { CanvasDocument, CanvasEdge } from "./types";
import type { CanvasViewportPoint } from "./viewport";

export type CanvasPoint = CanvasViewportPoint;

/** Return the screen-space midpoint used by the connection cancel affordance. */
export function canvasEdgeMidpoint(
  document: CanvasDocument,
  edge: CanvasEdge,
): CanvasPoint {
  const endpoints = canvasEdgeEndpoints(document, edge);
  const start = entityPortPoint(document, endpoints.source, edge.sourcePort || "right");
  const end = entityPortPoint(document, endpoints.target, edge.targetPort || "left");
  const sourceDirection = (edge.sourcePort || "right") === "right" ? 1 : -1;
  const targetDirection = (edge.targetPort || "left") === "left" ? -1 : 1;
  const laneOffset = edgeRouteLaneOffset(document, edge);
  const dx = Math.max(72, Math.abs(end.x - start.x) * 0.42);
  const t = 0.5;
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * (start.x + dx * sourceDirection) +
      3 * inverse * t ** 2 * (end.x + dx * targetDirection) +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * (start.y + laneOffset) +
      3 * inverse * t ** 2 * (end.y + laneOffset) +
      t ** 3 * end.y,
  };
}
