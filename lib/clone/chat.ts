/**
 * 克隆出片里的大模型调用：取文本、解析 JSON 块。
 * 各家兼容接口返回结构不完全一致，这里只做「宽容提取」，不做协议改造。
 */
import { chatCompletion, type ChatMessage } from '../providers';

export function chatText(response: unknown) {
  const raw = response as any;
  const content = raw?.choices?.[0]?.message?.content ?? raw?.choices?.[0]?.text ?? raw?.output_text ?? '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  if (Array.isArray(raw?.output)) {
    return raw.output
      .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/** 从模型回复里抠出第一个完整 JSON 值；抠不出来返回 null。 */
export function parseJsonBlock(value: unknown) {
  const text = String(value ?? '');
  if (!text.trim()) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const opener = candidate[start];
    const closer = opener === '{' ? '}' : ']';
    const end = candidate.lastIndexOf(closer);
    if (end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // 继续尝试下一个候选片段。
    }
  }
  return null;
}

export async function askText(
  runtime: { model: { rawId: string }; provider: Parameters<typeof chatCompletion>[0] },
  messages: ChatMessage[],
  signal?: AbortSignal,
) {
  const response = await chatCompletion(runtime.provider, runtime.model.rawId, { messages }, signal);
  return chatText(response);
}
