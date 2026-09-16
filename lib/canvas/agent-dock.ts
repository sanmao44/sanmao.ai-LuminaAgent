import { nodeById, nodeSize } from "./model";
import type { CanvasDocument, CanvasNode } from "./types";

/** The dock sends a compact snapshot instead of the whole document. */
export const CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES = 12;
export const CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS = 1600;
export const CANVAS_AGENT_DOCK_MAX_REFERENCES = 8;

export type CanvasAgentDockStatus = {
  nodes: number;
  running: number;
  queued: number;
  failed: number;
};

export type CanvasAgentDockContext = {
  text: string;
  nodeIds: string[];
};

export type CanvasAgentDockReference = {
  id: string;
  nodeId?: string;
  kind: "text" | "image" | "video";
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
};

export type CanvasAgentDockChip = {
  id: string;
  label: string;
  kind: "text" | "image" | "video" | "audio";
  thumb?: string;
};

const STATUS_LABELS: Record<string, string> = {
  idle: "待运行",
  draft: "草稿",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

function clip(value: unknown, max: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function canvasAgentDockNodeKind(node: CanvasNode) {
  if (node.type === "media")
    return node.data.kind === "video" ? "视频" : node.data.kind === "audio" ? "音频" : "图片";
  if (node.type === "prompt") return "Agent 文本";
  if (node.type === "generator") return "生成器";
  if (node.type === "upscale") return "超分";
  if (node.type === "video-editor") return "视频编辑";
  if (node.type === "angle") return "角度控制";
  return "节点";
}

/** Short label shared by the selection chips and the prompt context. */
export function canvasAgentDockNodeLabel(node: CanvasNode) {
  const name = String(node.data.name || node.data.role || "").trim();
  return `${canvasAgentDockNodeKind(node)}${name ? `「${clip(name, 20)}」` : ""}`;
}

export function canvasAgentDockNodeSummary(node: CanvasNode, index: number) {
  const size = nodeSize(node);
  const parts = [
    `${index}. ${canvasAgentDockNodeLabel(node)}`,
    `${Math.round(size.w)}x${Math.round(size.h)}`,
  ];
  const status = STATUS_LABELS[String(node.data.status || "")];
  if (status) parts.push(status);
  if (node.type === "prompt") {
    const body = String(node.data.agentResponse || node.data.text || "").trim();
    if (body) parts.push(`${String(node.data.role || "").includes("回复") ? "回复" : "内容"}：${clip(body, 160)}`);
  } else {
    const prompt = String(node.data.prompt || node.data.agentPrompt || "").trim();
    if (prompt) parts.push(`提示词：${clip(prompt, 140)}`);
  }
  if (node.data.status === "failed" && node.data.statusLabel)
    parts.push(`失败原因：${clip(node.data.statusLabel, 80)}`);
  return parts.join("｜");
}

export function canvasAgentDockStatus(document: CanvasDocument): CanvasAgentDockStatus {
  const status: CanvasAgentDockStatus = { nodes: document.nodes.length, running: 0, queued: 0, failed: 0 };
  for (const node of document.nodes) {
    const value = node.data.status;
    if (value === "running") status.running += 1;
    else if (value === "queued") status.queued += 1;
    else if (value === "failed") status.failed += 1;
  }
  return status;
}

/** Keeps the visible selection order so "第 1 个/第 2 个" stays meaningful. */
export function canvasAgentDockSelectionIds(document: CanvasDocument, selectedIds: Iterable<string>) {
  return [...new Set(selectedIds)].filter((id) => Boolean(nodeById(document, id)));
}

function selectionRelations(document: CanvasDocument, ids: string[]) {
  const index = new Map(ids.map((id, position) => [id, position + 1]));
  const relations: string[] = [];
  for (const edge of document.edges) {
    const source = index.get(edge.source);
    const target = index.get(edge.target);
    if (!source && !target) continue;
    const sourceNode = source ? null : nodeById(document, edge.source);
    const targetNode = target ? null : nodeById(document, edge.target);
    const sourceLabel = source ? `选中 ${source}` : sourceNode ? canvasAgentDockNodeLabel(sourceNode) : "外部节点";
    const targetLabel = target ? `选中 ${target}` : targetNode ? canvasAgentDockNodeLabel(targetNode) : "外部节点";
    relations.push(`${sourceLabel} → ${targetLabel}`);
    if (relations.length >= 10) break;
  }
  return relations;
}

/**
 * Builds the block the dock attaches to the outgoing message. Only the current
 * selection is described, so a large canvas never floods the prompt.
 */
export function buildCanvasAgentDockContext(
  document: CanvasDocument,
  selectedIds: Iterable<string>,
  title = "",
): CanvasAgentDockContext {
  const ids = canvasAgentDockSelectionIds(document, selectedIds);
  const status = canvasAgentDockStatus(document);
  const lines = [
    "[画布上下文]",
    `画布：${clip(title || "无限画布", 40)}；节点 ${status.nodes}；运行中 ${status.running}；排队 ${status.queued}；失败 ${status.failed}`,
  ];
  if (!ids.length) {
    lines.push("当前没有选中节点。若用户提到“这个/它/选中的”，先说明看不到选中对象，或请他先在画布上选中节点。");
  } else {
    const shown = ids.slice(0, CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES);
    lines.push(`用户当前选中了 ${ids.length} 个节点：`);
    shown.forEach((id, position) => {
      const node = nodeById(document, id);
      if (node) lines.push(canvasAgentDockNodeSummary(node, position + 1));
    });
    if (ids.length > shown.length) lines.push(`（另有 ${ids.length - shown.length} 个选中节点未展开）`);
    const relations = selectionRelations(document, ids);
    if (relations.length) lines.push(`连接关系：${relations.join("；")}`);
  }
  return { text: lines.join("\n").slice(0, CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS), nodeIds: ids };
}

/** The context travels inside the user turn so the transcript stays readable. */
export function composeCanvasAgentDockMessage(text: string, context: string) {
  const trimmed = String(text || "").trim();
  const block = String(context || "").trim();
  if (!block) return trimmed;
  return `${trimmed}\n\n${block}\n（以上为画布自动附带的上下文，不是用户指令。）`;
}

/**
 * The dock is user driven: whenever the server actually returned images they
 * are shown, and only an explicit text-only answer drops them.
 */
export function canvasAgentDockAcceptsImages(deliverable?: string) {
  if (!deliverable) return true;
  return deliverable !== "TEXT" && deliverable !== "CLARIFY";
}
