"use client";

import type { AgentDeliverable } from "./agent-intent";

export const AGENT_CONTEXT_MESSAGE_LIMIT = 12;

export type AgentClientFile = {
  name: string;
  mimeType?: string;
  content: string;
  encoding?: "utf8" | "base64";
  size?: number;
};

export type AgentClientMessage = {
  role: "user" | "assistant";
  content: string;
  references?: string[];
  files?: AgentClientFile[];
};

export type AgentRequestPayload = {
  source?: "agent" | "canvas";
  messages: AgentClientMessage[];
  referenceImages?: Array<Record<string, unknown>>;
  model?: string;
  task?: string;
  webMode?: "off" | "auto" | "always";
  webSearch?: boolean;
  deliverable?: AgentDeliverable;
  intentReason?: string;
};

export type AgentGeneratedFile = {
  name: string;
  mimeType: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
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
  error?: string;
  cancelled?: boolean;
  [key: string]: unknown;
};

export type AgentStreamEvent = AgentResponse & {
  type?: "status" | "delta" | "final" | "error";
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
