import type { TaskState } from './task';

export type CangyuanMediaKind = 'music' | '3d';
export type CangyuanMediaTaskStatus = Extract<TaskState, 'pending' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'>;

export const CANGYUAN_MUSIC_OPTION_KEYS = Object.freeze([
  'sourceTaskId',
  'sourceAudioId',
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
  'personaModel',
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
  family: 'su2' | 'suno-v6' | 'lyria' | 'suno-sfx';
  supportsReferences: false;
  promptMaxLength?: number;
  titleMaxLength?: number;
  allowedOptions: readonly CangyuanMusicOptionKey[];
};

const SU2_MUSIC_OPTIONS = Object.freeze(['instrumental', 'n'] as const);
const SUNO_V6_MUSIC_OPTIONS = Object.freeze([
  'sourceTaskId', 'sourceAudioId', 'instrumental', 'n', 'title', 'style_text', 'duration', 'audioWeight',
  'negativeTags', 'personaId', 'personaModel', 'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
] as const);
const LYRIA_MUSIC_OPTIONS = Object.freeze(['title', 'lyrics', 'instrumental', 'seed', 'duration', 'bpm', 'audio_format', 'n'] as const);
const SUNO_SFX_OPTIONS = Object.freeze(['n', 'sound_key', 'sound_loop', 'sound_tempo', 'version'] as const);

const CANGYUAN_MUSIC_MODEL_PROFILES: Readonly<Record<string, CangyuanMusicModelProfile>> = Object.freeze({
  'su2-suno-v6': Object.freeze({ modelId: 'su2-suno-v6', family: 'su2', supportsReferences: false, promptMaxLength: 3_000, allowedOptions: SU2_MUSIC_OPTIONS }),
  'su2-suno-v6-mini': Object.freeze({ modelId: 'su2-suno-v6-mini', family: 'su2', supportsReferences: false, promptMaxLength: 3_000, allowedOptions: SU2_MUSIC_OPTIONS }),
  'su2-suno-v6-wild': Object.freeze({ modelId: 'su2-suno-v6-wild', family: 'su2', supportsReferences: false, promptMaxLength: 3_000, allowedOptions: SU2_MUSIC_OPTIONS }),
  'suno-v6': Object.freeze({ modelId: 'suno-v6', family: 'suno-v6', supportsReferences: false, allowedOptions: SUNO_V6_MUSIC_OPTIONS }),
  'lyria-3.5': Object.freeze({ modelId: 'lyria-3.5', family: 'lyria', supportsReferences: false, promptMaxLength: 10_000, titleMaxLength: 160, allowedOptions: LYRIA_MUSIC_OPTIONS }),
  'lyria-3-pro': Object.freeze({ modelId: 'lyria-3-pro', family: 'lyria', supportsReferences: false, promptMaxLength: 10_000, titleMaxLength: 160, allowedOptions: LYRIA_MUSIC_OPTIONS }),
  'suno-sfx': Object.freeze({ modelId: 'suno-sfx', family: 'suno-sfx', supportsReferences: false, allowedOptions: SUNO_SFX_OPTIONS }),
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

  for (const key of ['sourceTaskId', 'sourceAudioId', 'title', 'lyrics', 'style_text', 'negativeTags', 'personaId', 'personaModel', 'version', 'vocalGender', 'audio_format', 'sound_key']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error(`${key} 必须是字符串`);
  }
  if (input.instrumental !== undefined && typeof input.instrumental !== 'boolean') throw new Error('instrumental 必须是布尔值');
  if (input.sound_loop !== undefined && typeof input.sound_loop !== 'boolean') throw new Error('sound_loop 必须是布尔值');
  if (input.n !== undefined && input.n !== 1) throw new Error('n 目前只支持 1');
  for (const key of ['duration', 'seed', 'bpm'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isInteger(input[key]))) throw new Error(`${key} 必须是整数`);
  }
  if (input.sound_tempo !== undefined && (typeof input.sound_tempo !== 'number' || !Number.isFinite(input.sound_tempo))) throw new Error('sound_tempo 必须是有限数字');
  for (const key of ['audioWeight', 'styleWeight', 'weirdnessConstraint']) {
    if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isFinite(input[key]))) throw new Error(`${key} 必须是有限数字`);
  }

  return Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined)) as CangyuanMusicOptions;
}

export function validateCangyuanMusicInput(modelId: string, input: { prompt: string } & CangyuanMusicOptions) {
  const profile = getCangyuanMusicModelProfile(modelId);
  if (!profile) throw new Error(`沧元音乐模型尚未接入：${modelId}`);
  if (typeof input.prompt !== 'string') throw new Error('请输入音乐生成描述');
  const prompt = input.prompt.trim();
  if (!prompt || profile.promptMaxLength !== undefined && prompt.length > profile.promptMaxLength) {
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
  sourceTaskId?: string;
  sourceAudioId?: string;
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
  personaModel?: string;
  styleWeight?: number;
  version?: string;
  vocalGender?: 'm' | 'f';
  weirdnessConstraint?: number;
  sound_key?: string;
  sound_loop?: boolean;
  sound_tempo?: number;
};

export type Cangyuan3DOptions = {
  mode?: 'text-to-3d' | 'image-to-3d';
  imageUrl?: string;
  texture?: 'no' | 'standard' | 'HD';
  pbr?: boolean;
  textureSize?: string;
  seed?: string;
  meshSimplify?: number;
  ssGuidanceStrength?: number;
  ssSamplingSteps?: number;
  slatGuidanceStrength?: number;
  slatSamplingSteps?: number;
};

export type Cangyuan3DModelProfile =
  | {
    modelId: 'tripo3d';
    defaultMode: 'image-to-3d';
    defaultTexture: 'standard';
    defaultPbr: false;
    supportedModes: readonly ('text-to-3d' | 'image-to-3d')[];
    supportedTextures: readonly ('no' | 'standard' | 'HD')[];
  }
  | {
    modelId: 'trellis';
    defaultMode: 'image-to-3d';
    supportedModes: readonly ['image-to-3d'];
  };

export const CANGYUAN_TRIPO3D_PUBLIC_MODEL = 'tripo3d';

const TRIPO3D_PROFILE: Cangyuan3DModelProfile = Object.freeze({
  modelId: CANGYUAN_TRIPO3D_PUBLIC_MODEL,
  defaultMode: 'image-to-3d',
  defaultTexture: 'standard',
  defaultPbr: false,
  supportedModes: Object.freeze(['image-to-3d', 'text-to-3d'] as const),
  supportedTextures: Object.freeze(['no', 'standard', 'HD'] as const),
});
const TRELLIS_PROFILE: Cangyuan3DModelProfile = Object.freeze({
  modelId: 'trellis',
  defaultMode: 'image-to-3d',
  supportedModes: Object.freeze(['image-to-3d'] as const),
});

export function getCangyuan3DModelProfile(modelId: string): Cangyuan3DModelProfile | null {
  if (modelId === CANGYUAN_TRIPO3D_PUBLIC_MODEL) return TRIPO3D_PROFILE;
  if (modelId === 'trellis') return TRELLIS_PROFILE;
  return null;
}

export function parseCangyuan3DOptions(value: unknown): Cangyuan3DOptions {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('三维 options 必须是对象');
  const input = value as Record<string, unknown>;
  const allowed = ['mode', 'imageUrl', 'texture', 'pbr', 'textureSize', 'seed', 'meshSimplify', 'ssGuidanceStrength', 'ssSamplingSteps', 'slatGuidanceStrength', 'slatSamplingSteps'];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`未支持的三维参数：${unknown.join(', ')}`);
  if (input.mode !== undefined && input.mode !== 'text-to-3d' && input.mode !== 'image-to-3d') throw new Error('mode 必须是 text-to-3d 或 image-to-3d');
  if (input.imageUrl !== undefined && (typeof input.imageUrl !== 'string' || !input.imageUrl.trim())) throw new Error('imageUrl 必须是非空公网图片地址');
  if (input.texture !== undefined && input.texture !== 'no' && input.texture !== 'standard' && input.texture !== 'HD') throw new Error('texture 必须是 no、standard 或 HD');
  if (input.pbr !== undefined && typeof input.pbr !== 'boolean') throw new Error('pbr 必须是布尔值');
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

export type CangyuanMediaCreateInput =
  | { kind: 'music'; modelId: string; prompt: string; options?: CangyuanMusicOptions }
  | { kind: '3d'; modelId: string; prompt?: string; options?: Cangyuan3DOptions };

export type CangyuanMediaTaskInput =
  | ({ prompt: string } & CangyuanMusicOptions)
  | ({ prompt: string } & Cangyuan3DOptions);

export type CangyuanMediaOutput = {
  url: string;
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
  | (CangyuanMediaTaskBase & { kind: 'music'; input: { prompt: string } & CangyuanMusicOptions })
  | (CangyuanMediaTaskBase & { kind: '3d'; input: { prompt: string } & Cangyuan3DOptions });
