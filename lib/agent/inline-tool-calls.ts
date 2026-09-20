/**
 * Some model/provider combinations serialize tool calls into message content
 * instead of returning the structured tool_calls field. Keep the compatibility
 * parser deliberately narrow: only calls matching tools that were actually
 * offered this turn may be recovered.
 */

export type InlineToolDefinition = { name?: unknown; function?: { name?: unknown } };

export type InlineToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

const INLINE_TOOL_MARKER = /(?:\bto\s*=\s*functions\.|<\s*function\s*=\s*)([A-Za-z0-9_-]+)/gi;

function normalizedToolName(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findMatchingObject(text: string, start: number) {
  const open = text.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return null;
}

function offeredToolName(candidate: string, definitions: readonly InlineToolDefinition[]) {
  const normalizedCandidate = normalizedToolName(candidate);
  if (!normalizedCandidate) return '';
  return definitions
    .map((definition) => String(definition?.name || definition?.function?.name || ''))
    .find((name) => normalizedToolName(name) === normalizedCandidate) || '';
}

export function hasInlineToolCallMarkup(text: unknown) {
  INLINE_TOOL_MARKER.lastIndex = 0;
  return INLINE_TOOL_MARKER.test(String(text ?? ''));
}

/** Recover provider-emitted text calls such as `to=functions.playwright_browserclick { ... }`. */
export function parseInlineToolCalls(text: unknown, definitions: readonly InlineToolDefinition[]): InlineToolCall[] {
  const source = String(text ?? '');
  const calls: InlineToolCall[] = [];
  const marker = new RegExp(INLINE_TOOL_MARKER.source, INLINE_TOOL_MARKER.flags);
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    const name = offeredToolName(match[1], definitions);
    if (!name) continue;
    const argumentsText = findMatchingObject(source, marker.lastIndex);
    if (!argumentsText) continue;
    try {
      const parsed = JSON.parse(argumentsText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    } catch {
      continue;
    }
    calls.push({
      id: `inline_tool_${calls.length + 1}`,
      type: 'function',
      function: { name, arguments: argumentsText },
    });
    marker.lastIndex = source.indexOf(argumentsText, marker.lastIndex) + argumentsText.length;
  }
  return calls;
}
