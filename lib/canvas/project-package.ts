import { normalizeCreativeProjectBrief, type CreativeProjectBrief } from "@/packages/contracts/creative";
import type { CanvasDocument, CanvasMediaKind, CanvasSnapshot } from "@/lib/canvas/types";

export const CANVAS_PROJECT_PACKAGE_SCHEMA = "sanmao.canvas.project";
export const CANVAS_PROJECT_PACKAGE_VERSION = 1;

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
  snapshot: CanvasSnapshot;
};

export type CanvasProjectPackage = {
  schema: typeof CANVAS_PROJECT_PACKAGE_SCHEMA;
  version: typeof CANVAS_PROJECT_PACKAGE_VERSION;
  exportedAt: string;
  project: {
    name: string;
    projectId?: string;
    brief?: CreativeProjectBrief;
    versions?: CanvasProjectPackageVersion[];
  };
  document: CanvasDocument;
  assets: CanvasProjectPackageAsset[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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
  versions?: readonly CanvasProjectPackageVersion[];
  document: CanvasDocument;
  exportedAt?: string;
}) {
  const brief = normalizeCreativeProjectBrief(input.brief);
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

export function parseCanvasProjectPackage(value: unknown): CanvasProjectPackage | null {
  if (!isRecord(value)
    || value.schema !== CANVAS_PROJECT_PACKAGE_SCHEMA
    || value.version !== CANVAS_PROJECT_PACKAGE_VERSION
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
  const versions = Array.isArray(value.project.versions)
    ? value.project.versions
      .map(versionManifest)
      .filter((version): version is CanvasProjectPackageVersion => Boolean(version))
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-50)
    : [];
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
  return {
    schema: CANVAS_PROJECT_PACKAGE_SCHEMA,
    version: CANVAS_PROJECT_PACKAGE_VERSION,
    exportedAt: cleanText(value.exportedAt, 80) || new Date(0).toISOString(),
    project: {
      name,
      ...(projectId ? { projectId } : {}),
      ...(brief ? { brief } : {}),
      ...(versions.length ? { versions } : {}),
    },
    document: value.document as unknown as CanvasDocument,
    assets,
  };
}
