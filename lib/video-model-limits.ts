import { is65535Provider, isJimengProvider, type VideoProviderIdentity } from './video-platform';

function isAgnesProvider(provider?: VideoProviderIdentity | null) {
  if (!provider) return false;
  const host = (value: string) => { try { return new URL(value).hostname; } catch { return value; } };
  return provider.platform === 'agnes' || /(^|\.)apihub\.agnes-ai\.com$/i.test(host(provider.baseUrl || '')) || /(^|\.)apihub\.agnes-ai\.com$/i.test(host(provider.videoBaseUrl || ''));
}

export type VideoModelLimits = {
  minSeconds: number;
  maxSeconds: number;
  fixedSeconds?: number;
  resolutions: string[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxAudios: number;
  referenceMaxResolution?: string;
  inheritVideoSettingsFor?: Array<'edit' | 'extend'>;
  omitAspectRatioResolutionFor?: Array<'edit' | 'extend'>;
  allowedSeconds?: number[];
  notes: string[];
};

export const VIDEO_INPUT_SAFETY_LIMITS = {
  maxReferenceImages: 16,
  maxReferenceVideos: 10,
  maxAudios: 10,
} as const;

const allRatios = ['auto', '21:9', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'];

const defaults: VideoModelLimits = {
  minSeconds: 1,
  maxSeconds: 60,
  resolutions: ['480p', '720p', '1080p'],
  // These are generic request-safety limits, not a provider's model
  // capability.  Keep them aligned with the server-side input guardrails.
  maxReferenceImages: VIDEO_INPUT_SAFETY_LIMITS.maxReferenceImages,
  maxReferenceVideos: VIDEO_INPUT_SAFETY_LIMITS.maxReferenceVideos,
  maxAudios: VIDEO_INPUT_SAFETY_LIMITS.maxAudios,
  notes: [],
};

const jimengDurations = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, index) => min + index);
const agnesDurations = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, index) => min + index);

function agnesLimits(rawId: string): VideoModelLimits {
  if (/agnes-video-v2\.0/i.test(rawId)) {
    return {
      ...defaults,
      minSeconds: 1,
      maxSeconds: 60,
      resolutions: ['480p', '720p', '1080p'],
      maxReferenceImages: 16,
      maxReferenceVideos: 0,
      maxAudios: 0,
      notes: ['Agnes Video V2.0：使用宽高、帧数和帧率', 'num_frames 不超过 441，且必须为 8n+1', '平台可能将尺寸标准化到 480p/720p/1080p'],
    };
  }
  const flash = /agnes-video-2\.5-flash/i.test(rawId);
  return {
    ...defaults,
    minSeconds: 4,
    maxSeconds: 12,
    allowedSeconds: agnesDurations(4, 12),
    resolutions: flash ? ['720P'] : ['720P', '960P', '2K'],
    maxReferenceImages: flash ? 5 : 16,
    maxReferenceVideos: flash ? 0 : 10,
    maxAudios: 10,
    notes: [
      `Agnes Video ${flash ? '2.5 Flash' : '2.5'}：4–12 秒`,
      flash ? '固定 720P，参考图片最多 5 张且不支持参考视频' : '支持 720P/960P/2K 与 text/keyframe/reference 模式',
      '本地图片、视频和音频需要配置 SANMAO_PUBLIC_BASE_URL',
    ],
  };
}

function jimengLimits(rawId: string): VideoModelLimits {
  const base: VideoModelLimits = {
    ...defaults,
    minSeconds: 4,
    maxSeconds: 15,
    allowedSeconds: jimengDurations(4, 15),
    resolutions: ['720p'],
    notes: ['即梦 CLI：4–15 秒', '当前模型支持 720p', '视频生成需要明确指定模型版本和分辨率', '首次使用视频前需先在即梦网页端完成一次生成授权'],
  };
  if (/seedance[-_. ]?2\.5/.test(rawId)) {
    return {
      ...base,
      maxSeconds: 30,
      allowedSeconds: jimengDurations(4, 30),
      resolutions: ['480p', '720p', '1080p'],
      notes: ['Seedance 2.5：4–30 秒', '支持 480p/720p/1080p', '多模态参考音视频和纯音频需使用 2–30 秒素材', '视频生成需要明确指定模型版本和分辨率', '首次使用视频前需先在即梦网页端完成一次生成授权'],
    };
  }
  if (/seedance[-_. ]?2\.0/.test(rawId)) {
    const vip = /seedance[-_. ]?2\.0(?:.*_vip|.*vip)/.test(rawId);
    const mini = /seedance[-_. ]?2\.0(?:.*mini|mini)/.test(rawId);
    return {
      ...base,
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxAudios: 3,
      resolutions: vip ? ['720p', '1080p', '4k'] : ['720p'],
      notes: [
        mini ? 'Seedance 2.0 Mini：4–15 秒' : 'Seedance 2.0 系列：4–15 秒',
        vip ? '支持 720p/1080p/4K' : '仅支持 720p',
        '图片最多 9 张、视频最多 3 个、音频最多 3 段',
        '视频生成需要明确指定模型版本和分辨率',
        '首次使用视频前需先在即梦网页端完成一次生成授权',
      ],
    };
  }
  return base;
}

function seedanceLimits(rawId: string): VideoModelLimits | null {
  if (/seedance[-_. ]?2\.5/.test(rawId)) {
    return {
      ...defaults,
      minSeconds: 5,
      maxSeconds: 15,
      resolutions: ['720p'],
      maxReferenceImages: 10,
      maxReferenceVideos: 10,
      maxAudios: 10,
      notes: ['5–15 秒', '图片最多 10 张', '视频最多 10 个', '音频最多 10 段', '仅支持 720p'],
    };
  }
  if (/seedance[-_. ]?2\.0/.test(rawId)) {
    return {
      ...defaults,
      minSeconds: 5,
      maxSeconds: 15,
      resolutions: ['720p'],
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxAudios: 3,
      notes: ['5–15 秒', '图片最多 9 张', '视频最多 3 个', '音频最多 3 段', '仅支持 720p'],
    };
  }
  return null;
}

export function getVideoModelLimits(model?: { rawId?: string; displayName?: string }, provider?: VideoProviderIdentity | string): VideoModelLimits {
  const providerIdentity: VideoProviderIdentity = typeof provider === 'string' ? { platform: provider } : (provider || {});
  const rawId = String(model?.rawId || model?.displayName || '').toLowerCase();
  if (isAgnesProvider(providerIdentity) || rawId.startsWith('agnes-video-')) return agnesLimits(rawId);
  if (isJimengProvider(providerIdentity)) return jimengLimits(rawId);
  if (!is65535Provider(providerIdentity)) return { ...defaults };

  const seedance = seedanceLimits(rawId);
  if (seedance) return seedance;

  if (/veo[-_. ]?omni[-_. ]?3[-_. ]?1/.test(rawId)) {
    return {
      ...defaults,
      fixedSeconds: 8,
      minSeconds: 8,
      maxSeconds: 8,
      resolutions: ['720p', '1080p'],
      maxReferenceImages: 9,
      notes: ['固定 8 秒', '参考图最多 9 张'],
    };
  }
  if (/veo[-_. ]?omni[-_. ]?flash[-_. ]?edit/.test(rawId)) {
    return {
      ...defaults,
      fixedSeconds: 10,
      minSeconds: 10,
      maxSeconds: 10,
      resolutions: ['720p', '1080p'],
      maxReferenceImages: 9,
      maxReferenceVideos: 1,
      inheritVideoSettingsFor: ['edit'],
      notes: ['固定 10 秒', '最多 1 个输入视频（小于 15 秒）', '参考图最多 9 张', '编辑模式沿用输入视频参数'],
    };
  }
  if (/veo[-_. ]?omni[-_. ]?flash/.test(rawId)) {
    return {
      ...defaults,
      fixedSeconds: 10,
      minSeconds: 10,
      maxSeconds: 10,
      resolutions: ['720p', '1080p'],
      maxReferenceImages: 9,
      notes: ['固定 10 秒', '参考图最多 9 张'],
    };
  }
  if (/grok[-_. ]?imagine[-_. ]?video/.test(rawId)) {
    const preview = /1\.5|preview/.test(rawId);
    return {
      ...defaults,
      minSeconds: 1,
      maxSeconds: 15,
      resolutions: preview ? ['480p', '720p', '1080p'] : ['480p', '720p'],
      maxReferenceImages: 7,
      referenceMaxResolution: '720p',
      inheritVideoSettingsFor: ['edit'],
      omitAspectRatioResolutionFor: ['edit', 'extend'],
      notes: [preview ? '1–15 秒' : '1–15 秒', preview ? '支持 480p/720p/1080p' : '支持 480p/720p', '参考图最多 7 张，参考图模式最高 720p', '编辑沿用输入视频参数，续写不传比例和分辨率'],
    };
  }

  return {
    ...defaults,
    notes: ['参考媒体必须是服务商可访问的公网 URL'],
  };
}

export { allRatios };
