import type { AssetRecord, AssetSource } from "@/lib/assets";
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

export function canvasNodeAssetRecord(
  node: CanvasNode,
  context: { activeProjectId: string; projectId?: string },
  fallbackCreatedAt = 0,
): AssetRecord | null {
  if ((node.type !== "media" && node.type !== "upscale") || !node.data.url)
    return null;

  return {
    id: `canvas:${context.activeProjectId}:${node.id}`,
    kind: node.data.kind || "image",
    url: String(node.data.url),
    name: String(node.data.name || "画布素材"),
    source: (node.data.generation ? "canvas-output" : "canvas-upload") as AssetSource,
    createdAt: Number(node.data.generation?.createdAt || fallbackCreatedAt),
    favorite: false,
    prompt: node.data.generation?.prompt,
    modelId: node.data.generation?.params.model,
    modelName: typeof node.data.model === "string" ? node.data.model : undefined,
    width: Number(node.data.nativeWidth) || undefined,
    height: Number(node.data.nativeHeight) || undefined,
    projectIds: context.projectId ? [context.projectId] : [],
    collectionIds: [],
    tags: [],
  };
}
