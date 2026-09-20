/**
 * 通用工具循环（任务书 §4）。
 *
 * 以前「模型要工具 → 执行 → 把结果带回去 → 再问一次」这件事在 route.ts 里写了两遍
 * （技能两轮、交付物两轮），两份代码几乎一样又各有各的边界条件，加一个工具组就要抄第三遍。
 * 这里把它收敛成一个引擎：轮数、总次数、总时长、中止和 Trace 都由引擎管，
 * 具体用哪些工具、怎么执行由调用方注入。
 *
 * 两条硬规则：
 * - 模型这一轮不再要工具就立刻结束，把它的文本原样交给调用方（不猜、不补）。
 * - 装不下这一轮的工具调用时直接停，不执行半截——宁可少答一轮，也不要留下没有结果的 tool_calls。
 */

/** 默认最多补几轮（不含已经跑过的主轮）。 */
export const TOOL_LOOP_DEFAULT_MAX_STEPS = 4;
/** 默认一轮里最多执行多少次工具调用。 */
export const TOOL_LOOP_DEFAULT_MAX_CALLS = 12;
/** 默认整个循环的总时长上限。 */
export const TOOL_LOOP_DEFAULT_DEADLINE_MS = 180_000;
/** 同一个调用连续拿到这么多次完全一样的结果，就认为它卡住了，停下来让模型换做法。 */
export const TOOL_LOOP_MCP_REPEAT_LIMIT = 3;

/**
 * 同 server + 同工具 + 同参数的调用指纹。
 * 键里带参数是为了不误伤：换个查询词再试一次是正常行为，同一个调用原地打转才是问题。
 * 参数按键名排序后再序列化，`{a,b}` 和 `{b,a}` 算同一个调用。
 */
export function mcpCallSignature(serverId: unknown, toolName: unknown, args: unknown) {
  let payload = '';
  try {
    const source = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    payload = JSON.stringify(args ?? {}, Object.keys(source).sort());
  } catch {
    payload = String(args);
  }
  return `${String(serverId || '')}\u0000${String(toolName || '')}\u0000${payload}`;
}

export type McpRepeatTracker = Map<string, { count: number; text: string }>;

/** 记一次调用结果，返回「同参数、同结果」连续出现的次数。结果一变就重新计数。 */
export function trackMcpRepeat(tracker: McpRepeatTracker, key: string, text: unknown): number {
  const settled = String(text ?? '');
  const previous = tracker.get(key);
  const count = previous && previous.text === settled ? previous.count + 1 : 1;
  tracker.set(key, { count, text: settled });
  return count;
}

export type ToolLoopCall = { id?: string; function?: { name?: string; arguments?: string } };

export type ToolLoopMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  reasoning_content?: unknown;
  tool_call_id?: string;
};

export type ToolLoopReply = { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown };

export type ToolLoopTraceStep = {
  step: number;
  /** 这一步模型要调用的工具名，按执行顺序。 */
  calls: string[];
  durationMs: number;
  /** 这一步执行完工具后是否还会继续下一轮。 */
  continued: boolean;
};

export type ToolLoopOutcome = {
  /** 真正跑过的轮数。 */
  steps: number;
  /** 真正执行过的工具调用次数。 */
  toolCallCount: number;
  /** 模型最后一轮没有要工具时的文本；其余情况为空串。 */
  text: string;
  stopReason: 'no_tool_calls' | 'max_steps' | 'max_calls' | 'stopped' | 'deadline' | 'signal';
  trace: ToolLoopTraceStep[];
};

export type RunToolLoopOptions = {
  /** 会被原地追加 assistant / tool 消息，和循环外持有的是同一个数组。 */
  messages: ToolLoopMessage[];
  callModel: (context: { step: number; messages: ToolLoopMessage[] }) => Promise<ToolLoopReply | null>;
  runCalls: (calls: ToolLoopCall[], context: { step: number }) => Promise<ToolLoopMessage[]>;
  /** 执行顺序；默认按模型给的顺序。交付物工具用它把 archive_generate 排到最后。 */
  orderCalls?: (calls: ToolLoopCall[]) => ToolLoopCall[];
  /** 这一步执行完还愿不愿意继续；返回 false 就停下（例如本轮工具调用次数已达上限）。 */
  shouldContinue?: (context: { step: number; toolCallCount: number; elapsedMs: number }) => boolean;
  /** 模型不再要工具时的收尾文本，默认取它的 content。 */
  finalText?: (reply: ToolLoopReply | null) => string;
  /**
   * 某些连续任务在工具失败后不能把模型的一次空回复当成完成。
   * 返回提示文本时会把它作为内部用户消息追加，再给模型一次重新规划机会。
   */
  continueOnEmpty?: (context: { step: number; reply: ToolLoopReply | null; messages: ToolLoopMessage[] }) => string | false;
  maxSteps?: number;
  maxCalls?: number;
  deadlineMs?: number;
  now?: () => number;
  signal?: AbortSignal;
};

function callName(call: ToolLoopCall) {
  return String(call?.function?.name || '');
}

function defaultFinalText(reply: ToolLoopReply | null) {
  return String(reply?.content || '').trim();
}

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
    if (options.signal?.aborted) {
      stopReason = 'signal';
      break;
    }
    if (now() >= deadline) {
      stopReason = 'deadline';
      break;
    }
    const stepStartedAt = now();
    const reply = await options.callModel({ step, messages: options.messages });
    if (options.signal?.aborted) {
      stopReason = 'signal';
      break;
    }
    const rawCalls = Array.isArray(reply?.tool_calls) ? (reply.tool_calls as ToolLoopCall[]) : [];
    // 名字都没有的调用执行不了，直接跳过；只剩这种调用时等同于「模型没要工具」。
    const calls = rawCalls.filter((call) => callName(call));
    steps = step + 1;
    if (!calls.length) {
      const continuation = options.continueOnEmpty?.({ step, reply, messages: options.messages });
      if (continuation && step + 1 < maxSteps && now() < deadline) {
        options.messages.push({ role: 'user', content: continuation });
        trace.push({ step, calls: [], durationMs: now() - stepStartedAt, continued: true });
        continue;
      }
      text = finalText(reply);
      trace.push({ step, calls: [], durationMs: now() - stepStartedAt, continued: false });
      stopReason = 'no_tool_calls';
      break;
    }
    if (toolCallCount + calls.length > maxCalls) {
      // 不执行、也不写回：消息里不出现没有结果的 tool_calls，下一轮模型调用仍然合法。
      stopReason = 'max_calls';
      break;
    }
    const ordered = options.orderCalls ? options.orderCalls(calls) : calls;
    const results = await options.runCalls(ordered, { step });
    const reasoning = typeof reply?.reasoning_content === 'string' && reply.reasoning_content ? { reasoning_content: reply.reasoning_content } : {};
    // 思维链模型要求把带 tool_calls 的助手消息原样带回，丢了 reasoning_content 会被服务商 400 拒绝。
    options.messages.push({ role: 'assistant', content: reply?.content ?? null, tool_calls: rawCalls, ...reasoning }, ...results);
    toolCallCount += calls.length;
    const elapsedMs = now() - startedAt;
    const continueLoop = options.shouldContinue ? options.shouldContinue({ step: step + 1, toolCallCount, elapsedMs }) : true;
    trace.push({ step, calls: ordered.map(callName), durationMs: now() - stepStartedAt, continued: continueLoop });
    if (!continueLoop) {
      stopReason = 'stopped';
      break;
    }
  }

  return { steps, toolCallCount, text, stopReason, trace };
}
