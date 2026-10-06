import {
  hideUnifiedAsset,
  listUnifiedAssets,
  listAssetCollections,
  registerCanvasAsset,
  saveAssetCollections,
  setUnifiedAssetFavorite,
  updateUnifiedAssetMetadata,
  type AssetRecord,
} from "@/lib/assets";
import type { AssetCollection } from "@/lib/client-history";
import {
  isAssignableCanvasAssetCollection,
  CANVAS_ASSET_UNCATEGORIZED_ID,
} from "@/lib/canvas/asset-library";

export type CanvasAssetCollectionResult =
  | { status: "invalid-collection" }
  | { status: "missing-asset" }
  | { status: "saved"; asset: AssetRecord; registered: boolean };

export function loadCanvasAssets(extraAssets: AssetRecord[] = []) {
  return listUnifiedAssets(extraAssets);
}

export function loadCanvasAssetCollections() {
  return listAssetCollections();
}

export function persistCanvasAssetCollections(collections: readonly AssetCollection[]) {
  return saveAssetCollections(collections);
}

export function updateCanvasAssetMetadata(
  asset: AssetRecord,
  patch: { collectionIds?: string[]; tags?: string[] },
) {
  return updateUnifiedAssetMetadata(asset, patch);
}

export function setCanvasAssetFavorite(asset: AssetRecord, favorite: boolean) {
  return setUnifiedAssetFavorite(asset, favorite);
}

export function hideCanvasAsset(asset: AssetRecord) {
  return hideUnifiedAsset(asset);
}

export function collectionIdsAfterRemoval(asset: AssetRecord, collectionId: string) {
  return (asset.collectionIds || []).filter((id) => id !== collectionId);
}

export function collectionIdsAfterAddition(asset: AssetRecord, collectionId: string) {
  return [...new Set([...(asset.collectionIds || []), collectionId])];
}

export function tagsAfterAddition(asset: AssetRecord, tag: string) {
  return [...new Set([...(asset.tags || []), tag])];
}

function collectionIdsFor(asset: AssetRecord, collectionId: string) {
  if (collectionId === CANVAS_ASSET_UNCATEGORIZED_ID)
    return asset.collectionIds || [];
  return [...new Set([...(asset.collectionIds || []), collectionId])];
}

async function saveCanvasAssetCollection(
  asset: AssetRecord,
  collectionId: string,
): Promise<CanvasAssetCollectionResult> {
  if (!isAssignableCanvasAssetCollection(collectionId))
    return { status: "invalid-collection" };

  const collectionIds = collectionIdsFor(asset, collectionId);
  await updateUnifiedAssetMetadata(asset, { collectionIds });
  return { status: "saved", asset, registered: false };
}

export function addExistingCanvasAssetToCollection(
  asset: Pick<AssetRecord, "kind" | "url">,
  collectionId: string,
  extraAssets: AssetRecord[] = [],
) {
  if (!isAssignableCanvasAssetCollection(collectionId))
    return Promise.resolve({ status: "invalid-collection" } as const);
  return listUnifiedAssets(extraAssets).then(async (assets) => {
    const existing = assets.find(
      (item) => item.kind === asset.kind && item.url === asset.url,
    );
    if (!existing) return { status: "missing-asset" } as const;
    return saveCanvasAssetCollection(existing, collectionId);
  });
}

export function registerCanvasAssetInCollection(
  asset: AssetRecord,
  collectionId: string,
  extraAssets: AssetRecord[] = [],
) {
  if (!isAssignableCanvasAssetCollection(collectionId))
    return Promise.resolve({ status: "invalid-collection" } as const);
  return listUnifiedAssets(extraAssets).then(async (assets) => {
    const existing = assets.find(
      (item) => item.kind === asset.kind && item.url === asset.url,
    );
    if (existing) return saveCanvasAssetCollection(existing, collectionId);

    const collectionIds = collectionIdsFor(asset, collectionId);
    await registerCanvasAsset({ ...asset, collectionIds });
    return { status: "saved", asset, registered: true } as const;
  });
}
