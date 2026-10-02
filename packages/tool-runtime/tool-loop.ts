/**
 * Tool loop application primitive. This is the single implementation of
 * continuation, limits and trace handling for native and MCP tool paths.
 */
import { boundAgentContext, boundToolResult } from '@/lib/agent/context-budget';

export const TOOL_LOOP_DEFAULT_MAX_STEPS = 4;
export const TOOL_LOOP_DEFAULT_MAX_CALLS = 12;
export const TOOL_LOOP_DEFAULT_DEADLINE_MS = 180_000;
export const TOOL_LOOP_MCP_REPEAT_LIMIT = 3;

export function mcpCallSignature(serverId: unknown, toolName: unknown, args: unknown) {
  let payload = '';
  try {
    const source = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
    payload = JSON.stringify(args ?? {}, Object.keys(source).sort());
  } catch { payload = String(args); }
  return `${String(serverId || '')}\u0000${String(toolName || '')}\u0000${payload}`;
}

export type McpRepeatTracker = Map<string, { count: number; text: string }>;
export function trackMcpRepeat(tracker: McpRepeatTracker, key: string, text: unknown): number {
  const settled = String(text ?? '');
  const previous = tracker.get(key);
  const count = previous && previous.text === settled ? previous.count + 1 : 1;
  tracker.set(key, { count, text: settled });
  return count;
}

export type ToolLoopCall = { id?: string; function?: { name?: string; arguments?: string } };
export type ToolLoopMessage = { role: 'assistant' | 'system' | 'user' | 'tool'; content?: unknown; tool_calls?: unknown; reasoning_content?: unknown; tool_call_id?: string };
export type ToolLoopReply = { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown };
export type ToolLoopTraceStep = { step: number; calls: string[]; durationMs: number; continued: boolean };
export type ToolLoopOutcome = { steps: number; toolCallCount: number; text: string; stopReason: 'no_tool_calls' | 'max_steps' | 'max_calls' | 'stopped' | 'deadline' | 'signal'; trace: ToolLoopTraceStep[] };

export type RunToolLoopOptions = {
  messages: ToolLoopMessage[];
  callModel: (context: { step: number; messages: ToolLoopMessage[] }) => Promise<ToolLoopReply | null>;
  runCalls: (calls: ToolLoopCall[], context: { step: number }) => Promise<ToolLoopMessage[]>;
  orderCalls?: (calls: ToolLoopCall[]) => ToolLoopCall[];
  shouldContinue?: (context: { step: number; toolCallCount: number; elapsedMs: number }) => boolean;
  finalText?: (reply: ToolLoopReply | null) => string;
  continueOnEmpty?: (context: { step: number; reply: ToolLoopReply | null; messages: ToolLoopMessage[] }) => string | false;
  continueOnText?: (context: { step: number; reply: ToolLoopReply | null; text: string; messages: ToolLoopMessage[] }) => string | false;
  maxSteps?: number;
  maxCalls?: number;
  deadlineMs?: number;
  now?: () => number;
  signal?: AbortSignal;
  contextMaxChars?: number;
};

function callName(call: ToolLoopCall) { return String(call?.function?.name || ''); }
function defaultFinalText(reply: ToolLoopReply | null) { return String(reply?.content || '').trim(); }

export async function runToolLoop(options: RunToolLoopOptions): Promise<ToolLoopOutcome> {
  const now = options.now || Date.now;
  const startedAt = now();
  const maxSteps = Math.max(1, options.maxSteps ?? TOOL_LOOP_DEFAULT_MAX_STEPS);
  const maxCalls = Math.max(1, options.maxCalls ?? TOOL_LOOP_DEFAULT_MAX_CALLS);
  const deadline = startedAt + Math.max(1_000, options.deadlineMs ?? TOOL_LOOP_DEFAULT_DEADLINE_MS);
  const finalText = options.finalText || defaultFinalText;
  const trace: ToolLoopTraceStep[] = [];
  let toolCallCount = 0;
  let steps = 0;
  let text = '';
  let stopReason: ToolLoopOutcome['stopReason'] = 'max_steps';
  for (let step = 0; step < maxSteps; step += 1) {
    if (options.signal?.aborted) { stopReason = 'signal'; break; }
    if (now() >= deadline) { stopReason = 'deadline'; break; }
    const stepStartedAt = now();
    const reply = await options.callModel({ step, messages: options.messages });
    if (options.signal?.aborted) { stopReason = 'signal'; break; }
    const rawCalls = Array.isArray(reply?.tool_calls) ? reply.tool_calls as ToolLoopCall[] : [];
    const calls = rawCalls.filter((call) => callName(call));
    steps = step + 1;
    if (now() >= deadline) { stopReason = 'deadline'; break; }
    if (!calls.length) {
      const candidate = finalText(reply);
      const continuation = candidate
        ? options.continueOnText?.({ step, reply, text: candidate, messages: options.messages })
        : options.continueOnEmpty?.({ step, reply, messages: options.messages });
      if (continuation) {
        const canContinue = step + 1 < maxSteps && toolCallCount < maxCalls && now() < deadline;
        trace.push({ step, calls: [], durationMs: now() - stepStartedAt, continued: canContinue });
        if (!canContinue) { stopReason = now() >= deadline ? 'deadline' : toolCallCount >= maxCalls ? 'max_calls' : 'max_steps'; break; }
        options.messages.push({ role: 'user', content: continuation });
        continue;
      }
      text = candidate;
      trace.push({ step, calls: [], durationMs: now() - stepStartedAt, continued: false });
      stopReason = 'no_tool_calls';
      break;
    }
    if (toolCallCount + calls.length > maxCalls) { stopReason = 'max_calls'; break; }
    const ordered = options.orderCalls ? options.orderCalls(calls) : calls;
    const results = (await options.runCalls(ordered, { step })).map((result) => ({ ...result, ...(typeof result.content === 'string' ? { content: boundToolResult(result.content) } : {}) }));
    const reasoning = typeof reply?.reasoning_content === 'string' && reply.reasoning_content ? { reasoning_content: reply.reasoning_content } : {};
    options.messages.push({ role: 'assistant', content: reply?.content ?? null, tool_calls: calls, ...reasoning }, ...results);
    if (options.contextMaxChars) {
      const bounded = boundAgentContext(options.messages as never, options.contextMaxChars);
      options.messages.splice(0, options.messages.length, ...bounded);
    }
    toolCallCount += calls.length;
    const continueLoop = options.shouldContinue ? options.shouldContinue({ step: step + 1, toolCallCount, elapsedMs: now() - startedAt }) : true;
    trace.push({ step, calls: ordered.map(callName), durationMs: now() - stepStartedAt, continued: continueLoop });
    if (!continueLoop) { stopReason = 'stopped'; break; }
  }
  return { steps, toolCallCount, text, stopReason, trace };
}
