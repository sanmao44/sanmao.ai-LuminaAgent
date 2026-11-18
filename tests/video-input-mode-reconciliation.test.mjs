import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const componentStub = { __esModule: true, default: () => null };
const { reconcileVideoInputMode } = createTsRequire(process.cwd(), {
  '@/components/SelectMenu': componentStub,
  '@/components/ModelPicker': componentStub,
  '@/components/ReferenceMentionEditor': componentStub,
  '@/components/JimengAccountSummary': componentStub,
  '@/components/cangyuan/CangyuanMediaUploadField': componentStub,
  '@/components/cangyuan/CangyuanVideoModelParameters': componentStub,
  '@/lib/video-model-limits': { allRatios: [], getVideoModelLimits: () => ({}), getVideoModelLimitsForInput: () => ({}) },
  '@/lib/video-studio-draft': { clearVideoStudioDraft() {}, hasVideoStudioDraftContent() {}, loadVideoStudioDraft() {}, saveVideoStudioDraft() {} },
  '@/lib/video-platform': { is65535Provider() {}, isJimengProvider() {}, isAgnesProvider() {}, requiresPublicMediaRelay() {} },
  '@/lib/creative-references': { replaceNaturalReferenceLabels() {}, selectCreativeReferences() {} },
  '@/lib/one-take-video-duration': { nearestOneTakeVideoDuration() {}, normalizeOneTakeDuration() {} },
  '@/lib/creation/agent': { requestPromptOptimization() {} },
  '@/lib/creation/settings': { AGNES_V20_DIMENSION_PRESETS: [], AGNES_V20_DURATION_PRESETS: [] },
  '@/lib/video-task-output': { videoTaskOutputUrl() {}, videoTaskStatus() {} },
  '@/lib/cangyuan-video-capabilities': {
    cangyuanVideoImageDataUrlBytes() {},
    cangyuanVideoImageSizeError() {},
    getCangyuanVideoModelProfile() {},
    isCangyuanVideoModelSelectable() { return false; },
    isPublicHttpsUrl() {},
  },
})('./components/VideoStudio');

test('unsupported model input mode falls back to text and retains the selected media', () => {
  const selectedMedia = {
    firstFrame: null,
    lastFrame: null,
    referenceImages: [{ name: 'reference.png', url: 'https://media.example/reference.png', kind: 'image' }],
    referenceVideo: null,
    referenceVideos: [],
    audios: [{ name: 'guide.wav', url: 'https://media.example/guide.wav', kind: 'audio' }],
    cangyuanImageUrl: '',
    cangyuanVideoUrl: '',
    cangyuanAudioUrl: '',
  };

  const result = reconcileVideoInputMode('reference', [{ value: 'text' }], selectedMedia);

  assert.equal(result.inputMode, 'text');
  assert.equal(result.didFallback, true);
  assert.equal(result.hasSelectedMedia, true);
  assert.equal(result.selectedMedia, selectedMedia);
  assert.equal(result.selectedMedia.referenceImages.length, 1);
  assert.equal(result.selectedMedia.audios.length, 1);
});

test('supported input mode remains selected without flagging a fallback', () => {
  const selectedMedia = {
    firstFrame: null,
    lastFrame: null,
    referenceImages: [],
    referenceVideo: null,
    referenceVideos: [],
    audios: [],
    cangyuanImageUrl: '',
    cangyuanVideoUrl: '',
    cangyuanAudioUrl: '',
  };

  const result = reconcileVideoInputMode('reference', [{ value: 'text' }, { value: 'reference' }], selectedMedia);

  assert.equal(result.inputMode, 'reference');
  assert.equal(result.didFallback, false);
  assert.equal(result.hasSelectedMedia, false);
  assert.equal(result.selectedMedia, selectedMedia);
});
