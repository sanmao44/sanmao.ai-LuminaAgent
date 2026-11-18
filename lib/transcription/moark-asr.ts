import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalTranscriptionResult, TimestampedTranscriptSegment, TimestampedTranscriptWord } from '@/packages/contracts/transcription';
import type { RuntimeProvider } from '@/lib/providers';

const MOARK_ASR_MODEL = 'SenseVoiceSmall';
const MOARK_ASR_TIMEOUT_MS = 180_000;

function transcriptionEndpoint(provider: RuntimeProvider) {
  const base = String(provider.baseUrl || '').replace(/\/+$/u, '');
  if (!base) throw new Error('模力方舟服务商未配置 API 地址');
  return /\/v\d+(?:\.\d+)?$/iu.test(base) ? `${base}/audio/transcriptions` : `${base}/v1/audio/transcriptions`;
}

function audioMimeType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.wav': return 'audio/wav';
    case '.m4a': return 'audio/mp4';
    case '.ogg':
    case '.oga': return 'audio/ogg';
    case '.webm': return 'audio/webm';
    case '.flac': return 'audio/flac';
    default: return 'audio/mpeg';
  }
}

function responseText(data: unknown) {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  for (const candidate of [record.text, record.transcription, (record.result as Record<string, unknown> | undefined)?.text]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const choice = (record.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string') return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
        ? (part as Record<string, unknown>).text as string
        : '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function timestampedItems(value: unknown, fallbackText: string): TimestampedTranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const start = Number(record.start);
    const end = Number(record.end);
    const text = String(record.text || '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text.trim()) return [];
    return [{ start, end, text: text.trim() }];
  }).map((segment) => ({ ...segment, text: segment.text || fallbackText }));
}

function timestampedWords(value: unknown): TimestampedTranscriptWord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const start = Number(record.start);
    const end = Number(record.end);
    const text = String(record.word || record.text || '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text.trim()) return [];
    return [{ start, end, text }];
  });
}

/** Moark's documented SenseVoiceSmall transcription API returns text; timestamp fields are not documented. */
export async function transcribeMoarkAudioFile(
  filePath: string,
  provider: RuntimeProvider,
  options: { referenceText?: string; signal?: AbortSignal } = {},
): Promise<LocalTranscriptionResult> {
  if (options.signal?.aborted) throw options.signal.reason || new Error('转写已取消');
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: audioMimeType(filePath) }), path.basename(filePath) || 'audio.mp3');
  form.append('model', MOARK_ASR_MODEL);
  form.append('language', 'zh');

  const header = provider.authHeader?.trim() || 'Authorization';
  const prefix = provider.authPrefix ?? 'Bearer ';
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(MOARK_ASR_TIMEOUT_MS)])
    : AbortSignal.timeout(MOARK_ASR_TIMEOUT_MS);
  const response = await fetch(transcriptionEndpoint(provider), {
    method: 'POST',
    headers: { [header]: `${prefix}${provider.apiKey}` },
    body: form,
    cache: 'no-store',
    signal,
  });
  const body = await response.text();
  let data: unknown;
  try { data = body ? JSON.parse(body) : {}; } catch { data = { text: body }; }
  if (!response.ok) {
    const message = data && typeof data === 'object'
      ? String((data as Record<string, unknown>).message || (data as Record<string, unknown>).error || '')
      : '';
    throw new Error(`模力方舟语音识别失败（HTTP ${response.status}）${message ? `：${message.slice(0, 300)}` : ''}`);
  }

  const text = responseText(data);
  if (!text) throw new Error('模力方舟语音识别未返回文本');
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const segments = timestampedItems(record.segments, text);
  const words = timestampedWords(record.words);
  return {
    text,
    segments,
    words,
    model: String(record.model || MOARK_ASR_MODEL),
    language: 'zh',
  };
}
