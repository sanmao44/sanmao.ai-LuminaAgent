import {
  SPEECH_VOICE_REGISTRATION_MODELS,
  type SpeechVoiceListInput,
  type SpeechVoicePreviewInput,
  type SpeechVoicePreviewResult,
  type SpeechVoiceRecord,
  type SpeechVoiceRegistrationInput,
  type SpeechVoiceRegistryPort,
} from '../../packages/contracts/audio-voice-registration';

export class SpeechVoiceRegistrationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechVoiceRegistrationInputError';
  }
}

export class SpeechVoiceRegistrationUnavailableError extends Error {
  constructor(message = '所选配音模型不支持声音克隆登记。') {
    super(message);
    this.name = 'SpeechVoiceRegistrationUnavailableError';
  }
}

export class SpeechVoiceProviderError extends Error {
  readonly resultUnconfirmed: boolean;

  constructor(message: string, resultUnconfirmed = false) {
    super(message);
    this.name = 'SpeechVoiceProviderError';
    this.resultUnconfirmed = resultUnconfirmed;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function registrationModel(value: unknown) {
  return typeof value === 'string'
    && SPEECH_VOICE_REGISTRATION_MODELS.includes(value as SpeechVoiceRegistrationInput['registrationModel'])
    ? value as SpeechVoiceRegistrationInput['registrationModel']
    : null;
}

function modelId(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 240) throw new SpeechVoiceRegistrationInputError('请选择有效的配音模型。');
  return normalized;
}

function parseVoiceListInput(value: unknown): SpeechVoiceListInput {
  if (!isRecord(value)) throw new SpeechVoiceRegistrationInputError('音色列表请求格式无效。');
  const model = registrationModel(value.registrationModel);
  if (!model) throw new SpeechVoiceRegistrationInputError('声音克隆型号无效。');
  return { modelId: modelId(value.modelId), registrationModel: model };
}

function parsePreviewInput(value: unknown): SpeechVoicePreviewInput {
  if (!isRecord(value)) throw new SpeechVoiceRegistrationInputError('音色试听请求格式无效。');
  const model = registrationModel(value.registrationModel);
  if (!model) throw new SpeechVoiceRegistrationInputError('声音克隆型号无效。');
  const previewUrl = typeof value.previewUrl === 'string' ? value.previewUrl.trim() : '';
  let url: URL;
  try { url = new URL(previewUrl); } catch {
    throw new SpeechVoiceRegistrationInputError('官方音色试听地址无效。');
  }
  if (previewUrl.length > 2048 || url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
    throw new SpeechVoiceRegistrationInputError('官方音色试听地址无效。');
  }
  return { modelId: modelId(value.modelId), registrationModel: model, previewUrl: url.toString() };
}

function parseRegistrationInput(value: unknown): SpeechVoiceRegistrationInput {
  if (!isRecord(value)) throw new SpeechVoiceRegistrationInputError('声音登记请求格式无效。');
  const model = registrationModel(value.registrationModel);
  if (!model) throw new SpeechVoiceRegistrationInputError('声音克隆型号无效。');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 80) throw new SpeechVoiceRegistrationInputError('音色名称不能为空，且最多 80 个字符。');
  let url: URL;
  try { url = new URL(typeof value.url === 'string' ? value.url.trim() : ''); } catch {
    throw new SpeechVoiceRegistrationInputError('请提供可公开访问的音频地址。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new SpeechVoiceRegistrationInputError('音频地址必须是公开可访问的 HTTP 或 HTTPS 地址。');
  }
  if (value.consent !== true) throw new SpeechVoiceRegistrationInputError('登记前必须确认录音本人所有或已取得说话人明确授权。');
  return {
    modelId: modelId(value.modelId),
    registrationModel: model,
    name,
    url: url.toString(),
    consent: true,
  };
}

export async function registerSpeechVoice(value: unknown, port: SpeechVoiceRegistryPort, signal?: AbortSignal) {
  return port.register(parseRegistrationInput(value), signal);
}

export async function listSpeechVoices(value: unknown, port: SpeechVoiceRegistryPort, signal?: AbortSignal) {
  const input = parseVoiceListInput(value);
  if (!input.registrationModel.startsWith('minimax-')) return port.list(input, signal);

  const counterpart = input.registrationModel === 'minimax-speech-2.8-hd-clone'
    ? 'minimax-speech-2.8-turbo-clone'
    : 'minimax-speech-2.8-hd-clone';
  const lists = await Promise.all([
    port.list(input, signal),
    port.list({ ...input, registrationModel: counterpart }, signal),
  ]);
  const merged = new Map<string, SpeechVoiceRecord>();
  for (const voice of lists.flat()) {
    const previous = merged.get(voice.voiceId);
    if (!previous) {
      merged.set(voice.voiceId, voice);
    } else if (!previous.previewUrl && voice.previewUrl) {
      merged.set(voice.voiceId, { ...previous, previewUrl: voice.previewUrl });
    }
  }
  return [...merged.values()];
}

export async function previewSpeechVoice(value: unknown, port: SpeechVoiceRegistryPort, signal?: AbortSignal): Promise<SpeechVoicePreviewResult> {
  return port.preview(parsePreviewInput(value), signal);
}
