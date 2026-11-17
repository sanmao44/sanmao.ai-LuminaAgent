import type { VideoGenerationInput } from './types';

export const CANGYUAN_SEEDANCE_FAST_MODEL = 'doubao-seedance-2-0-fast-260128';
export const CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES = 30 * 1024 * 1024;

export type CangyuanVideoModelProfile = {
  publicModel: string;
  minSeconds: number;
  maxSeconds: number;
  suggestedAspectRatios: readonly string[];
  suggestedResolutions: readonly string[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  maxReferenceImageBytes: number;
  supportsSeed: boolean;
  supportsFirstLastFrames: boolean;
};

const CANGYUAN_VIDEO_MODEL_PROFILES: Readonly<Record<string, CangyuanVideoModelProfile>> = Object.freeze({
  'doubao-seedance-2-0-260128': Object.freeze({
    publicModel: 'doubao-seedance-2-0-260128',
    minSeconds: 4,
    maxSeconds: 15,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'],
    suggestedResolutions: ['720p'],
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    maxReferenceImageBytes: CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
    supportsSeed: true,
    supportsFirstLastFrames: true,
  }),
  'doubao-seedance-2-0-fast-260128': Object.freeze({
    publicModel: CANGYUAN_SEEDANCE_FAST_MODEL,
    minSeconds: 4,
    maxSeconds: 15,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'],
    suggestedResolutions: ['480p', '720p', '1080p', '4k'],
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    maxReferenceImageBytes: CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
    supportsSeed: true,
    supportsFirstLastFrames: true,
  }),
  'doubao-seedance-2-0-mini-260615': Object.freeze({
    publicModel: 'doubao-seedance-2-0-mini-260615',
    minSeconds: 4,
    maxSeconds: 15,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'],
    suggestedResolutions: ['480p', '720p', '1080p', '4k'],
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    maxReferenceImageBytes: CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
    supportsSeed: true,
    supportsFirstLastFrames: true,
  }),
  'doubao-seedance-2-5-260628': Object.freeze({
    publicModel: 'doubao-seedance-2-5-260628',
    minSeconds: 4,
    maxSeconds: 30,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'],
    suggestedResolutions: ['720p'],
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    maxReferenceImageBytes: CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
    supportsSeed: true,
    supportsFirstLastFrames: true,
  }),
});

export function getCangyuanVideoModelProfile(publicModel: string): CangyuanVideoModelProfile | null {
  return Object.hasOwn(CANGYUAN_VIDEO_MODEL_PROFILES, publicModel)
    ? CANGYUAN_VIDEO_MODEL_PROFILES[publicModel]
    : null;
}

export function cangyuanVideoImageSizeError(publicModel: string, byteLength: number) {
  const profile = getCangyuanVideoModelProfile(publicModel);
  if (!profile || !Number.isFinite(byteLength) || byteLength < 0 || byteLength <= profile.maxReferenceImageBytes) return null;
  return `沧元算力 ${publicModel} 的单张参考图或首尾帧不能超过 30 MiB。`;
}

export function cangyuanVideoImageDataUrlBytes(value: string) {
  if (!/^data:image\//i.test(value)) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const metadata = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  if (/;base64(?:;|$)/i.test(metadata)) {
    const normalized = payload.replace(/\s/g, '');
    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    const contentLength = normalized.length - padding;
    if (padding > 0 && normalized.length % 4 !== 0) return null;
    if (padding === 1 && contentLength % 4 !== 3) return null;
    if (padding === 2 && contentLength % 4 !== 2) return null;
    if (!padding && normalized.length % 4 === 1) return null;
    const byteLength = Math.floor(contentLength * 3 / 4);
    if (byteLength > CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES) return byteLength;
    for (let index = 0; index < contentLength; index += 1) {
      const code = normalized.charCodeAt(index);
      const valid = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
        || (code >= 48 && code <= 57) || code === 43 || code === 47;
      if (!valid) return null;
    }
    return byteLength;
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  } catch {
    return null;
  }
}

export function validateCangyuanVideoInput(
  publicModel: string,
  input: VideoGenerationInput,
  options: { requirePublicMedia?: boolean } = {},
) {
  const profile = getCangyuanVideoModelProfile(publicModel);
  const unsupported: string[] = [];
  const addIfPresent = (value: unknown, label: string) => {
    if (value !== undefined && value !== null && value !== '') unsupported.push(label);
  };
  const referenceVideos = mediaValues(input.referenceVideos, input.referenceVideo);
  const referenceAudios = mediaValues(input.audios, input.audio);
  const referenceImages = mediaValues(input.referenceImages);
  const firstFrame = cleanMedia(input.firstFrame);
  const lastFrame = cleanMedia(input.lastFrame);
  const hasFrames = Boolean(firstFrame || lastFrame);
  const hasReferences = Boolean(referenceImages.length || referenceVideos.length || referenceAudios.length);

  if (input.operation && input.operation !== 'generate') unsupported.push('操作类型');
  addIfPresent(input.width, 'width');
  addIfPresent(input.height, 'height');
  addIfPresent(input.numFrames, 'num_frames');
  addIfPresent(input.frameRate, 'frame_rate');
  addIfPresent(input.videoSize, 'size');
  addIfPresent(input.referenceVideoStartSeconds, '参考视频起始时间');
  addIfPresent(input.referenceVideoEndSeconds, '参考视频结束时间');
  if (input.requireAudio !== undefined) throw unsupportedFieldsError(['generate_audio']);

  if (!profile) {
    addIfPresent(input.seconds, 'duration');
    addIfPresent(input.aspectRatio, 'aspect_ratio');
    addIfPresent(input.resolution, 'resolution');
    addIfPresent(input.seed, 'seed');
    if (referenceImages.length || referenceVideos.length || referenceAudios.length || hasFrames) unsupported.push('参考素材');
    if (unsupported.length) throw unsupportedFieldsError(unsupported);
    return;
  }

  for (const value of [...referenceImages, firstFrame || '', lastFrame || '']) {
    const byteLength = cangyuanVideoImageDataUrlBytes(value);
    if (byteLength === null) continue;
    const sizeError = cangyuanVideoImageSizeError(publicModel, byteLength);
    if (sizeError) throw new Error(sizeError);
  }

  if (input.seconds !== undefined) {
    const seconds = Number(input.seconds);
    if (!Number.isInteger(seconds) || seconds < profile.minSeconds || seconds > profile.maxSeconds) {
      throw new Error(`沧元算力 ${profile.publicModel} 时长必须是 ${profile.minSeconds}–${profile.maxSeconds} 秒的整数。`);
    }
  }
  if (input.aspectRatio !== undefined && !String(input.aspectRatio).trim()) throw new Error('沧元算力 aspect_ratio 不能为空。');
  if (input.resolution !== undefined && !String(input.resolution).trim()) throw new Error('沧元算力 resolution 不能为空。');
  if (input.seed !== undefined && !Number.isInteger(Number(input.seed))) throw new Error('沧元算力 seed 必须是整数。');
  if (referenceImages.length > profile.maxReferenceImages) throw new Error(`沧元算力 ${profile.publicModel} 最多接收 ${profile.maxReferenceImages} 张参考图。`);
  if (referenceVideos.length > profile.maxReferenceVideos) throw new Error(`沧元算力 ${profile.publicModel} 最多接收 ${profile.maxReferenceVideos} 个参考视频。`);
  if (referenceAudios.length > profile.maxReferenceAudios) throw new Error(`沧元算力 ${profile.publicModel} 最多接收 ${profile.maxReferenceAudios} 段参考音频。`);
  if (hasFrames && (!firstFrame || !lastFrame)) throw new Error('沧元算力 Seedance 2.0 首帧和尾帧必须成对提供。');
  if (hasFrames && hasReferences) throw new Error('沧元算力 Seedance 2.0 首尾帧不能与参考图、参考视频或参考音频同时使用。');

  if (options.requirePublicMedia !== false) {
    for (const url of [...referenceImages, ...referenceVideos, ...referenceAudios, ...(firstFrame ? [firstFrame] : []), ...(lastFrame ? [lastFrame] : [])]) {
      if (!isPublicHttpsUrl(url)) throw new Error('沧元算力视频参考素材必须使用公网 HTTPS URL；本地文件、Base64 和内网地址不可用。');
    }
  }
}

export function buildCangyuanVideoPayload(publicModel: string, input: VideoGenerationInput) {
  validateCangyuanVideoInput(publicModel, input);
  const profile = getCangyuanVideoModelProfile(publicModel);
  const payload: Record<string, unknown> = { model: publicModel, prompt: input.prompt };
  if (!profile) return payload;

  if (input.seconds !== undefined) payload.duration = input.seconds;
  if (input.aspectRatio !== undefined) payload.aspect_ratio = input.aspectRatio;
  if (input.resolution !== undefined) payload.resolution = input.resolution;
  if (input.seed !== undefined) payload.seed = String(input.seed);
  const referenceImages = mediaValues(input.referenceImages);
  const referenceVideos = mediaValues(input.referenceVideos, input.referenceVideo);
  const referenceAudios = mediaValues(input.audios, input.audio);
  if (referenceImages.length) payload.reference_image_urls = referenceImages;
  if (referenceVideos.length) payload.reference_videos = referenceVideos;
  if (referenceAudios.length) payload.reference_audios = referenceAudios;
  if (input.firstFrame) payload.first_image_url = input.firstFrame;
  if (input.lastFrame) payload.last_image_url = input.lastFrame;
  return payload;
}

function mediaValues(values?: string[], single?: string) {
  const normalized = (values || []).map(cleanMedia).filter((value): value is string => Boolean(value));
  if (normalized.length) return normalized;
  const one = cleanMedia(single);
  return one ? [one] : [];
}

function cleanMedia(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (host.includes(':')) return !['::', '::1'].includes(host) && !/^(?:fc|fd|fe[89ab])/.test(host);
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [first, second] = octets;
    return first !== 0 && first !== 10 && first !== 127
      && !(first === 169 && second === 254)
      && !(first === 172 && second >= 16 && second <= 31)
      && !(first === 192 && second === 168)
      && !(first === 100 && second >= 64 && second <= 127)
      && first < 224;
  } catch {
    return false;
  }
}

function unsupportedFieldsError(fields: string[]) {
  return new Error(`沧元算力视频接口当前仅支持模型和提示词；该型号未核实这些字段：${Array.from(new Set(fields)).join('、')}。`);
}
