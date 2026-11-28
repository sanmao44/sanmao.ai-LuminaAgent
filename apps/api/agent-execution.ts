import type { ChatMessage } from '@/lib/providers';
import { isArchiveToolCall } from '@/lib/tools';
import { SKILL_TOOL_MAX_CALLS } from '@/lib/skills';
import { stripToolCallMarkup } from '@/lib/skills';
import type { ToolLoopTraceStep, ToolLoopCall, ToolLoopMessage, ToolLoopReply } from '@/packages/tool-runtime/tool-loop';
import type { ToolRuntime, ToolRuntimeCall } from '@/packages/tool-runtime/runtime';

type ToolReply = { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown } | null;

export type CapabilityFollowupOptions = {
  messages: ChatMessage[];
  contextMaxChars?: number;
  signal: AbortSignal;
  now?: () => number;
  toolRuntime: Pick<ToolRuntime, 'runLoop' | 'executeCalls'>;
  boundAgentContext?: (messages: ToolLoopMessage[], maxChars: number) => ToolLoopMessage[];
  boundToolResult: (content: string) => string;
  callModel: (input: { messages: ChatMessage[]; tools: unknown[]; step: number }) => Promise<ToolReply>;
  skillTools: readonly unknown[];
  artifactTools: readonly unknown[];
  skillToolCalls: number;
  artifactRequested: boolean;
  skipArtifactFollowup?: boolean;
  continueAfterImage?: boolean;
  imageAttemptUnavailable?: boolean;
  initialToolCalls: readonly ToolLoopCall[];
  hasGenerated: boolean;
  hasGeneratedFiles: boolean;
  hasWebSearch: boolean;
  setDeferredCalls?: (calls: ToolRuntimeCall[]) => void;
};

export type CapabilityFollowupResult = {
  skillText: string;
  artifactText: string;
  trace: ToolLoopTraceStep[];
};

function modelToolName(tool: unknown) {
  if (!tool || typeof tool !== 'object') return '';
  const functionValue = (tool as { function?: unknown }).function;
  if (!functionValue || typeof functionValue !== 'object') return '';
  const name = (functionValue as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

function rejectedToolResult(call: ToolLoopCall): ToolLoopMessage {
  return {
    role: 'tool',
    tool_call_id: String(call.id || ''),
    content: JSON.stringify({
      ok: false,
      error: '本轮续轮只允许调用当前下发的工具；请不要调用文件、图片或其他未提供的工具，直接根据已有结果继续回答用户。',
    }),
  };
}

export type McpCapabilityFollowupOptions = {
  messages: ChatMessage[];
  contextMaxChars?: number;
  signal: AbortSignal;
  now?: () => number;
  toolRuntime: Pick<ToolRuntime, 'runLoop' | 'executeCalls'>;
  boundAgentContext?: (messages: ToolLoopMessage[], maxChars: number) => ToolLoopMessage[];
  boundToolResult: (content: string) => string;
  mcpTools: readonly unknown[];
  maxSteps: number;
  maxCalls: number;
  deadlineMs?: number;
  callModel: (messages: ChatMessage[]) => Promise<ToolLoopReply | null>;
  shouldContinue: () => boolean;
  continueOnEmpty?: () => string | false;
  continueOnText?: (input: { text: string }) => string | false;
  setDeferredCalls?: (calls: ToolRuntimeCall[]) => void;
};

export type McpCapabilityFollowupResult = {
  text: string;
  trace: ToolLoopTraceStep[];
  stopReason: string;
  stepMessages: ChatMessage[];
  stepReply: ToolLoopReply | null;
  deferredCalls: ToolRuntimeCall[];
};

/**
 * A bounded MCP continuation without a final model answer must be reported as
 * incomplete. Keeping this mapping outside the HTTP application makes the
 * fallback behavior testable without starting a provider or MCP service.
 */
export function mcpFollowupStopMessage(stopReason: string, steps: number) {
  const reason = {
    max_steps: `达到工具续轮上限（${steps} 轮）`,
    max_calls: '达到工具调用次数上限',
    context_budget: '本轮内容超过模型上下文预算',
    deadline: '达到工具执行时限',
    stopped: '工具续轮被提前停止',
    signal: '工具续轮已取消',
    no_tool_calls: '模型停止调用工具但未提供最终文字答复',
  }[stopReason];
  return reason || '';
}

export function mcpFollowupIncompleteMessage(stopReason: string, steps: number, toolCalls: number, providerFailed = false) {
  const reason = providerFailed ? '模型续轮请求失败' : mcpFollowupStopMessage(stopReason, steps);
  return reason ? `任务未完成：${reason}。已执行 ${toolCalls} 次工具调用，尚未得到最终答案。` : '';
}

export function mcpFollowupSummaryPrompt(stopReason: string, steps: number) {
  const reason = mcpFollowupStopMessage(stopReason, steps);
  return reason
    ? `工具续轮已停止：${reason}。请只根据此前已经返回的工具结果，概括可确认的事实和证据，并明确说明用户请求仍未完成、哪些步骤尚未执行或核验。不要调用工具，也不要把未确认的操作说成成功。`
    : '';
}

export function mcpFollowupPartialMessage(stopReason: string, steps: number, toolCalls: number, summary: string) {
  const reason = mcpFollowupStopMessage(stopReason, steps);
  const evidence = summary.trim();
  return reason && evidence
    ? `任务未完成：${reason}。以下整理只依据已返回的 ${toolCalls} 次工具结果，未执行或未核验的步骤仍未完成。\n\n${evidence}`
    : '';
}
/**
 * Application execution lifecycle for capability follow-ups.
 *
 * The HTTP application supplies model and ToolRuntime ports; this module owns
 * the ordering, bounded rounds and trace semantics for Skill and Artifact
 * continuation. No provider, route or persistence implementation is embedded.
 */
export async function runCapabilityFollowups(options: CapabilityFollowupOptions): Promise<CapabilityFollowupResult> {
  const trace: ToolLoopTraceStep[] = [];
  let skillText = '';
  let artifactText = '';
  let skillToolCalls = options.skillToolCalls;
  let artifactDelivered = false;
  const artifactToolNames = new Set(options.artifactTools.map(modelToolName));

  const runCalls = async (calls: ToolLoopCall[], allowedTools: readonly unknown[]) => {
    const allowedNames = new Set(allowedTools.map(modelToolName).filter(Boolean));
    const runtimeCalls = calls.filter((call): call is ToolRuntimeCall => Boolean(call?.function?.name) && allowedNames.has(String(call.function?.name || '')));
    const rejectedCalls = calls.filter((call) => Boolean(call?.function?.name) && !allowedNames.has(String(call.function?.name || '')));
    const execution = runtimeCalls.length
      ? await options.toolRuntime.executeCalls(runtimeCalls)
      : { results: [], deferredCalls: [], stalled: false };
    for (const result of execution.results) {
      const call = runtimeCalls.find((candidate) => candidate.id === result.tool_call_id);
      if (!call || !artifactToolNames.has(String(call.function?.name || ''))) continue;
      try {
        const outcome = JSON.parse(String(result.content || '')) as { ok?: unknown; file?: unknown; files?: unknown };
        if (outcome.ok === true && (outcome.file || (Array.isArray(outcome.files) && outcome.files.length > 0))) artifactDelivered = true;
      } catch { /* A malformed artifact result does not establish delivery. */ }
    }
    if (runtimeCalls.length && runtimeCalls.every((call) => String(call.function.name).startsWith('skill_'))) {
      skillToolCalls += runtimeCalls.length;
    }
    if (execution.deferredCalls.length) options.setDeferredCalls?.(execution.deferredCalls);
    return [...rejectedCalls.map(rejectedToolResult), ...execution.results];
  };

  if (options.skillToolCalls > 0 && options.skillTools.length && !options.hasGenerated && !options.hasGeneratedFiles && !options.hasWebSearch) {
    const outcome = await options.toolRuntime.runLoop({
      messages: options.messages,
      contextMaxChars: options.contextMaxChars,
      boundAgentContext: options.boundAgentContext,
      boundToolResult: options.boundToolResult,
      maxSteps: 2,
      signal: options.signal,
      now: options.now,
      callModel: async ({ step, messages }) => options.callModel({ step, messages: messages as ChatMessage[], tools: [...options.skillTools] }),
      runCalls: async (calls) => runCalls(calls, options.skillTools),
      shouldContinue: () => skillToolCalls < SKILL_TOOL_MAX_CALLS,
      finalText: (reply) => stripToolCallMarkup(String(reply?.content || '')).trim(),
    });
    skillText = outcome.text;
    trace.push(...outcome.trace);
  }

  const initialArtifactCall = options.initialToolCalls.some((call) => isArchiveToolCall(call) || String(call?.function?.name || '').startsWith('document_') || String(call?.function?.name || '').startsWith('spreadsheet_') || String(call?.function?.name || '').startsWith('presentation_'));
  const initialFileCall = options.initialToolCalls.some((call) => String(call?.function?.name || '') === 'file_generate');
  const repairFileOnly = initialFileCall && !initialArtifactCall;
  const followupArtifactTools = repairFileOnly
    ? options.artifactTools.filter((tool) => modelToolName(tool) === 'file_generate')
    : options.artifactTools;
  const generatedImageCall = options.initialToolCalls.some((call) => String(call?.function?.name || '').startsWith('image_'));
  const continueAfterGeneratedImage = Boolean(options.continueAfterImage && options.hasGenerated && generatedImageCall);
  const continueAfterUnavailableImage = Boolean(options.continueAfterImage && options.imageAttemptUnavailable && generatedImageCall);
  if (!options.skipArtifactFollowup && options.artifactRequested && followupArtifactTools.length
    && (continueAfterGeneratedImage || continueAfterUnavailableImage || ((initialArtifactCall || initialFileCall) && !options.hasGenerated && !options.hasGeneratedFiles))
    && (!options.hasWebSearch || continueAfterGeneratedImage || continueAfterUnavailableImage)) {
    const outcome = await options.toolRuntime.runLoop({
      messages: options.messages,
      contextMaxChars: options.contextMaxChars,
      boundAgentContext: options.boundAgentContext,
      boundToolResult: options.boundToolResult,
      maxSteps: repairFileOnly ? 1 : 2,
      signal: options.signal,
      now: options.now,
      callModel: async ({ step, messages }) => options.callModel({ step, messages: messages as ChatMessage[], tools: [...followupArtifactTools] }),
      runCalls: async (calls) => runCalls(calls, followupArtifactTools),
      orderCalls: (calls) => [...calls].sort((left, right) => Number(isArchiveToolCall(left)) - Number(isArchiveToolCall(right))),
      shouldContinue: () => !artifactDelivered,
      finalText: (reply) => stripToolCallMarkup(String(reply?.content || '')).trim(),
    });
    artifactText = outcome.text;
    trace.push(...outcome.trace);
  }

  return { skillText, artifactText, trace };
}

/** MCP/browser continuation lifecycle. Transport, policy and approval remain injected by the application. */
export async function runMcpCapabilityFollowup(options: McpCapabilityFollowupOptions): Promise<McpCapabilityFollowupResult> {
  let stepMessages: ChatMessage[] = [];
  let stepReply: ToolLoopReply | null = null;
  let deferredCalls: ToolRuntimeCall[] = [];
  const outcome = await options.toolRuntime.runLoop({
    messages: options.messages,
    contextMaxChars: options.contextMaxChars,
    boundAgentContext: options.boundAgentContext,
    boundToolResult: options.boundToolResult,
    maxSteps: options.maxSteps,
    maxCalls: options.maxCalls,
    deadlineMs: options.deadlineMs,
    signal: options.signal,
    now: options.now,
    callModel: async ({ messages }) => {
      stepMessages = [...(messages as ChatMessage[])];
      stepReply = await options.callModel(messages as ChatMessage[]);
      return stepReply;
    },
    runCalls: async (calls) => {
      const runtimeCalls = calls.filter((call): call is ToolRuntimeCall => Boolean(call?.function?.name));
      const execution = await options.toolRuntime.executeCalls(runtimeCalls);
      if (execution.deferredCalls.length) {
        deferredCalls = execution.deferredCalls;
        options.setDeferredCalls?.(deferredCalls);
      }
      return execution.results as ToolLoopMessage[];
    },
    shouldContinue: () => options.shouldContinue(),
    continueOnEmpty: () => options.continueOnEmpty?.() || false,
    continueOnText: ({ text }) => options.continueOnText?.({ text }) || false,
    finalText: (reply) => stripToolCallMarkup(String(reply?.content || '')).trim(),
  });
  return { text: outcome.text, trace: outcome.trace, stopReason: outcome.stopReason, stepMessages, stepReply, deferredCalls };
}
