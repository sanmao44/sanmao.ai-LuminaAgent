'use client';

import { type AssetCollection, type AssetIndexItem } from './client-history';
import { assetRepository } from './repositories/asset-repository';
import { assetOverlayId, stableHash, type AssetRecord } from './asset-catalog';
import { normalizeAssetStorageKey, storageKeyFromAssetUrl } from './asset-references';

export type { AssetRecord, AssetSource } from './asset-catalog';
export { assetKey, assetOverlayId, mergeAssetRecords } from './asset-catalog';

export async function listUnifiedAssets(extra: AssetRecord[] = []) {
  return [...await assetRepository.list(extra)];
}

export async function listAssetCollections() {
  return [...await assetRepository.listCollections()];
}

export async function saveAssetCollections(collections: readonly AssetCollection[]) {
  await assetRepository.saveCollections(collections);
}

export async function registerCanvasAsset(input: Omit<AssetRecord, 'favorite' | 'projectIds' | 'collectionIds' | 'tags'> & { favorite?: boolean; projectIds?: string[]; collectionIds?: string[]; tags?: string[] }) {
  const item: AssetIndexItem = {
    id: input.indexId || input.id || `asset_${stableHash(`${input.kind}:${input.url}:${Date.now()}`)}`,
    kind: input.kind,
    url: input.url,
    storageKey: normalizeAssetStorageKey(input.kind, input.storageKey) || storageKeyFromAssetUrl(input.kind, input.url),
    sha256: input.sha256,
    size: input.size,
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
    collectionIds: input.collectionIds || [],
    tags: input.tags || [],
  };
  await assetRepository.saveIndex(item);
  return item;
}

export async function setUnifiedAssetFavorite(asset: AssetRecord, favorite: boolean) {
  if (asset.galleryId) await assetRepository.patchGallery(asset.galleryId, { favorite });
  await assetRepository.saveIndex({ id: assetOverlayId(asset.kind, asset.url), kind: asset.kind, url: asset.url, name: asset.name, source: 'metadata', createdAt: Date.now(), favorite, projectIds: asset.projectIds, collectionIds: asset.collectionIds, tags: asset.tags });
}

export async function hideUnifiedAsset(asset: AssetRecord) {
  await assetRepository.saveIndex({ id: assetOverlayId(asset.kind, asset.url), kind: asset.kind, url: asset.url, name: asset.name, source: 'metadata', createdAt: Date.now(), favorite: asset.favorite, hidden: true, projectIds: asset.projectIds, collectionIds: asset.collectionIds, tags: asset.tags });
}

export async function updateUnifiedAssetMetadata(asset: AssetRecord, patch: { collectionIds?: string[]; tags?: string[] }) {
  await assetRepository.saveIndex({ id: assetOverlayId(asset.kind, asset.url), kind: asset.kind, url: asset.url, name: asset.name, source: 'metadata', createdAt: Date.now(), favorite: asset.favorite, projectIds: asset.projectIds, collectionIds: patch.collectionIds ?? asset.collectionIds, tags: patch.tags ?? asset.tags });
}
