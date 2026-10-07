import type { CanvasCamera } from "./types";

export type CanvasMinimapBounds = { x: number; y: number; w: number; h: number };
export type CanvasMinimapPoint = { x: number; y: number };
export type CanvasMinimapStage = { width: number; height: number };
export type CanvasMinimapMap = {
  mapWidth: number;
  mapHeight: number;
  mapScale: number;
  mapOffsetX: number;
  mapOffsetY: number;
};

export function createCanvasMinimapMap(
  bounds: CanvasMinimapBounds,
  mapWidth = 160,
  mapHeight = 100,
): CanvasMinimapMap {
  const mapScale = Math.min(
    mapWidth / Math.max(1, bounds.w),
    mapHeight / Math.max(1, bounds.h),
  );
  return {
    mapWidth,
    mapHeight,
    mapScale,
    mapOffsetX: (mapWidth - bounds.w * mapScale) / 2,
    mapOffsetY: (mapHeight - bounds.h * mapScale) / 2,
  };
}

export function canvasMinimapRect(
  rect: CanvasMinimapBounds,
  bounds: CanvasMinimapBounds,
  map: CanvasMinimapMap,
) {
  return {
    left: ((map.mapOffsetX + (rect.x - bounds.x) * map.mapScale) / map.mapWidth) * 100,
    top: ((map.mapOffsetY + (rect.y - bounds.y) * map.mapScale) / map.mapHeight) * 100,
    width: ((rect.w * map.mapScale) / map.mapWidth) * 100,
    height: ((rect.h * map.mapScale) / map.mapHeight) * 100,
  };
}

export function canvasMinimapVisibleWorld(
  camera: CanvasCamera,
  stage: CanvasMinimapStage,
) {
  const zoom = Math.max(0.12, camera.zoom || 1);
  return {
    x: -camera.x / zoom,
    y: -camera.y / zoom,
    w: stage.width / zoom,
    h: stage.height / zoom,
  };
}

export function canvasMinimapClipAxis(start: number, size: number) {
  const end = start + size;
  if (end <= 0) return { start: 0, size: 3 };
  if (start >= 100) return { start: 97, size: 3 };
  const clippedStart = Math.max(0, Math.min(100, start));
  const clippedEnd = Math.max(0, Math.min(100, end));
  const clippedSize = Math.max(3, clippedEnd - clippedStart);
  return {
    start: Math.min(clippedStart, 100 - clippedSize),
    size: clippedSize,
  };
}

export function canvasMinimapPointFromClient(
  client: CanvasMinimapPoint,
  stageRect: { left: number; top: number; width: number; height: number },
  bounds: CanvasMinimapBounds,
  map: CanvasMinimapMap,
) {
  const px = Math.max(0, Math.min(1, (client.x - stageRect.left) / Math.max(1, stageRect.width))) * map.mapWidth;
  const py = Math.max(0, Math.min(1, (client.y - stageRect.top) / Math.max(1, stageRect.height))) * map.mapHeight;
  return {
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.w, bounds.x + (px - map.mapOffsetX) / map.mapScale)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.h, bounds.y + (py - map.mapOffsetY) / map.mapScale)),
  };
}

export function canvasMinimapOffscreenDirection(
  visible: CanvasMinimapBounds,
  bounds: CanvasMinimapBounds,
) {
  const center = { x: visible.x + visible.w / 2, y: visible.y + visible.h / 2 };
  return {
    left: center.x > bounds.x + bounds.w,
    right: center.x < bounds.x,
    top: center.y > bounds.y + bounds.h,
    bottom: center.y < bounds.y,
  };
}
