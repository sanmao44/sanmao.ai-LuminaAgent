import type { ChatMessage } from '../providers';

/** Text attachments are inputs, not an excuse to send an entire local file on every turn. */
export const AGENT_INLINE_TEXT_MAX_CHARS = 120_000;
export const AGENT_TOOL_RESULT_MAX_CHARS = 24_000;
export const AGENT_DEFAULT_CONTEXT_WINDOW = 32_768;
export const AGENT_CONTEXT_OUTPUT_RESERVE = 4_096;

export function modelInputCharBudget(contextWindow?: number, maxInputTokens?: number, maxOutputTokens?: number) {
  const window = Number.isFinite(contextWindow) && Number(contextWindow) > 0
    ? Number(contextWindow)
    : AGENT_DEFAULT_CONTEXT_WINDOW;
  const advertisedInput = Number.isFinite(maxInputTokens) && Number(maxInputTokens) > 0
    ? Number(maxInputTokens)
    : window - (Number.isFinite(maxOutputTokens) && Number(maxOutputTokens) > 0 ? Number(maxOutputTokens) : AGENT_CONTEXT_OUTPUT_RESERVE);
  // A rough UTF-8 text weight derived from advertised tokens. The legacy
  // function name does not imply an exact character/token count or media limit.
  return Math.max(16_000, Math.min(600_000, Math.floor(Math.max(4_000, advertisedInput) * 3)));
}

function utf8Bytes(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

function contentTextWeight(content: ChatMessage['content']) {
  if (typeof content === 'string') return utf8Bytes(content);
  if (Array.isArray(content)) return content.reduce((sum, part) => sum + (part.type === 'text' ? utf8Bytes(part.text) : 0), 0);
  return 0;
}

export type AgentContextBudgetOptions = {
  /** Actual user turn's first message index, before any internal user-role retry prompts. */
  currentTurnStart?: number;
  /** Override the estimated wire budget with an explicit limit, when known. */
  maxBytes?: number;
  /** UTF-8 bytes outside the serialized messages array, including tools/schema. */
  overheadBytes?: number;
  /** Additional UTF-8 text weight, e.g. tool definitions. Legacy option name. */
  overheadChars?: number;
};

export class AgentContextBudgetExceededError extends Error {
  readonly code = 'AGENT_CONTEXT_BUDGET_EXCEEDED';

  constructor(
    /** Legacy field names; these are UTF-8 text weights, not character counts. */
    readonly requiredChars: number,
    readonly maxChars: number,
    readonly requiredBytes: number,
    readonly maxBytes: number,
  ) {
    super('当前请求的必要内容超过模型请求预算，无法在保留本轮指令、附件及工具结果的前提下继续。请减少本轮输入或附件，或使用更大上下文的模型。');
    this.name = 'AgentContextBudgetExceededError';
  }
}

/** Measures complete wire message fields, including metadata and media data URLs. */
export function agentContextSerializedBytes(messages: readonly ChatMessage[]) {
  return utf8Bytes(JSON.stringify(messages));
}

type MessageUnit = {
  messages: ChatMessage[];
  start: number;
  end: number;
  chars: number;
  bytes: number;
  mediaBytes: number;
};

function messageTextWeight(message: ChatMessage) {
  return contentTextWeight(message.content)
    + (message.tool_calls ? utf8Bytes(JSON.stringify(message.tool_calls)) : 0)
    + (message.reasoning_content ? utf8Bytes(message.reasoning_content) : 0)
    + (message.tool_call_id ? utf8Bytes(message.tool_call_id) : 0);
}

function messageMediaBytes(message: ChatMessage) {
  if (!Array.isArray(message.content)) return 0;
  return message.content.reduce((sum, part) => sum + (part.type === 'text' ? 0 : utf8Bytes(JSON.stringify(part))), 0);
}

function messageUnits(messages: ChatMessage[]) {
  const units: MessageUnit[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const group = [message];
      let next = index + 1;
      while (next < messages.length && messages[next]?.role === 'tool') {
        group.push(messages[next]);
        next += 1;
      }
      units.push({ messages: group, start: index, end: next, chars: group.reduce((sum, item) => sum + messageTextWeight(item), 0), bytes: agentContextSerializedBytes(group) - 2, mediaBytes: group.reduce((sum, item) => sum + messageMediaBytes(item), 0) });
      index = next - 1;
      continue;
    }
    units.push({ messages: [message], start: index, end: index + 1, chars: messageTextWeight(message), bytes: agentContextSerializedBytes([message]) - 2, mediaBytes: messageMediaBytes(message) });
  }
  return units;
}

/**
 * Keep system instructions and the current user turn intact; drop complete old units.
 * maxChars retains its legacy name but limits UTF-8 text weight, not exact tokens.
 */
export function boundAgentContext(messages: ChatMessage[], maxChars: number, options: AgentContextBudgetOptions = {}) {
  const normalizedLimit = Math.max(1, Math.floor(maxChars));
  const overheadBytes = Math.max(0, Math.ceil(options.overheadBytes || 0));
  const overheadChars = Math.max(0, Math.ceil(options.overheadChars || 0));
  const units = messageUnits(messages);
  let latestUser = messages.length - 1;
  while (latestUser >= 0 && messages[latestUser]?.role !== 'user') latestUser -= 1;
  // A synthesis call may contain no user message. Keep its latest complete
  // unit rather than retaining an orphaned tool result or returning no input.
  const lastContentUnit = units.filter((unit) => unit.messages.some((message) => message.role !== 'system')).at(-1);
  const explicitStart = options.currentTurnStart;
  const currentStart = explicitStart !== undefined && Number.isInteger(explicitStart) && explicitStart >= 0 && explicitStart < messages.length
    ? explicitStart
    : latestUser >= 0 ? latestUser : (lastContentUnit?.start ?? 0);
  const selected = new Set(units.filter((unit) => unit.end > currentStart || unit.messages.some((message) => message.role === 'system')));
  // Keep wire bytes separate from the text estimate. Reserve the current
  // turn's complete media, but make old media compete for the remaining
  // history budget. This is an application estimate, not a provider limit.
  const requiredMediaBytes = [...selected].reduce((sum, unit) => sum + unit.mediaBytes, 0);
  const maxBytes = options.maxBytes === undefined
    ? normalizedLimit * 4 + requiredMediaBytes
    : Math.max(1, Math.floor(options.maxBytes));
  let usedChars = overheadChars;
  let usedBytes = overheadBytes + 2; // The messages array's opening/closing brackets.
  let selectedCount = 0;
  for (const unit of selected) {
    usedChars += unit.chars;
    usedBytes += unit.bytes + (selectedCount > 0 ? 1 : 0);
    selectedCount += 1;
  }
  if (usedChars > normalizedLimit || usedBytes > maxBytes) {
    throw new AgentContextBudgetExceededError(usedChars, normalizedLimit, usedBytes, maxBytes);
  }
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (selected.has(unit)) continue;
    const nextBytes = usedBytes + unit.bytes + (selectedCount > 0 ? 1 : 0);
    if (usedChars + unit.chars > normalizedLimit || nextBytes > maxBytes) break;
    selected.add(unit);
    usedChars += unit.chars;
    usedBytes = nextBytes;
    selectedCount += 1;
  }
  return units.filter((unit) => selected.has(unit)).flatMap((unit) => unit.messages);
}

/** Recalculate request overhead and input capacity for the actual selected model. */
export function boundAgentChatPayload<TPayload extends { messages: ChatMessage[] }>(
  payload: TPayload,
  model: { rawId: string; contextWindow?: number; maxInputTokens?: number; maxOutputTokens?: number },
  options: Pick<AgentContextBudgetOptions, 'currentTurnStart'> = {},
) {
  // Include tools/schema and reserve protocol formatting; this remains an estimate.
  const overheadBytes = utf8Bytes(JSON.stringify({ ...payload, messages: [], model: model.rawId, stream: true })) - 2 + 512;
  const maxChars = modelInputCharBudget(model.contextWindow, model.maxInputTokens, model.maxOutputTokens);
  return {
    ...payload,
    messages: boundAgentContext(payload.messages, maxChars, { ...options, overheadChars: overheadBytes, overheadBytes }),
  };
}

export function boundToolResult(value: unknown, maxChars = AGENT_TOOL_RESULT_MAX_CHARS) {
  const text = String(value ?? '');
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 32))}\n[工具结果已截断]`;
}
