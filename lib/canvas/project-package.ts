import { normalizeCreativeProjectBrief, type CreativeProjectBrief } from "@/packages/contracts/creative";
import { MAX_CREATIVE_PROJECT_REFERENCE_ASSETS } from "@/packages/contracts/creative";
import type { CanvasDocument, CanvasMediaKind, CanvasSnapshot } from "@/lib/canvas/types";
import { canvasInlineImageUrls, replaceCanvasMediaUrls } from "@/lib/canvas/inline-images";

export const CANVAS_PROJECT_PACKAGE_SCHEMA = "sanmao.canvas.project";
export const CANVAS_PROJECT_PACKAGE_VERSION = 2;
export const CANVAS_PROJECT_PACKAGE_IMAGE_REF_PREFIX = "sanmao-project-image:";
export const CANVAS_PROJECT_PACKAGE_MAX_EMBEDDED_IMAGE_BYTES = 256 * 1024 * 1024;
export const CANVAS_PROJECT_PACKAGE_MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const CANVAS_PROJECT_PACKAGE_MAX_FILE_BYTES = 384 * 1024 * 1024;

export type CanvasProjectPackageImage = {
  id: string;
  name: string;
  dataUrl: string;
};

export type CanvasProjectPackageAsset = {
  nodeId: string;
  name: string;
  kind: CanvasMediaKind;
  url?: string;
  storageKey?: string;
  sourceAssetId?: string;
  prompt?: string;
  modelName?: string;
  createdAt?: number;
};

export type CanvasProjectPackageVersion = {
  id: string;
  canvasId?: string;
  label: string;
  createdAt: number;
  parentVersionId?: string;
  brief?: CreativeProjectBrief | null;
  referenceAssetIds?: string[];
  snapshot: CanvasSnapshot;
};

export type CanvasProjectPackage = {
  schema: typeof CANVAS_PROJECT_PACKAGE_SCHEMA;
  version: 1 | typeof CANVAS_PROJECT_PACKAGE_VERSION;
  exportedAt: string;
  project: {
    name: string;
    projectId?: string;
    brief?: CreativeProjectBrief;
    referenceAssetIds?: string[];
    versions?: CanvasProjectPackageVersion[];
  };
  document: CanvasDocument;
  assets: CanvasProjectPackageAsset[];
  embeddedImages?: CanvasProjectPackageImage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeReferenceAssetIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 300)))].slice(0, MAX_CREATIVE_PROJECT_REFERENCE_ASSETS)
    : [];
}

function mediaKind(value: unknown): CanvasMediaKind {
  return value === "video" ? "video" : value === "audio" ? "audio" : "image";
}

function snapshot(value: unknown): CanvasSnapshot | null {
  if (!isRecord(value)
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges)
    || !Array.isArray(value.groups)
    || !isRecord(value.camera)) return null;
  return value as unknown as CanvasSnapshot;
}

function versionManifest(value: unknown): CanvasProjectPackageVersion | null {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, 300);
  const versionSnapshot = snapshot(value.snapshot);
  if (!id || !versionSnapshot) return null;
  const createdAt = Number(value.createdAt);
  return {
    id,
    ...(cleanText(value.canvasId, 300) ? { canvasId: cleanText(value.canvasId, 300) } : {}),
    label: cleanText(value.label, 80) || "未命名版本",
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    ...(cleanText(value.parentVersionId, 300) ? { parentVersionId: cleanText(value.parentVersionId, 300) } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "brief")
      ? { brief: normalizeCreativeProjectBrief(value.brief) }
      : {}),
    ...(normalizeReferenceAssetIds(value.referenceAssetIds).length ? { referenceAssetIds: normalizeReferenceAssetIds(value.referenceAssetIds) } : {}),
    snapshot: versionSnapshot,
  };
}

function assetManifest(document: CanvasDocument): CanvasProjectPackageAsset[] {
  return document.nodes.flatMap((node) => {
    if (node.type !== "media" && node.type !== "upscale") return [];
    const data = node.data;
    const url = cleanText(data.url, 2000);
    const storageKey = cleanText(data.storageKey, 500);
    const sourceAssetId = cleanText(data.sourceAssetId, 300);
    if (!url && !storageKey && !sourceAssetId) return [];
    const name = cleanText(data.name, 120) || "未命名素材";
    const prompt = cleanText(data.generation?.prompt || data.prompt || data.speechGeneration?.text, 2000);
    const modelName = cleanText(data.generation?.params?.model || data.model || data.speechGeneration?.modelName, 160);
    const createdAt = Number(data.generation?.createdAt || data.speechGeneration?.createdAt);
    return [{
      nodeId: node.id,
      name,
      kind: mediaKind(data.kind),
      ...(url ? { url } : {}),
      ...(storageKey ? { storageKey } : {}),
      ...(sourceAssetId ? { sourceAssetId } : {}),
      ...(prompt ? { prompt } : {}),
      ...(modelName ? { modelName } : {}),
      ...(Number.isFinite(createdAt) && createdAt > 0 ? { createdAt } : {}),
    }];
  });
}

export function canvasProjectPackageFromDocument(input: {
  name: string;
  projectId?: string;
  brief?: CreativeProjectBrief | null;
  referenceAssetIds?: readonly string[];
  versions?: readonly CanvasProjectPackageVersion[];
  document: CanvasDocument;
  exportedAt?: string;
}) {
  const brief = normalizeCreativeProjectBrief(input.brief);
  const referenceAssetIds = normalizeReferenceAssetIds(input.referenceAssetIds);
  const versions = (input.versions || [])
    .map(versionManifest)
    .filter((version): version is CanvasProjectPackageVersion => Boolean(version))
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-50);
  const packageValue: CanvasProjectPackage = {
    schema: CANVAS_PROJECT_PACKAGE_SCHEMA,
    version: CANVAS_PROJECT_PACKAGE_VERSION,
    exportedAt: input.exportedAt || new Date().toISOString(),
    project: {
      name: cleanText(input.name, 120) || "SANMAO 无限画布",
      ...(cleanText(input.projectId, 300) ? { projectId: cleanText(input.projectId, 300) } : {}),
      ...(brief ? { brief } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
      ...(versions.length ? { versions } : {}),
    },
    document: input.document,
    assets: assetManifest(input.document),
  };
  return packageValue;
}

export function serializeCanvasProjectPackage(input: Parameters<typeof canvasProjectPackageFromDocument>[0]) {
  return JSON.stringify(canvasProjectPackageFromDocument(input), null, 2);
}

function mapPackageNodes(nodes: CanvasDocument["nodes"], urls: ReadonlyMap<string, string>) {
  return nodes.map((node) => ({
    ...node,
    data: replaceCanvasMediaUrls(node.data, urls),
  }));
}

function mapPackageDocuments<T extends CanvasProjectPackage>(packageValue: T, urls: ReadonlyMap<string, string>): T {
  return {
    ...packageValue,
    assets: packageValue.assets.map((asset) => {
      const mappedUrl = asset.url ? urls.get(asset.url) : undefined;
      if (!mappedUrl) return asset;
      const mappedAsset = { ...asset, url: mappedUrl };
      delete mappedAsset.storageKey;
      delete mappedAsset.sourceAssetId;
      return mappedAsset;
    }),
    document: { ...packageValue.document, nodes: mapPackageNodes(packageValue.document.nodes, urls) },
    project: {
      ...packageValue.project,
      ...(packageValue.project.versions ? {
        versions: packageValue.project.versions.map((version) => ({
          ...version,
          snapshot: { ...version.snapshot, nodes: mapPackageNodes(version.snapshot.nodes, urls) },
        })),
      } : {}),
    },
  };
}

export function canvasProjectPackageImageByteSize(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1).replace(/\s/g, "");
  if (!base64 || base64.length % 4 !== 0 || !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(base64)) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function packageImageReferences(packageValue: CanvasProjectPackage) {
  const refs = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith(CANVAS_PROJECT_PACKAGE_IMAGE_REF_PREFIX)) refs.add(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  for (const document of [packageValue.document, ...(packageValue.project.versions || []).map((version) => version.snapshot)]) {
    for (const node of document.nodes) visit(node.data);
  }
  return refs;
}

/** Image URLs used by the current canvas and version snapshots, deduplicated by source URL. */
export function canvasProjectPackageImageUrls(packageValue: CanvasProjectPackage) {
  const urls = new Set<string>();
  const documents = [packageValue.document, ...(packageValue.project.versions || []).map((version) => version.snapshot)];
  for (const document of documents) {
    for (const node of document.nodes) {
      if (node.data.kind === "image" && typeof node.data.url === "string" && node.data.url.trim())
        urls.add(node.data.url.trim());
      for (const url of canvasInlineImageUrls([node])) urls.add(url);
    }
  }
  return [...urls];
}

/** Replace source-machine image URLs with package-local references and store the image bytes once. */
export function embedCanvasProjectPackageImages(
  packageValue: CanvasProjectPackage,
  images: Array<CanvasProjectPackageImage & { sourceUrl: string }>,
) {
  const urls = new Map(images.map((image) => [
    image.sourceUrl,
    `${CANVAS_PROJECT_PACKAGE_IMAGE_REF_PREFIX}${image.id}`,
  ]));
  const embeddedImages = images.map(({ id, name, dataUrl }) => ({ id, name, dataUrl }));
  return mapPackageDocuments({ ...packageValue, version: CANVAS_PROJECT_PACKAGE_VERSION, embeddedImages }, urls);
}

/** Restore imported image references to URLs stored on the destination machine. */
export function restoreCanvasProjectPackageImages(
  packageValue: CanvasProjectPackage,
  uploads: ReadonlyMap<string, { url: string; storageKey?: string }>,
) {
  const urls = new Map<string, string>();
  for (const image of packageValue.embeddedImages || []) {
    const uploaded = uploads.get(image.id);
    if (!uploaded?.url) throw new Error(`项目包图片“${image.name}”没有成功导入。`);
    urls.set(`${CANVAS_PROJECT_PACKAGE_IMAGE_REF_PREFIX}${image.id}`, uploaded.url);
    urls.set(image.dataUrl, uploaded.url);
  }

  const restoreNodes = (nodes: CanvasDocument["nodes"]) => nodes.map((node) => {
    const oldUrl = typeof node.data.url === "string" ? node.data.url : "";
    const embedded = (packageValue.embeddedImages || []).find((image) => urls.has(oldUrl) && urls.get(oldUrl) === uploads.get(image.id)?.url);
    const uploaded = embedded ? uploads.get(embedded.id) : undefined;
    const data = replaceCanvasMediaUrls(node.data, urls);
    if (!uploaded || !node.data.kind || node.data.kind !== "image") return { ...node, data };
    const nextData = { ...data };
    delete nextData.assetId;
    delete nextData.sourceAssetId;
    delete nextData.storageKey;
    if (uploaded.storageKey) nextData.storageKey = uploaded.storageKey;
    return { ...node, data: nextData };
  });

  const restoredDocument = { ...packageValue.document, nodes: restoreNodes(packageValue.document.nodes) };
  const restoredAssets = packageValue.assets.map((asset) => {
    const node = restoredDocument.nodes.find((item) => item.id === asset.nodeId && item.data.kind === "image");
    const restoredAsset = { ...asset, ...(asset.url ? { url: urls.get(asset.url) || asset.url } : {}) };
    if (node) {
      delete restoredAsset.storageKey;
      delete restoredAsset.sourceAssetId;
      if (typeof node.data.url === "string") restoredAsset.url = node.data.url;
      if (typeof node.data.storageKey === "string") restoredAsset.storageKey = node.data.storageKey;
      if (typeof node.data.sourceAssetId === "string") restoredAsset.sourceAssetId = node.data.sourceAssetId;
    }
    return restoredAsset;
  });
  return {
    ...packageValue,
    assets: restoredAssets,
    document: restoredDocument,
    project: {
      ...packageValue.project,
      ...(packageValue.project.versions ? {
        versions: packageValue.project.versions.map((version) => ({
          ...version,
          snapshot: { ...version.snapshot, nodes: restoreNodes(version.snapshot.nodes) },
        })),
      } : {}),
    },
  };
}

export function parseCanvasProjectPackage(value: unknown): CanvasProjectPackage | null {
  if (!isRecord(value)
    || value.schema !== CANVAS_PROJECT_PACKAGE_SCHEMA
    || (value.version !== 1 && value.version !== CANVAS_PROJECT_PACKAGE_VERSION)
    || !isRecord(value.project)
    || !isRecord(value.document)
    || !Array.isArray(value.assets)
    || !Array.isArray(value.document.nodes)
    || !Array.isArray(value.document.edges)
    || !Array.isArray(value.document.groups)
    || !isRecord(value.document.camera)) return null;

  const name = cleanText(value.project.name, 120) || "SANMAO 无限画布";
  const projectId = cleanText(value.project.projectId, 300);
  const brief = normalizeCreativeProjectBrief(value.project.brief);
  const referenceAssetIds = normalizeReferenceAssetIds(value.project.referenceAssetIds);
  const versions = Array.isArray(value.project.versions)
    ? value.project.versions
      .map(versionManifest)
      .filter((version): version is CanvasProjectPackageVersion => Boolean(version))
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-50)
    : [];
  if (Object.prototype.hasOwnProperty.call(value, "embeddedImages") && !Array.isArray(value.embeddedImages)) return null;
  const embeddedImages = Array.isArray(value.embeddedImages) ? value.embeddedImages.map((item) => {
    if (!isRecord(item)) return null;
    const id = cleanText(item.id, 100);
    const name = cleanText(item.name, 160) || "未命名图片";
    const dataUrl = typeof item.dataUrl === "string" ? item.dataUrl : "";
    const byteSize = canvasProjectPackageImageByteSize(dataUrl);
    if (!/^[a-z0-9_-]+$/i.test(id)
      || !/^data:image\/(?:png|jpeg|webp|gif|bmp|svg\+xml);base64,/i.test(dataUrl)
      || byteSize === null
      || byteSize <= 0
      || byteSize > CANVAS_PROJECT_PACKAGE_MAX_IMAGE_BYTES) return null;
    return { id, name, dataUrl };
  }) : [];
  if (embeddedImages.some((image) => image === null)) return null;
  const validEmbeddedImages = embeddedImages as CanvasProjectPackageImage[];
  if (new Set(validEmbeddedImages.map((image) => image.id)).size !== validEmbeddedImages.length
    || validEmbeddedImages.reduce((total, image) => total + (canvasProjectPackageImageByteSize(image.dataUrl) || 0), 0) > CANVAS_PROJECT_PACKAGE_MAX_EMBEDDED_IMAGE_BYTES) return null;
  const assets = value.assets.flatMap((item) => {
    if (!isRecord(item)) return [];
    const nodeId = cleanText(item.nodeId, 300);
    if (!nodeId) return [];
    const createdAt = Number(item.createdAt);
    return [{
      nodeId,
      name: cleanText(item.name, 120) || "未命名素材",
      kind: mediaKind(item.kind),
      ...(cleanText(item.url, 2000) ? { url: cleanText(item.url, 2000) } : {}),
      ...(cleanText(item.storageKey, 500) ? { storageKey: cleanText(item.storageKey, 500) } : {}),
      ...(cleanText(item.sourceAssetId, 300) ? { sourceAssetId: cleanText(item.sourceAssetId, 300) } : {}),
      ...(cleanText(item.prompt, 2000) ? { prompt: cleanText(item.prompt, 2000) } : {}),
      ...(cleanText(item.modelName, 160) ? { modelName: cleanText(item.modelName, 160) } : {}),
      ...(Number.isFinite(createdAt) && createdAt > 0 ? { createdAt } : {}),
    }];
  });
  const parsed: CanvasProjectPackage = {
    schema: CANVAS_PROJECT_PACKAGE_SCHEMA,
    version: value.version,
    exportedAt: cleanText(value.exportedAt, 80) || new Date(0).toISOString(),
    project: {
      name,
      ...(projectId ? { projectId } : {}),
      ...(brief ? { brief } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
      ...(versions.length ? { versions } : {}),
    },
    document: value.document as unknown as CanvasDocument,
    assets,
    ...(validEmbeddedImages.length ? { embeddedImages: validEmbeddedImages } : {}),
  };
  const availableRefs = new Set(validEmbeddedImages.map((image) => `${CANVAS_PROJECT_PACKAGE_IMAGE_REF_PREFIX}${image.id}`));
  if ([...packageImageReferences(parsed)].some((reference) => !availableRefs.has(reference))) return null;
  return parsed;
}
