export type TextFileFallbackCall = {
  id: string;
  type: 'function';
  function: { name: 'file_generate'; arguments: string };
};

export type TextFileFallbackResult =
  | { ok: true; call: TextFileFallbackCall }
  | { ok: false; reason: 'invalid-json' | 'missing-content' | 'content-too-large' | 'invalid-document' };

const TEXT_FILE_EXTENSIONS = [
  'markdown', 'html', 'htm', 'yaml', 'yml', 'json', 'csv', 'tsv', 'svg', 'css',
  'jsx', 'tsx', 'xml', 'txt', 'java', 'sql', 'ps1', 'sh', 'js', 'ts', 'py', 'md',
] as const;
const MAX_TEXT_FILE_CHARS = 4_000_000;

function extensionFromName(value: string) {
  const extension = value.match(/\.([a-z0-9]+)(?:$|[?#])/i)?.[1]?.toLowerCase() || '';
  return (TEXT_FILE_EXTENSIONS as readonly string[]).includes(extension) ? extension : '';
}

function requestedExtension(instruction: string) {
  const explicitFilename = instruction.match(/(?:文件名|命名为|保存为|叫做|名为|filename)\s*[:：]?\s*["“「]?([^\s"”」]+\.[a-z0-9]+)(?:$|[\s"”」,，。！？!?])/iu)?.[1];
  const explicitExtension = explicitFilename ? extensionFromName(explicitFilename) : '';
  if (explicitExtension) return explicitExtension;

  // Prefer the format adjacent to a delivery verb: e.g. “SVG 动画，HTML 交付”.
  const deliveryFormat = instruction.match(/(?:html?|css|svg|xml|ya?ml|json|csv|tsv|markdown|md|txt|jsx?|tsx?|py|java|sql|sh|ps1)\s*(?:格式|交付|文件|附件|输出|下载|保存|导出)/iu)?.[0];
  const deliveredExtension = deliveryFormat?.match(/^(html?|css|svg|xml|ya?ml|json|csv|tsv|markdown|md|txt|jsx?|tsx?|py|java|sql|sh|ps1)/iu)?.[1]?.toLowerCase() || '';
  if (deliveredExtension) return deliveredExtension;

  const mentionedExtension = instruction.match(/(?:^|[^a-z0-9])(?:markdown|html?|yaml|yml|json|csv|tsv|svg|css|xml|txt|jsx|tsx|js|ts|py|java|sql|sh|ps1)(?:$|[^a-z0-9])/iu)?.[0]
    ?.replace(/[^a-z]/giu, '').toLowerCase();
  return mentionedExtension && (TEXT_FILE_EXTENSIONS as readonly string[]).includes(mentionedExtension)
    ? mentionedExtension
    : 'txt';
}

export function isTextFileFallbackRequested(instruction: string) {
  const explicitFilename = instruction.match(/(?:文件名|命名为|保存为|叫做|名为|filename)\s*[:：]?\s*["“「]?([^\s"”」]+\.[a-z0-9]+)(?:$|[\s"”」,，。！？!?])/iu)?.[1];
  if (explicitFilename) return Boolean(extensionFromName(explicitFilename));
  if (/^(?:如何|怎么|能否|能不能|可不可以|可以吗|是否可以)/iu.test(instruction.trim())) return false;
  if (/\.(?:docx|xlsx|pptx|zip)(?:$|[\s"”」,，。！？!?])/iu.test(instruction)) return false;
  const requestsFile = /(?:生成|创建|制作|导出|下载|保存|交付|输出|文件)/iu.test(instruction);
  const requestsTextFormat = /(?:^|[^a-z0-9])(?:markdown|html?|yaml|yml|json|csv|tsv|svg|css|xml|txt|jsx|tsx|js|ts|py|java|sql|sh|ps1)(?=\s*(?:格式|文件|附件|交付|输出|下载|保存|导出|网页|页面))/iu.test(instruction)
    || /(?:生成|创建|制作|导出|下载|保存|交付|输出)[^。！？\n]{0,40}(?:markdown|html?|yaml|yml|json|csv|tsv|svg|css|xml|txt|jsx|tsx|js|ts|py|java|sql|sh|ps1)(?:$|[^a-z0-9])/iu.test(instruction);
  return requestsFile && requestsTextFormat;
}

function requestedFilename(instruction: string, extension: string, modelFilename: unknown) {
  const explicit = instruction.match(/(?:文件名|命名为|保存为|叫做|名为|filename)\s*[:：]?\s*["“「]?([^\s"”」]+\.[a-z0-9]+)(?:$|[\s"”」,，。！？!?])/iu)?.[1];
  const candidate = explicit || (typeof modelFilename === 'string' ? modelFilename : '');
  const basename = candidate.split(/[\\/]/u).at(-1) || '';
  const safeBase = basename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_')
    .replace(/\.[a-z0-9]+$/iu, '')
    .trim()
    .slice(0, 120);
  return `${safeBase || 'SANMAO-交付物'}.${extension}`;
}

function parseEnvelope(value: string): Record<string, unknown> | null {
  let text = value.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced) text = fenced[1].trim();
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isCompleteDocument(content: string, extension: string) {
  if (extension === 'html' || extension === 'htm') {
    return /<html\b[\s\S]*<\/html\s*>/iu.test(content);
  }
  if (extension === 'svg') return /<svg\b[\s\S]*<\/svg\s*>/iu.test(content);
  if (extension === 'json') {
    try { JSON.parse(content); return true; } catch { return false; }
  }
  return true;
}

export function textFileFallbackSystemPrompt() {
  return [
    '你现在负责为 SANMAO.AI 生成用户明确要求交付的文本/代码文件。',
    '当前阶段没有可调用工具；不要声称文件已保存、已生成或已下载。',
    '只根据最近一条用户请求生成完整、可直接保存的文件内容；需要上下文时仅把较早对话作为资料。',
    '最终只输出一个 JSON 对象，字段为 filename 和 content；不要 Markdown 代码围栏、解释、路径或其他文字。',
    'filename 使用短文件名并带正确扩展名；content 必须是完整 UTF-8 文件正文，不得省略、截断或用占位符。',
  ].join('\n');
}

export function textFileFallbackUserPrompt(instruction: string) {
  const extension = requestedExtension(instruction);
  return `请为以下当前请求生成完整的 .${extension} 文件。若请求指定文件名则沿用，否则使用 SANMAO-交付物.${extension}。只返回 JSON：{"filename":"...","content":"..."}。\n\n[当前用户请求]\n${instruction}`;
}

export function makeTextFileFallbackCall(input: {
  response: unknown;
  instruction: string;
  callId: string;
}): TextFileFallbackResult {
  if (typeof input.response !== 'string') return { ok: false, reason: 'invalid-json' };
  const envelope = parseEnvelope(input.response);
  if (!envelope) return { ok: false, reason: 'invalid-json' };
  if (typeof envelope.content !== 'string' || !envelope.content.trim()) return { ok: false, reason: 'missing-content' };
  if (envelope.content.length > MAX_TEXT_FILE_CHARS) return { ok: false, reason: 'content-too-large' };

  const extension = requestedExtension(input.instruction);
  if (!isCompleteDocument(envelope.content, extension)) return { ok: false, reason: 'invalid-document' };
  const filename = requestedFilename(input.instruction, extension, envelope.filename);
  const call: TextFileFallbackCall = {
    id: input.callId,
    type: 'function',
    function: {
      name: 'file_generate',
      arguments: JSON.stringify({ files: [{ filename, content: envelope.content, encoding: 'utf8' }] }),
    },
  };
  return { ok: true, call };
}

export function isToolSchemaProviderFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { providerStatus?: unknown; status?: unknown; message?: unknown };
  const status = Number(value.providerStatus || value.status || 0);
  const message = typeof value.message === 'string' ? value.message : '';
  return status === 400 && /(?:tool|function|schema|工具|参数)/iu.test(message);
}
