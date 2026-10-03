'use client';

import { listAssetCollections, saveAssetCollections, listAssetIndex, saveAssetIndexItem, replaceAssetIndexItems, listGallery, patchGalleryItem, removeGalleryItems, replaceGalleryItems, saveGalleryItems, type AssetCollection } from '../client-history';
import { galleryAsset, indexAsset, mergeAssetRecords, videoAssets, type AssetRecord } from '../asset-catalog';
import type { AssetRepository } from './types';

async function loadVideoAssetTasks() {
  try {
    const response = await fetch('/api/video/tasks?limit=100', { cache: 'no-store' });
    const body = await response.json();
    return response.ok && Array.isArray(body.tasks) ? body.tasks : [];
  } catch { return []; }
}

async function listUnifiedAssets(extra: AssetRecord[] = []) {
  const [gallery, index, videoTasks] = await Promise.all([
    listGallery().catch(() => []),
    listAssetIndex().catch(() => []),
    loadVideoAssetTasks(),
  ]);
  const indexed = index.map(indexAsset).filter((item): item is AssetRecord => Boolean(item));
  return mergeAssetRecords([...gallery.map(galleryAsset), ...videoAssets(videoTasks), ...indexed, ...extra], index);
}

/** Asset metadata boundary; physical media remains resolved by storageKey. */
export const assetRepository: AssetRepository = {
  list: listUnifiedAssets,
  listGallery: async () => [...await listGallery()],
  saveGallery: saveGalleryItems,
  patchGallery: patchGalleryItem,
  removeGallery: removeGalleryItems,
  replaceGallery: replaceGalleryItems,
  listIndex: listAssetIndex,
  saveIndex: saveAssetIndexItem,
  replaceIndex: replaceAssetIndexItems,
  listCollections: listAssetCollections as () => Promise<AssetCollection[]>,
  saveCollections: saveAssetCollections as (collections: readonly AssetCollection[]) => Promise<void>,
};
