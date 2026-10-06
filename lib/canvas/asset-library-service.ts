import {
  listUnifiedAssets,
  registerCanvasAsset,
  updateUnifiedAssetMetadata,
  type AssetRecord,
} from "@/lib/assets";
import {
  isAssignableCanvasAssetCollection,
  CANVAS_ASSET_UNCATEGORIZED_ID,
} from "@/lib/canvas/asset-library";

export type CanvasAssetCollectionResult =
  | { status: "invalid-collection" }
  | { status: "missing-asset" }
  | { status: "saved"; asset: AssetRecord; registered: boolean };

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
