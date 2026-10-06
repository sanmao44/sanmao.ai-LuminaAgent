import type { CanvasCamera } from "./types";

/** A point in either the stage or world coordinate space. */
export type CanvasViewportPoint = { x: number; y: number };

/** Convert browser client coordinates into coordinates relative to the stage. */
export function canvasClientToStagePoint(
  client: CanvasViewportPoint,
  stageRect: { left: number; top: number },
): CanvasViewportPoint {
  return {
    x: client.x - stageRect.left,
    y: client.y - stageRect.top,
  };
}

/** Convert a point relative to the stage into canvas world coordinates. */
export function canvasStageToWorldPoint(
  point: CanvasViewportPoint,
  camera: CanvasCamera,
): CanvasViewportPoint {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

/** Convert a canvas world point into coordinates relative to the stage. */
export function canvasWorldToStagePoint(
  point: CanvasViewportPoint,
  camera: CanvasCamera,
): CanvasViewportPoint {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}
