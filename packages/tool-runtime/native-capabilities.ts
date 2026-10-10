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
  onProgress?: (line: string) => void;
  videoDownload?: (input: { url: string; outputDirectory: string; format?: 'best' | 'bestvideo+bestaudio/best'; signal: AbortSignal; onProgress?: (line: string) => void }) => Promise<{ filePath: string; bytes: number }>;
  videoStoragePath?: string;
};

const toolMessage = (callId: string | undefined, payload: unknown): ChatMessage => ({
  role: 'tool',
  tool_call_id: callId,
  content: JSON.stringify(payload),
});

function videoFileName(filePath: string) {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function videoMimeType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.ogv')) return 'video/ogg';
  return 'video/mp4';
}

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

/** Execute the local video downloader and return a stable storage URL. */
export async function executeVideoDownloadCapability(input: NativeCapabilityInput): Promise<NativeCapabilityResult> {
  const url = String(input.args.url || '').trim();
  if (!url || !input.videoDownload || !input.videoStoragePath) {
    return { message: toolMessage(input.callId, { ok: false, error: '当前未配置可用的视频下载器或视频存储目录' }) };
  }
  try {
    const format = input.args.format === 'best' || input.args.format === 'bestvideo+bestaudio/best' ? input.args.format : undefined;
    const result = await input.videoDownload({
      url,
      outputDirectory: input.videoStoragePath,
      ...(format ? { format } : {}),
      signal: input.signal,
      onProgress: (line) => input.onProgress?.(line),
    });
    const name = videoFileName(result.filePath);
    return {
      message: toolMessage(input.callId, {
        ok: true,
        url: `/api/storage/video?name=${encodeURIComponent(name)}`,
        name,
        bytes: result.bytes,
        sourceUrl: url,
      }),
      files: [{ name, size: result.bytes, url: `/api/storage/video?name=${encodeURIComponent(name)}`, mimeType: videoMimeType(name), sourceUrl: url }],
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason || error;
    return { message: toolMessage(input.callId, { ok: false, error: error instanceof Error ? error.message : String(error) }) };
  }
}
