import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
  buildCangyuanVideoPayload,
  cangyuanVideoImageDataUrlBytes,
  cangyuanVideoImageSizeError,
  getCangyuanVideoModelProfile,
  validateCangyuanVideoInput,
} = createTsRequire(process.cwd())('./lib/cangyuan-video-capabilities');

test('Cangyuan Seedance profiles match the four canonical public model IDs exactly', () => {
  const standard = getCangyuanVideoModelProfile('doubao-seedance-2-0-260128');
  const fast = getCangyuanVideoModelProfile('doubao-seedance-2-0-fast-260128');
  const mini = getCangyuanVideoModelProfile('doubao-seedance-2-0-mini-260615');
  const pro = getCangyuanVideoModelProfile('doubao-seedance-2-5-260628');

  assert.ok(standard && fast && mini && pro);
  assert.deepEqual(
    [standard.minSeconds, standard.maxSeconds, standard.suggestedResolutions],
    [4, 15, ['720p']],
  );
  assert.deepEqual(
    [fast.minSeconds, fast.maxSeconds, fast.suggestedResolutions],
    [4, 15, ['480p', '720p', '1080p', '4k']],
  );
  assert.deepEqual(
    [mini.minSeconds, mini.maxSeconds, mini.suggestedResolutions],
    [4, 15, ['480p', '720p', '1080p', '4k']],
  );
  assert.deepEqual(
    [pro.minSeconds, pro.maxSeconds, pro.suggestedResolutions],
    [4, 30, ['720p']],
  );
  for (const profile of [standard, fast, mini, pro]) {
    assert.equal(profile.maxReferenceImages, 9);
    assert.equal(profile.maxReferenceVideos, 3);
    assert.equal(profile.maxReferenceAudios, 3);
    assert.equal(profile.maxReferenceImageBytes, CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES);
    assert.equal(profile.supportsSeed, true);
    assert.equal(profile.supportsFirstLastFrames, true);
  }
  assert.equal(getCangyuanVideoModelProfile('DOUBAO-SEEDANCE-2-0-FAST-260128'), null);
  assert.equal(getCangyuanVideoModelProfile('sd11-seedance-2.0'), null);
});

test('each canonical model enforces its documented duration and emits its exact model ID', () => {
  const supportedDurations = [
    ['doubao-seedance-2-0-260128', 15],
    ['doubao-seedance-2-0-fast-260128', 15],
    ['doubao-seedance-2-0-mini-260615', 15],
    ['doubao-seedance-2-5-260628', 30],
  ];

  for (const [model, seconds] of supportedDurations) {
    assert.deepEqual(buildCangyuanVideoPayload(model, {
      prompt: 'a quiet lakeside at dawn',
      seconds,
      aspectRatio: 'custom-ratio',
      resolution: 'custom-resolution',
    }), {
      model,
      prompt: 'a quiet lakeside at dawn',
      duration: seconds,
      aspect_ratio: 'custom-ratio',
      resolution: 'custom-resolution',
    });
  }

  assert.throws(() => validateCangyuanVideoInput('doubao-seedance-2-0-260128', { prompt: 'scene', seconds: 16 }), /4–15 秒/);
  assert.throws(() => validateCangyuanVideoInput('doubao-seedance-2-0-mini-260615', { prompt: 'scene', seconds: 16 }), /4–15 秒/);
  assert.throws(() => validateCangyuanVideoInput('doubao-seedance-2-5-260628', { prompt: 'scene', seconds: 31 }), /4–30 秒/);
});

test('Cangyuan serializes numeric seeds as strings and rejects undocumented generate_audio', () => {
  const model = 'doubao-seedance-2-0-fast-260128';
  assert.deepEqual(buildCangyuanVideoPayload(model, { prompt: 'scene', seed: 7 }), {
    model,
    prompt: 'scene',
    seed: '7',
  });
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'scene', requireAudio: false }), /generate_audio/);
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'scene', requireAudio: true }), /generate_audio/);
});

test('unknown Cangyuan video IDs remain prompt-only and reject undocumented inputs', () => {
  const model = 'doubao-seedance-2-0-unknown';
  assert.deepEqual(buildCangyuanVideoPayload(model, { prompt: 'scene' }), { model, prompt: 'scene' });
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'scene', seconds: 8 }), /仅支持模型和提示词/);
});

test('Cangyuan image byte validation accepts exactly 30 MiB and rejects larger local images', () => {
  const model = 'doubao-seedance-2-0-fast-260128';
  assert.equal(cangyuanVideoImageSizeError(model, CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES), null);
  assert.equal(cangyuanVideoImageSizeError(model, CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES - 1), null);
  assert.match(
    cangyuanVideoImageSizeError(model, CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES + 1),
    /不能超过 30 MiB/,
  );
  assert.equal(cangyuanVideoImageSizeError('unlisted-model', CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES + 1), null);
});

test('image data URL byte count handles base64 and encoded payloads', () => {
  assert.equal(cangyuanVideoImageDataUrlBytes('data:image/png;base64,AQID'), 3);
  assert.equal(cangyuanVideoImageDataUrlBytes('data:image/png,%E2%9C%93'), 3);
  assert.equal(cangyuanVideoImageDataUrlBytes('data:audio/wav;base64,AQID'), null);
  assert.equal(cangyuanVideoImageDataUrlBytes('data:image/png;base64,not base64!'), null);
});

test('server-side validation rejects oversized inline images before media relay', () => {
  const model = 'doubao-seedance-2-0-fast-260128';
  const maxBytes = CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES;
  const encodedLength = Math.ceil((maxBytes + 1) / 3) * 4;
  const oversizedDataUrl = `data:image/png;base64,${'A'.repeat(encodedLength)}`;
  assert.throws(() => validateCangyuanVideoInput(model, {
    prompt: 'animate the image',
    referenceImages: [oversizedDataUrl],
  }, { requirePublicMedia: false }), /不能超过 30 MiB/);
});
