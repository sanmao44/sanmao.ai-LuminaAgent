/**
 * 配音（TTS）：走用户已配服务商的 OpenAI 兼容 /v1/audio/speech。
 * Hypit 的 Seedance 只吃「参考音频」，不会替人念台词；念台词必须靠这一层。
 *
 * 服务商差异很大，所以这里做了两层兼容：
 * 1) voice：OpenAI / 硅基流动认 voice，Gitee 模力方舟没有这个参数会直接 400；
 *    带了 voice 被拒就自动去掉重试一次。
 * 2) 容器：response_format 经常被忽略，Gitee 默认回 wav；
 *    落盘前按响应头 + 魔数判断真实格式，避免把 wav 存成 .mp3 导致时长探测失败。
 */
import { authHeaders, runtimeBaseUrl, type RuntimeProvider } from '../providers';
import { getRuntimeModelCandidates } from '../store';
import { getSpeechModelProfile, type SpeechOutputFormat } from '../../packages/contracts/audio-synthesis';

export type SpeechRuntime = NonNullable<Awaited<ReturnType<typeof getRuntimeModelCandidates>>[number]>;

export async function resolveSpeechRuntime(modelId: string | null = null) {
  const candidates = await getRuntimeModelCandidates(modelId, 'audio');
  return candidates.find((runtime) => runtime.model.capabilities.includes('speech')) ?? null;
}

export function speechEndpoint(provider: RuntimeProvider) {
  const base = runtimeBaseUrl(provider).replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

/** 判断音频容器：优先响应头，响应头不靠谱时按文件头兜底。 */
const SPEECH_FORMAT_CONTENT_TYPES: Readonly<Record<SpeechOutputFormat, string>> = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
});

export function speechContentType(buffer: Buffer, headerType?: string | null, fallbackFormat?: SpeechOutputFormat) {
  const header = String(headerType || '').split(';', 1)[0].trim().toLowerCase();
  if (header.startsWith('audio/')) return header === 'audio/x-wav' ? 'audio/wav' : header;
  const head = buffer.subarray(0, 12);
  const ascii = head.toString('latin1');
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii.startsWith('OggS')) return 'audio/ogg';
  if (ascii.startsWith('fLaC')) return 'audio/flac';
  if (ascii.slice(4, 8) === 'ftyp') return 'audio/mp4';
  if (ascii.startsWith('ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return header && header !== 'application/octet-stream'
    ? header
    : fallbackFormat ? SPEECH_FORMAT_CONTENT_TYPES[fallbackFormat] : header || 'audio/mpeg';
}

export function audioExtension(contentType: string) {
  const mime = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  if (mime === 'audio/ogg' || mime === 'audio/oga') return 'ogg';
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return 'm4a';
  if (mime === 'audio/aac') return 'aac';
  if (mime === 'audio/flac') return 'flac';
  if (mime === 'audio/opus') return 'opus';
  if (mime === 'audio/pcm' || mime === 'audio/l16') return 'pcm';
  if (mime === 'audio/webm') return 'webm';
  return 'mp3';
}

/** 服务商明确以参数错误拒单时值得换一种参数组合重试一次。 */
const RETRY_STATUS = new Set([400, 404, 422]);
/** 留空音色时，若服务端要求必填 voice，用它兜底（OpenAI 兼容平台的默认音色）。 */
export const DEFAULT_SPEECH_VOICE = 'alloy';

export type SpeechRequest = {
  text: string;
  /** 留空表示用服务商默认音色（Gitee 这类没有 voice 参数的服务商必须留空）。 */
  voice?: string;
  format?: SpeechOutputFormat;
  speed?: number;
  signal?: AbortSignal;
};

export type SpeechAudio = {
  buffer: Buffer;
  contentType: string;
  /** 实际用到的音色：只有「本机离线配音」会回填（用户填的音色可能不存在，被系统音色顶替）。 */
  voice?: string;
};

/** 有些服务商出错时也回 200 + JSON，这种必须先拦下来，不能当音频存盘。 */
function looksLikeTextPayload(buffer: Buffer) {
  const head = buffer.subarray(0, 64).toString('utf8').trimStart();
  return head.startsWith('{') || head.startsWith('[') || head.startsWith('<');
}

/** 合成一句配音，返回音频字节与真实容器；调用方负责落盘与测时长。 */
export async function synthesizeSpeech(runtime: SpeechRuntime, input: SpeechRequest): Promise<SpeechAudio> {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('配音文本为空。');
  if (runtime.provider.type !== 'openai-compatible') {
    throw new Error('所选服务商暂不支持兼容的语音生成接口。');
  }
  const profile = getSpeechModelProfile(runtime.model.rawId);
  if (profile) {
    if (input.format && !profile.responseFormats.includes(input.format)) {
      throw new Error(`语音模型 ${profile.publicModel} 不支持 ${input.format} 格式。`);
    }
    if (input.speed !== undefined && !profile.speedRange) {
      throw new Error(`语音模型 ${profile.publicModel} 不支持速度参数。`);
    }
    if (input.speed !== undefined && profile.speedRange && (input.speed < profile.speedRange.min || input.speed > profile.speedRange.max)) {
      throw new Error(`语音模型 ${profile.publicModel} 的速度必须在 ${profile.speedRange.min}–${profile.speedRange.max} 之间。`);
    }
    const body: Record<string, unknown> = { model: runtime.model.rawId, input: text };
    const voice = String(input.voice || '').trim();
    if (voice) body.voice = voice;
    if (input.format) body.response_format = input.format;
    if (input.speed !== undefined) body.speed = input.speed;
    const response = await fetch(speechEndpoint(runtime.provider), {
      method: 'POST',
      headers: { ...authHeaders(runtime.provider), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: input.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`配音接口失败：HTTP ${response.status}${detail ? `（${detail.replace(/\s+/g, ' ').slice(0, 180)}）` : ''}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.byteLength) throw new Error('配音接口没有返回音频数据。');
    if (looksLikeTextPayload(buffer)) {
      throw new Error(`配音接口没有返回音频：${buffer.subarray(0, 180).toString('utf8').replace(/\s+/g, ' ').trim()}`);
    }
    return { buffer, contentType: speechContentType(buffer, response.headers.get('content-type'), input.format) };
  }
  if (input.format && input.format !== 'mp3' && input.format !== 'wav') {
    throw new Error('当前语音模型仅支持 MP3 或 WAV 格式。');
  }
  if (input.speed !== undefined) throw new Error('当前语音模型不支持速度参数。');
  const body: Record<string, unknown> = {
    model: runtime.model.rawId,
    input: text,
    response_format: input.format || 'mp3',
  };
  const voice = String(input.voice || '').trim();
  if (voice) body.voice = voice;
  const send = () => fetch(speechEndpoint(runtime.provider), {
    method: 'POST',
    headers: { ...authHeaders(runtime.provider), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  let response = await send();
  let detail = '';
  const retryable = () => !response.ok && RETRY_STATUS.has(response.status);
  if (retryable() && voice) {
    detail = await response.text().catch(() => '');
    delete body.voice;
    response = await send();
  }
  if (retryable() && !voice) {
    const attemptDetail = await response.text().catch(() => '');
    if (/voice/i.test(attemptDetail)) {
      body.voice = DEFAULT_SPEECH_VOICE;
      response = await send();
      detail = '';
    } else {
      detail = detail || attemptDetail;
    }
  }
  if (!response.ok) {
    const message = detail || await response.text().catch(() => '');
    throw new Error(`配音接口失败：HTTP ${response.status}${message ? `（${message.replace(/\s+/g, ' ').slice(0, 180)}）` : ''}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.byteLength) throw new Error('配音接口没有返回音频数据。');
  if (looksLikeTextPayload(buffer)) {
    throw new Error(`配音接口没有返回音频：${buffer.subarray(0, 180).toString('utf8').replace(/\s+/g, ' ').trim()}`);
  }
  return { buffer, contentType: speechContentType(buffer, response.headers.get('content-type'), input.format || 'mp3') };
}
