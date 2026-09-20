"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import AgentApprovalCard, { type AgentApprovalOutcome } from "@/components/AgentApprovalCard";
import ModelPicker from "@/components/ModelPicker";
import SkillManager from "@/components/SkillManager";
import SkillIcon from "@/components/SkillIcon";
import AgentSkillMenu from "@/components/AgentSkillMenu";
import ReferenceMentionEditor from "@/components/ReferenceMentionEditor";
import AgentMarkdown from "@/components/AgentMarkdown";
import type { ReferenceMentionOption } from "@/components/ReferenceMentionMenu";
import { invalidReferenceMentionNumbers, replaceNaturalReferenceLabels } from "@/lib/creative-references";
import { filterSkills, skillMessageValue, skillSlashQuery, type SkillPickerEntry } from "@/lib/skill-picker";
import type { AgentWebMode } from "@/lib/creation/settings";
import type { AgentApproval, AgentApprovalCall, AgentGeneratedFile, AgentMcpToolUse } from "@/lib/agent-client";
import { pollAgentProgress } from "@/lib/agent-client";
import { generateCanvasAgent } from "@/lib/canvas/api";
import {
  CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES,
  CANVAS_AGENT_DOCK_IMAGE_DRAG_TYPE,
  CANVAS_AGENT_DOCK_MAX_REFERENCES,
  canvasAgentDockAcceptsImages,
  canvasAgentDockRequestsPreviousImageApply,
  composeCanvasAgentDockMessage,
  canvasAgentDockShouldAutoApplyText,
  buildCanvasAgentDockPlan,
  type CanvasAgentDockChip,
  type CanvasAgentDockPlan,
  type CanvasAgentDockPlanResult,
  type CanvasAgentDockReference,
  type CanvasAgentDockStatus,
} from "@/lib/canvas/agent-dock";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import {
  createCanvasAgentRunContext,
  normalizeCanvasAgentRunContext,
  type CanvasAgentRunContext,
} from "@/lib/canvas/run-context";
import type { PublicState } from "@/lib/types";
import type { WorkspaceContext } from "@/lib/workspace-context";

export const CANVAS_AGENT_DOCK_OPEN_KEY = "sanmao.canvas.agentdock.open.v1";
export const CANVAS_AGENT_DOCK_SESSION_KEY = "sanmao.canvas.agentdock.session.v1";

export type CanvasAgentDockMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  images?: Array<{ url: string; revisedPrompt?: string }>;
  skills?: Array<{ id: string; name: string }>;
  error?: string;
  /** 失败时存一份用户原话：重试直接用这句，@ 编号按当时的选区再解析一次。 */
  retryText?: string;
  /** 用户中途停止时留下的部分回答：可以在这条消息上接着写。 */
  interrupted?: boolean;
  /** 这条消息落到画布上的节点 id：存过之后按钮换成定位入口，随时回到画布上看结果。 */
  imageNodeIds?: string[];
  textNodeId?: string;
  plan?: CanvasAgentDockPlan;
  runContext?: CanvasAgentRunContext;
  /** 待确认的外部操作：确认卡挂在提出它的那条回答上；审批记录本身在服务端。 */
  approval?: AgentApproval;
  /** 用户处理过确认之后的结果文案：刷新后继续显示结果，而不是又冒出按钮。 */
  approvalResult?: string;
  /** 这一轮真正落到外部服务上的调用：让用户看得见助手用了哪个外部工具。 */
  mcpTools?: AgentMcpToolUse[];
  /** 这一轮生成的文件产物：只存元数据与取件地址，二进制不进本地会话。 */
  files?: AgentGeneratedFile[];
};

type CanvasAgentDockSession = {
  model: string;
  webMode: AgentWebMode;
  autoApply: boolean;
  messages: CanvasAgentDockMessage[];
};

type Props = {
  open: boolean;
  onToggle: (open: boolean) => void;
  status: CanvasAgentDockStatus;
  chips: CanvasAgentDockChip[];
  references: CanvasAgentDockReference[];
  selectedNodeIds?: string[];
  context: WorkspaceContext;
  /* 画布上真实的选中数量：芯片只渲染前几个，头部要报完整数字。 */
  selectedTotal?: number;
  contextBlock: string;
  runtime: PublicState | null;
  onFocusNodes: (ids: string[]) => void;
  /* 落画布后回传新节点 id：消息上的按钮要能变成「定位结果」。 */
  onApplyImages: (
    images: Array<{ url: string; revisedPrompt?: string }>,
    meta: { prompt: string; model?: string; runContext?: CanvasAgentRunContext },
  ) => string[];
  onApplyText: (text: string, meta: { prompt: string }) => string[];
  onApplyPlan: (plan: CanvasAgentDockPlan, images?: Array<{ url: string; revisedPrompt?: string }>, runContext?: CanvasAgentRunContext) => CanvasAgentDockPlanResult;
  onCreateAgentNode: (text: string) => void;
  onUseAsImagePrompt: (text: string) => void;
  onUseAsVideoPrompt: (text: string) => void;
  notify: (message: string, kind?: "ok" | "error") => void;
  /* 面板收起后仍可能在生成：把运行状态报给画布，工具栏的 Agent 按钮要能显示「生成中」。 */
  onBusyChange?: (busy: boolean) => void;
  /* 预览交给画布渲染：媒体预览器一直挂在画布层，和节点预览是同一个。 */
  onPreviewImages: (images: Array<{ url: string; revisedPrompt?: string }>, index: number) => void;
  /* 画布上点「问 Agent」时递增：面板展开后要直接把光标放进输入框。 */
  focusSignal?: number;
};

const MESSAGE_LIMIT = 40;
/* 这类回答常见几千字，默认全展开会让面板只能靠滚动翻。 */
const MESSAGE_COLLAPSE_CHARS = 900;
/* 距底多少像素以内算“贴在底部”，决定流式内容要不要跟着滚。 */
const SCROLL_BOTTOM_GAP = 48;
const EMPTY_SAMPLES = [
  "这几个节点的问题在哪？",
  "帮我写一版更细的提示词",
  "把选中的节点按顺序连线并横向整理",
];
const HELP_EXAMPLES = [
  {
    label: "分析整张画布",
    description: "没有选中节点时也能使用",
    prompt: "分析整张画布的现状，指出最值得继续的 3 个方向。",
    minimumSelection: 0,
  },
  {
    label: "整理并连线",
    description: "按顶部卡片顺序处理",
    prompt: "把选中的节点按当前卡片顺序依次连线，并横向整理；先给我看操作计划。",
    minimumSelection: 2,
  },
  {
    label: "命名分组",
    description: "成组前先预览计划",
    prompt: "把选中的节点归为一组，命名为参考素材；先给我看操作计划。",
    minimumSelection: 2,
  },
  {
    label: "复制为分支",
    description: "保留节点与可复用关系",
    prompt: "复制选中的节点或流程作为方案分支；先给我看操作计划。",
    minimumSelection: 1,
  },
] as const;
/* 联网方式在主对话页、节点参数面板和这里必须是同一套说法，别让同一件事有三个名字。 */
const WEB_MODE_LABELS: Record<AgentWebMode, string> = {
  off: "关闭联网",
  auto: "智能联网",
  always: "始终联网",
};
/* 这枚按钮是「点一下换一种」，所以提示既要写清当前状态，也要预告下一次点到的模式。 */
const WEB_MODE_HINTS: Record<AgentWebMode, string> = {
  off: "不会联网，适合最快的纯模型回复",
  auto: "只在需要最新或外部事实时联网，普通创作直接回复",
  always: "每轮都会联网检索，回复可能较慢",
};
const WEB_MODE_ORDER: AgentWebMode[] = ["off", "auto", "always"];

function createId() {
  return `dock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* 选段操作只认单条消息：跨气泡的选区没有对应的节点语义。 */
function messageElementOf(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement || null;
  return element?.closest<HTMLElement>(".canvas-agent-dock-message") || null;
}

function referenceOrderKey(reference: CanvasAgentDockReference) {
  return reference.nodeId || reference.id;
}

/* 输入框里的 @1 指的是“第 1 个选中引用”，发给模型前要还原成它代表的东西。 */
function resolveReferenceMentions(text: string, references: readonly CanvasAgentDockReference[]) {
  return String(text || "").replace(/@([0-9]+)/g, (token, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    const reference = index >= 0 && index < references.length ? references[index] : undefined;
    if (!reference) return token;
    return reference.kind === "video" ? `参考视频${index + 1}` : reference.kind === "text" ? `引用文本${index + 1}` : `参考图${index + 1}`;
  });
}

function nodeIdsForReferenceMentions(text: string, references: readonly CanvasAgentDockReference[]) {
  const ids: string[] = [];
  String(text || "").replace(/@([0-9]+)/g, (_token, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    const reference = index >= 0 && index < references.length ? references[index] : undefined;
    const nodeId = reference?.nodeId || (reference?.kind !== "text" ? reference?.id : undefined);
    if (nodeId && !ids.includes(nodeId)) ids.push(nodeId);
    return _token;
  });
  return ids;
}

/* 请求失败的原文（Failed to fetch / 401 / 超时…）对用户没有可操作性，统一换成能照做的说法。 */
function describeAgentError(message: string, online: boolean) {
  const text = String(message || "").trim();
  if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED|ENOTFOUND|network/i.test(text))
    return online
      ? "连不上 Agent 服务（网络不通或服务没起来），稍后重试这一句。"
      : "网络已断开，连上后重试这一句。";
  if (/timeout|超时/i.test(text)) return "Agent 响应超时，可以重试这一句，或换一个模型。";
  if (/\b(401|403)\b|unauthorized|api\s?key/i.test(text))
    return "模型密钥无效或没配置，去设置里检查模型连接。";
  if (/\b429\b|rate limit|too many requests/i.test(text)) return "请求太频繁，等几秒重试这一句。";
  const server = text.match(/\b5\d\d\b/);
  if (server) return `模型服务暂时不可用（${server[0]}），稍后重试这一句。`;
  return text || "Agent 请求失败";
}

/* 头部只统计选中节点自己的任务：把整张画布的任务数挂在选中提示后面，会让人以为问题出在自己选的东西上。 */
function countSelectedTaskStatus(chips: readonly CanvasAgentDockChip[]) {
  const counts = { running: 0, queued: 0, failed: 0 };
  for (const chip of chips) {
    if (chip.status === "running") counts.running += 1;
    else if (chip.status === "queued") counts.queued += 1;
    else if (chip.status === "failed") counts.failed += 1;
  }
  return counts;
}

function taskStatusText(counts: { running: number; queued: number; failed: number }) {
  const parts: string[] = [];
  if (counts.running + counts.queued) parts.push(`${counts.running + counts.queued} 个在跑`);
  if (counts.failed) parts.push(`${counts.failed} 个失败`);
  return parts.join(" · ");
}

/* 面板里的 @1 只对当时的选区有意义。发送时把用户那句话里的 @1 落成自解释的名字，
   历史消息回看才不会歧义（同一份文本也会作为后续轮次的上下文发给模型）。 */
function labelReferenceMentions(text: string, references: readonly CanvasAgentDockReference[]) {
  return String(text || "").replace(/@([0-9]+)/g, (token, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    const reference = index >= 0 && index < references.length ? references[index] : undefined;
    if (!reference) return token;
    const kind = reference.kind === "video" ? "参考视频" : reference.kind === "text" ? "引用文本" : "参考图";
    return `${kind}${index + 1}「${reference.name}」`;
  });
}

/* 长回复先给开头一段，展开再看全文；折叠只影响显示，复制和存为节点仍是完整内容。 */
function messagePreview(content: string) {
  if (content.length <= MESSAGE_COLLAPSE_CHARS) return content;
  const cut = content.slice(0, MESSAGE_COLLAPSE_CHARS);
  const lastBreak = cut.lastIndexOf("\n");
  return `${(lastBreak > 200 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`;
}

/* 芯片和 @ 引用是同一份选区的两种呈现，所以共用一套顺序：芯片上的编号就是 @编号。 */
function orderByReferenceIds<T>(items: readonly T[], order: readonly string[], keyOf: (item: T) => string) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) =>
      (rank.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER),
  );
}

function reorderReferenceIds(ids: readonly string[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length)
    return null;
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return null;
  next.splice(toIndex, 0, moved);
  return next;
}

/* 落点用命中判定：指针压在哪枚芯片上，就换到那枚芯片的位置；芯片会折行，比按距离算更准。 */
function chipIdUnderPoint(container: HTMLElement | null, draggedId: string, clientX: number, clientY: number) {
  if (!container) return null;
  const elements = Array.from(container.querySelectorAll<HTMLElement>(".canvas-agent-dock-chip[data-chip-id]"));
  for (const element of elements) {
    const id = element.dataset.chipId;
    if (!id || id === draggedId) continue;
    const rect = element.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return id;
  }
  return null;
}

/* 本地存下来的确认卡与工具徽标只用于显示：字段对不上就整段丢掉，别把坏数据渲染进面板。 */
function readStoredApproval(value: unknown): AgentApproval | undefined {
  if (!value || typeof value !== "object") return undefined;
  const approval = value as Partial<AgentApproval>;
  const id = typeof approval.id === "string" ? approval.id.trim() : "";
  if (!id) return undefined;
  const calls: AgentApprovalCall[] = (Array.isArray(approval.calls) ? approval.calls : [])
    .filter((call): call is AgentApprovalCall => Boolean(call) && typeof call === "object")
    .map((call) => ({
      id: String(call.id || ""),
      server: String(call.server || ""),
      tool: String(call.tool || ""),
      risk: String(call.risk || ""),
      reason: String(call.reason || ""),
      ...(call.argsPreview ? { argsPreview: String(call.argsPreview) } : {}),
    }));
  return { id, expiresAt: Number(approval.expiresAt || 0) || 0, message: String(approval.message || ""), calls };
}

function readStoredMcpTools(value: unknown): AgentMcpToolUse[] {
  if (!Array.isArray(value)) return [];
  return (value as AgentMcpToolUse[])
    .filter((tool) => Boolean(tool) && typeof tool === "object")
    .map((tool) => ({
      server: String(tool.server || ""),
      name: String(tool.name || ""),
      readOnly: tool.readOnly === true,
      ok: tool.ok !== false,
    }))
    .filter((tool) => Boolean(tool.server || tool.name));
}

/* 文件产物只保留元数据与取件地址：本地会话存不下二进制，刷新后按 id 重新取。 */
function readStoredFiles(value: unknown): AgentGeneratedFile[] {
  if (!Array.isArray(value)) return [];
  return (value as AgentGeneratedFile[])
    .filter((file) => Boolean(file) && typeof file === "object" && String(file.name || "").trim())
    .map((file) => ({
      name: String(file.name || "").trim(),
      mimeType: String(file.mimeType || "application/octet-stream"),
      size: Number.isFinite(Number(file.size)) && Number(file.size) > 0 ? Math.round(Number(file.size)) : 0,
      ...(typeof file.content === "string" ? { content: file.content } : {}),
      ...(file.encoding === "base64" ? { encoding: "base64" as const } : {}),
      ...(String(file.artifactId || "").trim() ? { artifactId: String(file.artifactId).trim() } : {}),
      ...(String(file.downloadUrl || "").trim() ? { downloadUrl: String(file.downloadUrl).trim() } : {}),
    }))
    .slice(0, 8);
}

/* 产物卡片只说人话：字节数按 KB / MB 显示，类型从扩展名取。 */
function formatAgentFileSize(size: number) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "大小未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function canvasAgentDockFileKind(file: AgentGeneratedFile) {
  const match = String(file?.name || "").trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1].toUpperCase() : "文件";
}

/* 预览交给服务端解析页：Word / Excel / PPT / ZIP 都是同一种只读预览。 */
function openCanvasAgentDockFile(file: AgentGeneratedFile, notify: (message: string, kind?: "ok" | "error") => void) {
  const id = String(file?.artifactId || "").trim();
  if (!id) return;
  const theme = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const opened = window.open(`/api/artifacts/${encodeURIComponent(id)}?preview=1&theme=${theme}`, "_blank", "noopener,noreferrer");
  if (!opened) notify("浏览器拦截了新标签页，请允许后重试", "error");
}

function saveCanvasAgentDockFile(objectUrl: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

/* 有 artifactId 的产物按 id 取件；只有内联文本的老产物仍然在本地拼 Blob 下载。 */
async function downloadCanvasAgentDockFile(file: AgentGeneratedFile) {
  const name = String(file?.name || "").trim() || "SANMAO-file";
  const downloadUrl = String(file?.downloadUrl || (file?.artifactId ? `/api/artifacts/${encodeURIComponent(file.artifactId)}` : "")).trim();
  if (downloadUrl) {
    const response = await fetch(downloadUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404 ? "文件已过期或被清理，请重新生成" : "文件下载失败");
    saveCanvasAgentDockFile(URL.createObjectURL(await response.blob()), name);
    return;
  }
  if (typeof file?.content !== "string" || !file.content) throw new Error("这个文件没有可下载的内容，请重新生成");
  const blob = file.encoding === "base64"
    ? new Blob([Uint8Array.from(atob(file.content.replace(/\s/g, "")), (char) => char.charCodeAt(0))], { type: file.mimeType || "application/octet-stream" })
    : new Blob([file.content], { type: file.mimeType || "text/plain;charset=utf-8" });
  saveCanvasAgentDockFile(URL.createObjectURL(blob), name);
}

/* 恢复历史消息时把确认卡和工具徽标一起带回来，刷新后不会只剩正文。 */
function readStoredMessageExtras(message: unknown): Partial<CanvasAgentDockMessage> {
  const source = (message && typeof message === "object" ? message : {}) as Record<string, unknown>;
  const approval = readStoredApproval(source.approval);
  const mcpTools = readStoredMcpTools(source.mcpTools);
  const files = readStoredFiles(source.files);
  return {
    ...(approval ? { approval } : {}),
    ...(mcpTools.length ? { mcpTools } : {}),
    ...(files.length ? { files } : {}),
    ...(source.approvalResult ? { approvalResult: String(source.approvalResult) } : {}),
  };
}

function readSession(): CanvasAgentDockSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CANVAS_AGENT_DOCK_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasAgentDockSession>;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((message) => message && (message.role === "user" || message.role === "assistant"))
          .map((message) => ({
            id: String(message.id || createId()),
            role: message.role,
            content: String(message.content || ""),
            ...(message.model ? { model: String(message.model) } : {}),
            ...(Array.isArray(message.images) && message.images.length
              ? { images: message.images.map((image) => ({ url: String(image.url || ""), ...(image.revisedPrompt ? { revisedPrompt: String(image.revisedPrompt) } : {}) })) }
              : {}),
            ...(Array.isArray(message.skills) && message.skills.length
              ? { skills: message.skills.map((skill) => ({ id: String(skill.id || ""), name: String(skill.name || "") })) }
              : {}),
            ...(message.error ? { error: String(message.error) } : {}),
            ...(message.retryText ? { retryText: String(message.retryText) } : {}),
            ...(message.interrupted ? { interrupted: true } : {}),
            ...(Array.isArray(message.imageNodeIds) && message.imageNodeIds.length
              ? { imageNodeIds: message.imageNodeIds.map((id) => String(id || "")).filter(Boolean) }
              : {}),
            ...(message.textNodeId ? { textNodeId: String(message.textNodeId) } : {}),
            ...(message.plan && typeof message.plan === "object" ? { plan: message.plan } : {}),
            ...(normalizeCanvasAgentRunContext(message.runContext) ? { runContext: normalizeCanvasAgentRunContext(message.runContext)! } : {}),
            ...readStoredMessageExtras(message),
          }))
          .filter((message) => message.content || message.images?.length)
      : [];
    return {
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : "auto",
      webMode: parsed.webMode === "auto" || parsed.webMode === "always" ? parsed.webMode : "off",
      autoApply: parsed.autoApply !== false,
      messages,
    };
  } catch {
    return null;
  }
}

export default function CanvasAgentDock({
  open,
  onToggle,
  status,
  chips,
  references,
  selectedNodeIds = [],
  context,
  selectedTotal,
  contextBlock,
  runtime,
  onFocusNodes,
  onApplyImages,
  onApplyText,
  onApplyPlan,
  onCreateAgentNode,
  onUseAsImagePrompt,
  onUseAsVideoPrompt,
  notify,
  onBusyChange,
  onPreviewImages,
  focusSignal,
}: Props) {
  const [messages, setMessages] = useState<CanvasAgentDockMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState("");
  /* 长任务阶段文案：主管线写快照，面板按 runId 轮询，正文开始流式返回就让位。 */
  const [progressDetail, setProgressDetail] = useState("");
  const [model, setModel] = useState("auto");
  const [webMode, setWebMode] = useState<AgentWebMode>("off");
  const [autoApply, setAutoApply] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillActive, setSkillActive] = useState(0);
  const [skills, setSkills] = useState<SkillPickerEntry[]>([]);
  const [chipOrder, setChipOrder] = useState<string[]>([]);
  const [expandedMessages, setExpandedMessages] = useState<ReadonlySet<string>>(() => new Set());
  /* 改一改自己那条提问再问一次，比整段重打省事。 */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const inputBeforeEditRef = useRef("");
  const [atBottom, setAtBottom] = useState(true);
  const [dragChipId, setDragChipId] = useState<string | null>(null);
  /* 面板收着的时候 Agent 答完了：rail 上要留一盏灯，否则回答静静躺着没人知道。 */
  const [unreadReply, setUnreadReply] = useState(false);
  const contextRef = useRef<HTMLDivElement | null>(null);
  const chipDragRef = useRef<{ id: string; pointerId: number; x: number; y: number } | null>(null);
  const chipDragMovedRef = useRef(false);
  const chipClickBlockedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /* 失败后要能重试，所以留一份最近一次发送的原话。 */
  const lastUserTextRef = useRef("");
  /* 停止时不能丢掉已经流回来的内容，所以流式文本同时记一份在 ref 里。 */
  const streamTextRef = useRef("");
  /* 一个 token 一次 setState，长回复会把重排堆满主线程；流式文本按帧合并。 */
  const streamFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  const logRef = useRef<HTMLDivElement | null>(null);
  const mentionEditorRef = useRef<HTMLDivElement | null>(null);
  const skillMenuFromSlashRef = useRef(false);
  /* 生成是异步的：收尾时要按「此刻面板开着没有」决定要不要点亮 rail。 */
  const openRef = useRef(open);

  useEffect(() => {
    const stored = readSession();
    if (stored) {
      setMessages(stored.messages);
      setModel(stored.model);
      setWebMode(stored.webMode);
      setAutoApply(stored.autoApply);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Persist only after hydration has been committed, otherwise the mount
    // pass would overwrite the stored session with the empty initial state.
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        CANVAS_AGENT_DOCK_SESSION_KEY,
        JSON.stringify({ model, webMode, autoApply, messages: messages.slice(-MESSAGE_LIMIT) }),
      );
    } catch {
      /* session persistence is best effort */
    }
  }, [hydrated, messages, model, webMode, autoApply]);

  /* 只有本来就贴在底部时才跟着滚：上滑看历史的时候，流式内容不该把人拽回底部。 */
  const trackLogScroll = useCallback(() => {
    const node = logRef.current;
    if (!node) return;
    const next = node.scrollHeight - node.scrollTop - node.clientHeight <= SCROLL_BOTTOM_GAP;
    stickToBottomRef.current = next;
    setAtBottom(next);
  }, []);

  const jumpToBottom = useCallback(() => {
    const node = logRef.current;
    if (!node) return;
    stickToBottomRef.current = true;
    setAtBottom(true);
    node.scrollTop = node.scrollHeight;
  }, []);

  useEffect(() => {
    const node = logRef.current;
    if (node && stickToBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [messages, streamText]);

  /* 面板每次打开都从最新的地方看起，打开即视为看过新回答。 */
  useEffect(() => {
    openRef.current = open;
    if (open) {
      jumpToBottom();
      setUnreadReply(false);
    } else {
      setHelpOpen(false);
    }
  }, [jumpToBottom, open]);

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setHelpOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [helpOpen]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  /* 芯片和 @ 引用是同一份选区的两种呈现，共用一套顺序：芯片上的编号就是 @编号。 */
  const orderedChips = useMemo(
    () => (chipOrder.length ? orderByReferenceIds(chips, chipOrder, (chip) => chip.id) : chips),
    [chipOrder, chips],
  );
  /* 引用有上限，@ 编号必须和真正发出去的引用一一对应，所以这里先夹一次。 */
  const orderedReferences = useMemo(
    () =>
      (chipOrder.length ? orderByReferenceIds(references, chipOrder, referenceOrderKey) : references).slice(
        0,
        CANVAS_AGENT_DOCK_MAX_REFERENCES,
      ),
    [chipOrder, references],
  );
  const mentionOptions = useMemo<ReferenceMentionOption[]>(
    () =>
      orderedReferences.map((reference) => ({
        id: reference.id,
        kind: reference.kind,
        name: reference.name,
        ...(reference.url ? { url: reference.url } : {}),
        ...(reference.text ? { text: reference.text } : {}),
      })),
    [orderedReferences],
  );
  const orderedSelectedNodeIds = useMemo(
    () => (chipOrder.length ? orderByReferenceIds(selectedNodeIds, chipOrder, (id) => id) : selectedNodeIds),
    [chipOrder, selectedNodeIds],
  );
  const chipMentionIndexes = useMemo(
    () => new Map(orderedReferences.map((reference, index) => [referenceOrderKey(reference), index + 1] as const)),
    [orderedReferences],
  );
  const selectedTaskText = useMemo(() => taskStatusText(countSelectedTaskStatus(orderedChips)), [orderedChips]);
  /* 画布上的任务状态可以直接点：把选中和视口一起拉过去，省得在无限画布上自己找。 */
  const canvasTaskLinks = useMemo(() => {
    const links: Array<{ key: string; label: string; ids: string[] }> = [];
    const active = status.running + status.queued;
    if (active > 0) links.push({ key: "active", label: `${active} 个进行中`, ids: status.activeIds });
    if (status.failed > 0) links.push({ key: "failed", label: `${status.failed} 个失败`, ids: status.failedIds });
    return links;
  }, [status]);
  /* 画布传进来的选中数量是完整的，芯片只有前几个，头部要报真实数字。 */
  const selectedNodeTotal = selectedTotal ?? chips.length;
  const moveChip = useCallback(
    (draggedId: string, targetId: string) => {
      const order = orderedChips.map((chip) => chip.id);
      const next = reorderReferenceIds(order, order.indexOf(draggedId), order.indexOf(targetId));
      if (next) setChipOrder(next);
    },
    [orderedChips],
  );
  /* 芯片用指针事件拖：拖动过程中就能看到换位，不必依赖浏览器原生拖拽（画布 stage 里的缩略图
     带 -webkit-user-drag:none，原生拖拽经常起不来，而且只有正好丢在另一枚芯片上才生效）。 */
  const beginChipDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, chipId: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    chipDragRef.current = { id: chipId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    chipDragMovedRef.current = false;
    chipClickBlockedRef.current = false;
    setDragChipId(chipId);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 捕获失败时芯片上的 pointermove 仍然够用 */
    }
  }, []);
  const trackChipDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, chipId: string) => {
      const drag = chipDragRef.current;
      if (!drag || drag.id !== chipId || drag.pointerId !== event.pointerId) return;
      if (!chipDragMovedRef.current) {
        // 手抖几个像素还是点击（点击＝定位到该节点）。
        if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 4) return;
        chipDragMovedRef.current = true;
      }
      event.preventDefault();
      const targetId = chipIdUnderPoint(contextRef.current, chipId, event.clientX, event.clientY);
      if (targetId) moveChip(chipId, targetId);
    },
    [moveChip],
  );
  const endChipDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!chipDragRef.current) return;
    if (chipDragMovedRef.current) chipClickBlockedRef.current = true;
    chipDragRef.current = null;
    setDragChipId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  /* 画布上真有失败节点时，「排查失败」先把它们选中再提问：否则模型只能收到一句干问。
     与「选中」强相关的提问在没选中节点时会被模型直接回绝，所以先置灰并说明怎么用。 */
  const quickActions = useMemo(() => {
    const needsSelection = selectedNodeTotal === 0;
    const selectionTitle = needsSelection ? "先在画布上选中节点，再点这条提问" : "用当前选中的节点回答";
    return [
      { label: "总结选中", prompt: "用 5 条以内的要点总结我选中的这些节点，并指出可继续的方向。", ids: [] as string[], disabled: needsSelection, title: selectionTitle },
      { label: "写提示词", prompt: "基于选中的节点，给我 3 条可直接用于图片生成的中文提示词。", ids: [] as string[], disabled: needsSelection, title: selectionTitle },
      {
        label: status.failedIds.length ? `排查失败（${status.failedIds.length}）` : "排查失败",
        prompt: status.failedIds.length
          ? "我已在画布上选中失败的节点，请逐个说明失败原因，并给出可直接执行的修复步骤。"
          : "如果画布上有失败或卡住的节点，说明原因并给出具体修复步骤。",
        ids: status.failedIds,
        disabled: false,
        title: status.failedIds.length ? "选中失败的节点后提问" : "画布上有失败或卡住的节点时最有用",
      },
      { label: "下一步建议", prompt: "结合当前选中的节点和它们的关系，告诉我下一步最值得做的 3 件事。", ids: [] as string[], disabled: needsSelection, title: selectionTitle },
      { label: "整理并连线", prompt: "把选中的节点按当前卡片顺序依次连线，并横向整理；先给我看操作计划。", ids: [] as string[], disabled: selectedNodeTotal < 2, title: selectedNodeTotal < 2 ? "至少选中两个节点后使用" : "按顶部卡片顺序生成可确认的画布操作计划" },
      { label: "复制为分支", prompt: "复制选中的节点或流程作为方案分支；先给我看操作计划。", ids: [] as string[], disabled: needsSelection, title: needsSelection ? "先在画布上选中要复制的节点" : "复制节点及关系，并生成可确认的画布操作计划" },
    ];
  }, [selectedNodeTotal, status.failedIds]);

  const refreshSkills = useCallback(async () => {
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      const data = await response.json();
      setSkills(Array.isArray(data?.skills) ? data.skills.filter((skill: SkillPickerEntry) => skill && skill.enabled) : []);
    } catch {
      /* 拉取失败时保留上一次的技能列表 */
    }
  }, []);

  const closeSkillMenu = useCallback(() => {
    skillMenuFromSlashRef.current = false;
    setSkillMenuOpen(false);
    setSkillQuery("");
  }, []);

  const openSkillMenu = useCallback(
    (query: string) => {
      setSkillQuery(query || "");
      setSkillActive(0);
      setSkillMenuOpen(true);
      void refreshSkills();
    },
    [refreshSkills],
  );

  /* contenteditable 没有 setSelectionRange：把光标折叠到内容末尾。 */
  const focusEditorEnd = useCallback(() => {
    window.setTimeout(() => {
      const node = mentionEditorRef.current;
      if (!node) return;
      node.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }, 0);
  }, []);

  /* 画布上点「问 Agent」：面板展开后光标直接落在输入框，少一次点击。 */
  useEffect(() => {
    if (!open || !focusSignal) return;
    focusEditorEnd();
  }, [focusEditorEnd, focusSignal, open]);

  const applySkill = useCallback(
    (skill: SkillPickerEntry) => {
      setInput((value) => skillMessageValue(value, skill.name));
      closeSkillMenu();
      focusEditorEnd();
    },
    [closeSkillMenu, focusEditorEnd],
  );

  /* 编辑自己发过的提问：填回输入框，发送时从那一轮重新问。 */
  const beginEditMessage = useCallback(
    (message: CanvasAgentDockMessage) => {
      inputBeforeEditRef.current = input;
      setEditingMessageId(message.id);
      setInput(message.content);
      focusEditorEnd();
    },
    [focusEditorEnd, input],
  );

  /* 取消编辑＝放弃这次改写，输入框还原成点「编辑」之前的内容。 */
  const cancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setInput(inputBeforeEditRef.current);
    focusEditorEnd();
  }, [focusEditorEnd]);

  const stop = useCallback(() => {
    abortRef.current?.abort(new DOMException("已停止", "AbortError"));
    abortRef.current = null;
    setBusy(false);
  }, []);

  const send = useCallback(
    async (raw?: string, options: { fromMessageId?: string } = {}) => {
      const text = String(raw ?? input).trim();
      if (!text) {
        notify("先输入要问 Agent 的内容。", "error");
        return;
      }
      if (busy) return;
      const invalidMentions = invalidReferenceMentionNumbers(text, orderedReferences);
      if (invalidMentions.length) {
        notify(`引用编号无效：${invalidMentions.map((number) => `@${number}`).join("、")}`, "error");
        return;
      }
      closeSkillMenu();
      lastUserTextRef.current = text;
      streamTextRef.current = "";
      /* 自己发的新消息一定要看到，所以这一次强制贴底。 */
      stickToBottomRef.current = true;
      // 输入框里显示 @1，模型收到的应该是它指向的那张图，否则编号对不上。
      const mentionText = resolveReferenceMentions(text, orderedReferences);
      const mentionedNodeIds = nodeIdsForReferenceMentions(text, orderedReferences);
      /* 重新问某一轮（重跑或改过之后再问）时先把它之后的内容丢掉，否则会留下两份回答。 */
      const fromMessageId = options.fromMessageId ?? editingMessageId ?? undefined;
      const base = fromMessageId
        ? (() => {
            const index = messages.findIndex((message) => message.id === fromMessageId);
            return index >= 0 ? messages.slice(0, index) : messages;
          })()
        : messages;
      const userMessage: CanvasAgentDockMessage = {
        id: createId(),
        role: "user",
        /* 存自解释的引用名：三天后回看这条消息，也不再依赖当时的 @ 编号。 */
        content: labelReferenceMentions(text, orderedReferences),
      };
      const history = [...base, userMessage];
      setMessages(history);
      setInput("");
      setEditingMessageId(null);
      setProgressDetail("");
      setStreamText("");
      const previousImageMessage = [...base]
        .reverse()
        .find((message) => message.role === "assistant" && message.images?.length);
      if (canvasAgentDockRequestsPreviousImageApply(text) && previousImageMessage?.images?.length) {
        if (previousImageMessage.imageNodeIds?.length) {
          onFocusNodes(previousImageMessage.imageNodeIds);
          setMessages([
            ...history,
            {
              id: createId(),
              role: "assistant",
              content: "上一轮图片已经在画布中，已为你定位结果。",
              model: previousImageMessage.model,
              imageNodeIds: previousImageMessage.imageNodeIds,
            },
          ]);
        } else {
          const appliedIds = onApplyImages(previousImageMessage.images, {
            prompt: "上一轮 Agent 图片",
            model: previousImageMessage.model,
          });
          setMessages([
            ...history,
            {
              id: createId(),
              role: "assistant",
              content: `已将上一轮的 ${previousImageMessage.images.length} 张图片加入画布。`,
              model: previousImageMessage.model,
              images: previousImageMessage.images,
              imageNodeIds: appliedIds,
            },
          ]);
        }
        return;
      }
      const localPlan = buildCanvasAgentDockPlan(text, {
        targetNodeIds: orderedSelectedNodeIds,
        mentionedNodeIds,
        selectedTotal,
      });
      if (localPlan?.kind === "layout-selection" || localPlan?.kind === "selection-command") {
        const appliedResult = localPlan.requiresConfirmation ? { ids: [] } : onApplyPlan(localPlan);
        const appliedIds = appliedResult.ids;
        setMessages([
          ...history,
          {
            id: createId(),
            role: "assistant",
            content: appliedIds.length
              ? "已按计划完成画布操作。"
              : appliedResult.error
                ? `画布操作未执行：${appliedResult.error}`
                : "我识别到这是一个画布操作，请确认下面的执行计划。",
            ...(appliedIds.length ? { imageNodeIds: appliedIds } : {}),
            plan: {
              ...localPlan,
              ...(appliedIds.length
                ? { applied: true }
                : appliedResult.error
                  ? { failed: true, failureReason: appliedResult.error }
                  : {}),
            },
          },
        ]);
        return;
      }
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      /*
       * 长任务进度：主管线在工具轮里写快照（app/api/agent/progress），这里按 runId 轮询。
       * 正文一开始流式返回就停：用户已经在看字，阶段文案不该再顶掉它。
       * 单次模型调用可能很久，所以同一步骤超过 3 秒会带上秒表（见 lib/agent-client）。
       */
      const progressRunId = createId();
      const runContext = createCanvasAgentRunContext({
        runId: progressRunId,
        context,
        references: orderedReferences,
      });
      const stopAgentProgress = pollAgentProgress(progressRunId, {
        signal: controller.signal,
        isSettled: () => Boolean(streamTextRef.current),
        onProgress: (progress) => setProgressDetail(progress.message),
      });
      const outbound = history.map((message, index) => ({
        role: message.role,
        content:
          index === history.length - 1
            ? composeCanvasAgentDockMessage(resolveReferenceMentions(message.content, orderedReferences), contextBlock)
            : message.content,
      }));
      try {
        const response = await generateCanvasAgent(
          {
            messages: outbound,
            model,
            webMode,
            // 画布上下文只给模型看，意图判断必须用用户自己那句话。
            intentText: text,
            runId: progressRunId,
            context,
            references: orderedReferences.slice(0, CANVAS_AGENT_DOCK_MAX_REFERENCES),
            signal: controller.signal,
          },
          (event) => {
            if (event.type === "delta" && event.text) {
              const chunk = String(event.text);
              streamTextRef.current += chunk;
              if (streamFrameRef.current === null)
                streamFrameRef.current = window.requestAnimationFrame(() => {
                  streamFrameRef.current = null;
                  setStreamText(streamTextRef.current);
                });
            }
          },
        );
        const content = String(response.message || "").trim() || "（Agent 没有返回文本内容）";
        const images = canvasAgentDockAcceptsImages(response.deliverable)
          ? (response.images || []).map((image) => ({
              url: String(image.url || ""),
              ...(image.revisedPrompt ? { revisedPrompt: String(image.revisedPrompt) } : {}),
            }))
          : [];
        const plan = buildCanvasAgentDockPlan(text, {
          imageCount: images.length,
          targetNodeIds: orderedSelectedNodeIds,
          mentionedNodeIds,
          selectedTotal,
        });
        const assistantMessageId = createId();
        /* 需要确认的外部操作：确认卡挂在这条回答上；面板收起时说一声，别让这次确认悄悄过期。 */
        const approval = readStoredApproval(response.approval);
        const mcpTools = readStoredMcpTools(response.mcpTools);
        const files = readStoredFiles(response.files);
        if (approval && !openRef.current) notify("助手有个操作等你确认，展开面板处理。");
        const shouldAutoApply = images.length > 0 && autoApply && (!plan || !plan.requiresConfirmation);
        let appliedImageIds: string[] = [];
        if (shouldAutoApply) {
          if (plan) {
            appliedImageIds = onApplyPlan(plan, images, runContext).ids;
          } else {
            const appliedIds = onApplyImages(images, { prompt: mentionText, model: response.model, runContext });
            appliedImageIds = appliedIds;
          }
        }
        setMessages((value) => [
          ...value,
          {
            id: assistantMessageId,
            role: "assistant",
            content,
            model: response.model,
            ...(images.length ? { images } : {}),
            ...(response.skills?.length
              ? { skills: response.skills.map((skill) => ({ id: String(skill.id || ""), name: String(skill.name || "") })) }
              : {}),
            ...(plan ? { plan: { ...plan, ...(appliedImageIds.length ? { applied: true } : {}) } } : {}),
            ...(appliedImageIds.length ? { imageNodeIds: appliedImageIds } : {}),
            ...(images.length || plan ? { runContext } : {}),
            ...(approval ? { approval } : {}),
            ...(mcpTools.length ? { mcpTools } : {}),
            ...(files.length ? { files } : {}),
          },
        ]);
        if (autoApply && canvasAgentDockShouldAutoApplyText(text)) {
          const appliedIds = onApplyText(content, { prompt: mentionText });
          if (appliedIds.length) {
            setMessages((value) =>
              value.map((message) => (message.id === assistantMessageId ? { ...message, textNodeId: appliedIds[0] } : message)),
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent 请求失败";
        if (message.includes("已停止") || (error instanceof DOMException && error.name === "AbortError")) {
          /* 已经流回来的那半截是继续写的上下文，不能丢。 */
          const partial = streamTextRef.current.trim();
          setMessages((value) => [
            ...value,
            partial
              ? { id: createId(), role: "assistant", content: partial, interrupted: true }
              : { id: createId(), role: "assistant", content: "已停止这一轮回答。" },
          ]);
        } else {
          const friendly = describeAgentError(message, typeof navigator === "undefined" ? true : navigator.onLine);
          setMessages((value) => [
            ...value,
            {
              id: createId(),
              role: "assistant",
              content: `请求失败：${friendly}`,
              error: message,
              retryText: lastUserTextRef.current,
            },
          ]);
          notify(friendly, "error");
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        /* 收起面板时跑完的这一轮：rail 上要能看出来，点开就能看到结果。 */
        if (!openRef.current) setUnreadReply(true);
        if (streamFrameRef.current !== null) window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
        setStreamText("");
        stopAgentProgress();
        setProgressDetail("");
      }
    },
    [autoApply, busy, closeSkillMenu, context, contextBlock, editingMessageId, input, messages, model, notify, onApplyImages, onApplyPlan, onApplyText, onFocusNodes, orderedReferences, orderedSelectedNodeIds, selectedTotal, webMode],
  );

  const applyMessagePlan = useCallback((message: CanvasAgentDockMessage) => {
    if (!message.plan || message.plan.applied || message.plan.dismissed) return;
    const result = onApplyPlan(message.plan, message.images, message.runContext);
    const ids = result.ids;
    setMessages((value) => value.map((item) => item.id === message.id
      ? {
          ...item,
          ...(ids.length ? { imageNodeIds: ids } : {}),
          plan: ids.length
            ? { ...message.plan!, applied: true }
            : { ...message.plan!, failed: true, failureReason: result.error || "画布没有发生变更，计划未应用" },
        }
      : item));
  }, [onApplyPlan]);

  const resolveMessageApproval = useCallback((messageId: string, outcome: AgentApprovalOutcome) => {
    setMessages((value) => value.map((item) => {
      if (item.id !== messageId) return item;
      /* 处理过的确认卡不再显示按钮：结果存到消息上，刷新后还在。 */
      const next: CanvasAgentDockMessage = {
        ...item,
        approvalResult: String(outcome.message || (outcome.rejected ? "已取消这一步操作，没有执行。" : "已执行完成。")),
      };
      delete next.approval;
      if (outcome.mcpTools?.length) next.mcpTools = [...(item.mcpTools || []), ...outcome.mcpTools];
      return next;
    }));
  }, []);

  const dismissMessagePlan = useCallback((message: CanvasAgentDockMessage) => {
    if (!message.plan || message.plan.applied) return;
    setMessages((value) => value.map((item) => item.id === message.id
      ? { ...item, plan: { ...message.plan!, dismissed: true } }
      : item));
  }, []);

  const useHelpExample = useCallback(
    (prompt: string) => {
      setInput(prompt);
      setHelpOpen(false);
      focusEditorEnd();
    },
    [focusEditorEnd],
  );

  const cycleWebMode = useCallback(() => {
    setWebMode((value) => WEB_MODE_ORDER[(WEB_MODE_ORDER.indexOf(value) + 1) % WEB_MODE_ORDER.length]);
  }, []);
  const nextWebMode = WEB_MODE_ORDER[(WEB_MODE_ORDER.indexOf(webMode) + 1) % WEB_MODE_ORDER.length];

  const clearSession = useCallback(() => {
    /* 新建对话会清掉整段记录且不可恢复，非空时先问一句。 */
    if (messages.length && typeof window !== "undefined" && !window.confirm("清空当前对话？画布内容不受影响。"))
      return;
    stop();
    setMessages([]);
    setStreamText("");
    setExpandedMessages(new Set());
    notify("已开始新的 Agent 对话");
  }, [messages.length, notify, stop]);

  const toggleMessageExpanded = useCallback((id: string) => {
    setExpandedMessages((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapsedMessages = useMemo(() => {
    const collapsed = new Set<string>();
    for (const message of messages)
      if (message.content.length > MESSAGE_COLLAPSE_CHARS && !expandedMessages.has(message.id))
        collapsed.add(message.id);
    return collapsed;
  }, [expandedMessages, messages]);

  const lastAssistantId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1)
      if (messages[index].role === "assistant") return messages[index].id;
    return null;
  }, [messages]);

  /* 重跑某一轮：用那条用户消息重新提问（引用已经落成名字，重发不会再走 @ 解析）。 */
  const regenerate = useCallback(
    (assistantId: string) => {
      const index = messages.findIndex((message) => message.id === assistantId);
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (messages[cursor].role !== "user") continue;
        void send(messages[cursor].content, { fromMessageId: messages[cursor].id });
        return;
      }
      notify("这一轮没有找到对应的提问，没法重新生成。", "error");
    },
    [messages, notify, send],
  );

  const copyMessage = useCallback(
    (content: string) => {
      void navigator.clipboard?.writeText(content).then(
        () => notify("已复制"),
        () => notify("复制失败", "error"),
      );
    },
    [notify],
  );

  /* 存成节点后记下画布节点 id：按钮从此变成定位入口，能直接跳回画布看这段回复。 */
  const storeReplyNode = useCallback(
    (message: CanvasAgentDockMessage) => {
      const ids = onApplyText(message.content, { prompt: "Agent 回复" });
      setMessages((value) =>
        value.map((item) => (item.id === message.id ? { ...item, textNodeId: ids[0] } : item)),
      );
    },
    [onApplyText],
  );

  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
    placement: "above" | "below";
  } | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  }, []);

  /* 面板里的回复用和节点文本一样的选中工具栏：选段后能直接复制、建节点、转图片/转视频。 */
  const updateSelection = useCallback(() => {
    const log = logRef.current;
    const dock = log?.closest(".canvas-agent-dock") || null;
    const current = typeof window === "undefined" ? null : window.getSelection();
    if (
      !log ||
      !dock ||
      !current ||
      current.isCollapsed ||
      !current.rangeCount ||
      !current.anchorNode ||
      !current.focusNode ||
      !log.contains(current.anchorNode) ||
      !log.contains(current.focusNode)
    ) {
      setSelection(null);
      return;
    }
    const anchorMessage = messageElementOf(current.anchorNode);
    if (!anchorMessage || anchorMessage !== messageElementOf(current.focusNode)) {
      setSelection(null);
      return;
    }
    const selectedText = current.toString().trim();
    const rect = current.getRangeAt(0).getBoundingClientRect();
    if (!selectedText || (!rect.width && !rect.height)) {
      setSelection(null);
      return;
    }
    /* 工具栏必须留在面板的 DOM 里：画布用它判断这一按是不是 UI 覆盖层，
       否则会被当成平移起手并抢走 pointer capture，按钮收不到 click。 */
    const dockRect = dock.getBoundingClientRect();
    const toolbarWidth = Math.min(420, Math.max(260, dockRect.width - 16));
    const halfWidth = toolbarWidth / 2;
    const center = rect.left + rect.width / 2 - dockRect.left;
    const x = Math.min(dockRect.width - halfWidth - 8, Math.max(halfWidth + 8, center));
    const top = rect.top - dockRect.top;
    const bottom = rect.bottom - dockRect.top;
    const showBelow = top < 48;
    setSelection({
      text: selectedText,
      x,
      y: showBelow ? bottom + 8 : top - 8,
      placement: showBelow ? "below" : "above",
    });
  }, []);

  useEffect(() => {
    if (!selection) return;
    const log = logRef.current;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".canvas-text-selection-toolbar")) return;
      if (!log?.contains(target)) setSelection(null);
    };
    const handleViewportChange = () => setSelection(null);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    log?.addEventListener("scroll", handleViewportChange);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      log?.removeEventListener("scroll", handleViewportChange);
    };
  }, [selection]);

  const copySelection = useCallback(() => {
    const value = selection?.text;
    if (!value) return;
    clearSelection();
    void navigator.clipboard?.writeText(value).then(
      () => notify("已复制选中的文本"),
      () => notify("复制失败，请检查浏览器剪贴板权限", "error"),
    );
  }, [clearSelection, notify, selection]);

  const runSelectionAction = useCallback(
    (action: (value: string) => void) => {
      const value = selection?.text;
      if (!value) return;
      clearSelection();
      action(value);
    },
    [clearSelection, selection],
  );

  if (!open)
    return (
      <button
        type="button"
        className={`canvas-agent-dock-rail${busy ? " is-busy" : ""}${!busy && status.failed ? " is-failed" : ""}${!busy && !status.failed && unreadReply ? " is-unread" : ""}`}
        onClick={() => onToggle(true)}
        title={
          busy
            ? "Agent 正在生成，点开面板查看或停止"
            : status.failed
              ? `画布上有 ${status.failed} 个失败节点，点开面板定位`
              : unreadReply
                ? "Agent 答完了，点开面板看新回答"
                : "展开 Agent 助手"
        }
        aria-label={
          busy
            ? "Agent 正在生成，展开面板查看或停止"
            : status.failed
              ? `画布上有 ${status.failed} 个失败节点，展开面板定位`
              : unreadReply
                ? "Agent 有新回答，展开面板查看"
                : "展开 Agent 助手"
        }
      >
        <span aria-hidden="true">✦</span>
        <em>{busy ? "生成中" : status.failed ? `${status.failed} 个失败` : unreadReply ? "有新回答" : "Agent"}</em>
        {status.running + status.queued > 0 && <b>{status.running + status.queued}</b>}
      </button>
    );

  return (
    <aside className="canvas-agent-dock" aria-label="画布 Agent 助手">
      <header className="canvas-agent-dock-head">
        <div className="canvas-agent-dock-title">
          <span aria-hidden="true">✦</span>
          <div>
            <b>Agent 助手</b>
            <small>
              {chips.length ? `已选中 ${selectedNodeTotal} 个节点` : "未选中节点 · 选中后提问更准"}
              {selectedNodeTotal > CANVAS_AGENT_DOCK_MAX_REFERENCES
                ? ` · 引用最多带 ${CANVAS_AGENT_DOCK_MAX_REFERENCES} 个`
                : ""}
              {selectedNodeTotal > CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES
                ? ` · 节点信息最多带 ${CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES} 个`
                : ""}
              {selectedTaskText ? ` · ${selectedTaskText}` : ""}
              {!selectedTaskText && canvasTaskLinks.length ? (
                <>
                  {" · 画布上"}
                  {canvasTaskLinks.map((link, index) => (
                    <Fragment key={link.key}>
                      {index ? " · " : " "}
                      <button
                        type="button"
                        className="canvas-agent-dock-head-task"
                        onClick={() => onFocusNodes(link.ids)}
                        title={`在画布上定位：${link.label}`}
                      >
                        {link.label}
                      </button>
                    </Fragment>
                  ))}
                </>
              ) : null}
            </small>
          </div>
        </div>
        <div className="canvas-agent-dock-head-actions">
          <SkillManager disabled={busy} icon={<SkillIcon size={14} />} />
          <button
            type="button"
            className={helpOpen ? "is-active" : ""}
            onClick={() => setHelpOpen((value) => !value)}
            title="Agent 使用指南"
            aria-label="Agent 使用指南"
            aria-expanded={helpOpen}
            aria-controls="canvas-agent-dock-help"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h4v15H7a2.5 2.5 0 0 0-2.5 2.5zM19.5 5.5A2.5 2.5 0 0 0 17 3h-4v15h4a2.5 2.5 0 0 1 2.5 2.5z" />
            </svg>
          </button>
          <button type="button" onClick={clearSession} title="新建对话" aria-label="新建对话">
            ＋
          </button>
          <button type="button" onClick={() => onToggle(false)} title="收起 Agent 助手" aria-label="收起 Agent 助手">
            —
          </button>
        </div>
      </header>
      {helpOpen ? (
        <section id="canvas-agent-dock-help" className="canvas-agent-dock-help" aria-label="Agent 使用指南">
          <div className="canvas-agent-dock-help-head">
            <div>
              <strong>让 Agent 和画布一起工作</strong>
              <small>结构操作先确认，明确的出图请求会直接生成结果。</small>
            </div>
            <button type="button" onClick={() => setHelpOpen(false)} aria-label="关闭使用指南">×</button>
          </div>
          <ol className="canvas-agent-dock-help-steps">
            <li><b>1</b><span><strong>选择对象</strong><small>选中节点后再提问；未选中时读取整张画布概况。</small></span></li>
            <li><b>2</b><span><strong>说明目标</strong><small>输入 @1、@2 精确引用；拖动顶部卡片可调整处理顺序。</small></span></li>
            <li><b>3</b><span><strong>确认执行</strong><small>结构操作确认后执行；出图完成后自动加入画布，均支持撤销。</small></span></li>
          </ol>
          <div className="canvas-agent-dock-help-examples">
            <b>点一个示例开始</b>
            <div>
              {HELP_EXAMPLES.map((example) => {
                const disabled = selectedNodeTotal < example.minimumSelection;
                const requirement = example.minimumSelection
                  ? `至少选中 ${example.minimumSelection} 个节点`
                  : example.description;
                return (
                  <button
                    key={example.label}
                    type="button"
                    onClick={() => useHelpExample(example.prompt)}
                    disabled={disabled}
                    title={disabled ? requirement : `填入：${example.prompt}`}
                  >
                    <span>{example.label}</span>
                    <small>{disabled ? requirement : example.description}</small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="canvas-agent-dock-help-notes">
            <span><b>智能落画布</b> 开启后，“画、生成、做一张”等指令会生成图片并加入画布；普通文字仅在明确要求保存时创建节点。</span>
            <span><b>安全边界</b> Agent 不会自动删除画布内容。</span>
            <span><kbd>Ctrl/⌘ K</kbd> 打开 Agent　<kbd>Esc</kbd> 停止生成或关闭指南</span>
          </div>
        </section>
      ) : null}
      <div className="canvas-agent-dock-context" ref={contextRef}>
        {orderedChips.length ? (
          orderedChips.map((chip) => {
            const mentionIndex = chipMentionIndexes.get(chip.id);
            return (
              <button
                type="button"
                key={chip.id}
                data-chip-id={chip.id}
                className={`canvas-agent-dock-chip${dragChipId === chip.id ? " dragging" : ""}`}
                onPointerDown={(event) => beginChipDrag(event, chip.id)}
                onPointerMove={(event) => trackChipDrag(event, chip.id)}
                onPointerUp={endChipDrag}
                onPointerCancel={endChipDrag}
                onClick={() => {
                  // 拖完浏览器还会补一次 click，别让它把视口带跑。
                  if (chipClickBlockedRef.current) {
                    chipClickBlockedRef.current = false;
                    return;
                  }
                  onFocusNodes([chip.id]);
                }}
                title={
                  mentionIndex
                    ? `定位到${chip.label} · 输入 @${mentionIndex} 引用它 · 拖动可调整顺序`
                    : `定位到${chip.label} · 拖动可调整顺序`
                }
              >
                {mentionIndex ? (
                  <b className="canvas-agent-dock-chip-index" aria-hidden="true">
                    {mentionIndex}
                  </b>
                ) : null}
                {chip.thumb ? <img src={chip.thumb} alt="" /> : <i aria-hidden="true">{chip.kind === "text" ? "T" : "▣"}</i>}
                <span>{chip.label}</span>
              </button>
            );
          })
        ) : (
          <small>在画布上选中节点后，这里会显示它们，并把节点信息一起发给 Agent；编号＝输入 @ 时用的编号，拖动可调整顺序。没有选中时，Agent 读整张画布的概况。</small>
        )}
      </div>
      {/* 流式时逐字播报会把读屏塞满，所以只在回答结束后才播报。 */}
      <div
        className="canvas-agent-dock-log"
        ref={logRef}
        role="log"
        aria-live={busy ? "off" : "polite"}
        onScroll={trackLogScroll}
        onMouseUp={updateSelection}
        onKeyUp={updateSelection}
        onTouchEnd={updateSelection}
      >
        {messages.length === 0 && !busy && (
          <div className="canvas-agent-dock-empty">
            <b>可以这样问</b>
            {EMPTY_SAMPLES.map((sample) => (
              <button key={sample} type="button" onClick={() => setInput(sample)}>
                {sample}
              </button>
            ))}
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`canvas-agent-dock-message ${message.role} ${message.error ? "is-error" : ""} ${message.interrupted ? "is-interrupted" : ""} ${message.role === "user" && message.images?.length ? "has-media" : ""}`}
          >
            {message.role === "assistant" ? (
              <div className="canvas-agent-dock-role">
                <b>✦ Agent</b>
                {message.model ? <small>{message.model}</small> : null}
              </div>
            ) : null}
            {message.mcpTools?.length ? (
              <div className="canvas-agent-dock-mcp">
                {message.mcpTools.map((tool, index) => (
                  <span key={`${message.id}-mcp-${index}`}>
                    {`外部工具 · ${tool.server} · ${tool.name}${tool.ok ? "" : "（失败）"}`}
                  </span>
                ))}
              </div>
            ) : null}
            {message.skills?.length ? (
              <div className="canvas-agent-dock-skills">
                {message.skills.map((skill) => (
                  <span key={skill.id || skill.name}>技能 · {skill.name}</span>
                ))}
              </div>
            ) : null}
            {message.role === "assistant" ? (
              <AgentMarkdown
                text={collapsedMessages.has(message.id) ? messagePreview(message.content) : message.content}
                onCopyCode={copyMessage}
              />
            ) : (
              <p>{message.content}</p>
            )}
            {message.files?.length ? (
              <div className="canvas-agent-dock-files">
                {message.files.map((file, index) => (
                  <article key={`${message.id}-file-${index}`} className="canvas-agent-dock-file">
                    <div className="canvas-agent-dock-file-info">
                      <strong title={file.name}>{file.name}</strong>
                      <small>{`${canvasAgentDockFileKind(file)} · ${formatAgentFileSize(file.size)}`}</small>
                    </div>
                    <div className="canvas-agent-dock-file-actions">
                      {file.artifactId ? (
                        <button type="button" onClick={() => openCanvasAgentDockFile(file, notify)}>
                          预览
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          void downloadCanvasAgentDockFile(file).catch((error) =>
                            notify(error instanceof Error ? error.message : "文件下载失败", "error"),
                          )
                        }
                      >
                        下载
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            {message.interrupted ? <span className="canvas-agent-dock-stopped">（已停止）</span> : null}
            {message.content.length > MESSAGE_COLLAPSE_CHARS ? (
              <button
                type="button"
                className="canvas-agent-dock-more"
                onClick={() => toggleMessageExpanded(message.id)}
              >
                {collapsedMessages.has(message.id) ? `展开全文（${message.content.length.toLocaleString()} 字）` : "收起"}
              </button>
            ) : null}
            {message.approval ? (
              <AgentApprovalCard
                approval={message.approval}
                onResolved={(outcome) => resolveMessageApproval(message.id, outcome)}
              />
            ) : null}
            {message.approvalResult ? <div className="message-approval-result">{message.approvalResult}</div> : null}
            {message.images?.length ? (
              <div className="canvas-agent-dock-media">
                {message.images.map((image, index) => (
                  <button
                    type="button"
                    key={`${message.id}-${index}`}
                    className="canvas-agent-dock-media-item"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        CANVAS_AGENT_DOCK_IMAGE_DRAG_TYPE,
                        JSON.stringify({ url: image.url, revisedPrompt: image.revisedPrompt || "" }),
                      );
                    }}
                    onClick={() => onPreviewImages(message.images || [], index)}
                    title="点开看大图：同一轮返回的其它图可以直接对比；也可以把这张图拖到画布上，落在你松开的位置"
                  >
                    <img src={image.url} alt={image.revisedPrompt || "Agent 图片"} />
                  </button>
                ))}
              </div>
            ) : null}
            {message.plan ? (
              <div className={`canvas-agent-dock-plan${message.plan.applied ? " is-applied" : message.plan.dismissed ? " is-dismissed" : message.plan.failed ? " is-failed" : ""}`}>
                <div className="canvas-agent-dock-plan-head"><strong>画布操作计划</strong><span>{message.plan.applied ? "已应用" : message.plan.dismissed ? "已取消" : message.plan.failed ? "未应用" : "待确认"}</span></div>
                <b>{message.plan.title}</b>
                <ol>{message.plan.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                {message.plan.failureReason ? <small className="canvas-agent-dock-plan-error">{message.plan.failureReason}</small> : null}
                {!message.plan.applied && !message.plan.dismissed && !message.plan.failed ? (
                  <div className="canvas-agent-dock-plan-actions">
                    <button type="button" className="primary" onClick={() => applyMessagePlan(message)}>确认并应用</button>
                    <button type="button" onClick={() => dismissMessagePlan(message)}>取消</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="canvas-agent-dock-message-tools">
              {message.role === "assistant" && !message.error ? (
                <>
                  {message.textNodeId ? (
                    <button type="button" onClick={() => onFocusNodes(message.textNodeId ? [message.textNodeId] : [])}>定位节点</button>
                  ) : (
                    <button type="button" onClick={() => storeReplyNode(message)}>存为节点</button>
                  )}
                  <button type="button" onClick={() => copyMessage(message.content)}>
                    复制
                  </button>
                </>
              ) : null}
              {message.role === "user" ? (
                <>
                  <button type="button" disabled={busy} onClick={() => beginEditMessage(message)}>
                    编辑
                  </button>
                  <button type="button" onClick={() => copyMessage(message.content)}>
                    复制
                  </button>
                </>
              ) : null}
              {message.error && message.retryText ? (
                <button type="button" disabled={busy} onClick={() => void send(message.retryText)}>
                  重试
                </button>
              ) : null}
              {message.role === "assistant" && message.id === lastAssistantId && !message.error ? (
                <button type="button" disabled={busy} onClick={() => regenerate(message.id)}>
                  重新生成
                </button>
              ) : null}
              {message.interrupted && message.id === lastAssistantId ? (
                <button type="button" disabled={busy} onClick={() => void send("继续")}>
                  继续
                </button>
              ) : null}
              {message.images?.length ? (
                message.imageNodeIds?.length ? (
                  <button
                    type="button"
                    onClick={() => onFocusNodes(message.imageNodeIds || [])}
                    title="已加入画布，点击定位这组图片节点"
                  >
                    定位结果
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const ids = onApplyImages(message.images || [], { prompt: "Agent 图片", model: message.model });
                      setMessages((value) =>
                        value.map((item) => (item.id === message.id ? { ...item, imageNodeIds: ids } : item)),
                      );
                    }}
                  >
                    加入画布
                  </button>
                )
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="canvas-agent-dock-message assistant is-streaming">
            <p>{streamText || progressDetail || "正在思考…"}</p>
          </div>
        ) : null}
        {!atBottom ? (
          <button type="button" className="canvas-agent-dock-jump" onClick={jumpToBottom} aria-label="回到最新消息">
            ↓ 最新消息
          </button>
        ) : null}
      </div>
      {selection ? (
        <div
          className={`canvas-text-selection-toolbar canvas-agent-dock-selection-toolbar ${selection.placement}`}
          style={{ left: selection.x, top: selection.y }}
          role="toolbar"
          aria-label="选中文本操作"
          onMouseDown={(event) => event.preventDefault()}
          onTouchStart={(event) => event.preventDefault()}
        >
          <span>{selection.text.length.toLocaleString()} 字</span>
          <button type="button" onClick={copySelection}>
            复制选段
          </button>
          <button type="button" className="primary" onClick={() => runSelectionAction(onCreateAgentNode)}>
            创建 Agent 节点
          </button>
          <button type="button" onClick={() => runSelectionAction(onUseAsImagePrompt)}>
            转图片
          </button>
          <button type="button" onClick={() => runSelectionAction(onUseAsVideoPrompt)}>
            转视频
          </button>
        </div>
      ) : null}
      <div className="canvas-agent-dock-quick">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.title}
            onClick={() => {
              if (action.ids.length) onFocusNodes(action.ids);
              setInput(action.prompt);
            }}
            disabled={busy || action.disabled}
          >
            {action.label}
          </button>
        ))}
      </div>
      {editingMessageId ? (
        <div className="canvas-agent-dock-editing">
          <span>正在编辑这条提问 · 发送后会替换它之后的回答</span>
          <button type="button" onClick={cancelEditMessage}>
            取消
          </button>
        </div>
      ) : null}
      <form
        className="canvas-agent-dock-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) stop();
          else void send();
        }}
      >
        <ReferenceMentionEditor
          ref={mentionEditorRef}
          value={input}
          references={mentionOptions}
          className="canvas-agent-dock-mention-editor"
          menuClassName="canvas-mention-menu canvas-agent-dock-mention-menu"
          ariaLabel="给 Agent 的消息"
          placeholder="问这只画布的 Agent，Enter 发送 / Shift+Enter 换行；输入 @ 引用选中节点，生成中按 Esc 停止"
          transformPastedText={(value) => replaceNaturalReferenceLabels(value, mentionOptions).value}
          onChange={(value) => {
            setInput(value);
            const slashQuery = skillSlashQuery(value);
            if (slashQuery !== null) {
              skillMenuFromSlashRef.current = true;
              if (!skillMenuOpen) void refreshSkills();
              setSkillQuery(slashQuery);
              setSkillActive(0);
              setSkillMenuOpen(true);
            } else if (skillMenuFromSlashRef.current) {
              closeSkillMenu();
            }
          }}
          onKeyDown={(event) => {
            if (skillMenuOpen) {
              const visibleSkills = filterSkills(skills, skillQuery);
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (visibleSkills.length) {
                  setSkillActive((current) => {
                    const next = event.key === "ArrowDown" ? current + 1 : current - 1;
                    return (next + visibleSkills.length) % visibleSkills.length;
                  });
                }
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeSkillMenu();
                return;
              }
              if (
                skillMenuFromSlashRef.current &&
                (event.key === "Enter" || event.key === "Tab") &&
                !event.nativeEvent.isComposing &&
                visibleSkills.length
              ) {
                event.preventDefault();
                applySkill(visibleSkills[Math.min(Math.max(skillActive, 0), visibleSkills.length - 1)]);
                return;
              }
            }
            /* 生成中按 Esc 停：聊天面板的通用约定。 */
            if (event.key === "Escape" && busy) {
              event.preventDefault();
              stop();
              return;
            }
            /* 没在生成时，Esc 退出「编辑提问」状态。 */
            if (event.key === "Escape" && editingMessageId) {
              event.preventDefault();
              cancelEditMessage();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              /* 生成中回车不再默默吞掉：告诉用户怎么停。 */
              if (busy) notify("Agent 正在生成，按 Esc 可以停止当前回答");
              else void send();
            }
          }}
        />
        <div className="canvas-agent-dock-composer-row">
          <button
            type="button"
            className={`canvas-agent-dock-skill ${skillMenuOpen ? "is-active" : ""}`}
            onClick={() => (skillMenuOpen ? closeSkillMenu() : openSkillMenu(""))}
            title="选择技能：把某个技能指定给本轮任务"
            aria-haspopup="listbox"
            aria-expanded={skillMenuOpen}
          >
            <SkillIcon size={14} />
            <span>技能</span>
          </button>
          {/* 模型选择复用全站同一套 ModelPicker：搜索、收藏、最近调用、按服务商筛选都在里面。 */}
          <div className={`canvas-agent-dock-model-wrap${busy ? " is-busy" : ""}`} inert={busy ? true : undefined}>
            <ModelPicker
              models={runtime?.models || []}
              value={model}
              capability="chat"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
              defaultProviderId={runtime?.settings.defaultProviderId}
              defaultProviderName={runtime?.providers.find((item) => item.id === runtime?.settings.defaultProviderId)?.name}
              defaultModelId={runtime?.settings.agentModelId}
              placeholder="选择对话模型"
              onChange={setModel}
              className="canvas-agent-dock-model"
            />
          </div>
          <button
            type="button"
            className={`canvas-agent-dock-web ${webMode}`}
            onClick={cycleWebMode}
            disabled={busy}
            aria-label={`联网模式：${WEB_MODE_LABELS[webMode]}`}
            title={`联网：${WEB_MODE_LABELS[webMode]} · ${WEB_MODE_HINTS[webMode]} · 点击切换到「${WEB_MODE_LABELS[nextWebMode]}」`}
          >
            {WEB_MODE_LABELS[webMode]}
          </button>
          <label className="canvas-agent-dock-auto" title="开启后，出图结果自动加入画布；明确说保存、加入或放到画布时，文字回复也会创建节点">
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(event) => setAutoApply(event.target.checked)}
            />
            <span>智能落画布</span>
          </label>
          <button type="submit" className={`canvas-agent-dock-send ${busy ? "is-busy" : ""}`}>
            {busy ? "停止" : "发送"}
          </button>
        </div>
        <AgentSkillMenu
          open={skillMenuOpen}
          skills={skills}
          query={skillQuery}
          activeIndex={skillActive}
          onActiveIndexChange={setSkillActive}
          onSelect={applySkill}
          onClose={closeSkillMenu}
          emptyHint="还没有启用中的技能。点右上角的「技能」按钮可以安装或启用。"
        />
      </form>
    </aside>
  );
}
