import type { CanvasPatch } from '../contracts/canvas';
import type { ChatMessage } from '../contracts/chat';

export type NativeCapabilityResult = {
  message: ChatMessage;
  webSearchData?: unknown;
  webSearchError?: string;
  files?: Array<{ name: string; size: number; [key: string]: unknown }>;
  canvasPatch?: CanvasPatch;
};

type NativeCapabilityInput = {
  callId?: string;
  args: Record<string, unknown>;
  signal: AbortSignal;
  latestContent?: unknown;
  searchQuery?: string;
  searchWeb?: (query: string, signal: AbortSignal) => Promise<unknown>;
  formatWebSearchContext?: (value: unknown) => string;
  normalizeGeneratedFile?: (raw: unknown, index: number) => { name: string; size: number; [key: string]: unknown } | null;
  canvasDocument?: unknown;
  parseToolArguments?: (raw?: string) => unknown;
  validateCanvasPatch?: (document: unknown, patch: CanvasPatch) => { ok: true } | { ok: false; error: string; operationIndex?: number };
  runId?: string;
};

const toolMessage = (callId: string | undefined, payload: unknown): ChatMessage => ({
  role: 'tool',
  tool_call_id: callId,
  content: JSON.stringify(payload),
});

export async function executeWebCapability(input: NativeCapabilityInput): Promise<NativeCapabilityResult> {
  const query = input.searchQuery || String(input.args.query || input.latestContent || '').trim().slice(0, 320);
  if (!query || !input.searchWeb || !input.formatWebSearchContext) {
    return { message: toolMessage(input.callId, { ok: false, error: '搜索问题不能为空' }) };
  }
  try {
    const webSearchData = await input.searchWeb(query, input.signal);
    return { message: toolMessage(input.callId, input.formatWebSearchContext(webSearchData)), webSearchData };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason || error;
    const webSearchError = error instanceof Error ? error.message : '联网搜索失败';
    return {
      message: toolMessage(input.callId, { ok: false, error: webSearchError, instruction: '如实说明无法完成实时核验，不要伪造最新事实或来源。' }),
      webSearchError,
    };
  }
}

export function executeFileCapability(input: NativeCapabilityInput): NativeCapabilityResult {
  const entries = Array.isArray(input.args.files) ? input.args.files : [input.args];
  const files = entries
    .map((entry, index) => input.normalizeGeneratedFile?.(entry, index) || null)
    .filter((file): file is { name: string; size: number; [key: string]: unknown } => Boolean(file))
    .slice(0, 8);
  if (!files.length) return { message: toolMessage(input.callId, { ok: false, error: '没有收到有效的文件内容' }) };
  return { message: toolMessage(input.callId, { ok: true, count: files.length, files: files.map((file) => ({ name: file.name, size: file.size })) }), files };
}

export function executeCanvasCapability(input: NativeCapabilityInput): NativeCapabilityResult {
  if (!input.canvasDocument || !input.parseToolArguments || !input.validateCanvasPatch) {
    return { message: toolMessage(input.callId, { ok: false, error: '当前请求没有可用的画布上下文' }) };
  }
  const patch = input.parseToolArguments() as CanvasPatch;
  const validation = input.validateCanvasPatch(input.canvasDocument, patch);
  if (!validation.ok) {
    return { message: toolMessage(input.callId, { ok: false, error: validation.error, operationIndex: validation.operationIndex }) };
  }
  const accepted = { ...patch, runId: input.runId || patch.runId } satisfies CanvasPatch;
  return {
    message: toolMessage(input.callId, { ok: true, patch: accepted, summary: `已生成${accepted.operations.length} 个画布操作，等待客户端应用` }),
    canvasPatch: accepted,
  };
}
