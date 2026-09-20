/**
 * 长任务进度账本：Agent 主管线在真正耗时的节点上写一条快照，前端按 runId 轮询读取。
 *
 * 四条边界：
 * - 只回答"这一步在做什么"，不参与任何业务判断：runId 未知、快照过期都当成没有进度。
 * - 只写服务端自己拼的固定文案（阶段名 + 工具名），不带用户内容、不带参数、不带工具结果。
 * - 落盘复用 lib/task-store（临时文件 + rename 原子替换、写入串行化）：运行目录里最多留
 *   MAX_RUNS 条、超过 TTL 就删。进度是给"这一刻"看的，不是审计记录。
 * - 任何一次读写失败都只是没有进度，绝不能让这一轮对话失败。
 */
import { createTaskStore } from '@/lib/task-store';

export type AgentProgressStage = "thinking" | "web_search" | "tool" | "artifact" | "skill" | "mcp" | "image" | "answering";

export type AgentProgressSnapshot = {
  runId: string;
  stage: AgentProgressStage;
  message: string;
  /** 已经执行过几次工具调用：让用户知道长任务确实在往前走。 */
  toolCalls: number;
  startedAt: number;
  updatedAt: number;
  /** 主管线已经交出响应（正文开始流式返回）：前端可以停止轮询。 */
  done: boolean;
};

export type AgentProgressPatch = { stage: AgentProgressStage; message: string; toolCalls?: number };

type AgentProgressRecord = {
  id: string;
  createdAt: string;
  stage: AgentProgressStage;
  message: string;
  toolCalls: number;
  startedAt: number;
  updatedAt: number;
  done: boolean;
};

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const PROGRESS_TTL_MS = 10 * 60 * 1000;
const MAX_RUNS = 32;
const INITIAL_MESSAGE = '正在整理对话上下文…';

const store = createTaskStore<AgentProgressRecord>({ fileName: 'agent-progress.json', maxList: MAX_RUNS });

/** 只接受前端生成的短 id：多余字符直接拒绝，避免这里变成任意的存储键。 */
export function normalizeAgentRunId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return RUN_ID_PATTERN.test(id) ? id : null;
}

/** 进度是附加信息：存储不可用时静默降级，不能把它变成这一轮的失败点。 */
async function safeCall<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

function snapshotOf(record: AgentProgressRecord): AgentProgressSnapshot {
  /* 显式列字段：账本里只有固定文案，不会有调用方多塞进来的东西。 */
  return {
    runId: record.id,
    stage: record.stage,
    message: record.message,
    toolCalls: record.toolCalls,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    done: record.done,
  };
}

/** 先按 TTL 清掉没人再看的，再按更新时间只留最近 MAX_RUNS 条。 */
function prune(records: AgentProgressRecord[], now: number) {
  const alive = records.filter((record) => now - record.updatedAt <= PROGRESS_TTL_MS);
  if (alive.length <= MAX_RUNS) return alive;
  return [...alive].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_RUNS);
}

export async function beginAgentRun(runId: unknown, now = Date.now()): Promise<AgentProgressSnapshot | null> {
  const id = normalizeAgentRunId(runId);
  if (!id) return null;
  const record: AgentProgressRecord = {
    id,
    createdAt: new Date(now).toISOString(),
    stage: "thinking",
    message: INITIAL_MESSAGE,
    toolCalls: 0,
    startedAt: now,
    updatedAt: now,
    done: false,
  };
  await safeCall(() => store.mutate((records) => {
    /* 新记录一起参与淘汰：账本上限是总数，不是"除它之外"。 */
    const kept = prune([...records.filter((item) => item.id !== id), record], now);
    records.length = 0;
    records.push(...kept);
  }), undefined);
  return snapshotOf(record);
}

export async function reportAgentProgress(runId: unknown, patch: AgentProgressPatch, now = Date.now()): Promise<boolean> {
  const id = normalizeAgentRunId(runId);
  if (!id) return false;
  return safeCall(() => store.mutate((records) => {
    const record = records.find((item) => item.id === id);
    if (!record || record.done) return false;
    record.stage = patch.stage;
    record.message = patch.message;
    if (typeof patch.toolCalls === "number" && Number.isFinite(patch.toolCalls)) record.toolCalls = Math.max(0, Math.trunc(patch.toolCalls));
    record.updatedAt = now;
    return true;
  }), false);
}

/** 主管线交出响应时收尾：前端看到 done 就停止轮询，不会一直问下去。 */
export async function finishAgentRun(runId: unknown, now = Date.now()): Promise<void> {
  const id = normalizeAgentRunId(runId);
  if (!id) return;
  await safeCall(() => store.mutate((records) => {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    record.done = true;
    record.updatedAt = now;
  }), undefined);
}

export async function readAgentProgress(runId: unknown, now = Date.now()): Promise<AgentProgressSnapshot | null> {
  const id = normalizeAgentRunId(runId);
  if (!id) return null;
  const record = await safeCall(() => store.find(id), null);
  if (!record) return null;
  if (now - record.updatedAt > PROGRESS_TTL_MS) {
    await safeCall(() => store.remove(id), null);
    return null;
  }
  return snapshotOf(record);
}

const ARTIFACT_TOOL_LABELS: Record<string, string> = {
  document_generate: "Word 文档",
  spreadsheet_generate: "Excel 表格",
  presentation_generate: "PPT 演示文稿",
  archive_generate: "压缩包",
};

/** MCP 工具 id 形如「服务__工具」，展示时换成「服务 · 工具」。 */
export function mcpProgressToolLabel(name: unknown): string {
  const raw = String(name || "");
  const [serverId, ...rest] = raw.split("__").filter(Boolean);
  return rest.length ? `${serverId} · ${rest.join("__")}` : raw;
}

/** 工具类别 → 一行进度文案。返回 null 表示这类调用没什么可说的，不上报。 */
export function agentToolProgress(kind: unknown, name: unknown): AgentProgressPatch | null {
  if (kind === "web") return { stage: "web_search", message: "正在联网搜索…" };
  if (kind === "file") return { stage: "tool", message: "正在准备文件内容…" };
  if (kind === "artifact") return { stage: "artifact", message: `正在生成${ARTIFACT_TOOL_LABELS[String(name || "")] || "文件"}…` };
  if (kind === "skill") return { stage: "skill", message: "正在准备技能…" };
  if (kind === "mcp") return { stage: "mcp", message: `正在调用外部工具 ${mcpProgressToolLabel(name)}…` };
  if (kind === "mcp-manage") return { stage: "mcp", message: "正在处理本机 MCP 配置…" };
  if (kind === "image") return { stage: "image", message: "正在生成图片…" };
  return null;
}