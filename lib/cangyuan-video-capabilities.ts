import type { VideoGenerationInput } from './types';
import { getCangyuanVideoModelSpec, getCangyuanVideoParameter } from './cangyuan-video-model-catalog';
import type { CangyuanVideoModelSpec, CangyuanVideoParameterSpec } from '@/packages/contracts/video-generation';
import { cangyuanVideoParameterLabel, cangyuanVideoParameterLabelByName, getCangyuanVideoAdvancedParameters } from './cangyuan-video-model-catalog';

export const CANGYUAN_SEEDANCE_FAST_MODEL = 'sd20-seedance-2.0-fast';
export const CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES = 30 * 1024 * 1024;

export function isCangyuanVideoModelSelectable(publicModel: string) {
  const spec = getCangyuanVideoModelSpec(publicModel);
  const profile = getCangyuanVideoModelProfile(publicModel);
  return Boolean(spec?.params.length && profile?.publicModel === publicModel);
}

export type CangyuanVideoModelProfile = {
  publicModel: string;
  supportsDuration: boolean;
  fixedSeconds?: number;
  durationDefault?: number;
  supportsAspectRatio: boolean;
  aspectRatioDefault?: string;
  supportsResolution: boolean;
  resolutionDefault?: string;
  minSeconds: number;
  maxSeconds: number;
  suggestedAspectRatios: readonly string[];
  suggestedResolutions: readonly string[];
  allowedResolutions?: readonly string[];
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  maxTotalInputs?: number;
  maxReferenceImageFileBytes?: number;
  maxReferenceVideoFileBytes?: number;
  maxReferenceAudioFileBytes?: number;
  minReferenceVideoSeconds?: number;
  maxReferenceVideoSeconds?: number;
  maxTotalReferenceVideoSeconds?: number;
  maxReferenceAudioSeconds?: number;
  maxReferenceImageBytes: number;
  seedWireType?: 'number' | 'string';
  seedMin?: number;
  seedMax?: number;
  supportsReferenceImages: boolean;
  supportsReferenceVideos: boolean;
  supportsReferenceAudios: boolean;
  supportsSeed: boolean;
  supportsGenerateAudio?: boolean;
  generateAudioDefault?: boolean;
  supportsEdit?: boolean;
  supportsExtend?: boolean;
  supportsFirstFrame: boolean;
  supportsLastFrame: boolean;
  supportsFirstLastFrames: boolean;
  requiresDuration?: boolean;
  requiresAspectRatio?: boolean;
  allowsFirstFrameWithoutLastFrame?: boolean;
  requiresFirstFrameForLastFrame?: boolean;
  allowsFramesWithReferences?: boolean;
  allowsFramesWithAudio?: boolean;
  allowsNoReferences?: boolean;
  requiresImageWithVideoOrAudio?: boolean;
};

const suggestedAspectRatios = ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'] as const;

type CangyuanVideoModelProfileInput = Omit<
  CangyuanVideoModelProfile,
  | 'publicModel'
  | 'minSeconds'
  | 'maxSeconds'
  | 'supportsDuration'
  | 'supportsAspectRatio'
  | 'supportsResolution'
  | 'maxReferenceImageBytes'
  | 'supportsSeed'
  | 'supportsFirstLastFrames'
  | 'suggestedResolutions'
> & {
  minSeconds?: number;
  maxSeconds?: number;
  suggestedAspectRatios?: readonly string[];
  suggestedResolutions?: readonly string[];
  supportsSeed?: boolean;
};

function seedance20Profile(publicModel: string, input: CangyuanVideoModelProfileInput): CangyuanVideoModelProfile {
  return Object.freeze({
    ...input,
    publicModel,
    supportsDuration: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsReferenceImages: input.supportsReferenceImages ?? false,
    supportsReferenceVideos: input.supportsReferenceVideos ?? false,
    supportsReferenceAudios: input.supportsReferenceAudios ?? false,
    supportsFirstFrame: input.supportsFirstFrame ?? false,
    supportsLastFrame: input.supportsLastFrame ?? false,
    minSeconds: input.minSeconds ?? 4,
    maxSeconds: input.maxSeconds ?? 15,
    suggestedAspectRatios: input.suggestedAspectRatios ?? suggestedAspectRatios,
    suggestedResolutions: input.suggestedResolutions ?? ['720p'],
    maxReferenceImageBytes: CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
    supportsSeed: input.supportsSeed ?? false,
    supportsFirstLastFrames: input.supportsFirstFrame && input.supportsLastFrame,
  });
}

const allReferences = {
  supportsReferenceImages: true,
  supportsReferenceVideos: true,
  supportsReferenceAudios: true,
};
const nineThreeThree = { maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3 };
const noFrames = { supportsFirstFrame: false, supportsLastFrame: false };
const CANGYUAN_VIDEO_MODEL_PROFILES: Readonly<Record<string, CangyuanVideoModelProfile>> = Object.freeze({
  'sd10-seedance-2.0': seedance20Profile('sd10-seedance-2.0', {
    ...allReferences, ...nineThreeThree, ...noFrames, suggestedResolutions: ['720p'],
    suggestedAspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1'],
    allowedResolutions: ['480p', '720p'], allowsNoReferences: true, requiresImageWithVideoOrAudio: true,
  }),
  'sd10-seedance-2.0-fast': seedance20Profile('sd10-seedance-2.0-fast', {
    ...allReferences, ...nineThreeThree, ...noFrames, suggestedResolutions: ['720p'],
    suggestedAspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1'],
    allowedResolutions: ['480p', '720p'], allowsNoReferences: true, requiresImageWithVideoOrAudio: true,
  }),
  'sd10-seedance-2.0-mini': seedance20Profile('sd10-seedance-2.0-mini', {
    supportsReferenceImages: true, supportsReferenceVideos: false, supportsReferenceAudios: false,
    maxReferenceImages: 9, maxReferenceVideos: 0, maxReferenceAudios: 0, ...noFrames,
    minSeconds: 5, maxSeconds: 10, suggestedAspectRatios: ['16:9', '9:16', '1:1'],
    suggestedResolutions: ['720p'], allowsNoReferences: true,
  }),
  'sd11-seedance-2.0': seedance20Profile('sd11-seedance-2.0', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    minSeconds: 4, maxSeconds: 15, supportsSeed: true, allowsFirstFrameWithoutLastFrame: true,
    requiresFirstFrameForLastFrame: true,
    suggestedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    suggestedResolutions: ['480p', '720p', '1080p'], allowsNoReferences: true,
  }),
  'sd11-seedance-2.0-fast': seedance20Profile('sd11-seedance-2.0-fast', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    supportsSeed: true, allowsFirstFrameWithoutLastFrame: true, requiresFirstFrameForLastFrame: true,
    suggestedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd11-seedance-2.0-mini': seedance20Profile('sd11-seedance-2.0-mini', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    supportsSeed: true, allowsFirstFrameWithoutLastFrame: true, requiresFirstFrameForLastFrame: true,
    suggestedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd12-seedance-2.0': seedance20Profile('sd12-seedance-2.0', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: true, requiresFirstFrameForLastFrame: true,
    allowsFramesWithAudio: false, suggestedResolutions: ['480p'],
    suggestedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'], allowsNoReferences: true,
  }),
  'sd12-seedance-2.0-fast': seedance20Profile('sd12-seedance-2.0-fast', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: true, requiresFirstFrameForLastFrame: true,
    allowsFramesWithAudio: false, suggestedResolutions: ['480p'],
    suggestedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'], allowsNoReferences: true,
  }),
  'sd12-seedance-2.0-mini': seedance20Profile('sd12-seedance-2.0-mini', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: true, requiresFirstFrameForLastFrame: true,
    allowsFramesWithAudio: false, suggestedResolutions: ['480p'],
    suggestedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'], allowsNoReferences: true,
  }),
  'sd13-seedance-2.0': seedance20Profile('sd13-seedance-2.0', {
    supportsReferenceImages: true, supportsReferenceVideos: true, supportsReferenceAudios: false,
    maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 0, ...noFrames,
    suggestedAspectRatios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['480p', '720p', '1080p', '4k'], allowsNoReferences: true,
  }),
  'sd13-seedance-2.0-fast': seedance20Profile('sd13-seedance-2.0-fast', {
    supportsReferenceImages: true, supportsReferenceVideos: true, supportsReferenceAudios: false,
    maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 0, ...noFrames,
    suggestedAspectRatios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd13-seedance-2.0-mini': seedance20Profile('sd13-seedance-2.0-mini', {
    supportsReferenceImages: true, supportsReferenceVideos: true, supportsReferenceAudios: false,
    maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 0, ...noFrames,
    suggestedAspectRatios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd14-seedance-2.0': seedance20Profile('sd14-seedance-2.0', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: true, requiresFirstFrameForLastFrame: true,
    allowsFramesWithReferences: false, suggestedResolutions: ['720p'],
    suggestedAspectRatios: ['1:1', '16:9', '9:16'], allowsNoReferences: true,
  }),
  'sd15-seedance-2.0': seedance20Profile('sd15-seedance-2.0', {
    ...allReferences, ...nineThreeThree, ...noFrames, suggestedResolutions: ['480p', '720p'],
    suggestedAspectRatios: ['1:1', '16:9', '9:16'], allowsNoReferences: true,
  }),
  // The upstream catalog calls generate_audio a string without an enum for
  // sd4/sd5, while its prose says audio is enabled by default. Keep the field
  // unavailable until the provider publishes an unambiguous wire contract.
  'sd4-seedance-2.0': seedance20Profile('sd4-seedance-2.0', {
    ...allReferences,
    maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1,
    maxReferenceImageFileBytes: 25 * 1024 * 1024,
    maxReferenceVideoFileBytes: 200 * 1024 * 1024,
    maxReferenceAudioFileBytes: 15 * 1024 * 1024,
    minReferenceVideoSeconds: 4, maxReferenceVideoSeconds: 15, maxTotalReferenceVideoSeconds: 15,
    maxReferenceAudioSeconds: 15,
    supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    allowsFramesWithReferences: false, allowsNoReferences: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '21:9', '3:4', '4:3'],
    suggestedResolutions: ['480p', '720p'],
  }),
  'sd4-seedance-2.0-fast': seedance20Profile('sd4-seedance-2.0-fast', {
    ...allReferences,
    maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1,
    maxReferenceImageFileBytes: 25 * 1024 * 1024,
    maxReferenceVideoFileBytes: 200 * 1024 * 1024,
    maxReferenceAudioFileBytes: 15 * 1024 * 1024,
    minReferenceVideoSeconds: 4, maxReferenceVideoSeconds: 15, maxTotalReferenceVideoSeconds: 15,
    maxReferenceAudioSeconds: 15,
    supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    allowsFramesWithReferences: false, allowsNoReferences: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '21:9', '3:4', '4:3'],
    suggestedResolutions: ['480p', '720p'],
  }),
  'sd4-seedance-2.0-mini': seedance20Profile('sd4-seedance-2.0-mini', {
    ...allReferences,
    maxReferenceImages: 4, maxReferenceVideos: 3, maxReferenceAudios: 1,
    maxReferenceImageFileBytes: 25 * 1024 * 1024,
    maxReferenceVideoFileBytes: 200 * 1024 * 1024,
    maxReferenceAudioFileBytes: 15 * 1024 * 1024,
    minReferenceVideoSeconds: 4, maxReferenceVideoSeconds: 15, maxTotalReferenceVideoSeconds: 15,
    maxReferenceAudioSeconds: 15,
    supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    allowsFramesWithReferences: false, allowsNoReferences: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '21:9', '3:4', '4:3'],
    suggestedResolutions: ['480p', '720p'],
  }),
  'sd5-seedance-2.0': seedance20Profile('sd5-seedance-2.0', {
    ...allReferences,
    maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxTotalInputs: 12,
    maxReferenceImageFileBytes: 30 * 1024 * 1024,
    maxReferenceVideoFileBytes: 50 * 1024 * 1024,
    maxReferenceAudioFileBytes: 15 * 1024 * 1024,
    minReferenceVideoSeconds: 1, maxReferenceVideoSeconds: 15, maxTotalReferenceVideoSeconds: 45,
    maxReferenceAudioSeconds: 15,
    supportsSeed: true, seedWireType: 'number', seedMin: 0, seedMax: 2_147_483_647,
    supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    allowsFramesWithReferences: false, allowsNoReferences: true,
    suggestedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['480p', '720p'],
  }),
  'sd5-seedance-2.0-fast': seedance20Profile('sd5-seedance-2.0-fast', {
    ...allReferences,
    maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxTotalInputs: 12,
    maxReferenceImageFileBytes: 30 * 1024 * 1024,
    maxReferenceVideoFileBytes: 50 * 1024 * 1024,
    maxReferenceAudioFileBytes: 15 * 1024 * 1024,
    minReferenceVideoSeconds: 1, maxReferenceVideoSeconds: 15, maxTotalReferenceVideoSeconds: 45,
    maxReferenceAudioSeconds: 15,
    supportsSeed: true, seedWireType: 'number', seedMin: 0, seedMax: 2_147_483_647,
    supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    allowsFramesWithReferences: false, allowsNoReferences: true,
    suggestedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['480p', '720p'],
  }),
  'sd7-seedance-2.0-720p': seedance20Profile('sd7-seedance-2.0-720p', {
    ...allReferences, maxReferenceImages: 5, maxReferenceVideos: 3, maxReferenceAudios: 3,
    ...noFrames, maxTotalInputs: 11, suggestedResolutions: ['720p', '1080p'],
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], allowsNoReferences: true,
  }),
  'sd7-seedance-2.0-1080p': seedance20Profile('sd7-seedance-2.0-1080p', {
    ...allReferences, maxReferenceImages: 5, maxReferenceVideos: 3, maxReferenceAudios: 3,
    ...noFrames, maxTotalInputs: 11, suggestedResolutions: ['720p', '1080p'],
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], allowsNoReferences: true,
  }),
  'sd8-seedance-2.0-mini': seedance20Profile('sd8-seedance-2.0-mini', {
    supportsReferenceImages: true, supportsReferenceVideos: false, supportsReferenceAudios: true,
    maxReferenceImages: 3, maxReferenceVideos: 0, maxReferenceAudios: 1,
    ...noFrames, maxTotalInputs: 4, suggestedResolutions: ['720p'],
    suggestedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], allowsNoReferences: true,
  }),
  'sd16-seedance-2.0': seedance20Profile('sd16-seedance-2.0', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    suggestedResolutions: ['480p', '720p', '1080p', '4k'], allowsNoReferences: true,
  }),
  'sd16-seedance-2.0-fast': seedance20Profile('sd16-seedance-2.0-fast', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd16-seedance-2.0-mini': seedance20Profile('sd16-seedance-2.0-mini', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    allowsFirstFrameWithoutLastFrame: false, requiresFirstFrameForLastFrame: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd16-seedance-2.0-x1': seedance20Profile('sd16-seedance-2.0-x1', {
    ...allReferences, ...nineThreeThree, ...noFrames, minSeconds: 5,
    suggestedAspectRatios: ['9:16'], suggestedResolutions: ['720p'], allowsNoReferences: true,
  }),
  'sd17-seedance-2.0': seedance20Profile('sd17-seedance-2.0', {
    supportsReferenceImages: true, supportsReferenceVideos: false, supportsReferenceAudios: true,
    maxReferenceImages: 9, maxReferenceVideos: 0, maxReferenceAudios: 3, ...noFrames,
    minSeconds: 5, suggestedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['480p'], allowsNoReferences: true,
  }),
  'sd17-seedance-2.0-2': seedance20Profile('sd17-seedance-2.0-2', {
    supportsReferenceImages: true, supportsReferenceVideos: false, supportsReferenceAudios: true,
    maxReferenceImages: 9, maxReferenceVideos: 0, maxReferenceAudios: 3, ...noFrames,
    minSeconds: 5, suggestedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['720p'], allowsNoReferences: true,
  }),
  'sd17-seedance-2.0-3': seedance20Profile('sd17-seedance-2.0-3', {
    supportsReferenceImages: true, supportsReferenceVideos: false, supportsReferenceAudios: false,
    maxReferenceImages: 9, maxReferenceVideos: 0, maxReferenceAudios: 0, ...noFrames,
    minSeconds: 5, suggestedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    suggestedResolutions: ['720p'], allowsNoReferences: true,
  }),
  'sd17-seedance-2.0-4': seedance20Profile('sd17-seedance-2.0-4', {
    ...allReferences, ...nineThreeThree, ...noFrames, minSeconds: 5,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd20-seedance-2.0-mini': seedance20Profile('sd20-seedance-2.0-mini', {
    ...allReferences, ...nineThreeThree, ...noFrames, requiresDuration: true, requiresAspectRatio: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd20-seedance-2.0-fast': seedance20Profile('sd20-seedance-2.0-fast', {
    ...allReferences, ...nineThreeThree, ...noFrames, requiresDuration: true, requiresAspectRatio: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd22-seedance-2.0': seedance20Profile('sd22-seedance-2.0', {
    ...allReferences, ...nineThreeThree, ...noFrames, requiresDuration: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd22-seedance-2.0-fast': seedance20Profile('sd22-seedance-2.0-fast', {
    ...allReferences, ...nineThreeThree, ...noFrames, requiresDuration: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd22-seedance-2.0-2': seedance20Profile('sd22-seedance-2.0-2', {
    ...allReferences, ...nineThreeThree, ...noFrames, requiresDuration: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd22-seedance-2.0-fast-2': seedance20Profile('sd22-seedance-2.0-fast-2', {
    ...allReferences, ...nineThreeThree, ...noFrames, requiresDuration: true,
    suggestedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    suggestedResolutions: ['480p', '720p'], allowsNoReferences: true,
  }),
  'sd25-seedance-2.0': seedance20Profile('sd25-seedance-2.0', {
    ...allReferences, ...nineThreeThree, supportsFirstFrame: true, supportsLastFrame: true,
    requiresDuration: true, allowsFirstFrameWithoutLastFrame: true, requiresFirstFrameForLastFrame: true,
    allowsFramesWithReferences: false, allowsNoReferences: true,
    supportsGenerateAudio: true, generateAudioDefault: true,
    suggestedAspectRatios: ['auto', '9:16', '1:1', '3:4', '16:9', '4:3', '21:9'],
    suggestedResolutions: ['480p', '720p', '1080p'],
  }),
});

export function getCangyuanVideoModelProfile(publicModel: string): CangyuanVideoModelProfile | null {
  const spec = getCangyuanVideoModelSpec(publicModel);
  if (!spec || !spec.params.length) return null;
  const documented = profileFromVideoSpec(publicModel, spec);
  const curated = Object.hasOwn(CANGYUAN_VIDEO_MODEL_PROFILES, publicModel)
    ? CANGYUAN_VIDEO_MODEL_PROFILES[publicModel]
    : undefined;
  if (!curated) return documented;
  return Object.freeze({
    ...curated,
    ...documented,
    maxReferenceImages: documented.maxReferenceImages ?? curated.maxReferenceImages,
    maxReferenceVideos: documented.maxReferenceVideos ?? curated.maxReferenceVideos,
    maxReferenceAudios: documented.maxReferenceAudios ?? curated.maxReferenceAudios,
    maxTotalInputs: curated.maxTotalInputs,
    maxReferenceImageFileBytes: documented.maxReferenceImageFileBytes ?? curated.maxReferenceImageFileBytes,
    maxReferenceVideoFileBytes: documented.maxReferenceVideoFileBytes ?? curated.maxReferenceVideoFileBytes,
    maxReferenceAudioFileBytes: documented.maxReferenceAudioFileBytes ?? curated.maxReferenceAudioFileBytes,
    minReferenceVideoSeconds: curated.minReferenceVideoSeconds,
    maxReferenceVideoSeconds: curated.maxReferenceVideoSeconds,
    maxTotalReferenceVideoSeconds: curated.maxTotalReferenceVideoSeconds,
    maxReferenceAudioSeconds: curated.maxReferenceAudioSeconds,
    requiresFirstFrameForLastFrame: curated.requiresFirstFrameForLastFrame ?? documented.requiresFirstFrameForLastFrame,
    allowsFirstFrameWithoutLastFrame: curated.allowsFirstFrameWithoutLastFrame ?? documented.allowsFirstFrameWithoutLastFrame,
    allowsFramesWithReferences: curated.allowsFramesWithReferences ?? documented.allowsFramesWithReferences,
    allowsFramesWithAudio: curated.allowsFramesWithAudio ?? documented.allowsFramesWithAudio,
    allowsNoReferences: curated.allowsNoReferences ?? documented.allowsNoReferences,
    requiresImageWithVideoOrAudio: curated.requiresImageWithVideoOrAudio ?? documented.requiresImageWithVideoOrAudio,
  });
}

function profileFromVideoSpec(publicModel: string, spec: CangyuanVideoModelSpec): CangyuanVideoModelProfile {
  const parameter = (name: string) => getCangyuanVideoParameter(spec, name);
  const duration = parameter('duration');
  const aspectRatio = parameter('aspect_ratio');
  const resolution = parameter('resolution');
  const seed = parameter('seed');
  const audio = parameter('generate_audio');
  const image = parameter('reference_image_urls');
  const video = parameter('reference_videos') || parameter('video');
  const audioReference = parameter('reference_audios');
  const firstFrame = parameter('first_image_url');
  const lastFrame = parameter('last_image_url');
  const mode = parameter('mode');
  const supportedModes = normalizedValues(mode?.enum);
  const durationDefault = numericValue(duration?.suggestedDefault);
  const describedDurationBounds = durationBounds(duration, spec);
  const fixedSeconds = duration && describedDurationBounds.minimum === undefined && describedDurationBounds.maximum === undefined
    ? durationDefault
    : undefined;
  const rules = cangyuanVideoRuleText(spec);
  const mediaParameters = [image, video, audioReference, firstFrame, lastFrame].filter((item): item is CangyuanVideoParameterSpec => Boolean(item));
  const requiredMedia = mediaParameters.some((item) => item.required);
  const aspectRatios = parameterValues(aspectRatio);
  const resolutions = parameterValues(resolution);
  const resolutionEnum = normalizedValues(resolution?.enum);
  return Object.freeze({
    publicModel,
    supportsDuration: Boolean(duration),
    ...(fixedSeconds !== undefined ? { fixedSeconds } : {}),
    ...(durationDefault !== undefined ? { durationDefault } : {}),
    supportsAspectRatio: Boolean(aspectRatio),
    ...(typeof aspectRatio?.suggestedDefault === 'string' ? { aspectRatioDefault: aspectRatio.suggestedDefault } : {}),
    supportsResolution: Boolean(resolution),
    ...(typeof resolution?.suggestedDefault === 'string' ? { resolutionDefault: resolution.suggestedDefault } : {}),
    minSeconds: duration?.minimum ?? describedDurationBounds.minimum ?? fixedSeconds ?? 1,
    maxSeconds: duration?.maximum ?? describedDurationBounds.maximum ?? fixedSeconds ?? 60,
    suggestedAspectRatios: aspectRatios,
    suggestedResolutions: resolutions,
    ...(resolutionEnum.length ? { allowedResolutions: resolutionEnum } : {}),
    ...(image?.maxItems !== undefined ? { maxReferenceImages: image.maxItems } : {}),
    ...(parameter('reference_videos')?.maxItems !== undefined
      ? { maxReferenceVideos: parameter('reference_videos')?.maxItems }
      : video ? { maxReferenceVideos: 1 } : {}),
    ...(audioReference?.maxItems !== undefined ? { maxReferenceAudios: audioReference.maxItems } : {}),
    ...(parameterMaximumBytes(image) !== undefined ? { maxReferenceImageFileBytes: parameterMaximumBytes(image) } : {}),
    ...(parameterMaximumBytes(video) !== undefined ? { maxReferenceVideoFileBytes: parameterMaximumBytes(video) } : {}),
    ...(parameterMaximumBytes(audioReference) !== undefined ? { maxReferenceAudioFileBytes: parameterMaximumBytes(audioReference) } : {}),
    maxReferenceImageBytes: CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
    supportsReferenceImages: Boolean(image),
    supportsReferenceVideos: Boolean(video),
    supportsReferenceAudios: Boolean(audioReference),
    supportsSeed: Boolean(seed),
    ...(seed ? { seedWireType: seed.type === 'number' ? 'number' as const : 'string' as const } : {}),
    ...(seed?.minimum !== undefined ? { seedMin: seed.minimum } : {}),
    ...(seed?.maximum !== undefined ? { seedMax: seed.maximum } : {}),
    supportsGenerateAudio: audio?.type === 'boolean',
    ...(typeof audio?.suggestedDefault === 'boolean' ? { generateAudioDefault: audio.suggestedDefault } : {}),
    supportsFirstFrame: Boolean(firstFrame),
    supportsLastFrame: Boolean(lastFrame),
    supportsFirstLastFrames: Boolean(firstFrame && lastFrame),
    ...(duration?.required ? { requiresDuration: true } : {}),
    ...(aspectRatio?.required ? { requiresAspectRatio: true } : {}),
    ...(mode ? { supportsEdit: supportedModes.includes('edit'), supportsExtend: supportedModes.includes('extend') } : {}),
    ...(hasRule(rules, /尾帧[^。\n]*(?:必须|需要)[^。\n]*首帧|尾帧.*(?:同时|配对).*首帧/) ? { requiresFirstFrameForLastFrame: true } : {}),
    ...(hasRule(rules, /(?:只提供|单独使用)首帧|首帧可以单独/) ? { allowsFirstFrameWithoutLastFrame: true } : {}),
    ...(hasRule(rules, /首尾帧[^。\n]*不能[^。\n]*(?:参考图|参考图片|参考视频|参考音频)/) ? { allowsFramesWithReferences: false } : {}),
    ...(hasRule(rules, /首尾帧[^。\n]*不能[^。\n]*参考音频|首尾帧[^。\n]*不能[^。\n]*音频/) ? { allowsFramesWithAudio: false } : {}),
    ...(hasRule(rules, /参考视频或音频[^。\n]*(?:必须|至少)[^。\n]*参考图|参考视频[^。\n]*(?:必须|至少)[^。\n]*参考图/) ? { requiresImageWithVideoOrAudio: true } : {}),
    allowsNoReferences: !requiredMedia,
  });
}

function cangyuanVideoRuleText(spec: CangyuanVideoModelSpec) {
  const sections = (spec.sections || []).flatMap((section) => section.items || []);
  const descriptions = spec.params.map((parameter) => parameter.description || '');
  return [...(spec.warnings || []), ...sections, ...descriptions].join('\n');
}

function durationBounds(parameter: CangyuanVideoParameterSpec | undefined, spec: CangyuanVideoModelSpec) {
  if (!parameter) return {};
  let minimum = parameter.minimum;
  let maximum = parameter.maximum;
  const text = [parameter.description, ...(spec.sections || []).flatMap((section) => section.items || [])]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  const range = text.match(/(?:时长|duration)[^\d\n]{0,24}(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*(?:-|–|—|至|到)\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/i);
  if (range) {
    minimum ??= Number(range[1]);
    maximum ??= Number(range[2]);
  }
  const fixed = text.match(/(?:固定|仅支持|时长为)[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(?:秒|s)/i);
  if (fixed) {
    const value = Number(fixed[1]);
    minimum ??= value;
    maximum ??= value;
  }
  const enumValues = normalizedValues(parameter.enum).map(Number).filter(Number.isFinite);
  if (minimum === undefined && maximum === undefined && enumValues.length === 1) {
    minimum = enumValues[0];
    maximum = enumValues[0];
  }
  return { minimum, maximum };
}

function documentedVideoParameterValue(
  name: string,
  publicModel: string,
  input: VideoGenerationInput,
  sourceVideo?: string,
): unknown {
  const spec = getCangyuanVideoModelSpec(publicModel);
  if (!spec) return undefined;
  const mode = input.operation && input.operation !== 'generate' ? input.operation : input.modelParameters?.mode;
  const referenceVideos = mediaValues(input.referenceVideos, getCangyuanVideoParameter(spec, 'video') ? undefined : input.referenceVideo);
  const referenceAudios = mediaValues(input.audios, input.audio);
  switch (name) {
    case 'model': return publicModel;
    case 'prompt': return input.prompt.trim();
    case 'duration': return input.seconds;
    case 'aspect_ratio': return input.aspectRatio;
    case 'resolution': return input.resolution;
    case 'seed': return input.seed;
    case 'generate_audio': return input.generateAudio ?? input.modelParameters?.generate_audio;
    case 'reference_image_urls': return mediaValues(input.referenceImages);
    case 'reference_videos': return referenceVideos;
    case 'reference_audios': return referenceAudios;
    case 'first_image_url': return cleanMedia(input.firstFrame);
    case 'last_image_url': return cleanMedia(input.lastFrame);
    case 'video': return sourceVideo;
    case 'mode': return mode;
    default: return input.modelParameters?.[name];
  }
}

function isEmptyDocumentedParameter(value: unknown) {
  return value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0;
}

function validateDocumentedVideoParameters(
  publicModel: string,
  spec: CangyuanVideoModelSpec,
  input: VideoGenerationInput,
  sourceVideo?: string,
) {
  const domainValidatedParameters = new Set([
    'model', 'prompt', 'duration', 'aspect_ratio', 'resolution', 'seed', 'generate_audio',
    'reference_image_urls', 'reference_videos', 'reference_audios', 'first_image_url', 'last_image_url', 'video',
  ]);
  for (const parameter of spec.params) {
    const value = documentedVideoParameterValue(parameter.name, publicModel, input, sourceVideo);
    const label = cangyuanVideoParameterLabel(parameter);
    if (parameter.required && isEmptyDocumentedParameter(value)
      && !['model', 'prompt', 'duration', 'aspect_ratio'].includes(parameter.name)) {
      throw new Error(`沧元算力 ${publicModel} 必须提供${label}。`);
    }
    if (isEmptyDocumentedParameter(value) || domainValidatedParameters.has(parameter.name)) continue;

    const validType = parameter.type === 'array'
      ? Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      : parameter.type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : parameter.type === 'boolean'
          ? typeof value === 'boolean'
          : typeof value === 'string';
    if (!validType) throw new Error(`${label}格式不正确，请按当前模型的参数类型填写。`);
    if (typeof value === 'number') {
      if (parameter.minimum !== undefined && value < parameter.minimum) throw new Error(`${label}不能小于 ${parameter.minimum}。`);
      if (parameter.maximum !== undefined && value > parameter.maximum) throw new Error(`${label}不能大于 ${parameter.maximum}。`);
    }
    if (typeof value === 'string') {
      if (parameter.minLength !== undefined && value.length < parameter.minLength) throw new Error(`${label}至少需要 ${parameter.minLength} 个字符。`);
      if (parameter.maxLength !== undefined && value.length > parameter.maxLength) throw new Error(`${label}不能超过 ${parameter.maxLength} 个字符。`);
    }
    if (Array.isArray(value) && parameter.maxItems !== undefined && value.length > parameter.maxItems) {
      throw new Error(`${label}最多支持 ${parameter.maxItems} 项。`);
    }
    const allowedValues = normalizedValues(parameter.enum);
    if (allowedValues.length) {
      const values = Array.isArray(value) ? value : [value];
      if (values.some((entry) => typeof entry !== 'string' || !allowedValues.includes(entry))) {
        throw new Error(`${label}仅支持 ${allowedValues.join('、')}。`);
      }
    }
  }
}

function hasRule(value: string, pattern: RegExp) {
  return pattern.test(value);
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizedValues(value: string[] | string | undefined): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && Boolean(item.trim())) : [];
}

function parameterValues(parameter: CangyuanVideoParameterSpec | undefined) {
  if (!parameter) return [];
  return normalizedValues(parameter.suggestions).length
    ? normalizedValues(parameter.suggestions)
    : normalizedValues(parameter.enum).length
      ? normalizedValues(parameter.enum)
      : typeof parameter.suggestedDefault === 'string' ? [parameter.suggestedDefault] : [];
}

function parameterMaximumBytes(parameter: CangyuanVideoParameterSpec | undefined) {
  const description = parameter?.description || '';
  const match = description.match(/(?:最多|上限|最大)\s*([\d.]+)\s*(字节|bytes?|KiB|MiB|GiB|KB|MB|GB)/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2].toLowerCase();
  const factor = unit === '字节' || unit === 'byte' || unit === 'bytes' ? 1
    : unit === 'kib' ? 1024 : unit === 'mib' ? 1024 ** 2 : unit === 'gib' ? 1024 ** 3
      : unit === 'kb' ? 1000 : unit === 'mb' ? 1000 ** 2 : 1000 ** 3;
  return Math.floor(amount * factor);
}

export function cangyuanVideoImageSizeError(publicModel: string, byteLength: number) {
  const profile = getCangyuanVideoModelProfile(publicModel);
  if (!profile || !Number.isFinite(byteLength) || byteLength < 0 || byteLength <= profile.maxReferenceImageBytes) return null;
  return `本站对沧元算力 ${publicModel} 的单张 inline 图片设置了 30 MiB 安全上限；实际上传大小还受上传服务限制。`;
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
  const spec = getCangyuanVideoModelSpec(publicModel);
  if (!spec) throw new Error(`沧元算力视频型号未出现在当前官方目录中：${publicModel}`);
  if (!spec.params.length) throw new Error(`沧元算力 ${publicModel} 的官方参数说明尚未补齐，请选择其他型号。`);
  const profile = getCangyuanVideoModelProfile(publicModel);
  if (!profile) throw new Error(`沧元算力 ${publicModel} 缺少可验证的参数规格。`);
  const videoSourceParameter = getCangyuanVideoParameter(spec, 'video');
  const modeParameter = getCangyuanVideoParameter(spec, 'mode');
  const rawReferenceVideos = mediaValues(input.referenceVideos, videoSourceParameter ? undefined : input.referenceVideo);
  const sourceVideo = cleanMedia(input.referenceVideo)
    || (videoSourceParameter && !getCangyuanVideoParameter(spec, 'reference_videos') && rawReferenceVideos.length === 1 ? rawReferenceVideos[0] : undefined);
  const referenceVideos = rawReferenceVideos.filter((value) => value !== sourceVideo);
  const unsupported: string[] = [];
  const addIfPresent = (value: unknown, label: string) => {
    if (value !== undefined && value !== null && value !== '') unsupported.push(label);
  };
  const referenceAudios = mediaValues(input.audios, input.audio);
  const referenceImages = mediaValues(input.referenceImages);
  const firstFrame = cleanMedia(input.firstFrame);
  const lastFrame = cleanMedia(input.lastFrame);
  const hasFrames = Boolean(firstFrame || lastFrame);
  const hasReferences = Boolean(referenceImages.length || referenceVideos.length || referenceAudios.length);

  if (input.generateAudio !== undefined && typeof input.generateAudio !== 'boolean') {
    throw new Error('generate_audio 必须是布尔值。');
  }
  const modelMode = input.modelParameters?.mode;
  const requestedMode = input.operation && input.operation !== 'generate' ? input.operation : modelMode;
  if (input.operation && input.operation !== 'generate' && modelMode !== undefined && modelMode !== input.operation) {
    throw new Error('生成操作与型号模式不能互相冲突。');
  }
  if (input.operation === 'edit' && !profile.supportsEdit || input.operation === 'extend' && !profile.supportsExtend) {
    throw new Error(`沧元算力 ${profile.publicModel} 不支持${input.operation === 'edit' ? '视频编辑' : '视频扩展'}。`);
  }
  if (input.operation && input.operation !== 'generate' && !modeParameter) unsupported.push('操作类型');
  addIfPresent(input.width, 'width');
  addIfPresent(input.height, 'height');
  addIfPresent(input.numFrames, 'num_frames');
  addIfPresent(input.frameRate, 'frame_rate');
  addIfPresent(input.videoSize, 'size');
  addIfPresent(input.referenceVideoStartSeconds, '参考视频起始时间');
  addIfPresent(input.referenceVideoEndSeconds, '参考视频结束时间');
  if (input.requireAudio !== undefined) throw unsupportedFieldsError(['generate_audio']);

  if (!profile.supportsDuration) addIfPresent(input.seconds, 'duration');
  if (!profile.supportsAspectRatio) addIfPresent(input.aspectRatio, 'aspect_ratio');
  if (!profile.supportsResolution) addIfPresent(input.resolution, 'resolution');
  if (!profile.supportsSeed) addIfPresent(input.seed, 'seed');
  if (!profile.supportsGenerateAudio) addIfPresent(input.generateAudio, 'generate_audio');
  if (!profile.supportsReferenceImages) addIfPresent(referenceImages.length ? referenceImages : undefined, '参考图片');
  if (!profile.supportsReferenceVideos) addIfPresent(referenceVideos.length ? referenceVideos : undefined, '参考视频');
  if (!profile.supportsReferenceAudios) addIfPresent(referenceAudios.length ? referenceAudios : undefined, '参考音频');
  if (!profile.supportsFirstFrame) addIfPresent(firstFrame, '首帧');
  if (!profile.supportsLastFrame) addIfPresent(lastFrame, '尾帧');
  if (unsupported.length) throw unsupportedModelFieldsError(profile.publicModel, unsupported);

  const documentedNames = new Set(spec.params.map((parameter) => parameter.name));
  const advancedNames = new Set(getCangyuanVideoAdvancedParameters(spec).map((parameter) => parameter.name));
  if (modeParameter) advancedNames.add('mode');
  const unsupportedParameters = Object.keys(input.modelParameters || {})
    .filter((name) => !documentedNames.has(name) || !advancedNames.has(name));
  if (unsupportedParameters.length) {
    throw unsupportedModelFieldsError(profile.publicModel, unsupportedParameters.map(cangyuanVideoParameterLabelByName));
  }
  validateDocumentedVideoParameters(publicModel, spec, input, sourceVideo);

  if (profile.requiresDuration && input.seconds === undefined) {
    throw new Error(`沧元算力 ${profile.publicModel} 必须指定视频时长。`);
  }
  if (profile.requiresAspectRatio && !String(input.aspectRatio || '').trim()) {
    throw new Error(`沧元算力 ${profile.publicModel} 必须指定画面比例。`);
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
  if (profile.allowedResolutions && input.resolution !== undefined
    && !profile.allowedResolutions.includes(String(input.resolution).trim().toLowerCase())) {
    throw new Error(`沧元算力 ${profile.publicModel} 的 resolution 仅支持 ${profile.allowedResolutions.join(' / ')}。`);
  }
  if (profile.maxReferenceImages !== undefined && referenceImages.length > profile.maxReferenceImages) {
    throw new Error(`沧元算力 ${profile.publicModel} 最多接收 ${profile.maxReferenceImages} 张参考图。`);
  }
  if (profile.maxReferenceVideos !== undefined && referenceVideos.length + (sourceVideo && !getCangyuanVideoParameter(spec, 'reference_videos') ? 1 : 0) > profile.maxReferenceVideos) {
    throw new Error(`沧元算力 ${profile.publicModel} 最多接收 ${profile.maxReferenceVideos} 个参考视频。`);
  }
  if (profile.maxReferenceAudios !== undefined && referenceAudios.length > profile.maxReferenceAudios) {
    throw new Error(`沧元算力 ${profile.publicModel} 最多接收 ${profile.maxReferenceAudios} 段参考音频。`);
  }
  const totalInputs = referenceImages.length + referenceVideos.length + referenceAudios.length + (sourceVideo ? 1 : 0);
  if (profile.maxTotalInputs !== undefined && totalInputs > profile.maxTotalInputs) {
    throw new Error(`沧元算力 ${profile.publicModel} 的参考素材总数不能超过 ${profile.maxTotalInputs} 个。`);
  }
  if (profile.allowsNoReferences === false && !hasReferences && !hasFrames && !sourceVideo) {
    throw new Error(`沧元算力 ${profile.publicModel} 必须至少提供一项参考素材或首尾帧。`);
  }
  if (input.seed !== undefined) {
    if (!Number.isSafeInteger(input.seed)) throw new Error('沧元算力 seed 必须是安全整数。');
    if (profile.seedMin !== undefined && input.seed < profile.seedMin) {
      throw new Error(`沧元算力 ${profile.publicModel} 的随机种子不能小于 ${profile.seedMin}。`);
    }
    if (profile.seedMax !== undefined && input.seed > profile.seedMax) {
      throw new Error(`沧元算力 ${profile.publicModel} 的随机种子不能大于 ${profile.seedMax}。`);
    }
  }
  if (profile.requiresFirstFrameForLastFrame && lastFrame && !firstFrame) {
    throw new Error(`沧元算力 ${profile.publicModel} 使用尾帧时必须同时提供首帧；首帧可以单独使用。`);
  }
  if (profile.allowsFirstFrameWithoutLastFrame === false && firstFrame && !lastFrame) {
    throw new Error(`沧元算力 ${profile.publicModel} 的首帧和尾帧必须成对提供。`);
  }
  if (hasFrames && hasReferences && profile.allowsFramesWithReferences === false) {
    throw new Error(`沧元算力 ${profile.publicModel} 的首尾帧不能与参考图、参考视频或参考音频同时使用。`);
  }
  if (hasFrames && referenceAudios.length && profile.allowsFramesWithAudio === false) {
    throw new Error(`沧元算力 ${profile.publicModel} 提供首尾帧时不能同时使用参考音频。`);
  }
  if (profile.requiresImageWithVideoOrAudio && (referenceVideos.length || referenceAudios.length || sourceVideo) && !referenceImages.length) {
    throw new Error(`沧元算力 ${profile.publicModel} 使用参考视频或音频时，必须至少再提供一张参考图。`);
  }

  if (options.requirePublicMedia !== false) {
    for (const url of [...referenceImages, ...referenceVideos, ...referenceAudios, ...(sourceVideo ? [sourceVideo] : []), ...(firstFrame ? [firstFrame] : []), ...(lastFrame ? [lastFrame] : [])]) {
      if (!isPublicHttpsUrl(url)) throw new Error('沧元算力视频参考素材必须使用公网 HTTPS URL；本地文件、Base64 和内网地址不可用。');
    }
  }
}

export function buildCangyuanVideoPayload(publicModel: string, input: VideoGenerationInput) {
  validateCangyuanVideoInput(publicModel, input);
  const spec = getCangyuanVideoModelSpec(publicModel);
  if (!spec) throw new Error(`沧元算力视频型号未出现在当前官方目录中：${publicModel}`);
  const profile = getCangyuanVideoModelProfile(publicModel);
  if (!profile) throw new Error(`沧元算力 ${publicModel} 缺少可验证的参数规格。`);
  const sourceVideo = cleanMedia(input.referenceVideo)
    || (getCangyuanVideoParameter(spec, 'video') && !getCangyuanVideoParameter(spec, 'reference_videos')
      ? mediaValues(input.referenceVideos)[0]
      : undefined);
  const referenceVideos = mediaValues(input.referenceVideos, getCangyuanVideoParameter(spec, 'video') ? undefined : input.referenceVideo);
  const values: Record<string, unknown> = {
    model: publicModel,
    prompt: input.prompt.trim(),
    duration: input.seconds,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    seed: input.seed,
    generate_audio: input.generateAudio,
    reference_image_urls: mediaValues(input.referenceImages),
    reference_videos: referenceVideos,
    reference_audios: mediaValues(input.audios, input.audio),
    first_image_url: cleanMedia(input.firstFrame),
    last_image_url: cleanMedia(input.lastFrame),
    video: sourceVideo,
    mode: input.operation && input.operation !== 'generate' ? input.operation : undefined,
    ...input.modelParameters,
  };
  if (values.seed !== undefined && profile.seedWireType === 'string') values.seed = String(values.seed);
  if (values.generate_audio === undefined && profile.supportsGenerateAudio) values.generate_audio = profile.generateAudioDefault;
  if (values.mode === undefined && input.modelParameters?.mode !== undefined) values.mode = input.modelParameters.mode;
  const payload: Record<string, unknown> = {};
  for (const parameter of spec.params) {
    let value = values[parameter.name];
    if (value === undefined) value = parameter.suggestedDefault;
    if (value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0) continue;
    payload[parameter.name] = value;
  }
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

function unsupportedModelFieldsError(publicModel: string, fields: string[]) {
  return new Error(`沧元算力 ${publicModel} 不支持或未核实这些输入：${Array.from(new Set(fields)).join('、')}。`);
}
