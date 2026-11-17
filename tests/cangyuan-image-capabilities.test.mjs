import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { CANGYUAN_IMAGE_PUBLIC_MODEL_NAMES, getCangyuanImageModelProfile } =
  createTsRequire(process.cwd())('./lib/cangyuan-image-capabilities');

test('registry covers the 72 exact public image model names', () => {
  assert.equal(CANGYUAN_IMAGE_PUBLIC_MODEL_NAMES.length, 72);
  assert.equal(new Set(CANGYUAN_IMAGE_PUBLIC_MODEL_NAMES).size, 72);
  assert.equal(getCangyuanImageModelProfile('Midjourney-v8.1')?.publicModel, 'Midjourney-v8.1');
  assert.equal(getCangyuanImageModelProfile('midjourney-v8.1'), null);
  assert.equal(getCangyuanImageModelProfile('unlisted-image-model'), null);
});

test('GPT Image AX profile exposes its documented tiers, enums, and media limits', () => {
  const profile = getCangyuanImageModelProfile('ax-gpt-image-2.5-flare');
  assert.ok(profile);
  assert.equal(profile.nMax, 1);
  assert.equal(profile.supportsSize, true);
  assert.deepEqual(profile.sizeRecommendations.slice(0, 4), ['auto', '1K', '2K', '4K']);
  assert.deepEqual(profile.qualityEnum, ['medium', 'low', 'high', 'xhigh', 'max', 'auto']);
  assert.deepEqual(profile.backgroundEnum, ['transparent', 'opaque', 'auto']);
  assert.deepEqual(profile.outputFormatEnum, ['png', 'jpeg', 'webp']);
  assert.equal(profile.imagesMaxItems, 16);
  assert.equal(profile.supportsMask, true);
  assert.equal(profile.supportsAspectRatio, true);
  assert.deepEqual(profile.aspectRatioRecommendations, ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']);
  assert.equal(profile.sizeRecommendations.includes('16:9'), false);
});

test('gateway variants retain their documented count and format differences', () => {
  const native = getCangyuanImageModelProfile('gpt-image-2');
  const gateway = getCangyuanImageModelProfile('gpt-image-2-az');
  const animated = getCangyuanImageModelProfile('gpt-image-2.6');
  assert.ok(native && gateway && animated);
  assert.equal(native.nMax, 1);
  assert.equal(gateway.nMax, 10);
  assert.deepEqual(gateway.outputFormatEnum, ['png', 'jpeg']);
  assert.deepEqual(animated.outputFormatEnum, ['png', 'jpeg', 'webp', 'gif']);
});

test('resolution enums and absent parameters stay distinct from size recommendations', () => {
  const gemini = getCangyuanImageModelProfile('gemini-3-pro-image-preview');
  const describe = getCangyuanImageModelProfile('mj2-midjourney-describe');
  const midjourneyEdit = getCangyuanImageModelProfile('midjourney-2k');
  assert.ok(gemini && describe && midjourneyEdit);
  assert.deepEqual(gemini.qualityEnum, ['1k', '2k', '4k']);
  assert.equal(gemini.sizeRecommendations.includes('1K'), false);
  assert.equal(describe.supportsSize, false);
  assert.equal(describe.imagesMaxItems, 1);
  assert.equal(describe.supportsMask, false);
  assert.equal(midjourneyEdit.supportsMask, true);
});

test('mutating a returned profile cannot alter later lookups', () => {
  const first = getCangyuanImageModelProfile('ax-gpt-image-2');
  assert.ok(first);
  first.sizeRecommendations.push('not-documented');
  assert.equal(
    getCangyuanImageModelProfile('ax-gpt-image-2')?.sizeRecommendations.includes('not-documented'),
    false,
  );
});
