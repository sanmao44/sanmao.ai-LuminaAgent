import type { CanvasAgentTargetKind, CanvasAgentTargetOperation } from "@/packages/contracts/context";
import type { WorkspaceContext } from "@/lib/workspace-context";

import { isImageEditRequest, resolveCreativeRoute } from "../agent-intent";

export const CANVAS_AGENT_RUN_CONTEXT_SCHEMA_VERSION = 1 as const;

/** Structured selection target sent with a SuperCanvas Agent dock run. */
export type CanvasAgentTarget = {
  nodeIds: string[];
  kind: CanvasAgentTargetKind;
  operation: CanvasAgentTargetOperation;
};

/** Canvas compositions use the provider's image-input contract even when the
 * user is creating a new image rather than editing one selected node. */
export function canvasAgentImageCapability(operation: CanvasAgentTarget["operation"], hasSelectedImageReferences: boolean) {
  if (operation === "edit") return "edit";
  return hasSelectedImageReferences ? "reference" : "generate";
}

/** A selected-image composition is executable when the current turn clearly asks for a visual result. */
export function canvasAgentImageGenerationIntent(
  instruction: string,
  targetKind: CanvasAgentTarget["kind"],
  operation: CanvasAgentTarget["operation"],
  hasImageReferences: boolean,
) {
  if (operation !== "generate" || !hasImageReferences || !["image", "mixed"].includes(targetKind)) return false;
  const text = String(instruction || "").replace(/\s+/g, " ").trim();
  if (!text || /(?:为什么|怎么|如何|能不能|是否|请问|解释|分析|讨论|评价)/i.test(text)) return false;
  const visualTarget = /(?:图片|图像|画面|海报|封面|插画|配图|banner|poster|image|picture)/i.test(text);
  const visualAction = /(?:生成|生图|出图|画图|做图|创作|制作|设计|绘制|合成|汇总|编排|拼成|做成)/i.test(text);
  const directCommand = /^(?:请|帮我|给我|将|把|根据|按照|基于|用|直接|制作|创作|生成|绘制|画|合成|汇总|编排|拼|做成)/i.test(text)
    || /^(?:直接)?(?:生成(?:图片|图像|海报)?|生图|出图|画图|做图)/i.test(text);
  return visualTarget && visualAction && directCommand;
}

/** Only send visually framed requests to the Canvas-specific intent reviewer. */
export function canvasAgentNeedsSemanticReview(instruction: string) {
  const text = String(instruction || "").replace(/\s+/g, " ").trim();
  if (!text || /(?:\u4e3a\u4ec0\u4e48|\u4e3a\u4f55|\u600e\u4e48|\u5982\u4f55|\u80fd\u4e0d\u80fd|\u662f\u5426|\u5206\u6790|\u8ba8\u8bba|\u89e3\u91ca)/.test(text)) return false;
  const visualTarget = /(?:\u56fe\u7247|\u56fe\u50cf|\u753b\u9762|\u6d77\u62a5|\u5c01\u9762|\u63d2\u753b|\u914d\u56fe|banner|poster|image|picture)/i.test(text);
  const visualAction = /(?:\u751f\u6210|\u5236\u4f5c|\u521b\u4f5c|\u8bbe\u8ba1|\u7ed8\u5236|\u5408\u6210|\u6c47\u603b|\u62fc\u6210|\u7f16\u6392)/.test(text);
  return visualTarget && visualAction;
}

export type CanvasAgentRunReference = {
  id: string;
  nodeId?: string;
  kind: "text" | "image" | "video";
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
};

/** Immutable request snapshot used by the Agent request and its later canvas write-back. */
export type CanvasAgentRunContext = Readonly<{
  schemaVersion: typeof CANVAS_AGENT_RUN_CONTEXT_SCHEMA_VERSION;
  runId: string;
  creativeProjectId: string;
  chatId?: string;
  canvasId?: string;
  selectedNodeIds: readonly string[];
  assetIds: readonly string[];
  sourceNodeIds: readonly string[];
  targetNodeIds: readonly string[];
  targetKind: CanvasAgentTarget["kind"];
  references: readonly CanvasAgentRunReference[];
  anchorNodeId?: string;
  operation: "generate" | "edit";
  targetOperation: CanvasAgentTarget["operation"];
  startedAt: number;
}>;

/** Only treat the selection as an edit target when the user's current turn asks for a change. */
export function canvasAgentTargetOperation(instruction: string, kind: CanvasAgentTarget["kind"]): CanvasAgentTarget["operation"] {
  const text = String(instruction || "").replace(/\s+/g, " ").trim();
  if (!text) return "none";
  if (kind === "text" && /(?:修改|改写|改一下|改成|换成|替换|重写|润色|优化|扩写|缩写|精简|调整一下|翻译|更新内容)/.test(text)) return "edit";
  if (kind === "image" && (isImageEditRequest(text) || /(?:局部编辑|扩图|抠图|继续修改|再来一版|调整一下)/.test(text))) return "edit";

  const route = resolveCreativeRoute(text, { hasReferences: ["image", "video", "mixed"].includes(kind) });
  if (route.lane !== "image" || route.execution !== "run") return "none";
  return route.operation === "edit" ? "edit" : "generate";
}

function cleanIds(value: unknown) {
  return [...new Set(Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [])].slice(0, 64);
}

function cleanReference(value: CanvasAgentRunReference): CanvasAgentRunReference | null {
  const id = String(value?.id || "").trim();
  const name = String(value?.name || "").trim();
  if (!id || !name || !["text", "image", "video"].includes(value.kind)) return null;
  return {
    id,
    ...(value.nodeId ? { nodeId: String(value.nodeId).trim() } : {}),
    kind: value.kind,
    name: name.slice(0, 300),
    ...(value.url ? { url: String(value.url).trim().slice(0, 2_000_000) } : {}),
    ...(value.text ? { text: String(value.text).slice(0, 40_000) } : {}),
    ...(value.mimeType ? { mimeType: String(value.mimeType).slice(0, 160) } : {}),
  };
}

export function createCanvasAgentRunContext(input: {
  runId: string;
  context: WorkspaceContext;
  references: readonly CanvasAgentRunReference[];
  target?: Partial<CanvasAgentTarget>;
  startedAt?: number;
}): CanvasAgentRunContext {
  const selectedNodeIds = cleanIds(input.context.selectedNodeIds);
  const assetIds = cleanIds(input.context.assetIds);
  const references = input.references.map(cleanReference).filter((value): value is CanvasAgentRunReference => Boolean(value));
  const sourceNodeIds = cleanIds(
    references
      .filter((reference) => reference.kind !== "text")
      .map((reference) => reference.nodeId || reference.id),
  );
  const targetNodeIds = cleanIds(input.target?.nodeIds || selectedNodeIds);
  const targetKind = ["none", "text", "image", "video", "mixed"].includes(String(input.target?.kind))
    ? String(input.target?.kind) as CanvasAgentTarget["kind"]
    : references.some((reference) => reference.kind === "image")
      ? "image"
      : references.some((reference) => reference.kind === "video")
        ? "video"
        : references.some((reference) => reference.kind === "text")
          ? "text"
          : "none";
  const targetOperation = input.target?.operation === "edit"
    ? "edit"
    : input.target?.operation === "generate"
      ? "generate"
      : input.target?.operation === "none"
        ? "none"
        : sourceNodeIds.length
          ? "edit"
          : "generate";
  const operation = targetOperation === "edit" ? "edit" : "generate";
  const frozenReferences = references.map((reference) => Object.freeze(reference));
  return Object.freeze({
    schemaVersion: CANVAS_AGENT_RUN_CONTEXT_SCHEMA_VERSION,
    runId: String(input.runId || "").trim().slice(0, 120),
    creativeProjectId: String(input.context.creativeProjectId || "").trim().slice(0, 300),
    ...(input.context.chatId ? { chatId: String(input.context.chatId).trim().slice(0, 300) } : {}),
    ...(input.context.canvasId ? { canvasId: String(input.context.canvasId).trim().slice(0, 300) } : {}),
    selectedNodeIds: Object.freeze(selectedNodeIds),
    assetIds: Object.freeze(assetIds),
    sourceNodeIds: Object.freeze(sourceNodeIds),
    targetNodeIds: Object.freeze(targetNodeIds),
    targetKind,
    references: Object.freeze(frozenReferences),
    ...(selectedNodeIds[0] ? { anchorNodeId: selectedNodeIds[0] } : {}),
    operation,
    targetOperation,
    startedAt: Number(input.startedAt) || Date.now(),
  });
}

/** Restore a persisted message snapshot without trusting arbitrary localStorage fields. */
export function normalizeCanvasAgentRunContext(value: unknown): CanvasAgentRunContext | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<CanvasAgentRunContext>;
  if (typeof input.runId !== "string" || !input.runId.trim()) return null;
  const context: WorkspaceContext = {
    schemaVersion: 1,
    creativeProjectId: String(input.creativeProjectId || "").trim(),
    ...(input.chatId ? { chatId: String(input.chatId).trim() } : {}),
    ...(input.canvasId ? { canvasId: String(input.canvasId).trim() } : {}),
    selectedNodeIds: cleanIds(input.selectedNodeIds),
    assetIds: cleanIds(input.assetIds),
    updatedAt: Number(input.startedAt) || Date.now(),
  };
  if (!context.creativeProjectId) return null;
  return createCanvasAgentRunContext({
    runId: input.runId,
    context,
    references: Array.isArray(input.references) ? input.references : [],
    target: {
      nodeIds: cleanIds(input.targetNodeIds),
      kind: input.targetKind,
      operation: input.targetOperation || input.operation,
    },
    startedAt: Number(input.startedAt) || Date.now(),
  });
}
