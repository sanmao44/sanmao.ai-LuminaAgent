"use client";

import type { AgentDeliverable } from "./agent-intent";
import type { CreativeReference } from "./creative-references";

export const AGENT_CONTEXT_MESSAGE_LIMIT = 12;

export type AgentClientFile = {
  name: string;
  mimeType?: string;
  /** 旧的内联文本文件仍带 content；Office/ZIP artifact 只带元数据。 */
  content?: string;
  encoding?: "utf8" | "base64";
  size?: number;
  artifactId?: string;
  downloadUrl?: string;
};

export type AgentClientMessage = {
  role: "user" | "assistant";
  content: string;
  /** New structured references; string[] remains accepted for old sessions. */
  references?: CreativeReference[] | string[];
  files?: AgentClientFile[];
};

export type AgentRequestPayload = {
  memory?: string;
  persona?: string;
  source?: "agent" | "canvas";
  messages: AgentClientMessage[];
  referenceImages?: Array<Record<string, unknown>>;
  references?: CreativeReference[];
  model?: string;
  task?: string;
  durationSeconds?: number;
  webMode?: "off" | "auto" | "always";
  webSearch?: boolean;
  deliverable?: AgentDeliverable;
  intentReason?: string;
  /** 用户原话。画布等调用方会把系统上下文拼进 messages，意图判断只认这段文字。 */
  intentText?: string;
  /** 长任务进度 id：服务端按它记录阶段快照，前端轮询 /api/agent/progress 读取。 */
  runId?: string;
};

export type AgentGeneratedFile = {
  name: string;
  mimeType: string;
  size: number;
  // 文本文件：继续内联 content
  content?: string;
  encoding?: "utf8" | "base64";
  // 二进制 artifact：只回传元数据与下载地址，二进制不进 SSE / 历史
  artifactId?: string;
  downloadUrl?: string;
};

/** 这一轮真正落到外部 MCP 服务上的调用，用于给用户看"助手用了哪个外部工具"。 */
export type AgentMcpToolUse = {
  server: string;
  name: string;
  readOnly: boolean;
  ok: boolean;
};

/** 待确认的一次外部操作：面板要说清「在哪、做什么、可能有什么影响」。 */
export type AgentApprovalCall = {
  id: string;
  server: string;
  tool: string;
  risk: string;
  reason: string;
  argsPreview?: string;
};

export type AgentApproval = {
  id: string;
  expiresAt: number;
  message: string;
  /** 生成这条确认时的审批档位（always / trusted / full），老会话可能没有这一项。 */
  policy?: string;
  calls: AgentApprovalCall[];
};

/** 用户点过「允许 / 取消」之后，续跑接口回传的结果。 */
export type AgentResumeResult = {
  ok?: boolean;
  rejected?: boolean;
  message?: string;
  mcpTools?: AgentMcpToolUse[];
  error?: string;
};

export type AgentResponse = {
  ok?: boolean;
  message: string;
  model?: string;
  deliverable?: AgentDeliverable;
  images?: Array<{ url: string; revisedPrompt?: string }>;
  files?: AgentGeneratedFile[];
  generations?: Array<Record<string, unknown>>;
  webSearch?: Record<string, unknown> | null;
  webSearchDecision?: Record<string, unknown>;
  skills?: Array<{ id: string; name: string }>;
  mcpTools?: AgentMcpToolUse[];
  /** 这一轮有操作在等服务端批准：没有它就不算正常回答。 */
  approval?: AgentApproval;
  needsApproval?: boolean;
  durationSeconds?: number;
  error?: string;
  cancelled?: boolean;
  [key: string]: unknown;
};

export type AgentStreamEvent = AgentResponse & {
  type?: "status" | "delta" | "final" | "error" | "approval_required";
  stage?: string;
  text?: string;
};

export type AgentRequestOptions = {
  signal?: AbortSignal;
  onEvent?: (event: AgentStreamEvent) => void;
};

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Agent 请求已取消", "AbortError");
}

export async function readAgentEventStream(
  response: Response,
  options: AgentRequestOptions = {},
): Promise<AgentResponse> {
  if (!response.body) throw new Error("助手没有返回可读取的流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  const finalRef: { current: AgentResponse | null } = { current: null };
  let streamError = "";
  const cancelReader = () => void reader.cancel().catch(() => undefined);
  if (options.signal?.aborted) cancelReader();
  else options.signal?.addEventListener("abort", cancelReader, { once: true });

  const consume = (raw: string) => {
    buffer += raw;
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as AgentStreamEvent;
        if (event.type === "delta") streamedText += String(event.text || "");
        if (event.type === "final") finalRef.current = event;
        if (event.type === "error") streamError = String(event.message || event.error || "助手流式响应失败");
        options.onEvent?.(event);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  };

  try {
    while (true) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const part = await reader.read();
      if (part.done) break;
      consume(decoder.decode(part.value, { stream: true }));
    }
    consume(decoder.decode());
    if (buffer.trim()) consume("\n\n");
  } finally {
    options.signal?.removeEventListener("abort", cancelReader);
  }
  if (options.signal?.aborted) throw abortError(options.signal);
  if (streamError) throw new Error(streamError);
  const final = finalRef.current;
  if (!final) throw new Error("Agent 流式响应不完整，请重试。");
  return { ...final, message: String(final.message || streamedText || "") };
}

/**
 * 回复一条待确认操作。
 *
 * 只把 action 发回服务端：执行哪个调用由服务端记录的 pending 决定，
 * 这里（以及任何前端）都没有办法拼一个新调用出来执行。
 */
export async function resumeAgentRun(
  id: string,
  action: "approve" | "reject",
  options: { signal?: AbortSignal } = {},
): Promise<AgentResumeResult> {
  const response = await fetch(`/api/agent/runs/${encodeURIComponent(id)}`, {
    cache: "no-store",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({ action }),
  });
  const data = (await response.json().catch(() => ({}))) as AgentResumeResult;
  if (!response.ok) throw new Error(String(data?.error || `这一步没有执行：${response.status}`));
  return data;
}

import type { AgentProgressSnapshot, AgentProgressStage } from "@/lib/agent/progress";
export type { AgentProgressSnapshot, AgentProgressStage };


/**
 * 读一条长任务进度快照：主管线在真正耗时的节点写，前端在这里读。
 *
 * 读不到（没开始、已过期、id 不合法）就回 null；任何失败都不该让这一轮对话出错。
 */
export async function readAgentProgress(
  runId: string,
  signal?: AbortSignal,
): Promise<AgentProgressSnapshot | null> {
  try {
    const response = await fetch(`/api/agent/progress?runId=${encodeURIComponent(runId)}`, { cache: "no-store", signal });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as { progress?: AgentProgressSnapshot | null } | null;
    return data?.progress || null;
  } catch {
    return null;
  }
}

/**
 * 按 runId 轮询长任务进度：主管线在工具轮里写快照（app/api/agent/progress），前端在这里读。
 *
 * - 正文开始流式返回（isSettled）、用户停止、主管线收尾，轮询都会自己停；
 * - 同一步骤超过 3 秒没变就带上秒表：模型单次思考可能很久，秒表让用户看到确实在往前走。
 *
 * 返回手动停止的函数；读进度失败只是没有进度，不会影响这一轮对话。
 */
export function pollAgentProgress(
  runId: string,
  options: {
    signal?: AbortSignal;
    /** 已经拿到正文（或已收尾）时返回 true，轮询停止。 */
    isSettled?: () => boolean;
    onProgress: (progress: { stage: AgentProgressStage; message: string }) => void;
    intervalMs?: number;
    maxPolls?: number;
  },
): () => void {
  const intervalMs = options.intervalMs ?? 900;
  const maxPolls = options.maxPolls ?? 400;
  const settled = () => options.isSettled?.() === true;
  let stopped = false;
  let polls = 0;
  let updatedAt = 0;
  let startedAt = 0;
  let stage: AgentProgressStage = "thinking";
  let message = "";
  let elapsed = 0;
  const stop = () => {
    stopped = true;
  };
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener("abort", stop, { once: true });
  const tick = async () => {
    if (stopped || settled()) {
      stopped = true;
      return;
    }
    polls += 1;
    const snapshot = await readAgentProgress(runId, options.signal);
    if (stopped || settled()) return;
    if (snapshot) {
      if (snapshot.updatedAt !== updatedAt) {
        updatedAt = snapshot.updatedAt;
        startedAt = snapshot.startedAt;
        stage = snapshot.stage;
        message = snapshot.message;
        elapsed = 0;
        options.onProgress({ stage, message });
      } else {
        /* 秒表只在整秒变化时刷新：同一步骤里也要看得出还在走。 */
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        if (seconds >= 3 && seconds !== elapsed) {
          elapsed = seconds;
          options.onProgress({ stage, message: `${message}（已 ${seconds}s）` });
        }
      }
    }
    if (snapshot?.done || polls >= maxPolls) {
      stopped = true;
      return;
    }
    window.setTimeout(() => void tick(), intervalMs);
  };
  void tick();
  return stop;
}
export async function requestAgent(
  payload: AgentRequestPayload,
  options: AgentRequestOptions = {},
): Promise<AgentResponse> {
  const response = await fetch("/api/agent", {
    cache: "no-store",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      ...payload,
      messages: payload.messages.slice(-AGENT_CONTEXT_MESSAGE_LIMIT),
      stream: true,
    }),
  });

  let data: AgentResponse;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    data = await readAgentEventStream(response, options);
  } else {
    data = (await response.json().catch(() => ({}))) as AgentResponse;
  }
  if (!response.ok) {
    throw new Error(String(data.error || data.message || `Agent 请求失败：${response.status}`));
  }
  return data;
}
