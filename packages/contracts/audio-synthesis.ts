/** Synchronous speech generation used by interactive audio creation surfaces. */
export const SPEECH_OUTPUT_FORMATS = Object.freeze([
  'mp3',
  'mp3_hq',
  'wav',
  'opus',
  'aac',
  'flac',
  'pcm',
] as const);

export type SpeechOutputFormat = typeof SPEECH_OUTPUT_FORMATS[number];

export const SPEECH_PLATFORM_TEXT_LIMIT = 10000;

export const MINIMAX_SPEECH_LANGUAGE_OPTIONS = Object.freeze([
  'auto', 'Chinese', 'Chinese,Yue', 'English', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Italian',
  'Portuguese', 'Russian', 'Arabic', 'Turkish', 'Dutch', 'Ukrainian', 'Vietnamese', 'Indonesian', 'Thai',
  'Polish', 'Romanian', 'Greek', 'Czech', 'Finnish', 'Hindi', 'Bulgarian', 'Danish', 'Hebrew', 'Malay',
  'Persian', 'Slovak', 'Swedish', 'Croatian', 'Filipino', 'Hungarian', 'Norwegian', 'Slovenian', 'Catalan',
  'Nynorsk', 'Tamil', 'Afrikaans',
] as const);
export const MINIMAX_SPEECH_BITRATE_OPTIONS = Object.freeze(['32000', '64000', '128000', '256000'] as const);
export const MINIMAX_SPEECH_CHANNEL_OPTIONS = Object.freeze(['1', '2'] as const);
export const MINIMAX_SPEECH_SAMPLE_RATE_OPTIONS = Object.freeze(['8000', '16000', '22050', '24000', '32000', '44100'] as const);
export const MINIMAX_SPEECH_EFFECT_OPTIONS = Object.freeze(['spacious_echo', 'auditorium_echo', 'lofi_telephone', 'robotic'] as const);
export const MINIMAX_SPEECH_NORMALIZATION_OPTIONS = Object.freeze(['basic', 'quality'] as const);

export type SpeechAdvancedOptionKey =
  | 'applyTextNormalization'
  | 'engine'
  | 'languageCode'
  | 'language'
  | 'seed'
  | 'similarityBoost'
  | 'stability'
  | 'voiceId'
  | 'emotion'
  | 'instruct'
  | 'dialogue'
  | 'aigcWatermark'
  | 'bitrate'
  | 'channel'
  | 'effectIntensity'
  | 'effectPitch'
  | 'effectTimbre'
  | 'latexRead'
  | 'pitch'
  | 'pronunciationTone'
  | 'sampleRate'
  | 'soundEffects'
  | 'textNormalizationMode'
  | 'volume';

export const SPEECH_VOICE_PREVIEW_TEXT = '你好，这是一段音色试听。';

export type SpeechModelProfile = {
  providerKey: 'cangyuan';
  publicModel: string;
  suggestedVoices: readonly string[];
  responseFormats: readonly SpeechOutputFormat[];
  textMaxLength?: number;
  defaultVoice?: string;
  speedRange?: { min: number; max: number };
  supportsDialogue?: boolean;
  requiresVoiceId?: boolean;
  supportsVoiceId?: boolean;
  supportsAdvancedControls?: boolean;
  engineOptions?: readonly string[];
  defaultEngine?: string;
  languageCodes?: readonly string[];
  emotionOptions?: readonly string[];
  advancedOptionKeys?: readonly SpeechAdvancedOptionKey[];
};

const SPEECH_VOICE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'gemini-tts': Object.freeze({
    Capella: '五车二', Ursa: '乌尔萨', Vega: '织女星', Eclipse: '日食', Lyra: '天琴座',
    Orbit: '轨道', Dipper: '北斗七星', Nova: '新星', Pegasus: '飞马座',
  }),
  'mu1-muse-tts': Object.freeze({
    alloy: '艾洛伊（清亮女声）', aria: '阿丽娅（清亮女声）', coral: '科拉尔（清亮女声）',
    nova: '诺娃（温暖女声）', shimmer: '希默尔（温暖女声）', sage: '塞奇（温暖女声）',
    echo: '埃科（沉稳男声）', helio: '赫利奥（沉稳男声）', onyx: '奥尼克斯（沉稳男声）',
    fable: '费布尔（叙事男声）',
  }),
  'elevenlabs-v4-tts': Object.freeze({
    Rachel: '瑞秋', Aria: '阿莉娅', Roger: '罗杰', Sarah: '莎拉', Laura: '劳拉', Charlie: '查理',
    George: '乔治', Callum: '卡勒姆', River: '里弗', Liam: '利亚姆', Charlotte: '夏洛特',
    Alice: '爱丽丝', Matilda: '玛蒂尔达', Will: '威尔', Jessica: '杰西卡', Eric: '埃里克',
    Chris: '克里斯', Brian: '布莱恩', Daniel: '丹尼尔', Lily: '莉莉', Bill: '比尔',
  }),
});

export function speechVoiceLabel(voice: string, publicModel: string): string {
  const modelCandidates = [String(publicModel || '')]
    .concat(String(publicModel || '').split(':').slice(-1))
    .concat(String(publicModel || '').split('/').slice(-1));
  for (const candidate of modelCandidates) {
    const label = SPEECH_VOICE_LABELS[candidate]?.[voice];
    if (label) return label;
  }
  return '自定义音色';
}

const SPEECH_MODEL_PROFILES: Readonly<Record<string, SpeechModelProfile>> = Object.freeze({
  'gemini-tts': Object.freeze({
    providerKey: 'cangyuan',
    publicModel: 'gemini-tts',
    suggestedVoices: Object.freeze(['Capella', 'Ursa', 'Vega', 'Eclipse', 'Lyra', 'Orbit', 'Dipper', 'Nova', 'Pegasus'] as const),
    responseFormats: Object.freeze(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const),
    speedRange: Object.freeze({ min: 0.25, max: 4 }),
  }),
  'mu1-muse-tts': Object.freeze({
    providerKey: 'cangyuan',
    publicModel: 'mu1-muse-tts',
    suggestedVoices: Object.freeze(['alloy', 'aria', 'coral', 'nova', 'shimmer', 'sage', 'echo', 'helio', 'onyx', 'fable'] as const),
    responseFormats: Object.freeze(['mp3', 'wav', 'opus', 'pcm'] as const),
  }),
  'elevenlabs-v4-tts': Object.freeze({
    providerKey: 'cangyuan',
    publicModel: 'elevenlabs-v4-tts',
    suggestedVoices: Object.freeze(['Rachel', 'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte', 'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill'] as const),
    responseFormats: Object.freeze(['mp3', 'mp3_hq', 'opus'] as const),
    textMaxLength: 4000,
    defaultVoice: 'Rachel',
    supportsVoiceId: true,
    supportsAdvancedControls: true,
    engineOptions: Object.freeze(['v4', 'turbo'] as const),
    defaultEngine: 'v4',
    languageCodes: Object.freeze(['auto', 'ru', 'en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'uk', 'tr', 'zh', 'ja', 'ko'] as const),
    advancedOptionKeys: Object.freeze(['applyTextNormalization', 'engine', 'languageCode', 'seed', 'similarityBoost', 'stability', 'voiceId'] as const),
  }),
  'elevenlabs-dialogue': Object.freeze({
    providerKey: 'cangyuan',
    publicModel: 'elevenlabs-dialogue',
    suggestedVoices: Object.freeze([] as const),
    responseFormats: Object.freeze([] as const),
    textMaxLength: 4000,
    supportsDialogue: true,
    supportsAdvancedControls: true,
    advancedOptionKeys: Object.freeze(['dialogue', 'stability'] as const),
  }),
  'voice-clone-tts': Object.freeze({
    providerKey: 'cangyuan',
    publicModel: 'voice-clone-tts',
    suggestedVoices: Object.freeze([] as const),
    responseFormats: Object.freeze(['mp3', 'wav'] as const),
    textMaxLength: 4000,
    requiresVoiceId: true,
    supportsVoiceId: true,
    supportsAdvancedControls: true,
    defaultEngine: 'qwen3',
    languageCodes: Object.freeze(['auto', 'ru', 'en', 'de', 'fr', 'es', 'it', 'pt', 'zh', 'ja', 'ko'] as const),
    emotionOptions: Object.freeze(['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'] as const),
    advancedOptionKeys: Object.freeze(['engine', 'language', 'seed', 'similarityBoost', 'stability', 'voiceId', 'emotion', 'instruct'] as const),
    engineOptions: Object.freeze(['qwen3', 'chatterbox', 'elevenlabs-v4', 'elevenlabs-v4-turbo'] as const),
  }),
  'minimax-speech-2.8-hd-tts': Object.freeze({
    providerKey: 'cangyuan',
    publicModel: 'minimax-speech-2.8-hd-tts',
    suggestedVoices: Object.freeze([] as const),
    responseFormats: Object.freeze(['mp3', 'wav', 'flac'] as const),
    textMaxLength: 10000,
    speedRange: Object.freeze({ min: 0.5, max: 2 }),
    requiresVoiceId: true,
    supportsVoiceId: true,
    supportsAdvancedControls: true,
    languageCodes: MINIMAX_SPEECH_LANGUAGE_OPTIONS,
    emotionOptions: Object.freeze(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent', 'whisper'] as const),
    advancedOptionKeys: Object.freeze(['voiceId', 'emotion', 'language', 'aigcWatermark', 'bitrate', 'channel', 'effectIntensity', 'effectPitch', 'effectTimbre', 'latexRead', 'pitch', 'pronunciationTone', 'sampleRate', 'soundEffects', 'textNormalizationMode', 'volume'] as const),
  }),
  'minimax-speech-2.8-turbo-tts': Object.freeze({
    providerKey: 'cangyuan',
    publicModel: 'minimax-speech-2.8-turbo-tts',
    suggestedVoices: Object.freeze([] as const),
    responseFormats: Object.freeze(['mp3', 'wav', 'flac'] as const),
    textMaxLength: 10000,
    speedRange: Object.freeze({ min: 0.5, max: 2 }),
    requiresVoiceId: true,
    supportsVoiceId: true,
    supportsAdvancedControls: true,
    languageCodes: MINIMAX_SPEECH_LANGUAGE_OPTIONS,
    emotionOptions: Object.freeze(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent', 'whisper'] as const),
    advancedOptionKeys: Object.freeze(['voiceId', 'emotion', 'language', 'aigcWatermark', 'bitrate', 'channel', 'effectIntensity', 'effectPitch', 'effectTimbre', 'latexRead', 'pitch', 'pronunciationTone', 'sampleRate', 'soundEffects', 'textNormalizationMode', 'volume'] as const),
  }),
});

export const SPEECH_MODEL_PROFILE_LIST: readonly SpeechModelProfile[] = Object.freeze(Object.values(SPEECH_MODEL_PROFILES));

export function getSpeechModelProfile(publicModel: string, providerKey?: string): SpeechModelProfile | null {
  const normalizedModel = speechPublicModelId(publicModel);
  const profile = SPEECH_MODEL_PROFILES[normalizedModel];
  return profile?.providerKey === providerKey ? profile : null;
}

export function speechPublicModelId(modelId: string): string {
  return String(modelId || '').split(':').at(-1)?.split('/').at(-1) || '';
}

export function getSpeechModelResponseFormats(publicModel: string, engine?: string, providerKey?: string): readonly SpeechOutputFormat[] {
  const profile = getSpeechModelProfile(publicModel, providerKey);
  if (!profile) return SPEECH_OUTPUT_FORMATS;
  if (profile.publicModel !== 'voice-clone-tts') return profile.responseFormats;
  const selected = (engine || profile.defaultEngine || '').toLowerCase();
  if (selected === 'elevenlabs-v4' || selected === 'elevenlabs-v4-turbo') return ['mp3', 'wav', 'opus', 'pcm'];
  return ['mp3', 'wav'];
}

export function getSpeechModelSpeedRange(publicModel: string, engine?: string, providerKey?: string) {
  const profile = getSpeechModelProfile(publicModel, providerKey);
  if (!profile) return undefined;
  if (profile.publicModel === 'voice-clone-tts') {
    // Live verification on 2026-11-24: Qwen3 and Chatterbox reject even speed=1
    // with HTTP 422, despite the public documentation advertising 0.5–2.
    return /^elevenlabs-v4(?:-turbo)?$/i.test(engine || '') ? { min: 0.7, max: 1.2 } : undefined;
  }
  return profile.speedRange;
}

export function getSpeechModelAdvancedOptions(publicModel: string, options: SpeechAdvancedOptions, providerKey?: string): SpeechAdvancedOptions {
  const profile = getSpeechModelProfile(publicModel, providerKey);
  if (!profile) return {};
  const allowed = profile.advancedOptionKeys || [];
  return Object.fromEntries(Object.entries(options).filter(([key, value]) =>
    value !== undefined && allowed.includes(key as SpeechAdvancedOptionKey),
  )) as SpeechAdvancedOptions;
}

export type AudioSynthesisRequest = {
  text: string;
  voice?: string;
  format?: SpeechOutputFormat;
  speed?: number;
  applyTextNormalization?: 'auto' | 'on' | 'off';
  engine?: string;
  languageCode?: string;
  language?: string;
  seed?: number;
  similarityBoost?: number;
  stability?: number;
  voiceId?: string;
  emotion?: string;
  instruct?: string;
  dialogue?: readonly SpeechDialogueLine[];
  aigcWatermark?: boolean;
  bitrate?: typeof MINIMAX_SPEECH_BITRATE_OPTIONS[number];
  channel?: typeof MINIMAX_SPEECH_CHANNEL_OPTIONS[number];
  effectIntensity?: number;
  effectPitch?: number;
  effectTimbre?: number;
  latexRead?: boolean;
  pitch?: number;
  pronunciationTone?: string;
  sampleRate?: typeof MINIMAX_SPEECH_SAMPLE_RATE_OPTIONS[number];
  soundEffects?: typeof MINIMAX_SPEECH_EFFECT_OPTIONS[number];
  textNormalizationMode?: typeof MINIMAX_SPEECH_NORMALIZATION_OPTIONS[number];
  volume?: number;
  modelId?: string;
  source?: 'workspace' | 'agent' | 'canvas';
  projectId?: string;
  canvasId?: string;
  nodeId?: string;
};

export type SpeechDialogueLine = {
  text: string;
  voice: string;
};

export type SpeechAdvancedOptions = Pick<AudioSynthesisRequest, 'applyTextNormalization' | 'engine' | 'languageCode' | 'language' | 'seed' | 'similarityBoost' | 'stability' | 'voiceId' | 'emotion' | 'instruct' | 'dialogue' | 'aigcWatermark' | 'bitrate' | 'channel' | 'effectIntensity' | 'effectPitch' | 'effectTimbre' | 'latexRead' | 'pitch' | 'pronunciationTone' | 'sampleRate' | 'soundEffects' | 'textNormalizationMode' | 'volume'>;

export type AudioSynthesisResult = {
  data: Uint8Array;
  contentType: string;
  extension: string;
  engine: 'provider' | 'offline';
  /** Stable media-library URL for playback and generation history. */
  storageUrl?: string;
  /** Persistence failures must not discard audio already generated by a provider. */
  storageError?: string;
  modelName?: string;
  modelId?: string;
};

export interface AudioArtifactPersistencePort {
  persist(data: Uint8Array, contentType: string): Promise<{ url: string }>;
}

export interface AudioSynthesisPort {
  synthesize(input: AudioSynthesisRequest, signal?: AbortSignal): Promise<AudioSynthesisResult>;
}
