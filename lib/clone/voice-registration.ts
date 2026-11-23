import { authHeaders, runtimeBaseUrl, type RuntimeProvider } from '../providers';
import { isCangyuanProvider } from '../cangyuan-provider';
import type { SpeechVoiceListInput, SpeechVoiceRecord, SpeechVoiceRegistrationInput } from '../../packages/contracts/audio-voice-registration';

export class CangyuanSpeechVoiceError extends Error {
  readonly resultUnconfirmed: boolean;

  constructor(message: string, resultUnconfirmed = false) {
    super(message);
    this.name = 'CangyuanSpeechVoiceError';
    this.resultUnconfirmed = resultUnconfirmed;
  }
}

export type SpeechVoiceRuntime = {
  provider: RuntimeProvider;
  model: { rawId: string };
};

export function speechVoicesEndpoint(provider: RuntimeProvider, modelId = '') {
  let base = runtimeBaseUrl(provider).replace(/\/+$/, '');
  if (isCangyuanProvider(provider) && /^minimax-speech-2\.8-(?:hd|turbo)-tts$/i.test(modelId)) {
    base = base.replace(/^https:\/\/ai\.cangyuansuanli\.cn(?=\/|$)/i, 'https://direct-api.cangyuansuanli.cn');
  }
  return /\/v1$/i.test(base) ? `${base}/audio/voices` : `${base}/v1/audio/voices`;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function responseMessage(status: number, body: string, apiKey: string) {
  const cleaned = (apiKey ? body.replaceAll(apiKey, '[已隐藏]') : body)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return `声音接口请求失败：HTTP ${status}${cleaned ? `（${cleaned}）` : ''}`;
}

async function responseJson(response: Response, apiKey: string, action: '登记' | '查询', resultUnconfirmedOnMalformedResponse = false) {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new CangyuanSpeechVoiceError(responseMessage(response.status, text, apiKey), response.status >= 500);
  }
  try {
    return text ? JSON.parse(text) as unknown : {};
  } catch {
    throw new CangyuanSpeechVoiceError(`${action}接口返回的数据格式无法识别。`, resultUnconfirmedOnMalformedResponse);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVoice(value: unknown): SpeechVoiceRecord | null {
  if (!isRecord(value)) return null;
  const voiceId = typeof value.voice_id === 'string' ? value.voice_id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const status = typeof value.status === 'string' ? value.status.trim() : '';
  if (!voiceId || !name || !status) return null;
  const previewUrl = typeof value.preview_url === 'string' ? value.preview_url.trim() : '';
  let safePreviewUrl: string | undefined;
  try {
    const parsed = new URL(previewUrl);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) safePreviewUrl = parsed.toString();
  } catch {}
  return {
    voiceId: voiceId.slice(0, 240),
    name: name.slice(0, 80),
    status: status.slice(0, 40),
    ...(safePreviewUrl ? { previewUrl: safePreviewUrl } : {}),
  };
}

function normalizeRegistrationResponse(value: unknown): SpeechVoiceRecord {
  const source = isRecord(value) && isRecord(value.voice) ? value.voice : value;
  const voice = normalizeVoice(source);
  if (!voice) throw new CangyuanSpeechVoiceError('登记接口已响应，但没有返回有效的音色编号。', true);
  return voice;
}

function normalizeVoiceListResponse(value: unknown): SpeechVoiceRecord[] {
  const candidate = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.voices)
      ? value.voices
      : isRecord(value) && Array.isArray(value.data)
        ? value.data
        : null;
  if (!candidate) throw new CangyuanSpeechVoiceError('音色列表接口返回的数据格式无法识别。');
  const voices = candidate.map(normalizeVoice);
  if (voices.some((voice) => !voice)) throw new CangyuanSpeechVoiceError('音色列表中存在无法识别的项目。');
  return voices as SpeechVoiceRecord[];
}

export async function registerCangyuanSpeechVoice(
  runtime: SpeechVoiceRuntime,
  input: SpeechVoiceRegistrationInput,
  signal?: AbortSignal,
): Promise<SpeechVoiceRecord> {
  let response: Response;
  try {
    response = await fetch(speechVoicesEndpoint(runtime.provider, runtime.model.rawId), {
      method: 'POST',
      headers: { ...authHeaders(runtime.provider), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.registrationModel,
        name: input.name,
        url: input.url,
        consent: true,
      }),
      signal: withTimeout(signal, 270_000),
    });
  } catch (error) {
    throw new CangyuanSpeechVoiceError(
      error instanceof Error && error.name === 'TimeoutError'
        ? '声音登记等待超时，结果尚未确认。请先刷新音色列表，再决定是否重试，避免重复扣费。'
        : '声音登记连接中断，结果尚未确认。请先刷新音色列表，再决定是否重试，避免重复扣费。',
      true,
    );
  }
  const value = await responseJson(response, runtime.provider.apiKey, '登记', true);
  return normalizeRegistrationResponse(value);
}

export async function listCangyuanSpeechVoices(
  runtime: SpeechVoiceRuntime,
  input: SpeechVoiceListInput,
  signal?: AbortSignal,
): Promise<readonly SpeechVoiceRecord[]> {
  const url = new URL(speechVoicesEndpoint(runtime.provider, runtime.model.rawId));
  url.searchParams.set('model', input.registrationModel);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: authHeaders(runtime.provider),
      cache: 'no-store',
      signal: withTimeout(signal, 30_000),
    });
  } catch (error) {
    throw new CangyuanSpeechVoiceError(error instanceof Error && error.name === 'TimeoutError'
      ? '读取已登记音色超时，请重试。'
      : '读取已登记音色失败，请检查网络后重试。');
  }
  const value = await responseJson(response, runtime.provider.apiKey, '查询');
  return normalizeVoiceListResponse(value);
}

export async function previewCangyuanSpeechVoice(
  runtime: SpeechVoiceRuntime,
  previewUrl: string,
  signal?: AbortSignal,
): Promise<{ body: ArrayBuffer; contentType: string }> {
  let target: URL;
  const voicesUrl = new URL(speechVoicesEndpoint(runtime.provider, runtime.model.rawId));
  try {
    target = new URL(previewUrl);
  } catch {
    throw new CangyuanSpeechVoiceError('官方音色试听地址无效。');
  }
  const expectedPathPrefix = `${voicesUrl.pathname.replace(/\/+$/, '')}/`;
  const pathRemainder = target.pathname.startsWith(expectedPathPrefix)
    ? target.pathname.slice(expectedPathPrefix.length)
    : '';
  if (voicesUrl.protocol !== 'https:' || target.protocol !== 'https:' || target.origin !== voicesUrl.origin
    || target.username || target.password || target.search || target.hash
    || !/^task_[A-Za-z0-9._~-]{1,220}\/preview$/.test(pathRemainder)) {
    throw new CangyuanSpeechVoiceError('官方音色试听地址与当前服务商不匹配，已阻止请求。');
  }

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method: 'GET',
      headers: authHeaders(runtime.provider),
      cache: 'no-store',
      redirect: 'manual',
      signal: withTimeout(signal, 30_000),
    });
  } catch (error) {
    throw new CangyuanSpeechVoiceError(error instanceof Error && error.name === 'TimeoutError'
      ? '音色试听超时，请重试。'
      : '音色试听连接失败，请检查网络后重试。');
  }
  if (response.redirected || response.status >= 300 && response.status < 400) {
    throw new CangyuanSpeechVoiceError('官方试听地址发生跳转，已阻止播放。');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new CangyuanSpeechVoiceError(responseMessage(response.status, text, runtime.provider.apiKey));
  }

  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
    throw new CangyuanSpeechVoiceError('官方试听接口未返回音频内容。');
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 8 * 1024 * 1024) throw new CangyuanSpeechVoiceError('官方试听文件超过 8 MiB，已停止下载。');
  const body = await response.arrayBuffer();
  if (body.byteLength > 8 * 1024 * 1024) throw new CangyuanSpeechVoiceError('官方试听文件超过 8 MiB，已停止下载。');
  return { body, contentType };
}
