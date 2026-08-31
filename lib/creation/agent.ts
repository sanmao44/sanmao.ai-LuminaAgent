"use client";

import { prepareCanvasAgentReferences } from "@/lib/canvas/api";

export type AgentReference = { url: string; name?: string };
export type AgentMessage = { role: "user" | "assistant"; content: string };

type AgentEvent = { type?: string; text?: string; message?: string; [key: string]: unknown };

async function readAgentStream(response: Response, onEvent?: (event: AgentEvent) => void) {
  if (!response.body) throw new Error("助手没有返回可读取的流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AgentEvent = {};
  const consume = (raw: string) => {
    buffer += raw;
    const chunks = buffer.split(/\n\n/);
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const dataLine = chunk.split(/\n/).find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const rawData = dataLine.slice(5).trim();
      if (!rawData || rawData === "[DONE]") continue;
      try {
        const event = JSON.parse(rawData) as AgentEvent;
        if (event.type === "final") final = event;
        onEvent?.(event);
      } catch {
        // Ignore malformed SSE frames and continue consuming the response.
      }
    }
  };
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    consume(decoder.decode(part.value, { stream: true }));
  }
  consume(decoder.decode());
  return final;
}

async function runAgentTask(task: string, prompt: string, references: AgentReference[] = [], model?: string) {
  const preparedReferences = await prepareCanvasAgentReferences(references);
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{
        role: "user",
        content: prompt,
        references: preparedReferences.map((reference, index) => ({
          id: `${task}-${index + 1}`,
          kind: "image" as const,
          name: reference.name || `参考图 ${index + 1}`,
          url: reference.url,
        })),
        files: [],
      }],
      model: model || "auto",
      task,
      stream: true,
    }),
  });
  let data: AgentEvent;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    let streamed = "";
    const final = await readAgentStream(response, (event) => {
      if (event.type === "delta") streamed += String(event.text || "");
      if (event.type === "error") throw new Error(String(event.message || "助手请求失败"));
    });
    data = { ...final, message: final.message || streamed };
  } else data = (await response.json()) as AgentEvent;
  if (!response.ok) throw new Error(String(data.message || data.error || "助手请求失败"));
  const message = String(data.message || "").trim();
  if (!message) throw new Error("助手没有返回有效结果");
  return message;
}

export function runReversePrompt(referenceImages: AgentReference[], model?: string) {
  if (!referenceImages.length) return Promise.reject(new Error("请先选择参考图片"));
  return runAgentTask("reverse_prompt", referenceImages.length === 1 ? "请根据这张图片反推提示词" : "请根据我上传的参考图反推提示词", referenceImages, model);
}

export function runOneTakeVideoPrompt(referenceImages: AgentReference[], model?: string) {
  if (referenceImages.length < 2) return Promise.reject(new Error("一镜到底至少需要两张参考图片"));
  return runAgentTask("one_take_video_prompt", "请按我上传参考图的顺序，将 Image 1、Image 2、Image 3……串联成一段 15 秒、一镜到底的 Seedance 2.0 视频生成 Prompt。只输出最终可直接使用的 VIDEO PROMPT。", referenceImages, model);
}

export function requestPromptOptimization(prompt: string, references: AgentReference[] = [], model?: string) {
  if (!prompt.trim()) return Promise.reject(new Error("请输入需要优化的提示词"));
  return runAgentTask("optimize_prompt", prompt, references, model);
}
