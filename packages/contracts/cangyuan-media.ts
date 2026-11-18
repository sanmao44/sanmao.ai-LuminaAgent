import type { TaskState } from './task';

export type CangyuanMediaKind = 'music' | '3d';
export type CangyuanMediaTaskStatus = Extract<TaskState, 'pending' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'>;

export const CANGYUAN_MUSIC_OPTION_KEYS = Object.freeze([
  'uploadUrl',
  'uploadUrls',
  'continueAt',
  'infillStartS',
  'infillEndS',
  'audioUrl',
  'stemType',
  'sourceTaskId',
  'sourceAudioId',
  'sourceTrack',
  'instrumental',
  'n',
  'title',
  'lyrics',
  'style_text',
  'duration',
  'seed',
  'bpm',
  'audio_format',
  'audioWeight',
  'negativeTags',
  'personaId',
  'personaName',
  'personaDescription',
  'personaModel',
  'customMode',
  'tags',
  'stemName',
  'styleWeight',
  'version',
  'vocalGender',
  'weirdnessConstraint',
  'sound_key',
  'sound_loop',
  'sound_tempo',
] as const);

export type CangyuanMusicOptionKey = typeof CANGYUAN_MUSIC_OPTION_KEYS[number];
export type CangyuanMusicModelProfile = {
  modelId: string;
  family: 'su2' | 'suno-v6' | 'lyria' | 'suno-sfx' | 'suno-workflow';
  supportsReferences: false;
  promptRequired: boolean;
  promptMaxLength?: number;
  titleMaxLength?: number;
  allowedOptions: readonly CangyuanMusicOptionKey[];
};

const SU2_MUSIC_OPTIONS = Object.freeze(['instrumental', 'n'] as const);
const SUNO_V6_MUSIC_OPTIONS = Object.freeze([
  'instrumental', 'n', 'title', 'style_text', 'duration', 'audioWeight',
  'negativeTags', 'personaId', 'personaModel', 'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
] as const);
const LYRIA_MUSIC_OPTIONS = Object.freeze(['title', 'lyrics', 'instrumental', 'seed', 'duration', 'bpm', 'audio_format', 'n'] as const);
const SUNO_SFX_OPTIONS = Object.freeze(['n', 'sound_key', 'sound_loop', 'sound_tempo', 'version'] as const);
const SUNO_LYRICS_OPTIONS = Object.freeze([] as const);
const SUNO_STYLE_BOOST_OPTIONS = Object.freeze([] as const);
const SUNO_EXTEND_OPTIONS = Object.freeze([
  'uploadUrl', 'continueAt', 'title', 'style_text', 'instrumental', 'audioWeight', 'negativeTags', 'personaId',
  'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
] as const);
const SUNO_ADD_INSTRUMENTAL_OPTIONS = Object.freeze([
  'uploadUrl', 'title', 'audioWeight', 'negativeTags', 'styleWeight', 'tags', 'version', 'vocalGender', 'weirdnessConstraint',
] as const);
const SUNO_ADD_VOCALS_OPTIONS = Object.freeze([
  'uploadUrl', 'title', 'style_text', 'audioWeight', 'negativeTags', 'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
] as const);
const SUNO_COVER_AUDIO_OPTIONS = Object.freeze([
  'uploadUrl', 'sourceTaskId', 'sourceAudioId', 'sourceTrack', 'title', 'style_text', 'instrumental', 'audioWeight',
  'customMode', 'negativeTags', 'personaId', 'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
] as const);
const SUNO_COVER_GENERATE_OPTIONS = Object.freeze(['sourceTaskId'] as const);
const SUNO_MASHUP_OPTIONS = Object.freeze([
  'uploadUrls', 'title', 'style_text', 'instrumental', 'audioWeight', 'customMode', 'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
] as const);
const SUNO_REPLACE_SECTION_OPTIONS = Object.freeze([
  'sourceTaskId', 'sourceAudioId', 'sourceTrack', 'infillStartS', 'infillEndS', 'title', 'lyrics', 'negativeTags', 'tags',
] as const);
const SUNO_STEM_OPTIONS = Object.freeze(['audioUrl', 'stemType', 'stemName'] as const);
const SUNO_PERSONA_OPTIONS = Object.freeze(['sourceTaskId', 'sourceAudioId', 'sourceTrack', 'personaName', 'personaDescription'] as const);
const SUNO_MIDI_OPTIONS = Object.freeze(['sourceTaskId', 'sourceAudioId', 'sourceTrack'] as const);
const SUNO_WAV_OPTIONS = Object.freeze(['sourceTaskId', 'sourceAudioId', 'sourceTrack'] as const);
const SUNO_TIMESTAMPED_LYRICS_OPTIONS = Object.freeze(['sourceTaskId', 'sourceAudioId', 'sourceTrack'] as const);

const workflowProfile = (modelId: string, allowedOptions: readonly CangyuanMusicOptionKey[], promptRequired = false): CangyuanMusicModelProfile => Object.freeze({
  modelId,
  family: 'suno-workflow',
  supportsReferences: false,
  promptRequired,
  allowedOptions: Object.freeze([...allowedOptions, 'n'] as CangyuanMusicOptionKey[]),
});

const CANGYUAN_MUSIC_MODEL_PROFILES: Readonly<Record<string, CangyuanMusicModelProfile>> = Object.freeze({
  'su2-suno-v6': Object.freeze({ modelId: 'su2-suno-v6', family: 'su2', supportsReferences: false, promptRequired: true, promptMaxLength: 3_000, allowedOptions: SU2_MUSIC_OPTIONS }),
  'su2-suno-v6-mini': Object.freeze({ modelId: 'su2-suno-v6-mini', family: 'su2', supportsReferences: false, promptRequired: true, promptMaxLength: 3_000, allowedOptions: SU2_MUSIC_OPTIONS }),
  'su2-suno-v6-wild': Object.freeze({ modelId: 'su2-suno-v6-wild', family: 'su2', supportsReferences: false, promptRequired: true, promptMaxLength: 3_000, allowedOptions: SU2_MUSIC_OPTIONS }),
  'suno-v6': Object.freeze({ modelId: 'suno-v6', family: 'suno-v6', supportsReferences: false, promptRequired: true, allowedOptions: SUNO_V6_MUSIC_OPTIONS }),
  'lyria-3.5': Object.freeze({ modelId: 'lyria-3.5', family: 'lyria', supportsReferences: false, promptRequired: true, promptMaxLength: 10_000, titleMaxLength: 160, allowedOptions: LYRIA_MUSIC_OPTIONS }),
  'lyria-3-pro': Object.freeze({ modelId: 'lyria-3-pro', family: 'lyria', supportsReferences: false, promptRequired: true, promptMaxLength: 10_000, titleMaxLength: 160, allowedOptions: LYRIA_MUSIC_OPTIONS }),
  'suno-sfx': Object.freeze({ modelId: 'suno-sfx', family: 'suno-sfx', supportsReferences: false, promptRequired: true, allowedOptions: SUNO_SFX_OPTIONS }),
  'suno-lyrics': workflowProfile('suno-lyrics', SUNO_LYRICS_OPTIONS, true),
  'suno-style-boost': workflowProfile('suno-style-boost', SUNO_STYLE_BOOST_OPTIONS, true),
  'suno-extend-audio': workflowProfile('suno-extend-audio', SUNO_EXTEND_OPTIONS, true),
  'suno-add-instrumental': workflowProfile('suno-add-instrumental', SUNO_ADD_INSTRUMENTAL_OPTIONS, true),
  'suno-add-vocals': workflowProfile('suno-add-vocals', SUNO_ADD_VOCALS_OPTIONS, true),
  'suno-cover-audio': workflowProfile('suno-cover-audio', SUNO_COVER_AUDIO_OPTIONS, true),
  'suno-cover-generate': workflowProfile('suno-cover-generate', SUNO_COVER_GENERATE_OPTIONS),
  'suno-mashup': workflowProfile('suno-mashup', SUNO_MASHUP_OPTIONS, true),
  'suno-replace-section': workflowProfile('suno-replace-section', SUNO_REPLACE_SECTION_OPTIONS, true),
  'suno-stem': workflowProfile('suno-stem', SUNO_STEM_OPTIONS),
  'suno-persona': workflowProfile('suno-persona', SUNO_PERSONA_OPTIONS),
  'suno-midi': workflowProfile('suno-midi', SUNO_MIDI_OPTIONS),
  'suno-wav': workflowProfile('suno-wav', SUNO_WAV_OPTIONS),
  'suno-timestamped-lyrics': workflowProfile('suno-timestamped-lyrics', SUNO_TIMESTAMPED_LYRICS_OPTIONS),
});

export function getCangyuanMusicModelProfile(modelId: string): CangyuanMusicModelProfile | null {
  return CANGYUAN_MUSIC_MODEL_PROFILES[String(modelId || '')] || null;
}

export function parseCangyuanMusicOptions(value: unknown): CangyuanMusicOptions {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('音乐 options 必须是对象');
  const input = value as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter((key) => !(CANGYUAN_MUSIC_OPTION_KEYS as readonly string[]).includes(key));
  if (unknownKeys.length) throw new Error(`未支持的音乐参数：${unknownKeys.join(', ')}`);

  for (const key of ['uploadUrl', 'audioUrl', 'sourceTaskId', 'sourceAudioId', 'title', 'lyrics', 'style_text', 'negativeTags', 'personaId', 'personaName', 'personaDescription', 'personaModel', 'version', 'vocalGender', 'audio_format', 'sound_key', 'stemType', 'stemName', 'tags', 'continueAt', 'infillStartS', 'infillEndS']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error(`${key} 必须是字符串`);
  }
  if (input.uploadUrls !== undefined && (!Array.isArray(input.uploadUrls) || input.uploadUrls.some((item) => typeof item !== 'string'))) {
    throw new Error('uploadUrls 必须是字符串数组');
  }
  if (input.instrumental !== undefined && typeof input.instrumental !== 'boolean') throw new Error('instrumental 必须是布尔值');
  if (input.customMode !== undefined && typeof input.customMode !== 'boolean') throw new Error('customMode 必须是布尔值');
  if (input.sound_loop !== undefined && typeof input.sound_loop !== 'boolean') throw new Error('sound_loop 必须是布尔值');
  if (input.n !== undefined && input.n !== 1) throw new Error('n 目前只支持 1');
  for (const key of ['duration', 'seed', 'bpm'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isInteger(input[key]))) throw new Error(`${key} 必须是整数`);
  }
  if (input.sourceTrack !== undefined && (typeof input.sourceTrack !== 'number' || !Number.isInteger(input.sourceTrack))) throw new Error('sourceTrack 必须是整数');
  if (input.sound_tempo !== undefined && (typeof input.sound_tempo !== 'number' || !Number.isFinite(input.sound_tempo))) throw new Error('sound_tempo 必须是有限数字');
  for (const key of ['audioWeight', 'styleWeight', 'weirdnessConstraint']) {
    if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isFinite(input[key]))) throw new Error(`${key} 必须是有限数字`);
  }

  return Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined)) as CangyuanMusicOptions;
}

export function validateCangyuanMusicInput(modelId: string, input: { prompt?: string } & CangyuanMusicOptions) {
  const profile = getCangyuanMusicModelProfile(modelId);
  if (!profile) throw new Error(`沧元音乐模型尚未接入：${modelId}`);
  if (typeof input.prompt !== 'string' && input.prompt !== undefined) throw new Error('音乐描述必须是字符串');
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (profile.promptRequired && (!prompt || profile.promptMaxLength !== undefined && prompt.length > profile.promptMaxLength)) {
    throw new Error(profile.promptMaxLength === undefined ? '请输入音乐生成描述' : `音乐描述长度必须为 1–${profile.promptMaxLength} 个字符`);
  }

  const { prompt: _prompt, ...rawOptions } = input;
  const options = parseCangyuanMusicOptions(rawOptions);
  const unsupported = Object.keys(options).filter((key) => !profile.allowedOptions.includes(key as CangyuanMusicOptionKey));
  if (unsupported.length) throw new Error(`${profile.modelId} 不支持这些音乐参数：${unsupported.join(', ')}`);

  if (options.sourceTaskId !== undefined) {
    options.sourceTaskId = options.sourceTaskId.trim();
    if (!options.sourceTaskId || options.sourceTaskId.length > 200) throw new Error('sourceTaskId 长度必须为 1–200 个字符');
  }
  if (options.sourceAudioId !== undefined) {
    options.sourceAudioId = options.sourceAudioId.trim();
    if (!options.sourceAudioId || options.sourceAudioId.length > 200) throw new Error('sourceAudioId 长度必须为 1–200 个字符');
    if (!options.sourceTaskId) throw new Error('sourceAudioId 必须与 sourceTaskId 一起提供');
  }
  if (options.sourceTrack !== undefined) {
    if (options.sourceTrack < 0 || options.sourceTrack > 11) throw new Error('sourceTrack 必须是 0–11 之间的整数');
    if (!options.sourceTaskId) throw new Error('sourceTrack 必须与 sourceTaskId 一起提供');
    if (options.sourceAudioId) throw new Error('sourceTrack 与 sourceAudioId 只能选择一个曲目');
  }
  if (options.uploadUrl !== undefined) {
    options.uploadUrl = options.uploadUrl.trim();
    if (!isPublicHttpUrl(options.uploadUrl)) throw new Error('uploadUrl 必须是公网音频地址');
  }
  if (options.uploadUrls !== undefined) {
    options.uploadUrls = options.uploadUrls.map((url) => url.trim());
    if (options.uploadUrls.length !== 2 || options.uploadUrls.some((url) => !isPublicHttpUrl(url))) throw new Error('uploadUrls 必须正好包含 2 个公网音频地址');
  }
  for (const key of ['continueAt', 'infillStartS', 'infillEndS'] as const) {
    const value = options[key];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) throw new Error(`${key} 必须是非负数字字符串`);
    options[key] = trimmed;
  }
  const continueAt = options.continueAt === undefined ? undefined : Number(options.continueAt);
  const infillStartS = options.infillStartS === undefined ? undefined : Number(options.infillStartS);
  const infillEndS = options.infillEndS === undefined ? undefined : Number(options.infillEndS);
  if (continueAt !== undefined && !Number.isFinite(continueAt)) throw new Error('continueAt 必须是大于等于 0 的秒数');
  if (infillStartS !== undefined && !Number.isFinite(infillStartS)) throw new Error('infillStartS 必须是大于等于 0 的秒数');
  if (infillEndS !== undefined && (!Number.isFinite(infillEndS) || infillEndS <= 0)) throw new Error('infillEndS 必须是大于 0 的秒数');
  if (infillStartS !== undefined && infillEndS !== undefined && infillEndS <= infillStartS) throw new Error('infillEndS 必须大于 infillStartS');
  if (options.audioUrl !== undefined) {
    options.audioUrl = options.audioUrl.trim();
    if (!isPublicHttpUrl(options.audioUrl)) throw new Error('audioUrl 必须是公网音频地址');
  }
  if (options.stemType !== undefined && !['separate_vocal', 'split_stem', 'split_stem_advanced'].includes(options.stemType)) throw new Error('stemType 必须是 separate_vocal、split_stem 或 split_stem_advanced');
  if (options.stemName !== undefined && options.stemType !== 'split_stem_advanced') throw new Error('stemName 仅用于高级分轨');
  if (profile.modelId === 'suno-stem' && options.stemType === 'split_stem_advanced' && !options.stemName?.trim()) {
    throw new Error('高级分轨必须填写轨道名称');
  }
  if (profile.modelId === 'suno-cover-audio' && options.uploadUrl && options.sourceTaskId) {
    throw new Error('翻唱音源请在上传音频与源作品之间选择一种');
  }
  if (profile.modelId === 'suno-extend-audio' && !options.uploadUrl) throw new Error('suno-extend-audio 必须提供 uploadUrl');
  if ((profile.modelId === 'suno-add-instrumental' || profile.modelId === 'suno-add-vocals') && !options.uploadUrl) throw new Error(`${profile.modelId} 必须提供 uploadUrl`);
  if (profile.modelId === 'suno-cover-audio' && !options.uploadUrl && !options.sourceTaskId) throw new Error('suno-cover-audio 必须提供 uploadUrl 或 sourceTaskId');
  if (profile.modelId === 'suno-cover-generate' && !options.sourceTaskId) throw new Error('suno-cover-generate 必须提供 sourceTaskId');
  if (profile.modelId === 'suno-mashup' && !options.uploadUrls) throw new Error('suno-mashup 必须提供正好 2 个 uploadUrls');
  if (profile.modelId === 'suno-replace-section' && (!options.sourceTaskId || options.infillStartS === undefined || options.infillEndS === undefined)) throw new Error('suno-replace-section 必须提供 sourceTaskId、infillStartS 和 infillEndS');
  if (profile.modelId === 'suno-stem' && !options.audioUrl) throw new Error('suno-stem 必须提供 audioUrl');
  if (profile.modelId === 'suno-stem' && options.stemType === 'split_stem_advanced') {
    options.stemName = options.stemName?.trim();
    if (!options.stemName) throw new Error('高级分轨必须填写轨道名称');
  }
  if (['suno-persona', 'suno-midi', 'suno-wav', 'suno-timestamped-lyrics'].includes(profile.modelId) && !options.sourceTaskId) throw new Error(`${profile.modelId} 必须提供 sourceTaskId`);
  if (profile.modelId === 'suno-persona') {
    options.personaName = options.personaName?.trim();
    options.personaDescription = options.personaDescription?.trim();
    if (!options.personaName || !options.personaDescription) throw new Error('suno-persona 必须提供 personaName 和 personaDescription');
  }
  if (options.title !== undefined && options.title.length > (profile.titleMaxLength ?? 80)) throw new Error(`title 最多 ${profile.titleMaxLength ?? 80} 个字符`);
  if (options.style_text !== undefined && options.style_text.length > 1_000) throw new Error('style_text 最多 1,000 个字符');
  if (options.lyrics !== undefined && options.lyrics.length > 20_000) throw new Error('lyrics 最多 20,000 个字符');
  if (options.duration !== undefined) {
    const min = profile.family === 'lyria' ? 5 : 10;
    const max = profile.family === 'lyria' ? 300 : 360;
    if (options.duration < min || options.duration > max) throw new Error(`duration 必须是 ${min}–${max} 秒之间的整数`);
  }
  if (options.seed !== undefined && (options.seed < 0 || options.seed > 2_147_483_647)) throw new Error('seed 必须是 0–2147483647 之间的整数');
  if (options.bpm !== undefined && (options.bpm < 30 || options.bpm > 300)) throw new Error('bpm 必须是 30–300 之间的整数');
  if (options.audio_format !== undefined && !['mp3', 'wav', 'm4a'].includes(options.audio_format)) throw new Error('audio_format 必须是 mp3、wav 或 m4a');
  for (const key of ['audioWeight', 'styleWeight', 'weirdnessConstraint'] as const) {
    const value = options[key];
    if (value !== undefined && (value < 0 || value > 1)) throw new Error(`${key} 必须在 0–1 之间`);
  }
  if (options.version !== undefined && profile.family !== 'suno-sfx' && !['v6', 'v6-wild', 'v6-mini'].includes(options.version)) throw new Error('version 必须是 v6、v6-wild 或 v6-mini');
  if (options.vocalGender !== undefined && options.vocalGender !== 'm' && options.vocalGender !== 'f') throw new Error('vocalGender 必须是 m 或 f');
  if (options.sound_tempo !== undefined && (options.sound_tempo < 1 || options.sound_tempo > 300)) throw new Error('sound_tempo 必须是 1–300 之间的数字');

  return { ...options, prompt };
}

export type CangyuanMusicOptions = {
  uploadUrl?: string;
  uploadUrls?: string[];
  continueAt?: string;
  infillStartS?: string;
  infillEndS?: string;
  audioUrl?: string;
  stemType?: 'separate_vocal' | 'split_stem' | 'split_stem_advanced';
  sourceTaskId?: string;
  sourceAudioId?: string;
  sourceTrack?: number;
  instrumental?: boolean;
  n?: 1;
  title?: string;
  lyrics?: string;
  style_text?: string;
  duration?: number;
  seed?: number;
  bpm?: number;
  audio_format?: 'mp3' | 'wav' | 'm4a';
  audioWeight?: number;
  negativeTags?: string;
  personaId?: string;
  personaName?: string;
  personaDescription?: string;
  personaModel?: string;
  customMode?: boolean;
  tags?: string;
  stemName?: string;
  styleWeight?: number;
  version?: string;
  vocalGender?: 'm' | 'f';
  weirdnessConstraint?: number;
  sound_key?: string;
  sound_loop?: boolean;
  sound_tempo?: number;
};

export type Cangyuan3DMode = 'text-to-3d' | 'image-to-3d' | 'multiview-to-3d';
export type Cangyuan3DView = 'front' | 'back' | 'left' | 'right';
export type Cangyuan3DTextureVersion = 'v3.5-20260815' | 'v3.0-20250812' | 'v2.5-20250123';

export type Cangyuan3DOptions = {
  mode?: Cangyuan3DMode;
  imageUrl?: string;
  multiviewImages?: Partial<Record<Cangyuan3DView, string>>;
  texture?: 'no' | 'standard' | 'HD' | boolean;
  pbr?: boolean;
  textureSize?: string;
  seed?: string;
  meshSimplify?: number;
  ssGuidanceStrength?: number;
  ssSamplingSteps?: number;
  slatGuidanceStrength?: number;
  slatSamplingSteps?: number;
  faceLimit?: number;
  generateParts?: boolean;
  geometryQuality?: 'standard' | 'detailed';
  textureQuality?: 'standard' | 'detailed' | 'extreme' | 'fast';
  textureVersion?: Cangyuan3DTextureVersion;
  quad?: boolean;
};

export type Cangyuan3DModelProfile =
  | {
    modelId: 'tripo3d';
    defaultMode: 'image-to-3d';
    defaultTexture: 'standard';
    defaultPbr: false;
    supportedModes: readonly ('text-to-3d' | 'image-to-3d')[];
    supportedTextures: readonly ('no' | 'standard' | 'HD')[];
    family: 'tripo-legacy';
  }
  | {
    modelId: 'trellis';
    defaultMode: 'image-to-3d';
    supportedModes: readonly ['image-to-3d'];
    family: 'trellis';
  }
  | {
    modelId: 'tripo3d-v3.1' | 'tripo3d-p1' | 'tripo3d-p2';
    defaultMode: 'image-to-3d';
    supportedModes: readonly Cangyuan3DMode[];
    family: 'tripo';
    faceLimitRange: readonly [number, number];
    supportsGenerateParts: boolean;
    supportsQuad: boolean;
  };

export const CANGYUAN_TRIPO3D_PUBLIC_MODEL = 'tripo3d';
export const CANGYUAN_TRIPO3D_V31_PUBLIC_MODEL = 'tripo3d-v3.1';
export const CANGYUAN_TRIPO3D_P1_PUBLIC_MODEL = 'tripo3d-p1';
export const CANGYUAN_TRIPO3D_P2_PUBLIC_MODEL = 'tripo3d-p2';

const TRIPO3D_PROFILE: Cangyuan3DModelProfile = Object.freeze({
  modelId: CANGYUAN_TRIPO3D_PUBLIC_MODEL,
  defaultMode: 'image-to-3d',
  defaultTexture: 'standard',
  defaultPbr: false,
  supportedModes: Object.freeze(['image-to-3d', 'text-to-3d'] as const),
  supportedTextures: Object.freeze(['no', 'standard', 'HD'] as const),
  family: 'tripo-legacy',
});
const TRELLIS_PROFILE: Cangyuan3DModelProfile = Object.freeze({
  modelId: 'trellis',
  defaultMode: 'image-to-3d',
  supportedModes: Object.freeze(['image-to-3d'] as const),
  family: 'trellis',
});
const TRIPO_MODES = Object.freeze(['text-to-3d', 'image-to-3d', 'multiview-to-3d'] as const);
const TRIPO_V31_PROFILE: Cangyuan3DModelProfile = Object.freeze({
  modelId: CANGYUAN_TRIPO3D_V31_PUBLIC_MODEL,
  defaultMode: 'image-to-3d',
  supportedModes: TRIPO_MODES,
  family: 'tripo',
  faceLimitRange: Object.freeze([1, 2_000_000] as const),
  supportsGenerateParts: true,
  supportsQuad: true,
});
const TRIPO_P1_PROFILE: Cangyuan3DModelProfile = Object.freeze({
  modelId: CANGYUAN_TRIPO3D_P1_PUBLIC_MODEL,
  defaultMode: 'image-to-3d',
  supportedModes: TRIPO_MODES,
  family: 'tripo',
  faceLimitRange: Object.freeze([50, 20_000] as const),
  supportsGenerateParts: false,
  supportsQuad: false,
});
const TRIPO_P2_PROFILE: Cangyuan3DModelProfile = Object.freeze({
  modelId: CANGYUAN_TRIPO3D_P2_PUBLIC_MODEL,
  defaultMode: 'image-to-3d',
  supportedModes: TRIPO_MODES,
  family: 'tripo',
  faceLimitRange: Object.freeze([48, 50_000] as const),
  supportsGenerateParts: false,
  supportsQuad: true,
});

export function getCangyuan3DModelProfile(modelId: string): Cangyuan3DModelProfile | null {
  if (modelId === CANGYUAN_TRIPO3D_PUBLIC_MODEL) return TRIPO3D_PROFILE;
  if (modelId === 'trellis') return TRELLIS_PROFILE;
  if (modelId === CANGYUAN_TRIPO3D_V31_PUBLIC_MODEL) return TRIPO_V31_PROFILE;
  if (modelId === CANGYUAN_TRIPO3D_P1_PUBLIC_MODEL) return TRIPO_P1_PROFILE;
  if (modelId === CANGYUAN_TRIPO3D_P2_PUBLIC_MODEL) return TRIPO_P2_PROFILE;
  return null;
}

export function reconcileCangyuan3DMode(modelId: string, mode: Cangyuan3DMode): Cangyuan3DMode {
  const profile = getCangyuan3DModelProfile(modelId);
  if (!profile || (profile.supportedModes as readonly Cangyuan3DMode[]).includes(mode)) return mode;
  return profile.defaultMode;
}

export function parseCangyuan3DOptions(value: unknown): Cangyuan3DOptions {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('三维 options 必须是对象');
  const input = value as Record<string, unknown>;
  const allowed = ['mode', 'imageUrl', 'multiviewImages', 'texture', 'pbr', 'textureSize', 'seed', 'meshSimplify', 'ssGuidanceStrength', 'ssSamplingSteps', 'slatGuidanceStrength', 'slatSamplingSteps', 'faceLimit', 'generateParts', 'geometryQuality', 'textureQuality', 'textureVersion', 'quad'];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`未支持的三维参数：${unknown.join(', ')}`);
  if (input.mode !== undefined && input.mode !== 'text-to-3d' && input.mode !== 'image-to-3d' && input.mode !== 'multiview-to-3d') throw new Error('mode 必须是 text-to-3d、image-to-3d 或 multiview-to-3d');
  if (input.imageUrl !== undefined && (typeof input.imageUrl !== 'string' || !input.imageUrl.trim())) throw new Error('imageUrl 必须是非空公网图片地址');
  if (input.multiviewImages !== undefined) {
    if (typeof input.multiviewImages !== 'object' || input.multiviewImages === null || Array.isArray(input.multiviewImages)) throw new Error('multiviewImages 必须是视图对象');
    const views = input.multiviewImages as Record<string, unknown>;
    const unknownViews = Object.keys(views).filter((key) => !['front', 'back', 'left', 'right'].includes(key));
    if (unknownViews.length) throw new Error(`不支持的多视图方向：${unknownViews.join(', ')}`);
    if (Object.values(views).some((url) => typeof url !== 'string' || !url.trim())) throw new Error('每个多视图图片都必须是非空公网图片地址');
  }
  if (input.texture !== undefined && input.texture !== 'no' && input.texture !== 'standard' && input.texture !== 'HD' && typeof input.texture !== 'boolean') throw new Error('texture 必须是布尔值或 no、standard、HD');
  if (input.pbr !== undefined && typeof input.pbr !== 'boolean') throw new Error('pbr 必须是布尔值');
  if (input.generateParts !== undefined && typeof input.generateParts !== 'boolean') throw new Error('generateParts 必须是布尔值');
  if (input.quad !== undefined && typeof input.quad !== 'boolean') throw new Error('quad 必须是布尔值');
  if (input.faceLimit !== undefined && (typeof input.faceLimit !== 'number' || !Number.isInteger(input.faceLimit))) throw new Error('faceLimit 必须是整数');
  if (input.geometryQuality !== undefined && input.geometryQuality !== 'standard' && input.geometryQuality !== 'detailed') throw new Error('geometryQuality 必须是 standard 或 detailed');
  if (input.textureQuality !== undefined && !['standard', 'detailed', 'extreme', 'fast'].includes(String(input.textureQuality))) throw new Error('textureQuality 必须是 standard、detailed、extreme 或 fast');
  if (input.textureVersion !== undefined && !['v3.5-20260815', 'v3.0-20250812', 'v2.5-20250123'].includes(String(input.textureVersion))) throw new Error('textureVersion 不是受支持的版本');
  if (input.textureSize !== undefined && (typeof input.textureSize !== 'string' || !input.textureSize.trim())) throw new Error('textureSize 必须是非空字符串');
  if (input.seed !== undefined && (typeof input.seed !== 'string' || !input.seed.trim())) throw new Error('seed 必须是非空字符串');
  if (input.meshSimplify !== undefined && (typeof input.meshSimplify !== 'number' || !Number.isFinite(input.meshSimplify) || input.meshSimplify < 0.9 || input.meshSimplify > 0.98)) throw new Error('meshSimplify 必须在 0.9–0.98 之间');
  for (const key of ['ssGuidanceStrength', 'slatGuidanceStrength'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 10)) throw new Error(`${key} 必须在 0–10 之间`);
  }
  for (const key of ['ssSamplingSteps', 'slatSamplingSteps'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isInteger(input[key]) || input[key] < 1 || input[key] > 50)) throw new Error(`${key} 必须是 1–50 之间的整数`);
  }
  return Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined)) as Cangyuan3DOptions;
}

export function validateCangyuan3DInput(modelId: string, value: { prompt?: string } & Cangyuan3DOptions) {
  const profile = getCangyuan3DModelProfile(modelId);
  if (!profile) throw new Error(`沧元三维模型尚未接入：${modelId}`);
  if (value.prompt !== undefined && typeof value.prompt !== 'string') throw new Error('物体描述必须是字符串');
  const prompt = (value.prompt || '').trim();
  const { prompt: _prompt, ...rawOptions } = value;
  const options = parseCangyuan3DOptions(rawOptions);
  const mode = options.mode || profile.defaultMode;
  if (!(profile.supportedModes as readonly Cangyuan3DMode[]).includes(mode)) throw new Error(`${profile.modelId} 不支持 ${mode}`);
  if (mode === 'text-to-3d' && !prompt) throw new Error(`${profile.modelId} 文生模式必须提供物体描述`);

  if (mode === 'image-to-3d') {
    if (!options.imageUrl) throw new Error(`${profile.modelId} 图生模式必须提供公网图片地址`);
    if (options.multiviewImages !== undefined) throw new Error('单图模式不能同时提供多视图图片');
    options.imageUrl = validatePublicCangyuanImageUrl(options.imageUrl);
  } else if (mode === 'multiview-to-3d') {
    if (options.imageUrl !== undefined) throw new Error('多视图模式不能同时提供单张 imageUrl');
    const views = options.multiviewImages || {};
    const entries = Object.entries(views);
    if (!views.front || entries.length < 2) throw new Error('多视图模式至少需要 2 张图片，并且必须包含正面 front');
    options.multiviewImages = Object.fromEntries(entries.map(([view, url]) => [view, validatePublicCangyuanImageUrl(url || '')])) as Cangyuan3DOptions['multiviewImages'];
  } else if (options.imageUrl !== undefined || options.multiviewImages !== undefined) {
    throw new Error('文生模式不能同时提交参考图片');
  }

  if (profile.modelId === 'tripo3d') {
    if (!prompt) throw new Error('Tripo3D 必须提供物体描述');
    if (options.textureSize !== undefined || options.seed !== undefined || options.meshSimplify !== undefined
      || options.ssGuidanceStrength !== undefined || options.ssSamplingSteps !== undefined
      || options.slatGuidanceStrength !== undefined || options.slatSamplingSteps !== undefined
      || options.faceLimit !== undefined || options.generateParts !== undefined || options.geometryQuality !== undefined
      || options.textureQuality !== undefined || options.textureVersion !== undefined || options.quad !== undefined) {
      throw new Error('Tripo3D 不支持所提供的专属参数');
    }
    if (typeof options.texture === 'boolean') throw new Error('Tripo3D texture 必须是 no、standard 或 HD');
  } else if (profile.family === 'trellis') {
    if (options.seed !== undefined) options.seed = options.seed.trim();
    if (options.texture !== undefined || options.pbr !== undefined || options.faceLimit !== undefined || options.generateParts !== undefined
      || options.geometryQuality !== undefined || options.textureQuality !== undefined || options.textureVersion !== undefined || options.quad !== undefined) {
      throw new Error('Trellis 不支持所提供的 Tripo 专属参数');
    }
  } else {
    if (options.textureSize !== undefined || options.seed !== undefined || options.meshSimplify !== undefined
      || options.ssGuidanceStrength !== undefined || options.ssSamplingSteps !== undefined
      || options.slatGuidanceStrength !== undefined || options.slatSamplingSteps !== undefined) {
      throw new Error(`${profile.modelId} 不支持 Trellis 专属参数`);
    }
    if (options.geometryQuality !== undefined && profile.modelId !== CANGYUAN_TRIPO3D_V31_PUBLIC_MODEL) {
      throw new Error(`${profile.modelId} 不支持 geometryQuality`);
    }
    if (options.texture !== undefined && typeof options.texture !== 'boolean') throw new Error(`${profile.modelId} 的 texture 必须是布尔值`);
    if (options.faceLimit !== undefined && (options.faceLimit < profile.faceLimitRange[0] || options.faceLimit > profile.faceLimitRange[1])) {
      throw new Error(`faceLimit 必须是 ${profile.faceLimitRange[0]}–${profile.faceLimitRange[1]} 之间的整数`);
    }
    if (options.generateParts !== undefined && !profile.supportsGenerateParts) throw new Error(`${profile.modelId} 不支持 generateParts`);
    if (options.quad !== undefined && !profile.supportsQuad) throw new Error(`${profile.modelId} 不支持 quad`);
    if (profile.modelId === CANGYUAN_TRIPO3D_P2_PUBLIC_MODEL && options.quad === true && options.faceLimit !== undefined && options.faceLimit > 25_000) {
      throw new Error('P2 quad 模式下 faceLimit 不能超过 25000');
    }
    if (options.textureQuality === 'fast' && options.textureVersion !== 'v3.5-20260815') {
      throw new Error('textureQuality=fast 时必须设置 textureVersion=v3.5-20260815');
    }
    if (options.generateParts === true && (options.texture !== false || options.pbr !== false || options.quad !== false)) {
      throw new Error('generateParts=true 时 texture、pbr、quad 都必须显式设为 false');
    }
  }

  return { prompt, ...options };
}

export type CangyuanMediaCreateInput =
  | { kind: 'music'; modelId: string; prompt?: string; options?: CangyuanMusicOptions }
  | { kind: '3d'; modelId: string; prompt?: string; options?: Cangyuan3DOptions };

export type CangyuanMediaTaskInput =
  | ({ prompt?: string } & CangyuanMusicOptions)
  | ({ prompt?: string } & Cangyuan3DOptions);

export type CangyuanMediaOutput = {
  url?: string;
  text?: string;
  artifactType?: 'audio' | 'midi' | 'wav' | 'stem' | 'text' | 'file' | 'glb' | 'fbx';
  name?: string;
  jobId?: string;
  audioId?: string;
  title?: string;
  duration?: number;
};

type CangyuanMediaTaskBase = {
  id: string;
  providerId: string;
  providerTaskId?: string;
  providerModel: string;
  modelId: string;
  modelName: string;
  status: CangyuanMediaTaskStatus;
  outputs: CangyuanMediaOutput[];
  providerStatus?: string;
  error?: string;
  submissionUncertain?: boolean;
  idempotencyKey: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pollCount: number;
  nextPollAt?: number;
};

export type CangyuanMediaTask =
  | (CangyuanMediaTaskBase & { kind: 'music'; input: { prompt?: string } & CangyuanMusicOptions })
  | (CangyuanMediaTaskBase & { kind: '3d'; input: { prompt?: string } & Cangyuan3DOptions });

function validatePublicCangyuanImageUrl(value: string) {
  const url = String(value || '').trim();
  if (!isPublicHttpUrl(url)) throw new Error('三维参考图必须是公网图片地址；本地文件、Base64 和站内文件编号不可用');
  return url;
}

function isPublicHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return false;
    return !isLocalOrPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isLocalOrPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) return host === '::' || host === '::1' || /^(?:fc|fd|fe[89ab])/.test(host) || /^::ffff:(?:0:)?(?:10\.|127\.|169\.254\.|192\.168\.)/.test(host);
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127) || first >= 224;
}
