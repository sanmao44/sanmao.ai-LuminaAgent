import { comparisonReferences, isCanvasReferenceableNode, nodeById } from "@/lib/canvas/model";
import { nodeLabel } from "@/lib/canvas/menu-labels";
import type { CanvasDocument, CanvasNode, CanvasRuntimeState } from "@/lib/canvas/types";

export type ImageVersionInfo = {
  sourceNode?: string;
  provider?: string;
  model?: string;
  dimensions?: string;
  createdAt?: number;
  generationDurationMs?: number;
  prompt?: string;
  parameters?: Array<{ label: string; value: string }>;
  status?: string;
};

function mediaViewerVersionInfo(
  document: CanvasDocument,
  node: CanvasNode,
  runtime: CanvasRuntimeState | null,
): ImageVersionInfo | undefined {
  const generation = node.data.generation;
  const rawParams = generation?.params || node.data.params;
  const params = rawParams && typeof rawParams === "object"
    ? rawParams as Record<string, unknown>
    : undefined;
  const entries: Array<{ label: string; value: string }> = [];
  const addEntry = (label: string, value: unknown) => {
    const normalized = String(value ?? "").trim();
    if (normalized) entries.push({ label, value: normalized });
  };
  const aspect = params?.aspect === "自定义"
    ? `${params.customAspectWidth || "?"}:${params.customAspectHeight || "?"}`
    : params?.aspect;
  const operationLabels: Record<string, string> = {
    generate: "生成",
    edit: "编辑",
    upscale: "超分",
    extend: "扩展",
  };
  const inputModeLabels: Record<string, string> = {
    reference: "参考图",
    first_last: "首尾帧",
    first_frame: "首帧",
    multi_frame: "多帧参考",
  };
  addEntry("比例", aspect);
  addEntry("分辨率", params?.resolution);
  addEntry("质量", params?.quality);
  addEntry(
    "尺寸",
    params?.sizeMode === "custom"
      ? `${params.width || "?"} × ${params.height || "?"}`
      : undefined,
  );
  addEntry("背景", params?.backgroundMode);
  addEntry("格式", params?.outputFormat);
  addEntry("操作", operationLabels[String(params?.operation || "")] || params?.operation);
  addEntry("输入", inputModeLabels[String(params?.inputMode || "")] || params?.inputMode);
  addEntry("时长", params?.duration ? `${params.duration} 秒` : undefined);
  if (generation?.referenceIds?.length) addEntry("参考", `${generation.referenceIds.length} 项`);
  if (params?.mask) addEntry("局部编辑", "已启用");

  const modelId = String(params?.model || node.data.model || "").trim();
  const runtimeModel = runtime?.models?.find(
    (model) => model.id === modelId || model.displayName === modelId,
  );
  const provider = String(node.data.providerName || runtimeModel?.providerName || "").trim();
  const displayModel = String(node.data.model || runtimeModel?.displayName || modelId).trim();
  const model = modelId && displayModel && modelId !== displayModel
    ? `${displayModel} · ${modelId}`
    : displayModel || modelId;
  const sourceNodeId = generation?.parentNodeId || generation?.reuseSourceNodeId || generation?.sourceGeneratorId;
  const sourceNode = sourceNodeId ? nodeById(document, sourceNodeId) : undefined;
  const sourceNodeLabel = sourceNode
    ? `${nodeLabel(sourceNode)}${sourceNode.data.name ? ` · ${String(sourceNode.data.name)}` : ""}`
    : sourceNodeId || "直接生成";
  const width = Number(node.data.nativeWidth);
  const height = Number(node.data.nativeHeight);
  const dimensions = width > 0 && height > 0
    ? `${width} × ${height}`
    : params?.sizeMode === "custom"
      ? `${params.width || "?"} × ${params.height || "?"}`
      : params?.resolution
        ? `${String(params.resolution)}${aspect ? ` · ${String(aspect)}` : ""}`
        : undefined;
  const status = node.data.status === "failed"
    ? "失败"
    : node.data.statusLabel || (node.data.url ? "已完成" : "待处理");
  const generationDurationMs = Number(generation?.durationMs);

  return {
    sourceNode: sourceNodeLabel,
    provider: provider || "未记录",
    model: model || "未记录",
    dimensions,
    createdAt: generation?.createdAt || generation?.updatedAt,
    generationDurationMs: Number.isFinite(generationDurationMs) && generationDurationMs >= 0
      ? generationDurationMs
      : undefined,
    prompt: generation?.prompt || node.data.prompt,
    parameters: entries,
    status,
  };
}


export type MediaViewerReference = {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  name: string;
};

export type MediaViewerItem = {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  name: string;
  prompt?: string;
  revisedPrompt?: string;
  width?: number;
  height?: number;
  versionInfo?: ImageVersionInfo;
};

export function mediaViewerItemForCanvasNode(
  document: CanvasDocument,
  node: CanvasNode,
  runtime: CanvasRuntimeState | null,
): MediaViewerItem | null {
  if (!isCanvasReferenceableNode(node)) return null;
  return {
    id: node.id,
    kind: node.data.kind || "image",
    url: String(node.data.url),
    name: String(node.data.name || (node.type === "upscale" ? "超分结果" : "画布素材")),
    prompt: String(node.data.generation?.prompt || node.data.prompt || ""),
    width: Number(node.data.nativeWidth) || undefined,
    height: Number(node.data.nativeHeight) || undefined,
    versionInfo: mediaViewerVersionInfo(document, node, runtime),
  };
}

export function mediaViewerReferencesForCanvasNode(
  document: CanvasDocument,
  nodeId: string,
): MediaViewerReference[] {
  return comparisonReferences(document, nodeId)
    .map((reference) => ({
      id: reference.id,
      kind: reference.data.kind || "image",
      url: String(reference.data.url || ""),
      name: String(reference.data.name || "参考素材"),
    }))
    .filter((reference) => Boolean(reference.url));
}

export { mediaViewerVersionInfo };
