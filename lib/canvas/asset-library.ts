import type { AssetSource } from "@/lib/assets";
import type { CanvasNode } from "@/lib/canvas/types";

export const CANVAS_ASSET_UNCATEGORIZED_ID = "uncategorized";
export const CANVAS_ASSET_SMART_COLLECTION_IDS = new Set([
  "all",
  "recent",
  "favorite",
  "generated",
  "reference",
  "image",
  "video",
  "audio",
]);
export const CANVAS_ASSET_NON_READY_STATUSES = new Set(["queued", "running", "failed"]);
export const CANVAS_ASSET_LAST_COLLECTION_KEY = "sanmao.canvas.asset.lastCollection";

export const ASSET_SOURCE_LABELS: Record<AssetSource, string> = {
  history: "主界面历史",
  "video-task": "视频任务",
  "canvas-upload": "画布导入",
  "canvas-output": "画布生成",
};

export function isAssignableCanvasAssetCollection(collectionId: string) {
  return (
    collectionId === CANVAS_ASSET_UNCATEGORIZED_ID ||
    !CANVAS_ASSET_SMART_COLLECTION_IDS.has(collectionId)
  );
}

export function canAddCanvasAsset(node: CanvasNode) {
  return (
    ((node.type === "media" && Boolean(node.data.kind)) ||
      (node.type === "upscale" && node.data.kind === "image")) &&
    Boolean(node.data.url) &&
    !CANVAS_ASSET_NON_READY_STATUSES.has(String(node.data.status || ""))
  );
}
