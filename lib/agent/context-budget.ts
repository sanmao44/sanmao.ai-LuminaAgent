import type { ChatContentPart, ChatMessage } from '../providers';

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
  // This is deliberately a conservative character estimate. It is a guard
  // against accidental overflow, not a fake token counter.
  return Math.max(16_000, Math.min(600_000, Math.floor(Math.max(4_000, advertisedInput) * 3)));
}

function contentChars(content: ChatMessage['content']) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) return content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 120), 0);
  return 0;
}

type MessageUnit = {
  messages: ChatMessage[];
  chars: number;
};

function trimContent(content: ChatMessage['content'], maxChars: number): ChatMessage['content'] {
  if (typeof content === 'string') return content.length <= maxChars ? content : `${content.slice(0, Math.max(0, maxChars - 32))}\n[上下文已截断]`;
  if (!Array.isArray(content)) return content;
  let remaining = maxChars;
  return content.flatMap((part): ChatContentPart[] => {
    if (part.type !== 'text') {
      if (remaining < 120) return [];
      remaining -= 120;
      return [part];
    }
    if (remaining <= 0) return [];
    const text = part.text.length <= remaining ? part.text : `${part.text.slice(0, Math.max(0, remaining - 32))}\n[上下文已截断]`;
    remaining -= text.length;
    return [{ ...part, text }];
  });
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
      units.push({ messages: group, chars: group.reduce((sum, item) => sum + contentChars(item.content), 0) });
      index = next - 1;
      continue;
    }
    units.push({ messages: [message], chars: contentChars(message.content) });
  }
  return units;
}

function trimMessageUnit(unit: MessageUnit, maxChars: number) {
  let remaining = Math.max(0, maxChars);
  return unit.messages.map((message) => {
    const content = trimContent(message.content, remaining);
    remaining = Math.max(0, remaining - contentChars(content));
    return { ...message, content };
  });
}

/** Keep the system prompt and newest complete message units while dropping old context first. */
export function boundAgentContext(messages: ChatMessage[], maxChars: number) {
  const normalizedLimit = Math.max(1, Math.floor(maxChars));
  const system: ChatMessage[] = [];
  let firstNonSystem = 0;
  while (firstNonSystem < messages.length && messages[firstNonSystem]?.role === 'system') {
    system.push(messages[firstNonSystem]);
    firstNonSystem += 1;
  }
  let used = 0;
  const boundedSystem = system.map((message) => {
    const content = trimContent(message.content, Math.max(0, normalizedLimit - used));
    used += contentChars(content);
    return { ...message, content };
  });
  const selected: MessageUnit[] = [];
  const units = messageUnits(messages.slice(firstNonSystem));
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    const available = normalizedLimit - used;
    if (available <= 0) break;
    if (unit.chars <= available) {
      selected.unshift(unit);
      used += unit.chars;
      continue;
    }
    // The newest unit must remain structurally valid. In particular, never
    // retain a tool result without its assistant tool_calls message.
    if (!selected.length) selected.unshift({ messages: trimMessageUnit(unit, available), chars: available });
    break;
  }
  return [...boundedSystem, ...selected.flatMap((unit) => unit.messages)];
}

export function boundToolResult(value: unknown, maxChars = AGENT_TOOL_RESULT_MAX_CHARS) {
  const text = String(value ?? '');
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 32))}\n[工具结果已截断]`;
}
