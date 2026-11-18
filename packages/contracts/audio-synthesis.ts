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

export const SPEECH_PLATFORM_TEXT_LIMIT = 5000;

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
  | 'dialogue';

export const SPEECH_VOICE_PREVIEW_TEXT = '你好，这是一段音色试听。';

export type SpeechModelProfile = {
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
    publicModel: 'gemini-tts',
    suggestedVoices: Object.freeze(['Capella', 'Ursa', 'Vega', 'Eclipse', 'Lyra', 'Orbit', 'Dipper', 'Nova', 'Pegasus'] as const),
    responseFormats: Object.freeze(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const),
    speedRange: Object.freeze({ min: 0.25, max: 4 }),
  }),
  'mu1-muse-tts': Object.freeze({
    publicModel: 'mu1-muse-tts',
    suggestedVoices: Object.freeze(['alloy', 'aria', 'coral', 'nova', 'shimmer', 'sage', 'echo', 'helio', 'onyx', 'fable'] as const),
    responseFormats: Object.freeze(['mp3', 'wav', 'opus', 'pcm'] as const),
  }),
  'elevenlabs-v4-tts': Object.freeze({
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
    publicModel: 'elevenlabs-dialogue',
    suggestedVoices: Object.freeze([] as const),
    responseFormats: Object.freeze([] as const),
    textMaxLength: 4000,
    supportsDialogue: true,
    supportsAdvancedControls: true,
    advancedOptionKeys: Object.freeze(['dialogue', 'stability'] as const),
  }),
  'voice-clone-tts': Object.freeze({
    publicModel: 'voice-clone-tts',
    suggestedVoices: Object.freeze([] as const),
    responseFormats: Object.freeze(['mp3', 'wav'] as const),
    textMaxLength: 4000,
    speedRange: Object.freeze({ min: 0.5, max: 2 }),
    requiresVoiceId: true,
    supportsVoiceId: true,
    supportsAdvancedControls: true,
    defaultEngine: 'qwen3',
    languageCodes: Object.freeze(['auto', 'ru', 'en', 'de', 'fr', 'es', 'it', 'pt', 'zh', 'ja', 'ko'] as const),
    emotionOptions: Object.freeze(['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'] as const),
    advancedOptionKeys: Object.freeze(['engine', 'language', 'seed', 'similarityBoost', 'stability', 'voiceId', 'emotion', 'instruct'] as const),
    engineOptions: Object.freeze(['qwen3', 'chatterbox', 'minimax-speech-02-hd', 'minimax-speech-02-turbo', 'minimax-speech-2.6-hd', 'minimax-speech-2.6-turbo', 'minimax-speech-2.8-hd', 'minimax-speech-2.8-turbo', 'elevenlabs-v4', 'elevenlabs-v4-turbo'] as const),
  }),
});

export function getSpeechModelProfile(publicModel: string): SpeechModelProfile | null {
  return SPEECH_MODEL_PROFILES[String(publicModel || '')] || null;
}

export function speechPublicModelId(modelId: string): string {
  return String(modelId || '').split(':').at(-1)?.split('/').at(-1) || '';
}

export function getSpeechModelResponseFormats(publicModel: string, engine?: string): readonly SpeechOutputFormat[] {
  const profile = getSpeechModelProfile(publicModel);
  if (!profile) return SPEECH_OUTPUT_FORMATS;
  if (profile.publicModel !== 'voice-clone-tts') return profile.responseFormats;
  const selected = (engine || profile.defaultEngine || '').toLowerCase();
  if (selected === 'elevenlabs-v4' || selected === 'elevenlabs-v4-turbo') return ['mp3', 'wav', 'opus', 'pcm'];
  if (/minimax-speech-.*-(?:hd|turbo)$/.test(selected)) return ['mp3', 'flac'];
  return ['mp3', 'wav'];
}

export function getSpeechModelSpeedRange(publicModel: string, engine?: string) {
  const profile = getSpeechModelProfile(publicModel);
  if (!profile) return undefined;
  if (profile.publicModel === 'voice-clone-tts' && /^elevenlabs-v4(?:-turbo)?$/i.test(engine || '')) return { min: 0.7, max: 1.2 };
  return profile.speedRange;
}

export function getSpeechModelAdvancedOptions(publicModel: string, options: SpeechAdvancedOptions): SpeechAdvancedOptions {
  const profile = getSpeechModelProfile(publicModel);
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

export type SpeechAdvancedOptions = Pick<AudioSynthesisRequest, 'applyTextNormalization' | 'engine' | 'languageCode' | 'language' | 'seed' | 'similarityBoost' | 'stability' | 'voiceId' | 'emotion' | 'instruct' | 'dialogue'>;

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
