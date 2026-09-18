import { nodeById, nodeSize } from "./model";
import type { CanvasDocument, CanvasGenerationStatus, CanvasNode } from "./types";

/** The dock sends a compact snapshot instead of the whole document. */
export const CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES = 12;
export const CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS = 1600;
export const CANVAS_AGENT_DOCK_MAX_REFERENCES = 8;
/** 面板把图片拖到画布时用的拖拽类型：画布靠它认出“从对话里拖出来的那张图”。 */
export const CANVAS_AGENT_DOCK_IMAGE_DRAG_TYPE = "application/x-sanmao-agent-image";

export type CanvasAgentDockStatus = {
  nodes: number;
  running: number;
  queued: number;
  failed: number;
  /* 面板头部把「进行中 / 失败」做成可点的定位入口，所以状态里要带节点 id。 */
  activeIds: string[];
  failedIds: string[];
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
  /** 节点的生成状态。面板头部只统计选中节点的任务，所以状态跟着芯片一起进面板。 */
  status?: CanvasGenerationStatus;
};

export type CanvasAgentDockLayout = "grid" | "horizontal" | "vertical";

export type CanvasAgentDockPlan = {
  kind: "layout-selection" | "batch-image-layout";
  title: string;
  steps: string[];
  layout: CanvasAgentDockLayout;
  targetNodeIds?: string[];
  targetCount?: number;
  imageCount?: number;
  sourcePrompt?: string;
  requiresConfirmation: boolean;
  applied?: boolean;
  dismissed?: boolean;
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
  const status: CanvasAgentDockStatus = {
    nodes: document.nodes.length,
    running: 0,
    queued: 0,
    failed: 0,
    activeIds: [],
    failedIds: [],
  };
  for (const node of document.nodes) {
    const value = node.data.status;
    if (value === "running") {
      status.running += 1;
      status.activeIds.push(node.id);
    } else if (value === "queued") {
      status.queued += 1;
      status.activeIds.push(node.id);
    } else if (value === "failed") {
      status.failed += 1;
      status.failedIds.push(node.id);
    }
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
  return { text: clipCanvasAgentDockLines(lines), nodeIds: ids };
}

/**
 * 按行裁剪：硬切 slice 会把某条节点摘要截成半句，模型会照着半句话下判断。
 * 超限时丢掉整行，并写明还有多少行没带过去。
 */
function clipCanvasAgentDockLines(lines: readonly string[]) {
  const kept: string[] = [];
  let used = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (used + line.length + 1 > CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS) {
      const note = `（节点信息过长，已省略后续 ${lines.length - index} 行）`;
      if (used + note.length + 1 <= CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS) kept.push(note);
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  if (kept.length) return kept.join("\n");
  /* 单行就超限时至少给出开头，不能让模型完全没有上下文。 */
  return String(lines[0] || "").slice(0, CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS);
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

/**
 * Only explicit canvas-directed wording may turn a normal Agent answer into a
 * text node. This keeps "智能落画布" useful without silently filling a board
 * with ordinary answers or web-search results.
 */
export function canvasAgentDockShouldAutoApplyText(input: string) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const canvasTarget = /(?:画布|画板|节点)/;
  const saveAction = /(?:保存|存成|存为|加入|添加|放到|落到|落入|落地|同步|写入|创建)/;
  const directInstruction = /(?:把|将|请|帮我|直接|自动|结果|回复|回答|这段|它).{0,24}(?:保存|存成|存为|加入|添加|放到|落到|落入|落地|同步|写入|创建).{0,24}(?:画布|画板|节点)/;
  const reverseInstruction = /(?:保存|存成|存为|加入|添加|放到|落到|落入|落地|同步|写入|创建).{0,24}(?:画布|画板|节点)/;
  return canvasTarget.test(text) && saveAction.test(text) && (directInstruction.test(text) || reverseInstruction.test(text));
}

/** A low-risk local command: reuse the latest Agent image without another model call. */
export function canvasAgentDockRequestsPreviousImageApply(input: string) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /(?:刚才|上一轮|上一次|刚生成|刚回复|这张|这些|这组|结果).{0,24}(?:图|图片|图像|结果)/.test(text)
    && /(?:加入|添加|放到|落到|落入|放入|拖到).{0,12}(?:画布|画板|节点)/.test(text);
}

function canvasAgentDockDirectExecution(input: string) {
  return /(?:直接执行|直接应用|马上执行|立即执行|不用确认|无需确认|自动执行|确认执行)/.test(
    String(input || ""),
  );
}

function canvasAgentDockLayout(input: string): CanvasAgentDockLayout {
  const text = String(input || "");
  if (/(?:横向|水平|一行|左右排列)/.test(text)) return "horizontal";
  if (/(?:纵向|垂直|一列|上下排列)/.test(text)) return "vertical";
  return "grid";
}

function canvasAgentDockLayoutRequested(input: string) {
  return /(?:排列|排版|整理|布局|平铺|网格|宫格|横向|纵向|水平|垂直|一行|一列|两行|两列)/.test(
    String(input || ""),
  );
}

/**
 * Turns an explicit canvas workflow into a reviewable plan. This is deliberately
 * explainable and local: the model still handles creative intent, while the
 * canvas owns mutations and can keep them transactional.
 */
export function buildCanvasAgentDockPlan(input: string, options: {
  imageCount?: number;
  targetNodeIds?: string[];
  selectedTotal?: number;
} = {}): CanvasAgentDockPlan | null {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const layoutRequested = canvasAgentDockLayoutRequested(text);
  const imageCount = Math.max(0, Math.floor(Number(options.imageCount || 0)));
  const batchRequested = imageCount > 1 && /(?:批量|多张|多个|几张|版本|变体|方案|批次|一起)/.test(text);
  const connectRequested = /(?:连线|连接|接到|接入|关联|串起来|建立关系)/.test(text);
  const targetNodeIds = options.targetNodeIds?.filter(Boolean);
  const hasSelection = Boolean(targetNodeIds?.length || options.selectedTotal);
  const direct = canvasAgentDockDirectExecution(text);

  if (layoutRequested && (hasSelection || /(?:全部|所有|整张画布|整个画布)/.test(text))) {
    const layout = canvasAgentDockLayout(text);
    const targetCount = targetNodeIds?.length || options.selectedTotal || 0;
    const targetLabel = targetCount ? `选中的 ${targetCount} 个节点` : "整张画布的节点";
    return {
      kind: "layout-selection",
      title: `整理${targetLabel}`,
      steps: [`将${targetLabel}按${layout === "grid" ? "网格" : layout === "horizontal" ? "横向" : "纵向"}重新排列`],
      layout,
      sourcePrompt: text,
      ...(targetNodeIds?.length ? { targetNodeIds } : {}),
      targetCount: targetCount || undefined,
      requiresConfirmation: !direct,
    };
  }

  if (imageCount > 1 && (batchRequested || layoutRequested || connectRequested)) {
    const layout = canvasAgentDockLayout(text);
    const steps = [`将 ${imageCount} 张生成结果加入画布`];
    if (layoutRequested) steps.push(`按${layout === "grid" ? "网格" : layout === "horizontal" ? "横向" : "纵向"}排列这批结果`);
    if (connectRequested || hasSelection) steps.push(hasSelection ? "将结果连接到当前选中的节点" : "保留生成结果之间的独立关系");
    return {
      kind: "batch-image-layout",
      title: `批量处理 ${imageCount} 张 Agent 结果`,
      steps,
      layout,
      sourcePrompt: text,
      ...(targetNodeIds?.length ? { targetNodeIds } : {}),
      targetCount: targetNodeIds?.length || options.selectedTotal || undefined,
      imageCount,
      requiresConfirmation: !direct,
    };
  }
  return null;
}
