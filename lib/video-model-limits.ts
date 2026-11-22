import { is65535Provider, isJimengLegacyCli, isJimengProvider, type VideoProviderIdentity } from './video-platform';
import { getCangyuanVideoModelProfile } from './cangyuan-video-capabilities';
import { usesCangyuanVideoProtocol } from './cangyuan-provider';

function isAgnesProvider(provider?: VideoProviderIdentity | null) {
  if (!provider) return false;
  const host = (value: string) => { try { return new URL(value).hostname; } catch { return ''; } };
  return provider.platform === 'agnes'
    || /(^|\.)api(?:hub)?\.agnes-ai\.(?:com|cn)$/i.test(host(provider.baseUrl || ''))
    || /(^|\.)api(?:hub)?\.agnes-ai\.(?:com|cn)$/i.test(host(provider.videoBaseUrl || ''));
}

export type VideoModelLimits = {
  minSeconds: number;
  maxSeconds: number;
  fixedSeconds?: number;
  requiresDuration?: boolean;
  requiresAspectRatio?: boolean;
  durationScope?: 'total' | 'per-transition';
  aspectRatioSource?: 'first-reference';
  resolutions: string[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxAudios: number;
  maxTotalInputs?: number;
  requiresVisualInput?: boolean;
  referenceMaxResolution?: string;
  inheritVideoSettingsFor?: Array<'edit' | 'extend'>;
  omitAspectRatioResolutionFor?: Array<'edit' | 'extend'>;
  allowedSeconds?: number[];
  notes: string[];
};

export type VideoModelInputContext = {
  hasFirstFrame?: boolean;
  hasLastFrame?: boolean;
  referenceImageCount?: number;
  referenceVideoCount?: number;
  audioCount?: number;
  referenceMode?: 'multiframe' | 'multimodal';
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
      notes: ['Agnes Video V2.0：使用宽高、帧数和帧率', '宽高必须是 64 的倍数', 'num_frames 不超过 441，且必须为 8n+1', '本地图片会自动安全准备，公网图片可直接使用', '平台可能将尺寸标准化到 480p/720p/1080p'],
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
      '本地图片会自动安全准备；参考视频和音频仍需使用服务商可访问的公网地址',
    ],
  };
}

function jimengLimits(rawId: string): VideoModelLimits {
  const normalized = rawId.replace(/[ _-]+/g, '').toLowerCase();
  const base: VideoModelLimits = {
    ...defaults,
    minSeconds: 4,
    maxSeconds: 15,
    allowedSeconds: jimengDurations(4, 15),
    resolutions: ['720p'],
    notes: ['即梦 CLI：4–15 秒', '当前模型支持 720p', '视频生成需要明确指定模型版本和分辨率', '首次使用视频前需先在即梦网页端完成一次生成授权'],
  };
  if (normalized.includes('seedance1.0fast')) {
    return {
      ...base,
      minSeconds: 5,
      maxSeconds: 10,
      allowedSeconds: jimengDurations(5, 10),
      resolutions: ['720p'],
      notes: [...base.notes, 'image2video/frames2video：Seedance 1.0 Fast 支持 5–10 秒；不支持文生视频和全能参考模式'],
    };
  }
  if (normalized.includes('seedance1.5pro')) {
    return {
      ...base,
      minSeconds: 5,
      maxSeconds: 12,
      allowedSeconds: jimengDurations(5, 12),
      resolutions: ['720p'],
      notes: [...base.notes, 'image2video/frames2video：Seedance 1.5 Pro 支持 5–12 秒；不支持文生视频和全能参考模式'],
    };
  }
  if (/seedance[-_. ]?2\.5/.test(rawId)) {
    return {
      ...base,
      maxSeconds: 30,
      allowedSeconds: jimengDurations(4, 30),
      resolutions: ['480p', '720p', '1080p'],
      maxReferenceImages: 30,
      maxReferenceVideos: 10,
      maxAudios: 10,
      maxTotalInputs: 50,
      notes: ['Seedance 2.5：4–30 秒', '支持 480p/720p/1080p', '全能参考最多图片 30 张、视频 10 个、音频 10 段，总输入最多 50 个；音视频素材需使用 2–30 秒', '视频生成需要明确指定模型版本和分辨率', '首次使用视频前需先在即梦网页端完成一次生成授权'],
    };
  }
  if (/seedance[-_. ]?2\.0/.test(rawId)) {
    const vip = /^seedance[-_. ]?2\.0(?:[-_. ]?vip)$/.test(rawId);
    const mini = /seedance[-_. ]?2\.0(?:.*mini|mini)/.test(rawId);
    return {
      ...base,
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxAudios: 3,
      maxTotalInputs: 12,
      requiresVisualInput: true,
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
  const originalRawId = String(model?.rawId || model?.displayName || '');
  const rawId = originalRawId.toLowerCase();
  if (usesCangyuanVideoProtocol(providerIdentity)) {
    const profile = getCangyuanVideoModelProfile(originalRawId);
    if (profile) {
      return {
        ...defaults,
        minSeconds: profile.minSeconds,
        maxSeconds: profile.maxSeconds,
        ...(profile.requiresDuration ? { requiresDuration: true } : {}),
        ...(profile.requiresAspectRatio ? { requiresAspectRatio: true } : {}),
        allowedSeconds: Array.from({ length: profile.maxSeconds - profile.minSeconds + 1 }, (_, index) => profile.minSeconds + index),
        resolutions: [...(profile.allowedResolutions ?? profile.suggestedResolutions)],
        maxReferenceImages: profile.supportsReferenceImages ? profile.maxReferenceImages ?? defaults.maxReferenceImages : 0,
        maxReferenceVideos: profile.supportsReferenceVideos ? profile.maxReferenceVideos ?? defaults.maxReferenceVideos : 0,
        maxAudios: profile.supportsReferenceAudios ? profile.maxReferenceAudios ?? defaults.maxAudios : 0,
        ...(profile.maxTotalInputs !== undefined ? { maxTotalInputs: profile.maxTotalInputs } : {}),
        notes: [
          ...(profile.supportsDuration ? [`${profile.publicModel}：${profile.minSeconds}–${profile.maxSeconds} 秒整数时长`] : []),
          ...(profile.supportsAspectRatio ? ['画面比例按当前型号文档配置'] : []),
          ...(profile.supportsResolution ? [profile.allowedResolutions ? '分辨率使用文档明确支持的枚举值' : '分辨率使用文档建议值，不代表完整允许枚举'] : []),
          ...(profile.requiresDuration ? ['必须指定视频时长'] : []),
          ...(profile.requiresAspectRatio ? ['必须指定画面比例'] : []),
          ...(profile.allowedResolutions ? [`分辨率仅支持 ${profile.allowedResolutions.join(' / ')}`] : []),
          ...(profile.maxTotalInputs !== undefined ? [`参考素材总数最多 ${profile.maxTotalInputs} 个`] : []),
          ...(profile.maxReferenceImages === undefined || profile.maxReferenceVideos === undefined || profile.maxReferenceAudios === undefined
            ? ['文档未核实的素材分类使用本站安全上限，不代表服务商上限']
            : []),
          ...(profile.supportsFirstFrame ? ['支持首帧图片'] : ['不支持首帧图片']),
          ...(profile.supportsLastFrame ? ['支持尾帧图片'] : ['不支持尾帧图片']),
          ...(profile.requiresFirstFrameForLastFrame ? ['尾帧必须与首帧一起提供；首帧可以单独使用'] : []),
          ...(profile.allowsFramesWithReferences === false ? ['首尾帧不能与参考图片、视频或音频混合'] : []),
          ...(profile.allowsFramesWithAudio === false ? ['提供首尾帧时不能同时使用参考音频'] : []),
          ...(profile.requiresImageWithVideoOrAudio ? ['使用参考视频或音频时必须至少再提供一张参考图'] : []),
          ...(profile.allowsNoReferences ? ['可以不提供参考素材'] : []),
          '参考素材必须是公网 HTTPS URL',
          '本站 inline 图片设有 30 MiB 安全上限，实际文件上传限制由上传服务执行',
        ],
      };
    }
    return {
      ...defaults,
      maxReferenceImages: 0,
      maxReferenceVideos: 0,
      maxAudios: 0,
      notes: ['该视频型号的参数说明尚未完善，暂不可生成，请选择已有完整说明的型号'],
    };
  }
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

export function getVideoModelLimitsForInput(
  model: { rawId?: string; displayName?: string } | undefined,
  provider: VideoProviderIdentity | string | undefined,
  input: VideoModelInputContext,
): VideoModelLimits {
  const limits = getVideoModelLimits(model, provider);
  const providerIdentity: VideoProviderIdentity = typeof provider === 'string' ? { platform: provider } : (provider || {});
  const referenceImageCount = Number.isFinite(input.referenceImageCount)
    ? Math.max(0, Math.floor(input.referenceImageCount || 0))
    : 0;
  const referenceVideoCount = Number.isFinite(input.referenceVideoCount)
    ? Math.max(0, Math.floor(input.referenceVideoCount || 0))
    : 0;
  const audioCount = Number.isFinite(input.audioCount)
    ? Math.max(0, Math.floor(input.audioCount || 0))
    : 0;
  const isMultiframe = isJimengProvider(providerIdentity)
    && isJimengLegacyCli(providerIdentity)
    && input.referenceMode === 'multiframe'
    && !input.hasFirstFrame
    && !input.hasLastFrame
    && referenceVideoCount === 0
    && audioCount === 0
    && referenceImageCount > 1;
  if (isMultiframe) {
    const exactlyTwoImages = referenceImageCount === 2;
    const minSeconds = exactlyTwoImages ? 2 : 1;
    return {
      ...limits,
      minSeconds,
      maxSeconds: 8,
      allowedSeconds: jimengDurations(minSeconds, 8),
      durationScope: exactlyTwoImages ? 'total' : 'per-transition',
      aspectRatioSource: 'first-reference',
      resolutions: ['720p', '1080p'],
      maxReferenceImages: 20,
      maxReferenceVideos: 0,
      maxAudios: 0,
      maxTotalInputs: 20,
      notes: [
        exactlyTwoImages
          ? '即梦 CLI multiframe2video：双图总时长 2–8 秒'
          : '即梦 CLI multiframe2video：每段转场时长 1–8 秒',
        '分辨率仅支持 720p/1080p，画面比例由首张参考图推断',
        '该命令使用固定后端模型，不传入所选 Seedance 版本',
      ],
    };
  }

  const hasMultimodalInput = referenceVideoCount > 0 || audioCount > 0;
  if (!hasMultimodalInput || !isJimengProvider(providerIdentity)) {
    if (!hasMultimodalInput) {
      const isSeedance25Frame = /seedance[-_. ]?2\.5/i.test(String(model?.rawId || model?.displayName || ''))
        && Boolean(input.hasFirstFrame || input.hasLastFrame || referenceImageCount > 0);
      if (isSeedance25Frame) return { ...limits, aspectRatioSource: 'first-reference' };
    }
    return limits;
  }

  const rawId = String(model?.rawId || model?.displayName || '').toLowerCase();
  const seedance25 = /seedance[-_. ]?2\.5/.test(rawId);
  const seedance20 = /seedance[-_. ]?2\.0/.test(rawId);
  if (seedance25) {
    return {
      ...limits,
      maxReferenceImages: 30,
      maxReferenceVideos: 10,
      maxAudios: 10,
      maxTotalInputs: 50,
      notes: [...limits.notes, '即梦 CLI multimodal2video：图片最多 30 张、视频最多 10 个、音频最多 10 段，总输入最多 50 个；音视频素材 2–30 秒'],
    };
  }
  if (seedance20) {
    return {
      ...limits,
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxAudios: 3,
      maxTotalInputs: 12,
      requiresVisualInput: true,
      notes: [...limits.notes, '即梦 CLI multimodal2video：至少一张图片或一个视频；图片最多 9 张、视频最多 3 个、音频最多 3 段，总输入最多 12 个；音视频素材 2–15 秒'],
    };
  }
  return limits;
}

export { allRatios };
