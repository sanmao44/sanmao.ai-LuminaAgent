/**
 * 配音（TTS）：走用户已配服务商的 OpenAI 兼容 /v1/audio/speech。
 * Hypit 的 Seedance 只吃「参考音频」，不会替人念台词；念台词必须靠这一层。
 */
import { authHeaders, runtimeBaseUrl, type RuntimeProvider } from '../providers';
import { getRuntimeModel } from '../store';

export type SpeechRuntime = NonNullable<Awaited<ReturnType<typeof getRuntimeModel>>>;

export async function resolveSpeechRuntime(modelId: string | null = null) {
  const runtime = await getRuntimeModel(modelId, 'audio');
  return runtime ?? null;
}

export function speechEndpoint(provider: RuntimeProvider) {
  const base = runtimeBaseUrl(provider).replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

export type SpeechRequest = {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav';
  signal?: AbortSignal;
};

/** 合成一句配音，直接返回音频字节；调用方负责落盘与测时长。 */
export async function synthesizeSpeech(runtime: SpeechRuntime, input: SpeechRequest) {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('配音文本为空。');
  const response = await fetch(speechEndpoint(runtime.provider), {
    method: 'POST',
    headers: { ...authHeaders(runtime.provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: runtime.model.rawId,
      input: text,
      voice: input.voice || 'alloy',
      response_format: input.format || 'mp3',
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`配音接口失败：HTTP ${response.status}${detail ? `（${detail.replace(/\s+/g, ' ').slice(0, 180)}）` : ''}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.byteLength) throw new Error('配音接口没有返回音频数据。');
  return buffer;
}
