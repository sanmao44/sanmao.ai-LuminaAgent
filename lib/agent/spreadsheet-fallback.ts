import type { SpreadsheetInput } from '@/packages/contracts/artifact';

export const SPREADSHEET_FALLBACK_SYSTEM_PROMPT = [
  '你现在负责为用户准备一个可下载的 Excel 工作簿。当前模型接口不支持原生工具调用，所以不要调用工具，也不要解释过程。',
  '请根据本轮用户请求和对话上下文，直接返回一个合法的 JSON 对象；不要使用 Markdown 代码块，不要在 JSON 前后添加说明。',
  'JSON 顶层必须包含 sheets 数组，至少一个工作表。可选 filename，文件名应以 .xlsx 结尾。',
  '每个工作表可包含 name、columns、rows、freezeHeader、autoFilter、totals；columns 使用 key、header、format、total、options、highlight，rows 使用对象数组或数组的数组。',
  '单元格可以是字符串、数字、布尔值或 null；公式使用 {"formula":"SUM(B2:B10)"}，链接使用 {"url":"https://example.com","text":"打开"}。',
  '如果用户没有给出完整数据，请根据用户要求生成合理、可用的表头和示例数据；只输出 JSON，不要输出 base64、代码或文件说明。',
].join('\n');

export const SPREADSHEET_FALLBACK_REQUEST_PROMPT = '请现在把 Excel 内容整理成上述 JSON，并只返回这个 JSON 对象。';

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => textFromContent(item)).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  if (typeof item.text === 'string') return item.text.trim();
  if (typeof item.content === 'string') return item.content.trim();
  if (Array.isArray(item.content)) return textFromContent(item.content);
  return '';
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function balancedObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function candidateTexts(text: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string) => {
    const normalized = value.trim();
    if (normalized) candidates.add(normalized);
  };
  add(text);
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) add(match[1]);
  for (const candidate of balancedObjectCandidates(text)) add(candidate);
  return [...candidates];
}

function spreadsheetRecord(value: unknown): SpreadsheetInput | null {
  const record = recordOf(value);
  if (!record) return null;
  const nested = recordOf(record.spreadsheet) || recordOf(record.data);
  const candidate = nested && Array.isArray(nested.sheets) ? nested : record;
  return Array.isArray(candidate.sheets) && candidate.sheets.length > 0 ? candidate : null;
}

/** Parse strict JSON, fenced JSON, or JSON embedded in a short model explanation. */
export function parseSpreadsheetFallback(content: unknown): SpreadsheetInput | null {
  const text = textFromContent(content);
  if (!text) return null;
  for (const candidate of candidateTexts(text)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const spreadsheet = spreadsheetRecord(parsed);
      if (spreadsheet) return spreadsheet;
    } catch {
      // The next balanced candidate may contain the actual JSON object.
    }
  }
  return null;
}
