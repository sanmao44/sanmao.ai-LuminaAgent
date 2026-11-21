import { SPEECH_OUTPUT_FORMATS, SPEECH_PLATFORM_TEXT_LIMIT, type AudioArtifactPersistencePort, type AudioSynthesisPort, type AudioSynthesisRequest, type AudioSynthesisResult, type SpeechAdvancedOptionKey, type SpeechDialogueLine, type SpeechOutputFormat } from '../../packages/contracts/audio-synthesis';

const MAX_AUDIO_SYNTHESIS_TEXT_LENGTH = SPEECH_PLATFORM_TEXT_LIMIT;
export const MAX_AUDIO_SYNTHESIS_BYTES = 50 * 1024 * 1024;
const SPEECH_OPTION_LABELS: Readonly<Record<SpeechAdvancedOptionKey, string>> = {
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

export class AudioSynthesisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioSynthesisInputError';
  }
}

export class AudioSynthesisUnavailableError extends Error {
  constructor(message = '当前没有可用的配音模型或本机语音引擎。请在模型库启用配音模型后重试。') {
    super(message);
    this.name = 'AudioSynthesisUnavailableError';
  }
}

/**
 * A synchronous speech request has no provider task id to query after the
 * HTTP response is lost. Transport failures therefore stay explicitly
 * unconfirmed so the activity drawer does not encourage a duplicate charge.
 * Validation and model-availability errors remain ordinary, recoverable
 * failures.
 */
export function audioSynthesisFailureCode(error: unknown) {
  const value = error as { name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown } | null;
  const name = String(value?.name || '');
  const message = String(value?.message || error || '');
  const status = Number(value?.status ?? value?.statusCode ?? NaN);
  if (name === 'AbortError' || name === 'TimeoutError' || status >= 500 && status <= 599) {
    return 'provider_result_unconfirmed' as const;
  }
  if (/HTTP\s+5\d{2}|timeout|timed[ -]?out|超时|fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|连接中断|没有返回完整响应|请求已取消/i.test(message)) {
    return 'provider_result_unconfirmed' as const;
  }
  return undefined;
}

function parseRequest(input: unknown): AudioSynthesisRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AudioSynthesisInputError('配音请求格式无效。');
  }
  const source = input as Record<string, unknown>;
  if (typeof source.text !== 'string' || !source.text.trim()) {
    throw new AudioSynthesisInputError('请先输入配音文本。');
  }
  const text = source.text.trim();
  if (text.length > MAX_AUDIO_SYNTHESIS_TEXT_LENGTH) {
    throw new AudioSynthesisInputError(`配音文本最多 ${MAX_AUDIO_SYNTHESIS_TEXT_LENGTH} 个字符。`);
  }
  const voice = typeof source.voice === 'string' ? source.voice.trim() : '';
  if (voice.length > 100) throw new AudioSynthesisInputError('音色名称最多 100 个字符。');
  if (source.format !== undefined && (typeof source.format !== 'string' || !SPEECH_OUTPUT_FORMATS.includes(source.format as SpeechOutputFormat))) {
    throw new AudioSynthesisInputError('配音格式无效。');
  }
  if (source.speed !== undefined && (typeof source.speed !== 'number' || !Number.isFinite(source.speed))) {
    throw new AudioSynthesisInputError('配音速度必须是有限数字。');
  }
  if (source.modelId !== undefined && typeof source.modelId !== 'string') {
    throw new AudioSynthesisInputError('配音模型无效。');
  }
  const modelId = typeof source.modelId === 'string' ? source.modelId.trim() : '';
  if (modelId.length > 160) throw new AudioSynthesisInputError('配音模型 ID 最多 160 个字符。');
  const enumValue = <T extends string>(key: string, values: readonly T[]) => {
    const value = source[key];
    if (value === undefined) return undefined;
    const label = SPEECH_OPTION_LABELS[key as SpeechAdvancedOptionKey] || key;
    if (typeof value !== 'string' || !values.includes(value as T)) throw new AudioSynthesisInputError(`${label}参数无效。`);
    return value as T;
  };
  const boundedNumber = (key: string, minimum: number, maximum?: number) => {
    const value = source[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || maximum !== undefined && value > maximum) {
      throw new AudioSynthesisInputError(`${SPEECH_OPTION_LABELS[key as SpeechAdvancedOptionKey] || key}超出允许范围。`);
    }
    return value;
  };
  const booleanValue = (key: string) => {
    const value = source[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw new AudioSynthesisInputError(`${SPEECH_OPTION_LABELS[key as SpeechAdvancedOptionKey] || key}必须是开关值。`);
    return value;
  };
  const optionalString = (key: string) => {
    const value = source[key];
    if (value === undefined) return undefined;
    const label = SPEECH_OPTION_LABELS[key as SpeechAdvancedOptionKey] || key;
    if (typeof value !== 'string') throw new AudioSynthesisInputError(`${label}必须是文本。`);
    return value.trim() || undefined;
  };
  const applyTextNormalization = enumValue('applyTextNormalization', ['auto', 'on', 'off'] as const);
  const languageCode = optionalString('languageCode');
  const language = optionalString('language');
  const engine = optionalString('engine');
  const emotion = optionalString('emotion');
  const instruct = optionalString('instruct');
  const voiceId = optionalString('voiceId');
  const seed = boundedNumber('seed', 0);
  if (seed !== undefined && !Number.isInteger(seed)) throw new AudioSynthesisInputError('随机种子必须是非负整数。');
  const similarityBoost = boundedNumber('similarityBoost', 0, 1);
  const stability = boundedNumber('stability', 0, 1);
  const aigcWatermark = booleanValue('aigcWatermark');
  const bitrate = enumValue('bitrate', ['32000', '64000', '128000', '256000'] as const);
  const channel = enumValue('channel', ['1', '2'] as const);
  const effectIntensity = boundedNumber('effectIntensity', -100, 100);
  const effectPitch = boundedNumber('effectPitch', -100, 100);
  const effectTimbre = boundedNumber('effectTimbre', -100, 100);
  const latexRead = booleanValue('latexRead');
  const pitch = boundedNumber('pitch', -12, 12);
  const pronunciationTone = optionalString('pronunciationTone');
  const sampleRate = enumValue('sampleRate', ['8000', '16000', '22050', '24000', '32000', '44100'] as const);
  const soundEffects = enumValue('soundEffects', ['spacious_echo', 'auditorium_echo', 'lofi_telephone', 'robotic'] as const);
  const textNormalizationMode = enumValue('textNormalizationMode', ['basic', 'quality'] as const);
  const volume = boundedNumber('volume', 0.01, 10);
  let dialogue: SpeechDialogueLine[] | undefined;
  if (source.dialogue !== undefined) {
    if (!Array.isArray(source.dialogue) || source.dialogue.length < 1 || source.dialogue.length > 50) {
      throw new AudioSynthesisInputError('多人对白需要 1 到 50 句。');
    }
    dialogue = source.dialogue.map((line, index) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) throw new AudioSynthesisInputError(`第 ${index + 1} 句对白格式无效。`);
      const item = line as Record<string, unknown>;
      const lineText = typeof item.text === 'string' ? item.text.trim() : '';
      const lineVoice = typeof item.voice === 'string' ? item.voice.trim() : '';
      if (!lineText || !lineVoice) throw new AudioSynthesisInputError(`第 ${index + 1} 句对白需要音色和文本。`);
      return { text: lineText, voice: lineVoice };
    });
  }
  const sourceName = source.source === 'workspace' || source.source === 'agent' || source.source === 'canvas'
    ? source.source
    : undefined;
  const projectId = typeof source.projectId === 'string' ? source.projectId.trim().slice(0, 160) : '';
  const canvasId = typeof source.canvasId === 'string' ? source.canvasId.trim().slice(0, 160) : '';
  const nodeId = typeof source.nodeId === 'string' ? source.nodeId.trim().slice(0, 160) : '';
  return {
    text,
    ...(voice ? { voice } : {}),
    ...(source.format ? { format: source.format as SpeechOutputFormat } : {}),
    ...(typeof source.speed === 'number' ? { speed: source.speed } : {}),
    ...(applyTextNormalization ? { applyTextNormalization } : {}),
    ...(engine ? { engine } : {}),
    ...(languageCode ? { languageCode } : {}),
    ...(language ? { language } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(similarityBoost !== undefined ? { similarityBoost } : {}),
    ...(stability !== undefined ? { stability } : {}),
    ...(voiceId ? { voiceId } : {}),
    ...(emotion ? { emotion } : {}),
    ...(instruct ? { instruct } : {}),
    ...(dialogue ? { dialogue } : {}),
    ...(aigcWatermark !== undefined ? { aigcWatermark } : {}),
    ...(bitrate ? { bitrate } : {}),
    ...(channel ? { channel } : {}),
    ...(effectIntensity !== undefined ? { effectIntensity } : {}),
    ...(effectPitch !== undefined ? { effectPitch } : {}),
    ...(effectTimbre !== undefined ? { effectTimbre } : {}),
    ...(latexRead !== undefined ? { latexRead } : {}),
    ...(pitch !== undefined ? { pitch } : {}),
    ...(pronunciationTone ? { pronunciationTone } : {}),
    ...(sampleRate ? { sampleRate } : {}),
    ...(soundEffects ? { soundEffects } : {}),
    ...(textNormalizationMode ? { textNormalizationMode } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(modelId && modelId !== 'auto' ? { modelId } : {}),
    ...(sourceName ? { source: sourceName } : {}),
    ...(projectId ? { projectId } : {}),
    ...(canvasId ? { canvasId } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

export function audioSynthesisLogMetadata(input: unknown) {
  const request = parseRequest(input);
  return {
    prompt: request.text,
    requestedModelId: request.modelId || 'auto',
    ...(request.voice ? { voice: request.voice } : {}),
    ...(request.format ? { format: request.format } : {}),
    ...(request.speed !== undefined ? { speed: request.speed } : {}),
  };
}

function validateResult(result: AudioSynthesisResult): AudioSynthesisResult {
  if (!(result.data instanceof Uint8Array) || !result.data.byteLength) {
    throw new Error('配音服务没有返回有效音频。');
  }
  if (result.data.byteLength > MAX_AUDIO_SYNTHESIS_BYTES) {
    throw new Error('配音结果超过 50 MB，未写入画布。');
  }
  if (!/^audio\/[a-z0-9.+-]+$/i.test(result.contentType)) {
    throw new Error('配音服务返回了无法识别的音频格式。');
  }
  if (!/^[a-z0-9]{1,8}$/i.test(result.extension)) {
    throw new Error('配音服务返回了无法识别的文件扩展名。');
  }
  return result;
}

export async function synthesizeAudioRequest(
  input: unknown,
  port: AudioSynthesisPort,
  signal?: AbortSignal,
) {
  const request = parseRequest(input);
  return validateResult(await port.synthesize(request, signal));
}

export async function synthesizeAndPersistAudio(
  input: unknown,
  synthesis: AudioSynthesisPort,
  persistence: AudioArtifactPersistencePort,
  signal?: AbortSignal,
) {
  const result = await synthesizeAudioRequest(input, synthesis, signal);
  try {
    const stored = await persistence.persist(result.data, result.contentType);
    return { ...result, storageUrl: stored.url };
  } catch {
    return { ...result, storageError: '音频生成成功，但保存到媒体库失败。请先下载本次结果。' };
  }
}
