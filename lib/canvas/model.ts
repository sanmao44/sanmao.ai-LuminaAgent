import type {
  CanvasCamera,
  CanvasConnectionStyle,
  CanvasDocument,
  CanvasEdge,
  CanvasGenerationParams,
  CanvasGroup,
  CanvasInputRole,
  CanvasMediaKind,
  CanvasMaskState,
  CanvasNode,
  CanvasNodeData,
  CanvasSnapshot,
  CanvasVariantState,
  CanvasUpscaleParams,
} from "./types";
import { normalizeCreationSettings } from "../creation/settings";
import { normalizeCanvasMaskState } from "./mask";
import { normalizeCanvasNodeLayers } from "./layers";

export const CANVAS_VERSION = "sanmao-canvas-3";
export const MAX_CANVAS_VARIANTS = 8;

export function normalizeVariantRequirements(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  const normalized = source
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, MAX_CANVAS_VARIANTS);
  return normalized.length ? normalized : [""];
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultCamera(width = 1200, height = 760): CanvasCamera {
  return { x: width / 2, y: height / 2, zoom: 1 };
}

export function normalizeCamera(
  value: unknown,
  fallback = defaultCamera(),
): CanvasCamera {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<CanvasCamera>;
  return {
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : fallback.x,
    y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : fallback.y,
    zoom: Math.max(
      0.12,
      Math.min(
        3,
        Number.isFinite(Number(raw.zoom)) ? Number(raw.zoom) : fallback.zoom,
      ),
    ),
  };
}

function nodeType(value: unknown): CanvasNode["type"] {
  return value === "prompt" || value === "generator" || value === "upscale" ? value : "media";
}

function mediaKind(value: unknown): CanvasMediaKind {
  return value === "video" ? "video" : value === "audio" ? "audio" : "image";
}

/** Nodes that currently expose a usable image/video URL to other nodes. */
export function isCanvasReferenceableNode(node: CanvasNode | undefined) {
  return Boolean(
    node &&
      (node.type === "media" || node.type === "upscale") &&
      node.data.kind &&
      node.data.url,
  );
}

/** Only completed image outputs can feed the dedicated upscale input. */
export function isCanvasReadyImageSource(node: CanvasNode | undefined) {
  if (!node || !isCanvasReferenceableNode(node)) return false;
  return (
    node.data.kind === "image" &&
    !["queued", "running", "failed"].includes(node.data.status || "")
  );
}

function normalizeUpscaleParams(value: unknown): CanvasUpscaleParams {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const scaleValue = Number(raw.scale ?? raw.upscaleScale);
  const scale = [1, 2, 3, 4].includes(scaleValue)
    ? scaleValue as CanvasUpscaleParams["scale"]
    : 2;
  const target = raw.target ?? raw.targetSize ?? raw.upscaleTarget;
  const algorithm = raw.algorithm ?? raw.upscaleAlgorithm;
  const outputFormat = raw.outputFormat ?? raw.upscaleOutputFormat;
  const outputQuality = Number(raw.outputQuality ?? raw.upscaleOutputQuality);
  return {
    kind: "upscale",
    model: typeof (raw.model ?? raw.modelId ?? raw.upscaleModelId) === "string" ? String(raw.model ?? raw.modelId ?? raw.upscaleModelId) : "auto",
    scale,
    target: target === "1K" || target === "2K" || target === "4K" ? target : "auto",
    seed: Number.isFinite(Number(raw.seed ?? raw.upscaleSeed)) ? Math.max(0, Math.round(Number(raw.seed ?? raw.upscaleSeed))) : 42,
    colorCorrection: raw.colorCorrection === "none" || raw.upscaleColorCorrection === "none" ? "none" : "wavelet",
    algorithm: algorithm === "bicubic" ? "bicubic" : algorithm === "nearest" ? "nearest" : "lanczos",
    ...(outputFormat === "jpg" || outputFormat === "bmp" ? { outputFormat } : { outputFormat: "png" }),
    ...(Number.isFinite(outputQuality) ? { outputQuality: Math.max(30, Math.min(100, Math.round(outputQuality))) } : { outputQuality: 95 }),
    ...(typeof raw.prompt === "string" ? { prompt: raw.prompt } : {}),
  };
}

function normalizeVideoNodeParams(data: CanvasNodeData) {
  const currentParams =
    data.params && typeof data.params === "object"
      ? data.params
      : data.generation?.params;
  return normalizeCreationSettings("video", currentParams);
}

const DEFAULT_VIDEO_ASPECT_RATIO = 16 / 9;
const MEDIA_CARD_FOOTER_HEIGHT = 42;
const MEDIA_IMAGE_FOOTER_HEIGHT = 48;
// The upscale card has a header and a status row instead of the compact
// media footer. Keep this value in one place so the result preview can use
// the full image ratio while the node still reserves its chrome.
const UPSCALE_CARD_HORIZONTAL_CHROME = 34;
const UPSCALE_CARD_CHROME_HEIGHT = 111;

function positiveRatio(value: unknown) {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function ratioFromAspect(value: unknown, fallback: number) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = width / height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : fallback;
}

function videoAspectRatio(params?: CanvasGenerationParams) {
  const aspect = params && "aspect" in params ? params.aspect : undefined;
  return ratioFromAspect(aspect, DEFAULT_VIDEO_ASPECT_RATIO);
}

function nativeMediaRatio(data: CanvasNodeData) {
  const width = positiveRatio(data.nativeWidth);
  const height = positiveRatio(data.nativeHeight);
  return width && height ? width / height : null;
}

function normalizeNode(value: unknown): CanvasNode | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CanvasNode> & { data?: unknown };
  if (
    !raw.id ||
    !Number.isFinite(Number(raw.x)) ||
    !Number.isFinite(Number(raw.y))
  )
    return null;
  const data =
    raw.data && typeof raw.data === "object"
      ? clone(raw.data as CanvasNodeData)
      : {};
  const type = nodeType(raw.type);
  if (type === "media" || type === "generator")
    data.kind = mediaKind(data.kind);
  if (type === "media" && data.kind === "audio") {
    const legacyParams =
      data.params && typeof data.params === "object"
        ? data.params as Record<string, unknown>
        : undefined;
    if (legacyParams?.kind === "video" || "inputMode" in (legacyParams || {}))
      delete data.params;
    const legacyGenerationParams =
      data.generation?.params && typeof data.generation.params === "object"
        ? data.generation.params as Record<string, unknown>
        : undefined;
    if (
      legacyGenerationParams?.kind === "video" ||
      "inputMode" in (legacyGenerationParams || {})
    )
      delete data.generation;
    if (!data.url && data.status === "draft") {
      data.statusLabel = "等待导入音频";
      data.role = "待导入";
    }
  }
  if (type === "media" && data.kind === "video")
    data.params = normalizeVideoNodeParams(data);
  if (type === "prompt")
    data.params = normalizeCreationSettings("text", data.params);
  if (type === "upscale") {
    data.params = normalizeUpscaleParams({
      ...(data as Record<string, unknown>),
      ...(data.params && typeof data.params === "object" ? data.params : {}),
    });
    data.kind = "image";
    data.autoFit = data.autoFit !== false;
    data.status = data.status || "draft";
    data.statusLabel = data.statusLabel || "等待连接图片";
    if (data.generation && typeof data.generation === "object") {
      data.generation = {
        ...data.generation,
        kind: "image",
        operation: "upscale",
        prompt: String(data.generation.prompt || data.prompt || "Upscale this image"),
        params: normalizeUpscaleParams({
          ...(data.generation.params && typeof data.generation.params === "object" ? data.generation.params : {}),
          ...(data.params && typeof data.params === "object" ? data.params : {}),
        }),
      };
    }
  }
  if (type === "generator") {
    const kind = mediaKind(data.kind || "image");
    if (kind === "video" && typeof data.videoInputModeAuto !== "boolean")
      data.videoInputModeAuto = true;
    data.params =
      kind === "image"
        ? normalizeCreationSettings("image", data.params)
        : normalizeCreationSettings("video", data.params);
    data.variantRequirements = normalizeVariantRequirements(
      data.variantRequirementsText ?? data.variantRequirements,
    );
    data.variantRequirementsText =
      typeof data.variantRequirementsText === "string"
        ? data.variantRequirementsText
        : data.variantRequirements.join("\n");
    if (Array.isArray(data.variantStates)) {
      data.variantStates = data.variantStates
        .filter((item) => Boolean(item && typeof item === "object"))
        .slice(0, MAX_CANVAS_VARIANTS)
        .map((item, index) => ({
          id: String(item.id || `variant-${index + 1}`),
          instruction: String(
            item.instruction || data.variantRequirements?.[index] || "",
          ),
          status:
            item.status === "running" ||
            item.status === "completed" ||
            item.status === "failed"
              ? item.status
              : "pending",
          resultIds: Array.isArray(item.resultIds)
            ? item.resultIds.map(String)
            : [],
          ...(Array.isArray(item.taskIds)
            ? { taskIds: item.taskIds.map(String) }
            : {}),
          ...(Number.isFinite(Number(item.progress))
            ? { progress: Number(item.progress) }
            : {}),
          ...(item.error ? { error: String(item.error) } : {}),
          ...(Number.isFinite(Number(item.updatedAt))
            ? { updatedAt: Number(item.updatedAt) }
            : {}),
        }));
    }
  }
  if (type === "media" && data.kind === "video" && typeof data.videoInputModeAuto !== "boolean")
    data.videoInputModeAuto = true;
  if (type === "media" && data.generation) {
    const kind = mediaKind(data.generation.kind || data.kind);
    data.generation = kind === "audio"
      ? { ...data.generation, kind }
      : {
          ...data.generation,
          kind,
          params:
            data.generation.operation === "upscale"
              ? normalizeUpscaleParams(data.generation.params)
              : kind === "image"
              ? normalizeCreationSettings("image", data.generation.params)
              : normalizeCreationSettings("video", data.generation.params),
        };
  }
  if (type === "media" && data.kind === "image") {
    const generationParams = data.generation?.params;
    const paramsMask =
      data.params && typeof data.params === "object"
        ? (data.params as Record<string, unknown>).mask
        : undefined;
    const generationMask =
      generationParams && typeof generationParams === "object"
        ? (generationParams as Record<string, unknown>).mask
        : undefined;
    const mask = normalizeCanvasMaskState(
      data.mask,
      generationMask || paramsMask,
    );
    if (mask) data.mask = mask as CanvasMaskState;
  }
  const videoSizeRatio =
    type === "media" && data.kind === "video" && data.autoFit !== false
      ? nativeMediaRatio(data) ||
        videoAspectRatio(data.params as CanvasGenerationParams | undefined)
      : null;
  const intrinsicVideoSize = videoSizeRatio
    ? mediaCardSizeForRatio(videoSizeRatio, "video")
    : undefined;
  const upscaleSizeRatio =
    type === "upscale" && data.url && data.autoFit !== false
      ? nativeMediaRatio(data)
      : null;
  const intrinsicUpscaleSize = upscaleSizeRatio
    ? upscaleCardSizeForRatio(upscaleSizeRatio)
    : undefined;
  return {
    id: String(raw.id),
    type,
    x: Number(raw.x),
    y: Number(raw.y),
    ...(Number.isFinite(Number(raw.w)) ? { w: Number(raw.w) } : {}),
    ...(Number.isFinite(Number(raw.h)) ? { h: Number(raw.h) } : {}),
    ...(typeof raw.zIndex === "number" && Number.isFinite(raw.zIndex)
      ? { zIndex: Math.trunc(raw.zIndex) }
      : {}),
    ...(raw.groupId ? { groupId: String(raw.groupId) } : {}),
    ...(intrinsicVideoSize || intrinsicUpscaleSize || {}),
    data,
  };
}

function withoutGroupId(node: CanvasNode): CanvasNode {
  const { groupId: _groupId, ...rest } = node;
  return rest;
}

function normalizeEdge(value: unknown): CanvasEdge | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CanvasEdge>;
  if (!raw.id || !raw.source || !raw.target) return null;
  return {
    id: String(raw.id),
    source: String(raw.source),
    target: String(raw.target),
    ...(Array.isArray(raw.sourceNodeIds)
      ? { sourceNodeIds: [...new Set(raw.sourceNodeIds.map((id) => String(id)))] }
      : {}),
    sourcePort: raw.sourcePort === "left" ? "left" : "right",
    targetPort: raw.targetPort === "right" ? "right" : "left",
    ...(raw.inputRole ? { inputRole: normalizeInputRole(raw.inputRole) } : {}),
    ...(Number.isFinite(Number(raw.order)) ? { order: Number(raw.order) } : {}),
    kind:
      raw.kind === "generated" ||
      raw.kind === "variant" ||
      raw.kind === "lineage" ||
      raw.kind === "reference"
        ? raw.kind
        : "manual",
  };
}

function normalizeInputRole(value: unknown): CanvasInputRole | undefined {
  if (value === "base-image") return "reference-image";
  return value === "prompt" ||
    value === "context" ||
    value === "reference-image" ||
    value === "audio" ||
    value === "mask" ||
    value === "video" ||
    value === "first-frame" ||
    value === "last-frame" ||
    value === "upscale-image"
    ? value
    : undefined;
}

function inferInputRoleFromNodes(
  source: CanvasNode,
  target: CanvasNode,
  inputMode?: "text" | "first-frame" | "frames" | "reference",
  position = 0,
): CanvasInputRole | undefined {
  if (source.type === "prompt" || source.type === "generator") return "context";
  const sourceKind = source.type === "media" || source.type === "upscale" ? source.data.kind : undefined;
  const targetKind = target.type === "media" || target.type === "generator" ? target.data.kind : undefined;
  if (!sourceKind || !targetKind) return undefined;
  if (sourceKind === "audio") return targetKind === "video" ? "audio" : undefined;
  if (targetKind === "image") return sourceKind === "video" ? "video" : "reference-image";
  if (sourceKind === "video") return "video";
  if (inputMode === "frames") return position === 0 ? "first-frame" : position === 1 ? "last-frame" : "reference-image";
  if (inputMode === "first-frame") return position === 0 ? "first-frame" : "reference-image";
  return "reference-image";
}

function hasPath(document: CanvasDocument, source: string, target: string) {
  const visited = new Set<string>();
  const pending = [target];
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === source) return true;
    visited.add(current);
    document.edges.forEach((edge) => {
      if (edge.source === current && !visited.has(edge.target)) pending.push(edge.target);
    });
  }
  return false;
}

export function canConnect(
  document: CanvasDocument,
  source: string,
  target: string,
  inputRole?: CanvasInputRole,
) {
  if (!source || !target || source === target) return { ok: false, reason: "不能连接自身" };
  if (!nodeById(document, source) && !groupById(document, source)) return { ok: false, reason: "源节点不存在" };
  if (!nodeById(document, target) && !groupById(document, target)) return { ok: false, reason: "目标节点不存在" };
  if (hasPath(document, source, target)) return { ok: false, reason: "这条连接会形成循环" };
  const sourceNode = nodeById(document, source);
  const sourceGroup = groupById(document, source);
  const targetNode = nodeById(document, target);
  const targetKind = targetNode && (targetNode.type === "media" || targetNode.type === "generator")
    ? targetNode.data.kind
    : undefined;
  const sourceHasAudio = Boolean(
    (sourceNode && sourceNode.data.kind === "audio") ||
    sourceGroup?.nodeIds.some((nodeId) => nodeById(document, nodeId)?.data.kind === "audio"),
  );
  if (
    targetKind === "image" &&
    sourceNode &&
    isCanvasReferenceableNode(sourceNode) &&
    sourceNode.data.kind === "video"
  )
    return { ok: false, reason: "图片节点不能接收视频作为图片参考。" };
  if (targetKind === "audio")
    return { ok: false, reason: "音频节点目前是独立素材输入，不能接收其他节点。" };
  if (
    sourceHasAudio &&
    targetKind !== "video"
  )
    return { ok: false, reason: "参考音频只能连接到视频节点。" };
  if (inputRole === "audio" && targetKind !== "video")
    return { ok: false, reason: "参考音频只能连接到视频节点。" };
  if (targetNode?.type === "upscale") {
    if (!isCanvasReadyImageSource(sourceNode))
      return { ok: false, reason: "超分节点只接受一张已完成的图片" };
    if (document.edges.some((edge) => edge.target === target))
      return { ok: false, reason: "超分节点只能连接一张图片" };
    inputRole = "upscale-image";
  }
  return { ok: true as const };
}

export function normalizeDocument(
  value: unknown,
  width = 1200,
  height = 760,
): CanvasDocument {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<CanvasDocument>)
      : {};
  const nodes = Array.isArray(raw.nodes)
    ? (raw.nodes.map(normalizeNode).filter(Boolean) as CanvasNode[])
    : [];
  const originalNodeIds = new Set(nodes.map((node) => node.id));
  const legacyUpscaleResultIds = new Set<string>();
  const legacyUpscaleResultParentIds = new Map<string, string>();
  const latestLegacyUpscaleResults = new Map<string, CanvasNode>();
  const legacyResultTimestamp = (node: CanvasNode) => {
    const generation = node.data.generation;
    const values = [
      generation?.updatedAt,
      generation?.createdAt,
      node.data.updatedAt,
    ];
    return values
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value)) || 0;
  };

  nodes.forEach((node) => {
    if (node.type !== "media" || node.data.generation?.operation !== "upscale") return;
    const parentNodeId = node.data.generation.parentNodeId;
    const parent = nodes.find((candidate) => candidate.id === parentNodeId);
    if (!parent || parent.type !== "upscale") return;
    legacyUpscaleResultIds.add(node.id);
    legacyUpscaleResultParentIds.set(node.id, parent.id);
    const current = latestLegacyUpscaleResults.get(parent.id);
    if (!current || legacyResultTimestamp(node) >= legacyResultTimestamp(current)) {
      latestLegacyUpscaleResults.set(parent.id, node);
    }
  });

  // Before results were written directly to the upscale node, each run added
  // a separate media card. Fold those saved results into their owning node so
  // existing canvases converge on the current single-node representation.
  const migratedNodes = nodes
    .filter((node) => !legacyUpscaleResultIds.has(node.id))
    .map((node) => {
      const legacyResult = latestLegacyUpscaleResults.get(node.id);
      if (!legacyResult) return node;
      const legacyGeneration = legacyResult.data.generation;
      const resultParams = normalizeUpscaleParams(
        legacyGeneration?.params || legacyResult.data.params || node.data.params,
      );
      const prompt = String(
        legacyGeneration?.prompt ||
          legacyResult.data.prompt ||
          node.data.generation?.prompt ||
          node.data.prompt ||
          "Upscale this image",
      );
      const data: CanvasNodeData = {
        ...node.data,
        kind: "image",
        role: "超分结果",
        resultSource: "upscale-node",
        status: legacyResult.data.status || "completed",
        statusLabel: "超分节点生成的结果",
        progress: Number.isFinite(Number(legacyResult.data.progress))
          ? Number(legacyResult.data.progress)
          : 100,
        params: resultParams,
        generation: {
          ...(legacyGeneration || {}),
          kind: "image",
          prompt,
          params: resultParams,
          operation: "upscale",
          parentNodeId: node.id,
        },
      };
      [
        "url",
        "name",
        "model",
        "assetId",
        "sourceAssetId",
        "autoFit",
        "nativeWidth",
        "nativeHeight",
        "jobId",
        "processingStartedAt",
      ].forEach((key) => {
        if (legacyResult.data[key] !== undefined) data[key] = legacyResult.data[key];
      });
      return { ...node, data };
    });
  const nodeIds = new Set(migratedNodes.map((node) => node.id));
  const groups = Array.isArray(raw.groups)
    ? raw.groups
        .filter((group): group is CanvasGroup =>
          Boolean(group && typeof group === "object"),
        )
        .map((group) => ({
          id: String(group.id || uid("group")),
          name: String(group.name || "对象组"),
          nodeIds: Array.isArray(group.nodeIds)
            ? [...new Set(group.nodeIds.map(String).map((id) => legacyUpscaleResultParentIds.get(id) || id))].filter((id) =>
                nodeIds.has(id),
              )
            : [],
        }))
        .filter(
          (group, index, all) =>
            group.nodeIds.length >= 2 &&
            all.findIndex((item) => item.id === group.id) === index,
        )
    : [];
  const groupIds = new Set(groups.map((group) => group.id));
  const groupMembership = new Map<string, string>();
  groups.forEach((group) =>
    group.nodeIds.forEach((id) => {
      if (!groupMembership.has(id)) groupMembership.set(id, group.id);
    }),
  );
  const normalizedNodes = normalizeCanvasNodeLayers(
    migratedNodes.map((node) =>
      groupMembership.has(node.id)
        ? { ...node, groupId: groupMembership.get(node.id) }
        : withoutGroupId(node),
    ),
  );
  const rawEdges = Array.isArray(raw.edges)
    ? (raw.edges
        .map(normalizeEdge)
        .filter(Boolean)
        .filter(
          (edge) => originalNodeIds.has(edge!.source) || groupIds.has(edge!.source),
        )
        .filter(
          (edge) => originalNodeIds.has(edge!.target) || groupIds.has(edge!.target),
        ) as CanvasEdge[])
    : [];
  const migratedEdges = rawEdges
    .filter((edge) => !legacyUpscaleResultIds.has(edge.target))
    .map((edge) => ({
      ...edge,
      source: legacyUpscaleResultParentIds.get(edge.source) || edge.source,
    }))
    .filter((edge) => edge.source !== edge.target)
    .filter(
      (edge) => nodeIds.has(edge.source) || groupIds.has(edge.source),
    )
    .filter(
      (edge) => nodeIds.has(edge.target) || groupIds.has(edge.target),
    );
  const upscaleTargets = new Set<string>();
  const usableEdges = migratedEdges.filter((edge) => {
    const targetNode = normalizedNodes.find((node) => node.id === edge.target);
    if (targetNode?.type !== "upscale") return true;
    const sourceNode = normalizedNodes.find((node) => node.id === edge.source);
    if (!sourceNode || sourceNode.type !== "media" || sourceNode.data.kind !== "image" || !sourceNode.data.url || upscaleTargets.has(targetNode.id)) return false;
    upscaleTargets.add(targetNode.id);
    return true;
  });
  const targetOrder = new Map<string, number>();
  usableEdges.forEach((edge) => {
    if (!targetOrder.has(edge.target)) targetOrder.set(edge.target, targetOrder.size);
  });
  const orderedUsableEdges = usableEdges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftTargetOrder = targetOrder.get(left.edge.target) || 0;
      const rightTargetOrder = targetOrder.get(right.edge.target) || 0;
      if (leftTargetOrder !== rightTargetOrder) return leftTargetOrder - rightTargetOrder;
      const leftOrder = Number(left.edge.order);
      const rightOrder = Number(right.edge.order);
      const leftHasOrder = Number.isFinite(leftOrder);
      const rightHasOrder = Number.isFinite(rightOrder);
      if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
      return left.index - right.index;
    });
  const edgeInputPositions = new Map<string, number>();
  const normalizedEdgeMap = new Map<CanvasEdge, CanvasEdge>();
  orderedUsableEdges.forEach(({ edge }) => {
    const targetNode = normalizedNodes.find((node) => node.id === edge.target);
    if (targetNode?.type === "upscale") {
      normalizedEdgeMap.set(edge, { ...edge, inputRole: "upscale-image" as CanvasInputRole });
      return;
    }
    const sourceNode = normalizedNodes.find((node) => node.id === edge.source);
    if (!sourceNode || !targetNode) {
      normalizedEdgeMap.set(edge, edge);
      return;
    }
    const inputPosition = edgeInputPositions.get(edge.target) || 0;
    const sourceIsImageInput = isCanvasReferenceableNode(sourceNode) && sourceNode.data.kind === "image";
    if (sourceIsImageInput) edgeInputPositions.set(edge.target, inputPosition + 1);
    if (edge.inputRole) {
      normalizedEdgeMap.set(
        edge,
        Number.isFinite(Number(edge.order)) || !sourceIsImageInput
          ? edge
          : { ...edge, order: inputPosition },
      );
      return;
    }
    const params = targetNode.data.params;
    const inputMode = params && typeof params === "object" && "inputMode" in params
      ? params.inputMode
      : undefined;
    const inputRole = inferInputRoleFromNodes(
      sourceNode,
      targetNode,
      inputMode === "first-frame" || inputMode === "frames" || inputMode === "reference" || inputMode === "text" ? inputMode : undefined,
      inputPosition,
    );
    normalizedEdgeMap.set(edge, inputRole ? { ...edge, inputRole } : edge);
  });
  const edges = usableEdges.map((edge) => normalizedEdgeMap.get(edge) || edge);
  return {
    version: CANVAS_VERSION,
    nodes: normalizedNodes,
    edges,
    groups,
    camera: normalizeCamera(raw.camera, defaultCamera(width, height)),
  };
}

/**
 * A browser refresh cancels in-flight image/Agent requests, while remote
 * video and upscale tasks can continue on the server. Keep the latter
 * resumable and turn the former into an explicit retryable state instead of
 * leaving a canvas node stuck on "running" forever.
 */
export function recoverInterruptedCanvasDocument(
  document: CanvasDocument,
  now = Date.now(),
) {
  const resumableVideoTaskIds = new Set(
    document.nodes
      .filter((node) => node.type === "media" && node.data.kind === "video")
      .map((node) => String(node.data.jobId || node.data.generation?.taskId || ""))
      .filter(Boolean),
  );
  const interruptedLabel = "上次任务已中断，可重试";
  let recoveredCount = 0;

  const interrupted = (node: CanvasNode, statusLabel = interruptedLabel) => {
    recoveredCount += 1;
    return {
      ...node,
      data: {
        ...node.data,
        status: "failed" as const,
        statusLabel,
        processingStartedAt: undefined,
      },
    };
  };

  const nodes = document.nodes.map((node) => {
    const status = node.data.status;
    const pending = status === "queued" || status === "running";
    if (!pending) return node;

    if (node.type === "prompt") return interrupted(node, "上次 Agent 请求已中断，可重试");

    if (node.type === "media") {
      const taskId = String(node.data.jobId || node.data.generation?.taskId || "");
      if (node.data.kind === "video" && taskId) return node;
      return interrupted(node, `${node.data.kind === "video" ? "上次视频任务" : "上次图片任务"}已中断，可重试`);
    }

    if (node.type === "upscale") {
      if (node.data.jobId && node.data.upscaleRequestId) return node;
      return interrupted(node, "上次超分任务已中断，可重试");
    }

    const rawStates = Array.isArray(node.data.variantStates)
      ? node.data.variantStates
      : [];
    if (!rawStates.length) return interrupted(node, "上次变体任务已中断，可重试");
    let changed = false;
    const variantStates = rawStates.map((state: CanvasVariantState) => {
      if (state.status !== "pending" && state.status !== "running") return state;
      const hasResumableVideoTask = (state.taskIds || []).some((taskId) =>
        resumableVideoTaskIds.has(String(taskId)),
      );
      if (hasResumableVideoTask) return state;
      changed = true;
      recoveredCount += 1;
      return {
        ...state,
        status: "failed" as const,
        error: interruptedLabel,
        updatedAt: now,
      };
    });
    if (!changed) return node;
    const nextStatus: CanvasNodeData["status"] = variantStates.some((state) => state.status === "running")
      ? "running"
      : variantStates.some((state) => state.status === "failed")
        ? "failed"
        : variantStates.length && variantStates.every((state) => state.status === "completed")
          ? "completed"
          : "queued";
    return {
      ...node,
      data: {
        ...node.data,
        variantStates,
        status: nextStatus,
        statusLabel: nextStatus === "failed" ? "上次变体任务已中断，可重试" : node.data.statusLabel,
        processingStartedAt: nextStatus === "running" ? node.data.processingStartedAt : undefined,
      },
    };
  });

  return { document: { ...document, nodes }, recoveredCount };
}

export function snapshot(document: CanvasDocument): CanvasSnapshot {
  return clone({
    nodes: document.nodes,
    edges: document.edges,
    groups: document.groups,
    camera: document.camera,
  });
}

export function restoreSnapshot(
  document: CanvasDocument,
  value: CanvasSnapshot,
): CanvasDocument {
  return normalizeDocument(value, document.camera.x * 2, document.camera.y * 2);
}

export function nodeSize(node: Pick<CanvasNode, "type" | "w" | "h">) {
  return {
    w:
      node.w ||
      (node.type === "media" ? 320 : node.type === "prompt" ? 270 : node.type === "upscale" ? 360 : 306),
    h:
      node.h ||
      (node.type === "media" ? 220 : node.type === "prompt" ? 170 : node.type === "upscale" ? 260 : 238),
  };
}

export function nodeById(document: CanvasDocument, id: string | undefined) {
  return document.nodes.find((node) => node.id === id);
}

export function groupById(document: CanvasDocument, id: string | undefined) {
  return document.groups.find((group) => group.id === id);
}

export function groupNodes(document: CanvasDocument, groupId: string) {
  const group = groupById(document, groupId);
  return group
    ? (group.nodeIds
        .map((id) => nodeById(document, id))
        .filter(Boolean) as CanvasNode[])
    : [];
}

export function groupContentBounds(document: CanvasDocument, groupId: string) {
  const nodes = groupNodes(document, groupId);
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + nodeSize(node).w));
  const maxY = Math.max(...nodes.map((node) => node.y + nodeSize(node).h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function groupBounds(document: CanvasDocument, groupId: string) {
  const content = groupContentBounds(document, groupId);
  return {
    x: content.x - 30,
    y: content.y - 48,
    w: content.w + 60,
    h: content.h + 78,
  };
}

export function groupAtPoint(
  document: CanvasDocument,
  point: { x: number; y: number },
) {
  return [...document.groups]
    .reverse()
    .find((group) => {
      const bounds = groupBounds(document, group.id);
      return (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.w &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.h
      );
    });
}

export function entityBounds(document: CanvasDocument, id: string) {
  const group = groupById(document, id);
  if (group) return groupBounds(document, group.id);
  const node = nodeById(document, id);
  if (!node) return { x: 0, y: 0, w: 0, h: 0 };
  const size = nodeSize(node);
  return { x: node.x, y: node.y, w: size.w, h: size.h };
}

/** Resolve a persisted edge to the entities it should touch visually. */
export function canvasEdgeEndpoints(
  document: CanvasDocument,
  edge: CanvasEdge,
) {
  const projectEntity = (id: string) => {
    const node = nodeById(document, id);
    const group = document.groups.find(
      (candidate) =>
        candidate.id === node?.groupId || candidate.nodeIds.includes(id),
    );
    return group?.id || id;
  };
  return {
    source: projectEntity(edge.source),
    target: projectEntity(edge.target),
  };
}

/** Internal member edges collapse into the group and should not be painted. */
export function isCanvasEdgeVisible(
  document: CanvasDocument,
  edge: CanvasEdge,
) {
  const endpoints = canvasEdgeEndpoints(document, edge);
  if (endpoints.source === endpoints.target) return false;
  return Boolean(
    (nodeById(document, endpoints.source) || groupById(document, endpoints.source)) &&
      (nodeById(document, endpoints.target) || groupById(document, endpoints.target)),
  );
}

export type CanvasAlignment =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";

export type CanvasDistribution = "horizontal" | "vertical";

export type CanvasAlignResult = {
  document: CanvasDocument;
  alignedIds: string[];
  changed: boolean;
};

/** Aligns ordinary nodes to the outer bounds of the current selection. */
export function alignCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  alignment: CanvasAlignment,
): CanvasAlignResult {
  const selectedIds = [...new Set(nodeIds)].filter((id) =>
    document.nodes.some((node) => node.id === id),
  );
  const selected = selectedIds
    .map((id) => nodeById(document, id))
    .filter((node): node is CanvasNode => Boolean(node));
  const next = clone(document);
  if (selected.length < 2) {
    return { document: next, alignedIds: selectedIds, changed: false };
  }

  const bounds = selected.map((node) => {
    const size = nodeSize(node);
    return {
      node,
      right: node.x + size.w,
      bottom: node.y + size.h,
    };
  });
  const left = Math.min(...bounds.map((item) => item.node.x));
  const top = Math.min(...bounds.map((item) => item.node.y));
  const right = Math.max(...bounds.map((item) => item.right));
  const bottom = Math.max(...bounds.map((item) => item.bottom));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const selectedSet = new Set(selectedIds);
  let changed = false;

  next.nodes = next.nodes.map((node) => {
    if (!selectedSet.has(node.id)) return node;
    const size = nodeSize(node);
    let x = node.x;
    let y = node.y;
    switch (alignment) {
      case "left":
        x = left;
        break;
      case "center-x":
        x = centerX - size.w / 2;
        break;
      case "right":
        x = right - size.w;
        break;
      case "top":
        y = top;
        break;
      case "center-y":
        y = centerY - size.h / 2;
        break;
      case "bottom":
        y = bottom - size.h;
        break;
      default:
        return node;
    }
    if (x !== node.x || y !== node.y) changed = true;
    return { ...node, x, y };
  });

  return { document: next, alignedIds: selectedIds, changed };
}

/** Distributes ordinary nodes with equal edge-to-edge gaps along one axis. */
export function distributeCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  direction: CanvasDistribution,
): CanvasAlignResult {
  const selectedIds = [...new Set(nodeIds)].filter((id) =>
    document.nodes.some((node) => node.id === id),
  );
  const selected = selectedIds
    .map((id) => nodeById(document, id))
    .filter((node): node is CanvasNode => Boolean(node));
  const next = clone(document);
  if ((direction !== "horizontal" && direction !== "vertical") || selected.length < 3) {
    return { document: next, alignedIds: selectedIds, changed: false };
  }

  const axis = direction === "horizontal" ? "x" : "y";
  const sizeAxis = direction === "horizontal" ? "w" : "h";
  const sorted = selected
    .map((node, index) => ({
      node,
      index,
      coordinate: node[axis],
      size: nodeSize(node)[sizeAxis],
    }))
    .sort((left, right) => left.coordinate - right.coordinate || left.index - right.index);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = first.coordinate;
  const end = last.coordinate + last.size;
  const totalSize = sorted.reduce((sum, item) => sum + item.size, 0);
  const gap = (end - start - totalSize) / (sorted.length - 1);
  const positions = new Map<string, number>();
  let cursor = start;

  sorted.forEach((item, index) => {
    const coordinate =
      index === 0
        ? start
        : index === sorted.length - 1
          ? end - item.size
          : cursor + gap;
    positions.set(item.node.id, coordinate);
    cursor = coordinate + item.size;
  });

  let changed = false;
  next.nodes = next.nodes.map((node) => {
    const coordinate = positions.get(node.id);
    if (coordinate === undefined) return node;
    if (coordinate !== node[axis]) changed = true;
    return { ...node, [axis]: coordinate };
  });

  return { document: next, alignedIds: selectedIds, changed };
}

export type CanvasArrangeResult = {
  document: CanvasDocument;
  arrangedIds: string[];
  changed: boolean;
};

type ArrangeEntity = {
  id: string;
  nodeIds: string[];
  x: number;
  y: number;
  w: number;
  h: number;
};

type ArrangePoint = { x: number; y: number };

const ARRANGE_GAP_X = 120;
const ARRANGE_GAP_Y = 72;

function arrangeTypeRank(document: CanvasDocument, entity: ArrangeEntity) {
  const node = nodeById(document, entity.nodeIds[0]);
  if (!node) return 9;
  if (node.type === "prompt") return 0;
  if (node.type === "media") return 1;
  return 2;
}

function compareArrangeEntities(
  document: CanvasDocument,
  left: ArrangeEntity,
  right: ArrangeEntity,
) {
  if (left.y !== right.y) return left.y - right.y;
  const typeDifference =
    arrangeTypeRank(document, left) - arrangeTypeRank(document, right);
  return typeDifference || left.id.localeCompare(right.id);
}

function arrangeGrid(entities: ArrangeEntity[], origin: ArrangePoint) {
  if (!entities.length)
    return { positions: new Map<string, ArrangePoint>(), width: 0, height: 0 };
  const columns = Math.max(1, Math.ceil(Math.sqrt(entities.length)));
  const rows = Math.ceil(entities.length / columns);
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      ...entities
        .filter((_, index) => index % columns === column)
        .map((entity) => entity.w),
    ),
  );
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(
      ...entities
        .slice(row * columns, (row + 1) * columns)
        .map((entity) => entity.h),
    ),
  );
  const columnX = columnWidths.reduce<number[]>((result, width, index) => {
    result[index] =
      (index ? result[index - 1] + ARRANGE_GAP_X : origin.x) + width;
    return result;
  }, []);
  const rowY = rowHeights.reduce<number[]>((result, height, index) => {
    result[index] =
      (index ? result[index - 1] + ARRANGE_GAP_Y : origin.y) + height;
    return result;
  }, []);
  const positions = new Map<string, ArrangePoint>();
  entities.forEach((entity, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.set(entity.id, {
      x: column ? columnX[column - 1] : origin.x,
      y: row ? rowY[row - 1] : origin.y,
    });
  });
  return {
    positions,
    width:
      columnWidths.reduce((total, width) => total + width, 0) +
      ARRANGE_GAP_X * Math.max(0, columns - 1),
    height:
      rowHeights.reduce((total, height) => total + height, 0) +
      ARRANGE_GAP_Y * Math.max(0, rows - 1),
  };
}

function arrangeLayered(
  document: CanvasDocument,
  entities: ArrangeEntity[],
  edges: Array<{ source: string; target: string }>,
  origin: ArrangePoint,
) {
  if (!entities.length)
    return { positions: new Map<string, ArrangePoint>(), width: 0, height: 0 };
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const outgoing = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  entities.forEach((entity) => {
    outgoing.set(entity.id, []);
    predecessors.set(entity.id, []);
    indegree.set(entity.id, 0);
  });
  const edgeKeys = new Set<string>();
  edges.forEach((edge) => {
    if (
      !byId.has(edge.source) ||
      !byId.has(edge.target) ||
      edge.source === edge.target
    )
      return;
    const key = `${edge.source}\u0000${edge.target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    outgoing.get(edge.source)!.push(edge.target);
    predecessors.get(edge.target)!.push(edge.source);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });
  const sortQueue = (left: string, right: string) =>
    compareArrangeEntities(document, byId.get(left)!, byId.get(right)!);
  const queue = [...entities]
    .filter((entity) => indegree.get(entity.id) === 0)
    .map((entity) => entity.id)
    .sort(sortQueue);
  const levels = new Map<string, number>(
    entities.map((entity) => [entity.id, 0]),
  );
  const resolved = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    resolved.add(current);
    (outgoing.get(current) || []).forEach((target) => {
      levels.set(
        target,
        Math.max(levels.get(target) || 0, (levels.get(current) || 0) + 1),
      );
      const nextDegree = (indegree.get(target) || 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        queue.push(target);
        queue.sort(sortQueue);
      }
    });
  }
  const cyclic = entities.filter((entity) => !resolved.has(entity.id));
  if (cyclic.length) {
    const cycleLevel =
      Math.max(0, ...[...resolved].map((id) => levels.get(id) || 0)) +
      (resolved.size ? 1 : 0);
    cyclic.forEach((entity) => levels.set(entity.id, cycleLevel));
  }
  const layerIds = new Map<number, string[]>();
  entities.forEach((entity) => {
    const level = levels.get(entity.id) || 0;
    layerIds.set(level, [...(layerIds.get(level) || []), entity.id]);
  });
  const rowIndex = new Map<string, number>();
  const orderedLayers = [...layerIds.keys()]
    .sort((left, right) => left - right)
    .map((level) => {
      const ids = layerIds.get(level)!;
      ids.sort((left, right) => {
        const leftPreds = (predecessors.get(left) || [])
          .map((id) => rowIndex.get(id))
          .filter((value): value is number => value !== undefined);
        const rightPreds = (predecessors.get(right) || [])
          .map((id) => rowIndex.get(id))
          .filter((value): value is number => value !== undefined);
        const leftBarycenter = leftPreds.length
          ? leftPreds.reduce((total, value) => total + value, 0) /
            leftPreds.length
          : Number.POSITIVE_INFINITY;
        const rightBarycenter = rightPreds.length
          ? rightPreds.reduce((total, value) => total + value, 0) /
            rightPreds.length
          : Number.POSITIVE_INFINITY;
        if (leftBarycenter !== rightBarycenter)
          return leftBarycenter - rightBarycenter;
        const leftEntity = byId.get(left)!;
        const rightEntity = byId.get(right)!;
        if (leftEntity.y !== rightEntity.y) return leftEntity.y - rightEntity.y;
        return compareArrangeEntities(document, leftEntity, rightEntity);
      });
      ids.forEach((id, index) => rowIndex.set(id, index));
      return ids;
    });
  const layerHeights = orderedLayers.map((ids) =>
    ids.reduce(
      (total, id, index) =>
        total + byId.get(id)!.h + (index ? ARRANGE_GAP_Y : 0),
      0,
    ),
  );
  const maxLayerHeight = Math.max(...layerHeights, 0);
  const layerWidths = orderedLayers.map((ids) =>
    Math.max(...ids.map((id) => byId.get(id)!.w), 0),
  );
  const positions = new Map<string, ArrangePoint>();
  let x = origin.x;
  orderedLayers.forEach((ids, layerIndex) => {
    let y = origin.y + (maxLayerHeight - layerHeights[layerIndex]) / 2;
    ids.forEach((id) => {
      positions.set(id, { x, y });
      y += byId.get(id)!.h + ARRANGE_GAP_Y;
    });
    x += layerWidths[layerIndex] + ARRANGE_GAP_X;
  });
  return {
    positions,
    width:
      layerWidths.reduce((total, width) => total + width, 0) +
      ARRANGE_GAP_X * Math.max(0, layerWidths.length - 1),
    height: maxLayerHeight,
  };
}

function arrangeCanvasSelection(
  document: CanvasDocument,
  selected: Set<string>,
  collapseFullGroups: boolean,
): CanvasArrangeResult {
  const allNodes = document.nodes;
  if (!selected.size)
    return { document: clone(document), arrangedIds: [], changed: false };
  const fullGroupIds = new Set(
    collapseFullGroups
      ? document.groups
          .filter(
            (group) =>
              group.nodeIds.length >= 2 &&
              group.nodeIds.every((id) => selected.has(id)),
          )
          .map((group) => group.id)
      : [],
  );
  const coveredNodeIds = new Set<string>();
  const entities: ArrangeEntity[] = [];
  document.groups.forEach((group) => {
    if (!fullGroupIds.has(group.id)) return;
    const bounds = groupBounds(document, group.id);
    entities.push({ id: group.id, nodeIds: group.nodeIds, ...bounds });
    group.nodeIds.forEach((id) => coveredNodeIds.add(id));
  });
  allNodes
    .filter((node) => selected.has(node.id) && !coveredNodeIds.has(node.id))
    .forEach((node) => {
      const bounds = entityBounds(document, node.id);
      entities.push({ id: node.id, nodeIds: [node.id], ...bounds });
    });
  if (!entities.length)
    return {
      document: clone(document),
      arrangedIds: [...selected],
      changed: false,
    };
  const nodeToEntity = new Map<string, string>();
  entities.forEach((entity) =>
    entity.nodeIds.forEach((nodeId) => nodeToEntity.set(nodeId, entity.id)),
  );
  const entityIds = new Set(entities.map((entity) => entity.id));
  const resolveEntity = (id: string) => {
    if (entityIds.has(id)) return id;
    const node = nodeById(document, id);
    return node ? nodeToEntity.get(node.id) : undefined;
  };
  const graphEdges = document.edges
    .map((edge) => ({
      source: resolveEntity(edge.source),
      target: resolveEntity(edge.target),
    }))
    .filter((edge): edge is { source: string; target: string } =>
      Boolean(edge.source && edge.target && edge.source !== edge.target),
    );
  const connectedIds = new Set(
    graphEdges.flatMap((edge) => [edge.source, edge.target]),
  );
  const connected = entities
    .filter((entity) => connectedIds.has(entity.id))
    .sort((left, right) => compareArrangeEntities(document, left, right));
  const isolated = entities
    .filter((entity) => !connectedIds.has(entity.id))
    .sort((left, right) => compareArrangeEntities(document, left, right));
  const minX = Math.min(...entities.map((entity) => entity.x));
  const minY = Math.min(...entities.map((entity) => entity.y));
  const positions = new Map<string, ArrangePoint>();
  const isolatedLayout = arrangeGrid(isolated, { x: minX, y: minY });
  isolatedLayout.positions.forEach((position, id) =>
    positions.set(id, position),
  );
  const layeredLayout = arrangeLayered(document, connected, graphEdges, {
    x: minX + (isolated.length ? isolatedLayout.width + ARRANGE_GAP_X : 0),
    y: minY,
  });
  layeredLayout.positions.forEach((position, id) =>
    positions.set(id, position),
  );
  const next = clone(document);
  let changed = false;
  next.nodes = next.nodes.map((node) => {
    const entityId = nodeToEntity.get(node.id);
    const target = entityId ? positions.get(entityId) : undefined;
    if (!target) return node;
    const entity = entities.find((item) => item.id === entityId)!;
    const offset = { x: target.x - entity.x, y: target.y - entity.y };
    const x = node.x + offset.x;
    const y = node.y + offset.y;
    if (x !== node.x || y !== node.y) changed = true;
    return { ...node, x, y };
  });
  return { document: next, arrangedIds: [...selected], changed };
}

export function arrangeCanvas(
  document: CanvasDocument,
  selectedIds?: string[],
): CanvasArrangeResult {
  const selected =
    selectedIds === undefined
      ? new Set(document.nodes.map((node) => node.id))
      : new Set(selectedIds.filter((id) => nodeById(document, id)));
  return arrangeCanvasSelection(document, selected, true);
}

/** Arranges every node inside one group without moving the group as an entity. */
export function arrangeCanvasGroup(
  document: CanvasDocument,
  groupId: string,
): CanvasArrangeResult {
  const group = groupById(document, groupId);
  const selected = new Set(
    (group?.nodeIds || []).filter((id) => nodeById(document, id)),
  );
  if (!group || selected.size < 2) {
    return { document: clone(document), arrangedIds: [...selected], changed: false };
  }
  return arrangeCanvasSelection(document, selected, false);
}

function canvasRectanglesOverlap(
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number },
  gap = 0,
) {
  return (
    left.x < right.x + right.w + gap &&
    left.x + left.w + gap > right.x &&
    left.y < right.y + right.h + gap &&
    left.y + left.h + gap > right.y
  );
}

export function canvasGroupHasOverlaps(
  document: CanvasDocument,
  groupId: string,
  gap = 0,
) {
  const nodes = groupNodes(document, groupId);
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = entityBounds(document, nodes[leftIndex].id);
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      if (canvasRectanglesOverlap(left, entityBounds(document, nodes[rightIndex].id), gap))
        return true;
    }
  }
  return false;
}

/** Pack a group only when its members currently collide. */
export function ensureCanvasGroupLayout(
  document: CanvasDocument,
  groupId: string,
) {
  if (!canvasGroupHasOverlaps(document, groupId)) return document;
  return arrangeCanvasGroup(document, groupId).document;
}

export function entityPortPoint(
  document: CanvasDocument,
  id: string,
  port: "left" | "right",
) {
  const bounds = entityBounds(document, id);
  // Node and group ports are rendered outside their card. Terminate the SVG
  // at the capsule's outer face so lines never run through the control.
  const offset = 14;
  return {
    x:
      bounds.x +
      (port === "right" ? bounds.w + offset : -offset),
    y: bounds.y + bounds.h / 2,
  };
}

/**
 * Build a connection path from two already-resolved port points.
 *
 * The points can be in world coordinates (scale = 1) or in a scaled
 * coordinate system such as the minimap.  Keeping the minimum control/bend
 * distances in the same coordinate system prevents minimap paths from
 * growing disproportionately when the canvas is zoomed out.
 */
export function connectionPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  style: CanvasConnectionStyle = "curve",
  sourcePort: "left" | "right" = "right",
  targetPort: "left" | "right" = "left",
  scale = 1,
) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const format = (value: number) =>
    String(Number.isFinite(value) ? Number(value.toFixed(4)) : 0);
  const sourceDirection = sourcePort === "right" ? 1 : -1;
  const targetDirection = targetPort === "left" ? -1 : 1;
  const distance = Math.abs(b.x - a.x);

  if (style === "straight")
    return `M ${format(a.x)} ${format(a.y)} L ${format(b.x)} ${format(b.y)}`;

  if (style === "orthogonal") {
    const gap = Math.max(
      56 * safeScale,
      Math.min(140 * safeScale, distance * 0.24),
    );
    const bendX =
      sourceDirection === targetDirection
        ? sourceDirection === 1
          ? Math.max(a.x, b.x) + gap
          : Math.min(a.x, b.x) - gap
        : (a.x + b.x) / 2;
    return `M ${format(a.x)} ${format(a.y)} H ${format(bendX)} V ${format(b.y)} H ${format(b.x)}`;
  }

  const controlDistance = Math.max(72 * safeScale, distance * 0.42);
  return `M ${format(a.x)} ${format(a.y)} C ${format(a.x + controlDistance * sourceDirection)} ${format(a.y)}, ${format(b.x + controlDistance * targetDirection)} ${format(b.y)}, ${format(b.x)} ${format(b.y)}`;
}

export function edgePath(
  document: CanvasDocument,
  edge: CanvasEdge,
  style: CanvasConnectionStyle = "curve",
) {
  const sourcePort = edge.sourcePort || "right";
  const targetPort = edge.targetPort || "left";
  const endpoints = canvasEdgeEndpoints(document, edge);
  return connectionPath(
    entityPortPoint(document, endpoints.source, sourcePort),
    entityPortPoint(document, endpoints.target, targetPort),
    style,
    sourcePort,
    targetPort,
  );
}

export function edgeTouchesSelection(
  document: CanvasDocument,
  edge: CanvasEdge,
  selectedIds: Iterable<string>,
  selectedGroupId?: string | null,
) {
  const selectedEntities = new Set(selectedIds);
  if (selectedGroupId) selectedEntities.add(selectedGroupId);

  document.groups.forEach((group) => {
    if (
      group.id === selectedGroupId ||
      group.nodeIds.some((nodeId) => selectedEntities.has(nodeId))
    ) {
      selectedEntities.add(group.id);
    }
  });

  return selectedEntities.has(edge.source) || selectedEntities.has(edge.target);
}

export function mediaCardSizeForRatio(
  ratio?: number,
  kind: CanvasMediaKind = "image",
) {
  if (kind === "audio") return { w: 380, h: 176 };
  const safeRatio =
    positiveRatio(ratio) ||
    (kind === "video" ? DEFAULT_VIDEO_ASPECT_RATIO : 1);
  const footer = kind === "video" ? MEDIA_CARD_FOOTER_HEIGHT : MEDIA_IMAGE_FOOTER_HEIGHT;
  let width = kind === "video" ? 420 : 380;
  let stage = width / safeRatio;
  if (stage > 520) {
    stage = 520;
    width = stage * safeRatio;
  }
  if (width > 480) {
    width = 480;
    stage = width / safeRatio;
  }
  if (width < 280) {
    width = 280;
    stage = width / safeRatio;
  }
  if (stage < 180) {
    stage = 180;
    width = stage * safeRatio;
  }
  return { w: Math.round(width), h: Math.round(stage + footer) };
}

/** Size an upscale node so its result area follows the generated image ratio. */
export function upscaleCardSizeForRatio(ratio?: number) {
  const mediaSize = mediaCardSizeForRatio(ratio, "image");
  return {
    // The result preview sits inside the node border and the card's 16px
    // horizontal padding, so add that chrome around the ratio-sized area.
    w: mediaSize.w + UPSCALE_CARD_HORIZONTAL_CHROME,
    h: Math.round(mediaSize.h - MEDIA_IMAGE_FOOTER_HEIGHT + UPSCALE_CARD_CHROME_HEIGHT),
  };
}

export function smartMediaSize(
  kind: CanvasMediaKind,
  params?: CanvasGenerationParams,
) {
  if (kind === "video")
    return mediaCardSizeForRatio(videoAspectRatio(params), kind);
  const aspect = params && "aspect" in params ? params.aspect : "1:1";
  const [a, b] = String(aspect || "1:1")
    .split(":")
    .map(Number);
  return mediaCardSizeForRatio((a || 1) / (b || 1), kind);
}

export function createMedia(
  kind: CanvasMediaKind,
  url: string,
  name: string,
  position: { x: number; y: number },
  data: CanvasNodeData = {},
): CanvasNode {
  const normalizedVideoParams =
    kind === "video" ? normalizeVideoNodeParams(data) : undefined;
  const size =
    kind === "video"
      ? mediaCardSizeForRatio(
          nativeMediaRatio(data) || videoAspectRatio(normalizedVideoParams),
          kind,
        )
      : kind === "audio"
        ? mediaCardSizeForRatio(1, kind)
        : { w: 380, h: 270 };
  return {
    id: uid("node"),
    type: "media",
    x: position.x,
    y: position.y,
    ...size,
    data: {
      kind,
      url,
      name: name || (kind === "video" ? "视频素材" : kind === "audio" ? "音频素材" : "图片素材"),
      role: "参考",
      autoFit: true,
      ...(kind === "video" && typeof data.videoInputModeAuto !== "boolean"
        ? { videoInputModeAuto: true }
        : {}),
      ...data,
      ...(normalizedVideoParams ? { params: normalizedVideoParams } : {}),
    },
  };
}

export function createPrompt(
  position: { x: number; y: number },
  text = "",
): CanvasNode {
  return {
    id: uid("node"),
    type: "prompt",
    x: position.x,
    y: position.y,
    w: 290,
    h: 180,
    data: {
      text,
      role: "Agent 输入",
      params: normalizeCreationSettings("text", null),
      status: "idle",
    },
  };
}

export function createGenerator(
  kind: Exclude<CanvasMediaKind, "audio">,
  position: { x: number; y: number },
  params?: CanvasGenerationParams,
): CanvasNode {
  const normalizedParams =
    kind === "image"
      ? normalizeCreationSettings("image", params)
      : normalizeCreationSettings("video", params);
  return {
    id: uid("node"),
    type: "generator",
    x: position.x,
    y: position.y,
    // A generator card carries a prompt, status list and retry controls. Give
    // new nodes enough room for the first variant to remain readable without
    // requiring an immediate manual resize.
    w: 390,
    h: 390,
    data: {
      kind,
      params: normalizedParams,
      ...(kind === "video" ? { videoInputModeAuto: true } : {}),
      prompt: "",
      status: "idle",
      variantRequirements: [""],
      variantRequirementsText: "",
      variantStates: [],
    },
  };
}

export function createEmptyMedia(
  kind: CanvasMediaKind,
  position: { x: number; y: number },
  params?: CanvasGenerationParams,
): CanvasNode {
  if (kind === "audio") {
    return createMedia(
      "audio",
      "",
      "空音频节点",
      position,
      {
        role: "待导入",
        status: "draft",
        statusLabel: "等待导入音频",
        referenceOrder: [],
      },
    );
  }
  const normalizedParams =
    kind === "image"
      ? normalizeCreationSettings("image", params)
      : normalizeCreationSettings("video", params);
  const size = smartMediaSize(kind, normalizedParams);
  return {
    ...createMedia(
      kind,
      "",
      kind === "video" ? "空视频节点" : "空图片节点",
      position,
      {
        role: "待生成",
        status: "draft",
        statusLabel: kind === "video" ? "等待生成视频" : "等待生成图片",
        ...(kind === "video" ? { videoInputModeAuto: true } : {}),
        generation: {
          kind,
          prompt: "",
          params: normalizedParams,
          referenceIds: [],
          createdAt: Date.now(),
        },
        referenceOrder: [],
      },
    ),
    ...size,
  };
}

export function createUpscaleNode(position: { x: number; y: number } = { x: 0, y: 0 }, params?: Partial<CanvasUpscaleParams>): CanvasNode {
  const normalized = normalizeUpscaleParams(params);
  return {
    id: uid("node"),
    type: "upscale",
    x: position.x,
    y: position.y,
    w: 360,
    h: 260,
    data: {
      kind: "image",
      autoFit: true,
      role: "独立超分",
      status: "draft",
      statusLabel: "等待连接图片",
      params: normalized,
      prompt: normalized.prompt || "Upscale this image",
      generation: {
        kind: "image",
        prompt: normalized.prompt || "Upscale this image",
        params: normalized,
        operation: "upscale",
        referenceIds: [],
        createdAt: Date.now(),
      },
    },
  };
}

export function addEdge(
  document: CanvasDocument,
  source: string,
  target: string,
  sourcePort: "left" | "right" = "right",
  targetPort: "left" | "right" = "left",
  kind: CanvasEdge["kind"] = "manual",
  inputRole?: CanvasInputRole,
  order?: number,
) {
  const sourceExists = Boolean(
    nodeById(document, source) || groupById(document, source),
  );
  const targetExists = Boolean(
    nodeById(document, target) || groupById(document, target),
  );
  const validation = canConnect(document, source, target, inputRole);
  if (
    !validation.ok ||
    !sourceExists ||
    !targetExists ||
    source === target ||
    document.edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        edge.sourcePort === sourcePort &&
        edge.targetPort === targetPort,
    )
  )
    return document;
  const sourceNode = nodeById(document, source);
  const targetNode = nodeById(document, target);
  const inputPosition = document.edges.filter((edge) => {
    if (edge.target !== target) return false;
    const edgeSource = nodeById(document, edge.source);
    return Boolean(
      edgeSource &&
        isCanvasReferenceableNode(edgeSource) &&
        edgeSource.data.kind === "image",
    );
  }).length;
  const targetParams = targetNode?.data.params;
  const targetInputMode = targetParams && typeof targetParams === "object" && "inputMode" in targetParams
    ? targetParams.inputMode
    : undefined;
  const effectiveInputRole = targetNode?.type === "upscale"
    ? "upscale-image" as CanvasInputRole
    : inputRole || (sourceNode && targetNode
      ? inferInputRoleFromNodes(
          sourceNode,
          targetNode,
          targetInputMode === "first-frame" || targetInputMode === "frames" || targetInputMode === "reference" || targetInputMode === "text" ? targetInputMode : undefined,
          inputPosition,
        )
      : undefined);
  const effectiveOrder = Number.isFinite(Number(order))
    ? Number(order)
    : effectiveInputRole && ["reference-image", "first-frame", "last-frame", "video"].includes(effectiveInputRole)
      ? inputPosition
      : undefined;
  return {
    ...document,
    edges: [
      ...document.edges,
      {
        id: uid("edge"),
        source,
        target,
        sourcePort,
        targetPort,
        kind,
        ...(effectiveInputRole ? { inputRole: effectiveInputRole } : {}),
        ...(Number.isFinite(Number(effectiveOrder)) ? { order: Number(effectiveOrder) } : {}),
      },
    ],
  };
}

export function removeEdge(document: CanvasDocument, id: string) {
  const removed = document.edges.find((edge) => edge.id === id);
  if (!removed) return document;
  const edges = document.edges.filter((edge) => edge.id !== id);
  const target = nodeById(document, removed.target);
  const removedReferenceIds = referenceNodeIdsForEdge(document, removed);
  if (!target || !removedReferenceIds.length) return { ...document, edges };

  const remainingReferenceIds = new Set(
    edges.flatMap((edge) => referenceNodeIdsForEdge(document, edge)),
  );
  const removedSet = new Set(removedReferenceIds);
  const prune = (value: unknown) => {
    if (!Array.isArray(value)) return value;
    const next = value.filter((referenceId) => !removedSet.has(String(referenceId)) || remainingReferenceIds.has(String(referenceId)));
    return next.length === value.length && next.every((referenceId, index) => referenceId === value[index])
      ? value
      : next;
  };
  const referenceOrder = prune(target.data.referenceOrder);
  const referenceIds = prune(target.data.generation?.referenceIds);
  const referenceOrderChanged = referenceOrder !== target.data.referenceOrder;
  const referenceIdsChanged = referenceIds !== target.data.generation?.referenceIds;
  if (!referenceOrderChanged && !referenceIdsChanged) return { ...document, edges };
  return {
    ...document,
    edges,
    nodes: document.nodes.map((node) =>
      node.id !== target.id
        ? node
        : {
            ...node,
            data: {
              ...node.data,
              ...(referenceOrderChanged ? { referenceOrder: referenceOrder as string[] } : {}),
              ...(referenceIdsChanged && node.data.generation
                ? { generation: { ...node.data.generation, referenceIds: referenceIds as string[] } }
                : {}),
            },
          },
    ),
  };
}

/**
 * Remove one reference from a target without treating a group connection as
 * an all-or-nothing input. Group edges keep their boundary connection and
 * persist the remaining member ids when an individual member is removed.
 */
export function removeCanvasReference(
  document: CanvasDocument,
  targetId: string,
  sourceId: string,
) {
  const matchingEdges = document.edges.filter((edge) =>
    edge.target === targetId &&
    !["generated", "variant", "lineage"].includes(edge.kind || "") &&
    referenceNodeIdsForEdge(document, edge).includes(sourceId),
  );
  if (!matchingEdges.length) return document;

  let next = document;
  for (const edge of matchingEdges) {
    const sourceGroup = groupById(next, edge.source);
    const sourceNodes = referenceNodeIdsForEdge(next, edge)
      .map((id) => nodeById(next, id))
      .filter((node): node is CanvasNode => Boolean(node));
    if (!sourceNodes.some((node) => node.id === sourceId)) continue;

    const remainingSourceIds = sourceNodes
      .filter((node) => node.id !== sourceId)
      .map((node) => node.id);
    if (!sourceGroup || !remainingSourceIds.length) {
      next = removeEdge(next, edge.id);
      continue;
    }

    // Keep the group boundary connection and persist the user's per-target
    // subset instead of re-expanding the whole group on every render.
    next = {
      ...next,
      edges: next.edges.map((item) =>
        item.id === edge.id
          ? { ...item, sourceNodeIds: remainingSourceIds }
          : item,
      ),
    };
  }

  const desiredOrder = incomingReferences(document, targetId)
    .map((node) => node.id)
    .filter((id) => id !== sourceId);
  return reorderReferences(next, targetId, desiredOrder);
}

function referenceNodeIdsForEdge(document: CanvasDocument, edge: CanvasEdge) {
  if (["generated", "variant", "lineage"].includes(edge.kind || "")) return [];
  return sourceNodesForEdge(document, edge)
    .filter((node) => isCanvasReferenceableNode(node))
    .map((node) => node.id);
}

function sourceNodesForEdge(document: CanvasDocument, edge: CanvasEdge) {
  const sourceGroup = groupById(document, edge.source);
  if (!sourceGroup) {
    const source = nodeById(document, edge.source);
    return source ? [source] : [];
  }
  if (Array.isArray(edge.sourceNodeIds)) {
    return [...new Set(edge.sourceNodeIds)]
      .map((id) => nodeById(document, id))
      .filter((node): node is CanvasNode => Boolean(node));
  }
  return groupNodes(document, sourceGroup.id);
}

function removeEdgesAndPruneReferences(
  document: CanvasDocument,
  shouldRemove: (edge: CanvasEdge) => boolean,
) {
  return document.edges
    .filter(shouldRemove)
    .reduce((next, edge) => removeEdge(next, edge.id), document);
}

export function createGroup(
  document: CanvasDocument,
  ids: string[],
  name?: string,
) {
  const valid = [...new Set(ids)].filter((id) => nodeById(document, id));
  if (valid.length < 2) return document;
  const groupId = uid("group");
  const selected = new Set(valid);
  const groups = document.groups
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => !selected.has(id)),
    }))
    .filter((group) => group.nodeIds.length >= 2);
  const survivingMembership = new Map(
    groups.flatMap((group) =>
      group.nodeIds.map((id) => [id, group.id] as const),
    ),
  );
  const nodes = document.nodes.map((node) =>
    selected.has(node.id)
      ? { ...node, groupId }
      : node.groupId && survivingMembership.has(node.id)
        ? { ...node, groupId: survivingMembership.get(node.id) }
        : { ...node, groupId: undefined },
  );
  groups.push({
    id: groupId,
    name: name?.trim() || `对象组 ${document.groups.length + 1}`,
    nodeIds: valid,
  });
  return ensureCanvasGroupLayout({ ...document, nodes, groups }, groupId);
}

export function moveNodesToGroup(
  document: CanvasDocument,
  ids: string[],
  groupId: string,
) {
  const target = groupById(document, groupId);
  const valid = [...new Set(ids)].filter((id) => nodeById(document, id));
  if (!target || !valid.length) return document;
  if (valid.every((id) => nodeById(document, id)?.groupId === groupId))
    return document;
  const moving = new Set(valid);
  const groups = document.groups
    .map((group) => ({
      ...group,
      nodeIds:
        group.id === groupId
          ? [
              ...new Set([
                ...group.nodeIds.filter((id) => !moving.has(id)),
                ...valid,
              ]),
            ]
          : group.nodeIds.filter((id) => !moving.has(id)),
    }))
    .filter((group) => group.id === groupId || group.nodeIds.length >= 2);
  const membership = new Map(
    groups.flatMap((group) =>
      group.nodeIds.map((id) => [id, group.id] as const),
    ),
  );
  const entityIds = new Set([
    ...document.nodes.map((node) => node.id),
    ...groups.map((group) => group.id),
  ]);
  const next = {
    ...document,
    nodes: document.nodes.map((node) =>
      membership.has(node.id)
        ? { ...node, groupId: membership.get(node.id) }
        : { ...node, groupId: undefined },
    ),
    groups,
    edges: document.edges.filter(
      (edge) => entityIds.has(edge.source) && entityIds.has(edge.target),
    ),
  };
  return ensureCanvasGroupLayout(next, groupId);
}

export function detachNodesFromGroups(
  document: CanvasDocument,
  ids: string[],
): CanvasDocument {
  const validIds = new Set(
    [...new Set(ids)].filter((id) => nodeById(document, id)),
  );
  if (!validIds.size) return document;

  const affectedGroups = document.groups.filter((group) =>
    group.nodeIds.some((id) => validIds.has(id)),
  );
  if (!affectedGroups.length) return document;

  const groups = document.groups
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => !validIds.has(id)),
    }))
    .filter((group) => group.nodeIds.length >= 2);
  const survivingMembership = new Map(
    groups.flatMap((group) =>
      group.nodeIds.map((id) => [id, group.id] as const),
    ),
  );
  const removedGroupIds = new Set(
    document.groups
      .filter((group) => !groups.some((item) => item.id === group.id))
      .map((group) => group.id),
  );
  const withoutRemovedEdges = removeEdgesAndPruneReferences(
    document,
    (edge) => removedGroupIds.has(edge.source) || removedGroupIds.has(edge.target),
  );

  return {
    ...withoutRemovedEdges,
    nodes: withoutRemovedEdges.nodes.map((node) =>
      validIds.has(node.id)
        ? { ...node, groupId: undefined }
        : node.groupId && survivingMembership.has(node.id)
          ? { ...node, groupId: survivingMembership.get(node.id) }
          : node.groupId && removedGroupIds.has(node.groupId)
            ? { ...node, groupId: undefined }
            : node,
    ),
    groups,
  };
}

export function ungroup(document: CanvasDocument, groupId: string) {
  const group = groupById(document, groupId);
  if (!group) return document;
  const withoutGroupEdges = removeEdgesAndPruneReferences(
    document,
    (edge) => edge.source === groupId || edge.target === groupId,
  );
  return {
    ...withoutGroupEdges,
    nodes: withoutGroupEdges.nodes.map((node) =>
      group.nodeIds.includes(node.id) ? { ...node, groupId: undefined } : node,
    ),
    groups: document.groups.filter((item) => item.id !== groupId),
  };
}

export function removeNodes(document: CanvasDocument, ids: string[]) {
  const set = new Set(ids);
  const groupIds = new Set(
    document.groups
      .filter((group) => group.nodeIds.some((id) => set.has(id)))
      .map((group) => group.id),
  );
  const groups = document.groups
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => !set.has(id)),
    }))
    .filter((group) => group.nodeIds.length >= 2);
  const survivingMembership = new Map(
    groups.flatMap((group) =>
      group.nodeIds.map((id) => [id, group.id] as const),
    ),
  );
  const withoutRemovedEdges = removeEdgesAndPruneReferences(
    document,
    (edge) =>
      set.has(edge.source) ||
      set.has(edge.target) ||
      groupIds.has(edge.source) ||
      groupIds.has(edge.target),
  );
  return {
    ...withoutRemovedEdges,
    nodes: withoutRemovedEdges.nodes
      .filter((node) => !set.has(node.id))
      .map((node) =>
        node.groupId && survivingMembership.has(node.id)
          ? { ...node, groupId: survivingMembership.get(node.id) }
          : { ...node, groupId: undefined },
      ),
    groups,
  };
}

export function incomingContext(document: CanvasDocument, entityId: string) {
  const entity = nodeById(document, entityId) || groupById(document, entityId);
  if (!entity) return [];
  const direct = document.edges
    .map((edge, index) => ({ edge, index }))
    .filter(
      ({ edge }) =>
        edge.target === entityId &&
        !["generated", "variant", "lineage"].includes(edge.kind || ""),
    )
    .sort((left, right) => {
      const leftOrder = Number(left.edge.order);
      const rightOrder = Number(right.edge.order);
      const leftHasOrder = Number.isFinite(leftOrder);
      const rightHasOrder = Number.isFinite(rightOrder);
      if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ edge }) => edge)
    .flatMap((edge) => sourceNodesForEdge(document, edge))
    .filter((node): node is CanvasNode => node !== undefined);
  const storedOrder =
    "nodeIds" in entity
      ? []
      : entity.data.referenceOrder?.length
        ? entity.data.referenceOrder
        : entity.data.generation?.referenceIds || [];
  const directIds = new Set(direct.map((node) => node.id));
  const virtual = storedOrder
    .map((id) => nodeById(document, id))
    .filter((node): node is CanvasNode => {
      if (!node || !isCanvasReferenceableNode(node)) return false;
      return directIds.has(node.id);
    });
  const seen = new Set<string>();
  return [...virtual, ...direct].filter(
    (node) => !seen.has(node.id) && Boolean(seen.add(node.id)),
  );
}

export function incomingReferences(document: CanvasDocument, entityId: string) {
  return incomingContext(document, entityId).filter(isCanvasReferenceableNode);
}

export function reorderReferences(
  document: CanvasDocument,
  ownerId: string,
  ids: string[],
) {
  const owner = nodeById(document, ownerId) || groupById(document, ownerId);
  if (!owner || "nodeIds" in owner) return document;
  const valid = incomingReferences(document, ownerId).map((node) => node.id);
  const next = ids.filter((id) => valid.includes(id));
  valid.forEach((id) => {
    if (!next.includes(id)) next.push(id);
  });
  const ownerNode = nodeById(document, ownerId);
  const ownerKind = ownerNode?.type === "media" || ownerNode?.type === "generator"
    ? ownerNode.data.kind
    : undefined;
  const ownerParams = ownerNode?.data.params;
  const ownerInputMode = ownerParams && typeof ownerParams === "object" && "inputMode" in ownerParams
    ? ownerParams.inputMode
    : undefined;
  const imageIds = next.filter((id) => nodeById(document, id)?.data.kind === "image");
  const reorderedRole = new Map<string, CanvasInputRole>();
  if (ownerKind === "video") {
    if (ownerInputMode === "first-frame") {
      imageIds.forEach((id, index) => reorderedRole.set(id, index === 0 ? "first-frame" : "reference-image"));
    } else if (ownerInputMode === "frames") {
      imageIds.forEach((id, index) => reorderedRole.set(id, index === 0 ? "first-frame" : index === 1 ? "last-frame" : "reference-image"));
    } else if (ownerInputMode === "reference") {
      imageIds.forEach((id) => reorderedRole.set(id, "reference-image"));
    }
  }
  return {
    ...document,
    edges: document.edges.map((edge) => {
      if (edge.target !== ownerId) return edge;
      const sourceReferenceIds = referenceNodeIdsForEdge(document, edge);
      const index = sourceReferenceIds
        .map((id) => next.indexOf(id))
        .filter((value) => value >= 0)
        .sort((left, right) => left - right)[0] ?? next.indexOf(edge.source);
      return index >= 0
        ? {
            ...edge,
            order: index,
            ...(reorderedRole.has(edge.source) ? { inputRole: reorderedRole.get(edge.source) } : {}),
          }
        : edge;
    }),
    nodes: document.nodes.map((node) =>
      node.id === ownerId
        ? {
            ...node,
            data: {
              ...node.data,
              referenceOrder: next,
              generation: node.data.generation
                ? { ...node.data.generation, referenceIds: next }
                : node.data.generation,
            },
          }
        : node,
    ),
  };
}

export function smartPrompt(prompt: string, context: CanvasNode[]) {
  const texts = context
    .filter((node) => node.type === "prompt")
    .map((node) => node.data.text?.trim())
    .filter(Boolean) as string[];
  const output = [prompt.trim(), ...texts].filter(Boolean).join("\n");
  const refs = context.filter(isCanvasReferenceableNode);
  if (
    refs.length > 1 &&
    /(融合|合并|组合|结合|一张图|共同|全部参考|merge|combine|blend|composite|all references)/i.test(
      output,
    )
  ) {
    return `你将按顺序收到 ${refs.length} 张参考图（图1到图${refs.length}）。请同时使用全部参考图，不要忽略其中任何一张；把参考图的主体或视觉元素合理融合到同一张新画面中。\n用户指令：${output}`;
  }
  return output;
}
