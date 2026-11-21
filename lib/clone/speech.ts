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
import { isCangyuanProvider } from '../cangyuan-provider';
import { getRuntimeModelCandidates } from '../store';
import { getSpeechModelAdvancedOptions, getSpeechModelProfile, getSpeechModelResponseFormats, getSpeechModelSpeedRange, type AudioSynthesisRequest, type SpeechAdvancedOptionKey, type SpeechAdvancedOptions, type SpeechOutputFormat } from '../../packages/contracts/audio-synthesis';

export type SpeechRuntime = NonNullable<Awaited<ReturnType<typeof getRuntimeModelCandidates>>[number]>;

const SPEECH_ADVANCED_OPTION_LABELS: Readonly<Record<SpeechAdvancedOptionKey, string>> = {
  applyTextNormalization: '数字与日期读法',
  engine: '语音引擎',
  languageCode: '朗读语言',
  language: '声音语言',
  seed: '随机种子',
  similarityBoost: '音色相似度',
  stability: '稳定度',
  voiceId: '已登记音色编号',
  emotion: '情绪',
  instruct: '语气说明',
  dialogue: '多人对白',
  aigcWatermark: '生成内容水印',
  bitrate: '音频比特率',
  channel: '声道数',
  effectIntensity: '力度效果',
  effectPitch: '音高效果',
  effectTimbre: '音色效果',
  latexRead: '公式朗读',
  pitch: '音高',
  pronunciationTone: '发音标注',
  sampleRate: '采样率',
  soundEffects: '声音效果',
  textNormalizationMode: '文本规范化方式',
  volume: '音量',
};

const SPEECH_ADVANCED_OPTION_KEYS = Object.keys(SPEECH_ADVANCED_OPTION_LABELS);

export async function resolveSpeechRuntime(modelId: string | null = null) {
  const candidates = await getRuntimeModelCandidates(modelId, 'audio');
  return candidates.find((runtime) => runtime.model.capabilities.includes('speech')) ?? null;
}

export function speechEndpoint(provider: RuntimeProvider, modelId?: string) {
  let base = runtimeBaseUrl(provider).replace(/\/+$/, '');
  if (isCangyuanProvider(provider) && /^minimax-speech-2\.8-(?:hd|turbo)-tts$/i.test(modelId || '')) {
    // Cangyuan documents MiniMax TTS on its public API host, separate from the console host.
    base = base.replace(/^https:\/\/ai\.cangyuansuanli\.cn(?=\/|$)/i, 'https://direct-api.cangyuansuanli.cn');
  }
  return /\/v1$/i.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

/** 判断音频容器：优先响应头，响应头不靠谱时按文件头兜底。 */
const SPEECH_FORMAT_CONTENT_TYPES: Readonly<Record<SpeechOutputFormat, string>> = Object.freeze({
  mp3: 'audio/mpeg',
  mp3_hq: 'audio/mpeg',
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
/** 留空音色时，若服务端要求必填 voice，用它兜底（OpenAI 兼容平台的默认音色）。 */

export type SpeechRequest = Pick<AudioSynthesisRequest, 'text' | 'voice' | 'format' | 'speed'> & SpeechAdvancedOptions & { signal?: AbortSignal };

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
  const providerKey = isCangyuanProvider(runtime.provider) ? 'cangyuan' : undefined;
  const profile = getSpeechModelProfile(runtime.model.rawId, providerKey);
  if (profile) {
    if (profile.textMaxLength !== undefined && text.length > profile.textMaxLength) {
      throw new Error(`语音模型 ${profile.publicModel} 的正文最多 ${profile.textMaxLength} 个字符。`);
    }
    if (input.format && !getSpeechModelResponseFormats(profile.publicModel, input.engine, providerKey).includes(input.format)) {
      throw new Error(`语音模型 ${profile.publicModel} 不支持 ${input.format} 格式。`);
    }
    const unsupportedOptions = Object.entries(input).filter(([key, value]) =>
      value !== undefined
      && SPEECH_ADVANCED_OPTION_KEYS.includes(key)
      && !profile.advancedOptionKeys?.includes(key as SpeechAdvancedOptionKey),
    );
    if (unsupportedOptions.length) throw new Error(`当前配音型号不支持这些设置：${unsupportedOptions.map(([key]) => SPEECH_ADVANCED_OPTION_LABELS[key as SpeechAdvancedOptionKey]).join('、')}。`);
    if (input.engine && profile.engineOptions && !profile.engineOptions.includes(input.engine)) throw new Error('所选语音引擎不在当前型号支持范围内。');
    if (input.languageCode && profile.languageCodes && !profile.languageCodes.includes(input.languageCode)) throw new Error('所选朗读语言不受当前型号支持。');
    if (input.language && profile.languageCodes && !profile.languageCodes.includes(input.language)) throw new Error('所选声音语言不受当前型号支持。');
    if (input.emotion && profile.emotionOptions && !profile.emotionOptions.includes(input.emotion)) throw new Error('所选情绪不受当前型号支持。');
    if (input.seed !== undefined && (!Number.isInteger(input.seed) || input.seed < 0)) throw new Error('随机种子必须是非负整数。');
    if (input.bitrate && !['32000', '64000', '128000', '256000'].includes(input.bitrate)) throw new Error('所选音频比特率不受当前型号支持。');
    if (input.channel && !['1', '2'].includes(input.channel)) throw new Error('所选声道数不受当前型号支持。');
    if (input.sampleRate && !['8000', '16000', '22050', '24000', '32000', '44100'].includes(input.sampleRate)) throw new Error('所选采样率不受当前型号支持。');
    if (input.soundEffects && !['spacious_echo', 'auditorium_echo', 'lofi_telephone', 'robotic'].includes(input.soundEffects)) throw new Error('所选声音效果不受当前型号支持。');
    if (input.textNormalizationMode && !['basic', 'quality'].includes(input.textNormalizationMode)) throw new Error('所选文本规范化方式不受当前型号支持。');
    if (input.bitrate && input.format && input.format !== 'mp3') throw new Error('音频比特率仅支持 MP3 格式。');
    for (const [key, value, min, max] of [
      ['effectIntensity', input.effectIntensity, -100, 100],
      ['effectPitch', input.effectPitch, -100, 100],
      ['effectTimbre', input.effectTimbre, -100, 100],
      ['pitch', input.pitch, -12, 12],
      ['volume', input.volume, 0.01, 10],
    ] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) {
        throw new Error(`${SPEECH_ADVANCED_OPTION_LABELS[key]}超出允许范围。`);
      }
    }
    if (profile.supportsDialogue && (!input.dialogue?.length || input.dialogue.length > 50)) throw new Error('多人对白需要 1 到 50 句。');
    if (!profile.supportsDialogue && input.dialogue?.length) throw new Error('当前配音型号不支持多人对白。');
    if (input.voice && (profile.supportsDialogue || profile.requiresVoiceId)) throw new Error('当前配音型号使用对白音色或已登记的音色编号，不能再传预设音色。');
    const speedRange = getSpeechModelSpeedRange(profile.publicModel, input.engine, providerKey);
    if (input.speed !== undefined && !speedRange) {
      throw new Error(`语音模型 ${profile.publicModel} 不支持速度参数。`);
    }
    if (input.speed !== undefined && speedRange && (input.speed < speedRange.min || input.speed > speedRange.max)) {
      throw new Error(`语音模型 ${profile.publicModel} 的速度必须在 ${speedRange.min}–${speedRange.max} 之间。`);
    }
    if (profile.requiresVoiceId && !input.voiceId?.trim()) throw new Error('声音克隆模型必须填写已登记的音色编号。');
    const advancedOptions = getSpeechModelAdvancedOptions(profile.publicModel, input, providerKey);
    const body: Record<string, unknown> = { model: runtime.model.rawId, input: text };
    const voice = String(input.voice || '').trim();
    if (voice && !advancedOptions.voiceId && !profile.supportsDialogue && !profile.requiresVoiceId) body.voice = voice;
    if (input.format) body.response_format = input.format;
    if (input.speed !== undefined) body.speed = input.speed;
    if (advancedOptions.applyTextNormalization) body.apply_text_normalization = advancedOptions.applyTextNormalization;
    if (advancedOptions.engine) body.engine = advancedOptions.engine;
    if (advancedOptions.languageCode) body.language_code = advancedOptions.languageCode;
    if (advancedOptions.language) body.language = advancedOptions.language;
    if (advancedOptions.seed !== undefined) body.seed = advancedOptions.seed;
    if (advancedOptions.similarityBoost !== undefined) body.similarity_boost = advancedOptions.similarityBoost;
    if (advancedOptions.stability !== undefined) body.stability = advancedOptions.stability;
    if (advancedOptions.voiceId) body.voice_id = advancedOptions.voiceId;
    if (advancedOptions.emotion) body.emotion = advancedOptions.emotion;
    if (advancedOptions.instruct) body.instruct = advancedOptions.instruct;
    if (advancedOptions.dialogue?.length) body.dialogue = advancedOptions.dialogue;
    if (advancedOptions.aigcWatermark !== undefined) body.aigc_watermark = advancedOptions.aigcWatermark;
    if (advancedOptions.bitrate) body.bitrate = advancedOptions.bitrate;
    if (advancedOptions.channel) body.channel = advancedOptions.channel;
    if (advancedOptions.effectIntensity !== undefined) body.effect_intensity = advancedOptions.effectIntensity;
    if (advancedOptions.effectPitch !== undefined) body.effect_pitch = advancedOptions.effectPitch;
    if (advancedOptions.effectTimbre !== undefined) body.effect_timbre = advancedOptions.effectTimbre;
    if (advancedOptions.latexRead !== undefined) body.latex_read = advancedOptions.latexRead;
    if (advancedOptions.pitch !== undefined) body.pitch = advancedOptions.pitch;
    if (advancedOptions.pronunciationTone) body.pronunciation_tone = advancedOptions.pronunciationTone;
    if (advancedOptions.sampleRate) body.sample_rate = advancedOptions.sampleRate;
    if (advancedOptions.soundEffects) body.sound_effects = advancedOptions.soundEffects;
    if (advancedOptions.textNormalizationMode) body.text_normalization_mode = advancedOptions.textNormalizationMode;
    if (advancedOptions.volume !== undefined) body.volume = advancedOptions.volume;
    const response = await fetch(speechEndpoint(runtime.provider, runtime.model.rawId), {
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
  const unsupportedOptions = Object.entries(input).filter(([key, value]) =>
    value !== undefined
    && SPEECH_ADVANCED_OPTION_KEYS.includes(key),
  );
  if (unsupportedOptions.length) throw new Error(`所选服务商未为此模型确认这些设置：${unsupportedOptions.map(([key]) => SPEECH_ADVANCED_OPTION_LABELS[key as SpeechAdvancedOptionKey]).join('、')}。`);
  const body: Record<string, unknown> = {
    model: runtime.model.rawId,
    input: text,
    response_format: input.format || 'mp3',
  };
  const voice = String(input.voice || '').trim();
  if (voice) body.voice = voice;
  const response = await fetch(speechEndpoint(runtime.provider, runtime.model.rawId), {
    method: 'POST',
    headers: { ...authHeaders(runtime.provider), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`配音接口失败：HTTP ${response.status}${message ? `（${message.replace(/\s+/g, ' ').slice(0, 180)}）` : ''}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.byteLength) throw new Error('配音接口没有返回音频数据。');
  if (looksLikeTextPayload(buffer)) {
    throw new Error(`配音接口没有返回音频：${buffer.subarray(0, 180).toString('utf8').replace(/\s+/g, ' ').trim()}`);
  }
  return { buffer, contentType: speechContentType(buffer, response.headers.get('content-type'), input.format || 'mp3') };
}
