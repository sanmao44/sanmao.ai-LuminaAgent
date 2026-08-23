'use client';

import {
  listAssetIndex,
  listGallery,
  patchGalleryItem,
  saveAssetIndexItem,
  type AssetIndexItem,
  type GalleryItem,
} from './client-history';

export type AssetSource = 'history' | 'video-task' | 'canvas-upload' | 'canvas-output';

export type AssetRecord = {
  id: string;
  kind: 'image' | 'video';
  url: string;
  name: string;
  source: AssetSource;
  createdAt: number;
  favorite: boolean;
  prompt?: string;
  modelId?: string;
  modelName?: string;
  width?: number;
  height?: number;
  projectIds: string[];
  galleryId?: string;
  taskId?: string;
  indexId?: string;
};

type VideoTaskAssetSource = {
  id: string;
  modelId?: string;
  modelName?: string;
  createdAt?: string;
  completedAt?: string;
  input?: { prompt?: string };
  videoUrls?: string[];
};

export function assetKey(kind: AssetRecord['kind'], url: string) {
  return `${kind}:${String(url || '').trim()}`;
}

function stableHash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function assetOverlayId(kind: AssetRecord['kind'], url: string) {
  return `asset_meta_${stableHash(assetKey(kind, url))}`;
}

function galleryAsset(item: GalleryItem): AssetRecord {
  return {
    id: `gallery:${item.id}`,
    galleryId: item.id,
    kind: 'image',
    url: item.url,
    name: item.prompt?.trim().slice(0, 48) || item.modelName || '生成图片',
    source: 'history',
    createdAt: item.createdAt,
    favorite: Boolean(item.favorite),
    prompt: item.prompt,
    modelId: item.modelId,
    modelName: item.modelName,
    projectIds: [],
  };
}

function indexAsset(item: AssetIndexItem): AssetRecord | null {
  if (item.source === 'metadata' || !item.url) return null;
  return {
    id: `index:${item.id}`,
    indexId: item.id,
    kind: item.kind,
    url: item.url,
    name: item.name || (item.kind === 'video' ? '视频素材' : '图片素材'),
    source: item.source,
    createdAt: item.createdAt,
    favorite: Boolean(item.favorite),
    prompt: item.prompt,
    modelId: item.modelId,
    modelName: item.modelName,
    width: item.width,
    height: item.height,
    projectIds: item.projectIds || [],
  };
}

function videoAssets(tasks: VideoTaskAssetSource[]) {
  return tasks.flatMap((task) => (task.videoUrls || []).map((url, index): AssetRecord => ({
    id: `video:${task.id}:${index}`,
    taskId: task.id,
    kind: 'video',
    url,
    name: task.input?.prompt?.trim().slice(0, 48) || task.modelName || `生成视频 ${index + 1}`,
    source: 'video-task',
    createdAt: Date.parse(task.completedAt || task.createdAt || '') || Date.now(),
    favorite: false,
    prompt: task.input?.prompt,
    modelId: task.modelId,
    modelName: task.modelName,
    projectIds: [],
  })));
}

export function mergeAssetRecords(records: AssetRecord[], index: AssetIndexItem[] = []) {
  const overlays = new Map(index.filter((item) => item.source === 'metadata').map((item) => [assetKey(item.kind, item.url), item]));
  const merged = new Map<string, AssetRecord>();
  for (const record of records) {
    if (!record.url) continue;
    const key = assetKey(record.kind, record.url);
    const overlay = overlays.get(key);
    if (overlay?.hidden) continue;
    const existing = merged.get(key);
    const combined: AssetRecord = {
      ...(existing || record),
      ...record,
      id: existing?.id || record.id,
      name: overlay?.name || record.name || existing?.name || '未命名资产',
      favorite: overlay ? Boolean(overlay.favorite) : Boolean(record.favorite || existing?.favorite),
      projectIds: [...new Set([...(existing?.projectIds || []), ...record.projectIds, ...(overlay?.projectIds || [])])],
      galleryId: record.galleryId || existing?.galleryId,
      taskId: record.taskId || existing?.taskId,
      indexId: record.indexId || existing?.indexId,
      createdAt: Math.max(existing?.createdAt || 0, record.createdAt || 0),
    };
    merged.set(key, combined);
  }
  return [...merged.values()].sort((left, right) => right.createdAt - left.createdAt);
}

async function loadVideoAssetTasks() {
  try {
    const response = await fetch('/api/video/tasks?limit=100', { cache: 'no-store' });
    const body = await response.json();
    return response.ok && Array.isArray(body.tasks) ? body.tasks as VideoTaskAssetSource[] : [];
  } catch { return []; }
}

export async function listUnifiedAssets(extra: AssetRecord[] = []) {
  const [gallery, index, videoTasks] = await Promise.all([listGallery().catch(() => []), listAssetIndex().catch(() => []), loadVideoAssetTasks()]);
  const indexed = index.map(indexAsset).filter((item): item is AssetRecord => Boolean(item));
  return mergeAssetRecords([...gallery.map(galleryAsset), ...videoAssets(videoTasks), ...indexed, ...extra], index);
}

export async function registerCanvasAsset(input: Omit<AssetRecord, 'favorite' | 'projectIds'> & { favorite?: boolean; projectIds?: string[] }) {
  const item: AssetIndexItem = {
    id: input.indexId || input.id || `asset_${stableHash(`${input.kind}:${input.url}:${Date.now()}`)}`,
    kind: input.kind,
    url: input.url,
    name: input.name,
    source: input.source === 'canvas-output' ? 'canvas-output' : 'canvas-upload',
    createdAt: input.createdAt || Date.now(),
    favorite: Boolean(input.favorite),
    prompt: input.prompt,
    modelId: input.modelId,
    modelName: input.modelName,
    width: input.width,
    height: input.height,
    projectIds: input.projectIds || [],
  };
  await saveAssetIndexItem(item);
  return item;
}

export async function setUnifiedAssetFavorite(asset: AssetRecord, favorite: boolean) {
  if (asset.galleryId) await patchGalleryItem(asset.galleryId, { favorite });
  await saveAssetIndexItem({
    id: assetOverlayId(asset.kind, asset.url),
    kind: asset.kind,
    url: asset.url,
    name: asset.name,
    source: 'metadata',
    createdAt: Date.now(),
    favorite,
    projectIds: asset.projectIds,
  });
}

export async function hideUnifiedAsset(asset: AssetRecord) {
  await saveAssetIndexItem({
    id: assetOverlayId(asset.kind, asset.url),
    kind: asset.kind,
    url: asset.url,
    name: asset.name,
    source: 'metadata',
    createdAt: Date.now(),
    favorite: asset.favorite,
    hidden: true,
    projectIds: asset.projectIds,
  });
}
