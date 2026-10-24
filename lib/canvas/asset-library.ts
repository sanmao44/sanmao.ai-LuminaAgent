import type { AssetRecord, AssetSource } from "@/lib/assets";
import { assetKey } from "@/lib/asset-catalog";
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

export type CanvasAssetKindFilter = "all" | AssetRecord["kind"];
export type CanvasAssetSourceFilter = "all" | AssetSource;
export type CanvasAssetSort = "newest" | "oldest" | "name";

export function filterCanvasAssets(
  assets: readonly AssetRecord[],
  options: {
    collection: string;
    kind: CanvasAssetKindFilter;
    source: CanvasAssetSourceFilter;
    favoritesOnly: boolean;
    query: string;
    tagFilter: string;
    sort: CanvasAssetSort;
    now?: number;
  },
) {
  const search = options.query.trim().toLowerCase();
  const tagSearch = options.tagFilter.trim().toLowerCase();
  const now = options.now ?? Date.now();
  const matchesCollection = (asset: AssetRecord) => {
    if (options.collection === "all") return true;
    if (options.collection === "uncategorized") return !asset.collectionIds?.length;
    if (options.collection === "favorite") return asset.favorite;
    if (options.collection === "image" || options.collection === "video" || options.collection === "audio")
      return asset.kind === options.collection;
    if (options.collection === "generated")
      return asset.source === "history" || asset.source === "video-task" || asset.source === "canvas-output";
    if (options.collection === "reference")
      return asset.source === "canvas-upload" || asset.tags?.includes("参考");
    if (options.collection === "recent") return asset.createdAt >= now - 7 * 24 * 60 * 60 * 1000;
    return asset.collectionIds?.includes(options.collection);
  };

  return assets
    .filter((asset) =>
      (options.kind === "all" || asset.kind === options.kind) &&
      (options.source === "all" || asset.source === options.source) &&
      (!options.favoritesOnly || asset.favorite) &&
      matchesCollection(asset) &&
      (!tagSearch || asset.tags?.some((tag) => tag.toLowerCase().includes(tagSearch))) &&
      (!search || `${asset.name} ${asset.prompt || ""} ${asset.modelName || ""}`.toLowerCase().includes(search)),
    )
    .sort((left, right) =>
      options.sort === "oldest"
        ? left.createdAt - right.createdAt
        : options.sort === "name"
          ? left.name.localeCompare(right.name, "zh-CN")
          : right.createdAt - left.createdAt,
    );
}

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

/**
 * Existing asset references already belong to the unified asset index or
 * another authoritative source such as gallery history. Materialized output
 * nodes still carry assetId and must remain eligible for registration.
 */
export function shouldRegisterCanvasAsset(node: CanvasNode) {
  if (node.type !== "media" || !node.data.url) return false;
  const sourceAssetId = node.data.sourceAssetId?.trim();
  const assetId = node.data.assetId?.trim();
  return !sourceAssetId || Boolean(assetId);
}

export function canvasNodeAssetKey(node: CanvasNode) {
  if (!node.data.url) return null;
  const kind = node.data.kind || "image";
  const storageKey = typeof node.data.storageKey === "string"
    ? node.data.storageKey
    : undefined;
  return assetKey(kind, String(node.data.url), storageKey);
}

export function canvasNodeAssetRecord(
  node: CanvasNode,
  context: { activeProjectId: string; projectId?: string },
  fallbackCreatedAt = 0,
): AssetRecord | null {
  if ((node.type !== "media" && node.type !== "upscale") || !node.data.url)
    return null;

  const storageKey = typeof node.data.storageKey === "string"
    ? node.data.storageKey
    : undefined;

  return {
    id: `canvas:${context.activeProjectId}:${node.id}`,
    kind: node.data.kind || "image",
    url: String(node.data.url),
    ...(storageKey ? { storageKey } : {}),
    ...(node.data.sourceAssetId?.trim() && !node.data.assetId?.trim()
      ? { sourceAssetId: node.data.sourceAssetId.trim() }
      : {}),
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
