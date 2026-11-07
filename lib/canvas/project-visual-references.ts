import type { AssetRecord } from "@/lib/assets";
import { assetKey } from "@/lib/asset-catalog";
import { MAX_CREATIVE_PROJECT_REFERENCE_ASSETS, MAX_IMAGE_REFERENCES } from "@/packages/contracts/creative";

export type ProjectVisualReference = {
  assetId: string;
  name: string;
  url: string;
  storageKey?: string;
};

export type GenerationReference = {
  id?: string;
  kind: "image" | "video" | "audio";
  name: string;
  url: string;
  storageKey?: string;
};

export function projectVisualReferenceAssetId(asset: AssetRecord) {
  if (asset.indexId) return `index:${asset.indexId}`;
  if (asset.sourceAssetId) return asset.sourceAssetId;
  if (asset.id.startsWith("canvas:")) return `index:${asset.id}`;
  return asset.id;
}

export function resolveProjectVisualReferences(
  assetIds: readonly string[],
  assets: readonly AssetRecord[],
): ProjectVisualReference[] {
  const byId = new Map<string, AssetRecord>();
  for (const asset of assets) {
    byId.set(projectVisualReferenceAssetId(asset), asset);
    byId.set(asset.id, asset);
  }
  const seen = new Set<string>();
  return assetIds.flatMap((assetId) => {
    const asset = byId.get(assetId);
    if (!asset || asset.kind !== "image" || !asset.url) return [];
    const key = assetKey(asset.kind, asset.url, asset.storageKey);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      assetId: projectVisualReferenceAssetId(asset),
      name: asset.name,
      url: asset.url,
      ...(asset.storageKey ? { storageKey: asset.storageKey } : {}),
    }];
  }).slice(0, MAX_CREATIVE_PROJECT_REFERENCE_ASSETS);
}

export function mergeProjectVisualReferences(
  explicit: readonly GenerationReference[],
  project: readonly ProjectVisualReference[],
  excludedProjectAssetIds: readonly string[] = [],
  maxReferences = MAX_IMAGE_REFERENCES,
) {
  const excluded = new Set(excludedProjectAssetIds);
  const result: Array<GenerationReference & { projectAssetId?: string }> = [];
  const seen = new Set<string>();
  const append = (reference: GenerationReference, projectAssetId?: string) => {
    if (!reference.url || reference.kind !== "image") return;
    const key = assetKey(reference.kind, reference.url, reference.storageKey);
    if (seen.has(key) || result.length >= Math.max(0, maxReferences)) return;
    seen.add(key);
    result.push({ ...reference, ...(projectAssetId ? { projectAssetId } : {}) });
  };
  explicit.forEach((reference) => append(reference));
  project.forEach((reference) => {
    if (!excluded.has(reference.assetId)) {
      append({ kind: "image", name: reference.name, url: reference.url, storageKey: reference.storageKey }, reference.assetId);
    }
  });
  return result;
}
