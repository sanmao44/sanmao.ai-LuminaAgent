import type { ChatMessage } from '@/lib/providers';
import { isArchiveToolCall } from '@/lib/tools';
import { SKILL_TOOL_MAX_CALLS } from '@/lib/skills';
import { stripToolCallMarkup } from '@/lib/skills';
import type { ToolLoopTraceStep, ToolLoopCall, ToolLoopMessage, ToolLoopReply } from '@/packages/tool-runtime/tool-loop';
import type { ToolRuntime, ToolRuntimeCall } from '@/packages/tool-runtime/runtime';

type ToolReply = { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown } | null;

export type CapabilityFollowupOptions = {
  messages: ChatMessage[];
  contextMaxChars: number;
  signal: AbortSignal;
  toolRuntime: Pick<ToolRuntime, 'runLoop' | 'executeCalls'>;
  boundAgentContext: (messages: ToolLoopMessage[], maxChars: number) => ToolLoopMessage[];
  boundToolResult: (content: string) => string;
  callModel: (input: { messages: ChatMessage[]; tools: unknown[]; step: number }) => Promise<ToolReply>;
  skillTools: readonly unknown[];
  artifactTools: readonly unknown[];
  skillToolCalls: number;
  artifactRequested: boolean;
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
  contextMaxChars: number;
  signal: AbortSignal;
  toolRuntime: Pick<ToolRuntime, 'runLoop' | 'executeCalls'>;
  boundAgentContext: (messages: ToolLoopMessage[], maxChars: number) => ToolLoopMessage[];
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

  const runCalls = async (calls: ToolLoopCall[], allowedTools: readonly unknown[]) => {
    const allowedNames = new Set(allowedTools.map(modelToolName).filter(Boolean));
    const runtimeCalls = calls.filter((call): call is ToolRuntimeCall => Boolean(call?.function?.name) && allowedNames.has(String(call.function?.name || '')));
    const rejectedCalls = calls.filter((call) => Boolean(call?.function?.name) && !allowedNames.has(String(call.function?.name || '')));
    const execution = runtimeCalls.length
      ? await options.toolRuntime.executeCalls(runtimeCalls)
      : { results: [], deferredCalls: [], stalled: false };
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
      callModel: async ({ step, messages }) => options.callModel({ step, messages: messages as ChatMessage[], tools: [...options.skillTools] }),
      runCalls: async (calls) => runCalls(calls, options.skillTools),
      shouldContinue: () => skillToolCalls < SKILL_TOOL_MAX_CALLS,
      finalText: (reply) => stripToolCallMarkup(String(reply?.content || '')).trim(),
    });
    skillText = outcome.text;
    trace.push(...outcome.trace);
  }

  if (options.artifactRequested && options.artifactTools.length && options.initialToolCalls.some((call) => isArchiveToolCall(call) || String(call?.function?.name || '').startsWith('document_') || String(call?.function?.name || '').startsWith('spreadsheet_') || String(call?.function?.name || '').startsWith('presentation_')) && !options.hasGenerated && !options.hasWebSearch) {
    const outcome = await options.toolRuntime.runLoop({
      messages: options.messages,
      contextMaxChars: options.contextMaxChars,
      boundAgentContext: options.boundAgentContext,
      boundToolResult: options.boundToolResult,
      maxSteps: 2,
      signal: options.signal,
      callModel: async ({ step, messages }) => options.callModel({ step, messages: messages as ChatMessage[], tools: [...options.artifactTools] }),
      runCalls: async (calls) => runCalls(calls, options.artifactTools),
      orderCalls: (calls) => [...calls].sort((left, right) => Number(isArchiveToolCall(left)) - Number(isArchiveToolCall(right))),
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
