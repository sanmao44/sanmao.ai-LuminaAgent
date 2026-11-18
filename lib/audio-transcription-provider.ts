import type { AudioTranscriptionRequest } from '@/packages/contracts/audio-transcription';
import { authHeaders, runtimeBaseUrl, type RuntimeProvider } from './providers';

export type AudioTranscriptionRuntime = {
  model: { id: string; rawId: string; displayName: string };
  provider: RuntimeProvider;
};

function transcriptionEndpoint(provider: RuntimeProvider) {
  const base = runtimeBaseUrl(provider).replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? `${base}/audio/transcriptions` : `${base}/v1/audio/transcriptions`;
}

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const error = (payload as Record<string, unknown>).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const value = payload as Record<string, unknown>;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.transcript === 'string') return value.transcript;
  if (Array.isArray(value.segments)) {
    return value.segments.map((segment) => segment && typeof segment === 'object' && typeof (segment as Record<string, unknown>).text === 'string'
      ? (segment as Record<string, string>).text : '').filter(Boolean).join(' ');
  }
  return '';
}

function responseSegments(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>).segments)) return undefined;
  const segments = (payload as { segments: unknown[] }).segments.flatMap((segment) => {
    if (!segment || typeof segment !== 'object') return [];
    const value = segment as Record<string, unknown>;
    const start = Number(value.start);
    const end = Number(value.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || typeof value.text !== 'string') return [];
    return [{ start, end, text: value.text }];
  });
  return segments.length ? segments : undefined;
}

export async function transcribeOpenAiCompatibleAudio(
  runtime: AudioTranscriptionRuntime,
  input: AudioTranscriptionRequest,
  signal?: AbortSignal,
) {
  const form = new FormData();
  form.set('model', runtime.model.rawId);
  form.set('file', new Blob([Uint8Array.from(input.file.bytes)], { type: input.file.mimeType }), input.file.name);
  if (input.language) form.set('language', input.language);
  if (input.prompt) form.set('prompt', input.prompt);
  form.set('response_format', input.responseFormat || 'verbose_json');
  form.set('temperature', String(input.temperature ?? 0));

  const response = await fetch(transcriptionEndpoint(runtime.provider), {
    method: 'POST',
    headers: authHeaders(runtime.provider),
    body: form,
    ...(signal ? { signal } : {}),
  });
  const raw = await response.text();
  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!response.ok) {
    const detail = errorMessage(payload) || raw.trim().slice(0, 1000);
    throw new Error(`语音转写服务请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }
  const expectsJson = !input.responseFormat || input.responseFormat === 'json' || input.responseFormat === 'verbose_json';
  const text = !expectsJson && payload === null ? raw : responseText(payload);
  if (payload === null && expectsJson) {
    throw new Error('语音转写服务返回格式无法解析，请切换为“纯文本”或重试。');
  }
  const language = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).language === 'string'
    ? (payload as Record<string, string>).language
    : input.language;
  const segments = input.responseFormat === 'verbose_json' ? responseSegments(payload) : undefined;
  const normalizedText = text || segments?.map((segment) => segment.text).join(' ') || '';
  return {
    text: normalizedText,
    modelId: runtime.model.id,
    modelName: runtime.model.displayName,
    ...(language ? { language } : {}),
    ...(segments ? { segments } : {}),
  };
}
