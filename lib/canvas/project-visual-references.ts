import type { AssetRecord } from "@/lib/assets";
import { assetKey } from "@/lib/asset-catalog";
import {
  MAX_CREATIVE_PROJECT_REFERENCE_ASSETS,
  MAX_IMAGE_REFERENCES,
  type ImageRequestMode,
} from "@/packages/contracts/creative";

export type ProjectVisualReferenceMode = "included" | "disabled" | "conditional";

export function projectDefaultReferenceMode(input: {
  operation: ImageRequestMode;
  imageReferenceCount: number;
  hasMentions: boolean;
  hasMask: boolean;
}): ProjectVisualReferenceMode {
  if (input.hasMentions || input.hasMask || input.operation === "edit") return "disabled";
  if (input.operation === "auto" && input.imageReferenceCount > 0) return "conditional";
  return "included";
}

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

export type ProjectVisualReferencePreviewItem = {
  reference: ProjectVisualReference;
  status: "included" | "excluded" | "model-limit" | "duplicate" | "defaults-disabled" | "conditional";
};

export type ProjectVisualReferenceSubmissionPlan = {
  references: Array<GenerationReference & { projectAssetId?: string }>;
  items: ProjectVisualReferencePreviewItem[];
  explicitCount: number;
  projectCount: number;
  limit: number;
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
      append({
        kind: "image",
        name: reference.name,
        url: reference.url,
        ...(reference.storageKey ? { storageKey: reference.storageKey } : {}),
      }, reference.assetId);
    }
  });
  return result;
}

export function planProjectVisualReferenceSubmission(
  explicit: readonly GenerationReference[],
  project: readonly ProjectVisualReference[],
  excludedProjectAssetIds: readonly string[] = [],
  maxReferences = MAX_IMAGE_REFERENCES,
  mode: ProjectVisualReferenceMode = "included",
): ProjectVisualReferenceSubmissionPlan {
  const limit = Math.max(0, Math.floor(maxReferences));
  const excluded = new Set(excludedProjectAssetIds);
  const defaultsEnabled = mode !== "disabled";
  const conditionalDefaults = mode === "conditional";
  const submitted = mergeProjectVisualReferences(
    explicit,
    defaultsEnabled && !conditionalDefaults ? project : [],
    defaultsEnabled && !conditionalDefaults ? excludedProjectAssetIds : [],
    limit,
  );
  const submittedProjectIds = new Set(
    submitted.flatMap((reference) => reference.projectAssetId ? [reference.projectAssetId] : []),
  );
  const submittedExplicitKeys = new Set(
    mergeProjectVisualReferences(explicit, [], [], limit)
      .map((reference) => assetKey(reference.kind, reference.url, reference.storageKey)),
  );
  const projectCount = submitted.filter((reference) => Boolean(reference.projectAssetId)).length;
  const submittedExplicitCount = submitted.length - projectCount;
  let conditionalSlots = conditionalDefaults ? Math.max(0, limit - submittedExplicitCount) : 0;

  return {
    references: submitted,
    explicitCount: submitted.length - projectCount,
    projectCount,
    limit,
    items: project.map((reference) => {
      if (!defaultsEnabled) return { reference, status: "defaults-disabled" };
      if (excluded.has(reference.assetId)) return { reference, status: "excluded" };
      if (submittedProjectIds.has(reference.assetId)) return { reference, status: "included" };
      if (submittedExplicitKeys.has(assetKey("image", reference.url, reference.storageKey)))
        return { reference, status: "duplicate" };
      if (conditionalDefaults && conditionalSlots > 0) {
        conditionalSlots -= 1;
        return { reference, status: "conditional" };
      }
      return { reference, status: "model-limit" };
    }),
  };
}
