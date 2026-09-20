import {
  addEdge,
  clone,
  normalizeDocument,
  nodeById,
  removeNodes,
} from "./model";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./types";

/** A small, serializable edit transaction shared by Agent and the canvas UI. */
export type CanvasPatchOperation =
  | { op: "add_node"; node: CanvasNode }
  | { op: "update_node"; id: string; patch: Partial<CanvasNode> }
  | {
      op: "connect";
      source: string;
      target: string;
      sourcePort?: CanvasEdge["sourcePort"];
      targetPort?: CanvasEdge["targetPort"];
      kind?: CanvasEdge["kind"];
      inputRole?: CanvasEdge["inputRole"];
      order?: number;
    }
  | { op: "remove_nodes"; ids: string[] };

export type CanvasPatch = {
  version: 1;
  runId?: string;
  operations: CanvasPatchOperation[];
};

export type CanvasPatchValidation =
  | { ok: true; document: CanvasDocument }
  | { ok: false; error: string; operationIndex?: number };

const MAX_OPERATIONS = 32;
const MAX_NODE_DATA_KEYS = 80;

function fail(error: string, operationIndex?: number): CanvasPatchValidation {
  return { ok: false, error, ...(operationIndex === undefined ? {} : { operationIndex }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateNode(node: unknown) {
  if (!isRecord(node)) return "节点必须是对象";
  if (typeof node.id !== "string" || !node.id.trim() || node.id.length > 160) return "节点 id 无效";
  if (!["media", "prompt", "generator", "upscale", "video-editor", "angle"].includes(String(node.type))) return "节点类型无效";
  if (typeof node.x !== "number" || !Number.isFinite(node.x) || typeof node.y !== "number" || !Number.isFinite(node.y)) return "节点位置无效";
  if (node.w !== undefined && (typeof node.w !== "number" || !Number.isFinite(node.w))) return "节点宽度无效";
  if (node.h !== undefined && (typeof node.h !== "number" || !Number.isFinite(node.h))) return "节点高度无效";
  if (!isRecord(node.data)) return "节点 data 无效";
  if (Object.keys(node.data).length > MAX_NODE_DATA_KEYS) return "节点 data 过大";
  return null;
}

function validatePatchShape(patch: CanvasPatch): string | null {
  if (!patch || patch.version !== 1 || !Array.isArray(patch.operations)) return "Canvas Patch 版本或 operations 无效";
  if (patch.operations.length < 1) return "Canvas Patch 至少需要一个操作";
  if (patch.operations.length > MAX_OPERATIONS) return `Canvas Patch 最多支持 ${MAX_OPERATIONS} 个操作`;
  if (patch.runId !== undefined && (typeof patch.runId !== "string" || patch.runId.length > 160)) return "Canvas Patch runId 无效";
  for (const operation of patch.operations) {
    if (!isRecord(operation) || typeof operation.op !== "string") return "Canvas Patch 操作无效";
    if (operation.op === "add_node") {
      const error = validateNode(operation.node);
      if (error) return error;
    } else if (operation.op === "update_node") {
      if (typeof operation.id !== "string" || !operation.id.trim() || !isRecord(operation.patch)) return "更新节点操作无效";
    } else if (operation.op === "connect") {
      if (typeof operation.source !== "string" || typeof operation.target !== "string") return "连接操作无效";
    } else if (operation.op === "remove_nodes") {
      if (!Array.isArray(operation.ids) || operation.ids.some((id) => typeof id !== "string" || !id.trim())) return "删除节点操作无效";
    } else {
      return `不支持的 Canvas Patch 操作：${String((operation as { op?: unknown }).op)}`;
    }
  }
  return null;
}

function applyOperation(document: CanvasDocument, operation: CanvasPatchOperation): CanvasDocument | null {
  if (operation.op === "add_node") {
    if (nodeById(document, operation.node.id)) return null;
    return { ...document, nodes: [...document.nodes, clone(operation.node)] };
  }
  if (operation.op === "update_node") {
    const node = nodeById(document, operation.id);
    if (!node) return null;
    const patch = operation.patch;
    if (
      hasOwn(patch, "id") ||
      hasOwn(patch, "type") ||
      hasOwn(patch, "data") && !isRecord(patch.data) ||
      hasOwn(patch, "x") && (typeof patch.x !== "number" || !Number.isFinite(patch.x)) ||
      hasOwn(patch, "y") && (typeof patch.y !== "number" || !Number.isFinite(patch.y)) ||
      hasOwn(patch, "w") && patch.w !== undefined && (typeof patch.w !== "number" || !Number.isFinite(patch.w)) ||
      hasOwn(patch, "h") && patch.h !== undefined && (typeof patch.h !== "number" || !Number.isFinite(patch.h))
    ) return null;
    if (isRecord(patch.data) && Object.keys(patch.data).length > MAX_NODE_DATA_KEYS) return null;
    const nextNode = { ...node, ...clone(patch), id: node.id, data: hasOwn(patch, "data")
      ? { ...node.data, ...(patch.data as Record<string, unknown>) }
      : node.data };
    return { ...document, nodes: document.nodes.map((item) => item.id === node.id ? nextNode : item) };
  }
  if (operation.op === "connect") {
    const next = addEdge(
      document,
      operation.source,
      operation.target,
      operation.sourcePort || "right",
      operation.targetPort || "left",
      operation.kind || "manual",
      operation.inputRole,
      operation.order,
    );
    return next === document ? null : next;
  }
  const ids = [...new Set(operation.ids)];
  if (ids.some((id) => !nodeById(document, id))) return null;
  return removeNodes(document, ids);
}

export function validateCanvasPatch(document: CanvasDocument, patch: CanvasPatch): CanvasPatchValidation {
  const shapeError = validatePatchShape(patch);
  if (shapeError) return fail(shapeError);
  let current = normalizeDocument(document);
  for (const [index, operation] of patch.operations.entries()) {
    const next = applyOperation(current, operation);
    if (!next) return fail(`Canvas Patch 第 ${index + 1} 步无法应用`, index);
    current = normalizeDocument(next);
  }
  return { ok: true, document: current };
}

export function applyCanvasPatch(document: CanvasDocument, patch: CanvasPatch): CanvasDocument {
  const result = validateCanvasPatch(document, patch);
  if (!result.ok) throw new Error(result.error);
  return result.document;
}
