import type { CanvasCamera } from "./types";

/** A point in either the stage or world coordinate space. */
export type CanvasViewportPoint = { x: number; y: number };
export type CanvasViewportBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Resolve the world-space rectangle currently covered by the stage.
 *
 * Overscan is expressed in screen pixels so the number of prefetched world
 * units stays consistent at every zoom level. Keeping this calculation in the
 * canvas boundary lets render layers share one cheap, pure visibility rule.
 */
export function canvasViewportWorldBounds(
  camera: CanvasCamera,
  stage: { width: number; height: number },
  overscan = 480,
): CanvasViewportBounds {
  const zoom = Math.max(camera.zoom, 0.0001);
  return {
    x: (-overscan - camera.x) / zoom,
    y: (-overscan - camera.y) / zoom,
    w: (stage.width + overscan * 2) / zoom,
    h: (stage.height + overscan * 2) / zoom,
  };
}

/** Return whether two world-space rectangles overlap. */
export function canvasBoundsIntersect(
  bounds: CanvasViewportBounds,
  viewport: CanvasViewportBounds,
): boolean {
  return (
    bounds.x < viewport.x + viewport.w &&
    bounds.x + bounds.w > viewport.x &&
    bounds.y < viewport.y + viewport.h &&
    bounds.y + bounds.h > viewport.y
  );
}

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

/** Compute a zoomed camera while keeping the world point under the anchor fixed. */
export function canvasZoomCameraAtPoint(
  stagePoint: CanvasViewportPoint,
  camera: CanvasCamera,
  factor: number,
  minZoom = 0.12,
  maxZoom = 3,
): CanvasCamera {
  const worldPoint = canvasStageToWorldPoint(stagePoint, camera);
  const zoom = Math.max(minZoom, Math.min(maxZoom, camera.zoom * factor));
  return {
    x: stagePoint.x - worldPoint.x * zoom,
    y: stagePoint.y - worldPoint.y * zoom,
    zoom,
  };
}

/** Fit world bounds into the visible stage while preserving the canvas limits. */
export function canvasFitCamera(
  bounds: readonly CanvasViewportBounds[],
  stage: { width: number; height: number },
  rightInset = 0,
): CanvasCamera {
  const viewWidth = stage.width - Math.min(
    Math.max(rightInset, 0),
    Math.max(0, stage.width - 240),
  );
  if (!bounds.length) {
    return { x: viewWidth / 2, y: stage.height / 2, zoom: 1 };
  }
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.w));
  const maxY = Math.max(...bounds.map((item) => item.y + item.h));
  const zoom = Math.max(
    0.12,
    Math.min(
      1.25,
      (viewWidth - 180) / Math.max(1, maxX - minX),
      (stage.height - 320) / Math.max(1, maxY - minY),
    ),
  );
  return {
    x: viewWidth / 2 - (minX + (maxX - minX) / 2) * zoom,
    y: (stage.height - 120) / 2 - (minY + (maxY - minY) / 2) * zoom,
    zoom,
  };
}
