import type { WorkspaceContext } from "@/lib/workspace-context";

export const CANVAS_AGENT_RUN_CONTEXT_SCHEMA_VERSION = 1 as const;

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
  references: readonly CanvasAgentRunReference[];
  anchorNodeId?: string;
  operation: "generate" | "edit";
  startedAt: number;
}>;

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
    references: Object.freeze(frozenReferences),
    ...(selectedNodeIds[0] ? { anchorNodeId: selectedNodeIds[0] } : {}),
    operation: sourceNodeIds.length ? "edit" : "generate",
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
    startedAt: Number(input.startedAt) || Date.now(),
  });
}
