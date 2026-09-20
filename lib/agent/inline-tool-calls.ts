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
const TOOL_CALL_MARKER = /<\s*tool_call\b[^>]*>([\s\S]*?)<\/\s*tool_call\s*>/gi;
// DeepSeek-compatible providers sometimes emit their tool call as DSML text
// instead of populating `message.tool_calls`. Keep this matcher deliberately
// narrow: the recovered name still has to exist in the tools offered this
// turn, just like the legacy marker above.
const DSML_INVOKE_MARKER = /<[^>]*DSML[^>]*\binvoke\s+name\s*=\s*["']([^"']+)["'][^>]*>/gi;

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
  const source = String(text ?? '');
  INLINE_TOOL_MARKER.lastIndex = 0;
  if (INLINE_TOOL_MARKER.test(source)) return true;
  TOOL_CALL_MARKER.lastIndex = 0;
  if (TOOL_CALL_MARKER.test(source) || /<\s*tool_call\b/i.test(source)) return true;
  DSML_INVOKE_MARKER.lastIndex = 0;
  return DSML_INVOKE_MARKER.test(source);
}

function parseParameterValue(value: string) {
  const text = value.trim();
  if (!text) return '';
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  try { return JSON.parse(text); } catch { return text; }
}

function parseDsmlArguments(source: string, start: number, end: number) {
  const body = source.slice(start, end);
  const args: Record<string, unknown> = {};
  const parameter = /<[^>]*DSML[^>]*\bparameter\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<[^>]*DSML[^>]*\bparameter\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = parameter.exec(body))) args[match[1]] = parseParameterValue(match[2]);
  return Object.keys(args).length ? args : null;
}

function parseDsmlToolCalls(source: string, definitions: readonly InlineToolDefinition[], calls: InlineToolCall[]) {
  const marker = new RegExp(DSML_INVOKE_MARKER.source, DSML_INVOKE_MARKER.flags);
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    const name = offeredToolName(match[1], definitions);
    if (!name) continue;
    const remainder = source.slice(marker.lastIndex);
    const close = remainder.search(/<\/[^>]*DSML[^>]*\binvoke\s*>/i);
    const end = close >= 0 ? marker.lastIndex + close : source.length;
    const args = parseDsmlArguments(source, marker.lastIndex, end);
    if (!args) continue;
    calls.push({
      id: `inline_tool_${calls.length + 1}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    });
    marker.lastIndex = end;
  }
}

function parseToolCallBlocks(source: string, definitions: readonly InlineToolDefinition[], calls: InlineToolCall[]) {
  const marker = new RegExp(TOOL_CALL_MARKER.source, TOOL_CALL_MARKER.flags);
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    let parsed: any;
    try { parsed = JSON.parse(match[1].trim()); } catch { continue; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const name = offeredToolName(parsed.name || parsed.function?.name, definitions);
    if (!name) continue;
    const rawArguments = parsed.arguments ?? parsed.function?.arguments;
    const args = typeof rawArguments === 'string'
      ? (() => { try { return JSON.parse(rawArguments); } catch { return null; } })()
      : rawArguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
    calls.push({
      id: `inline_tool_${calls.length + 1}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    });
  }
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
  parseToolCallBlocks(source, definitions, calls);
  parseDsmlToolCalls(source, definitions, calls);
  return calls;
}
