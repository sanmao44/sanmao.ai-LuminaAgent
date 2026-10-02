import type { WorkspaceContext } from "@/lib/workspace-context";

export const CANVAS_AGENT_RUN_CONTEXT_SCHEMA_VERSION = 1 as const;

/** Structured selection target sent with a SuperCanvas Agent dock run. */
export type CanvasAgentTarget = {
  nodeIds: string[];
  kind: "none" | "text" | "image" | "video" | "mixed";
  operation: "generate" | "edit";
};

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
  startedAt: number;
}>;

/** Only treat the selection as an edit target when the user's current turn asks for a change. */
export function canvasAgentTargetOperation(instruction: string, kind: CanvasAgentTarget["kind"]): CanvasAgentTarget["operation"] {
  const text = String(instruction || "").replace(/\s+/g, " ").trim();
  if (!text || kind === "none" || kind === "mixed" || kind === "video") return "generate";
  if (/(?:为什么|怎么|如何|能不能|可不可以|是否|请问|解释|分析|评价|觉得|怎么样)/.test(text) && /[？?]?$/.test(text)) return "generate";
  const editRequest = kind === "image"
    ? /(?:修改|改一下|改成|换成|替换|重绘|修图|换背景|去掉|加上|增加|减少|保持主体|局部编辑|扩图|抠图|继续修改|再来一版|调整一下)/
    : /(?:修改|改写|改一下|改成|换成|替换|重写|润色|优化|扩写|缩写|精简|调整一下|翻译|更新内容)/;
  return editRequest.test(text) ? "edit" : "generate";
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
  const operation = input.target?.operation === "edit"
    ? "edit"
    : input.target?.operation === "generate"
      ? "generate"
      : sourceNodeIds.length
        ? "edit"
        : "generate";
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
      operation: input.operation,
    },
    startedAt: Number(input.startedAt) || Date.now(),
  });
}
