import test from 'node:test';
import assert from 'node:assert/strict';
import { createTsRequire } from './ts-require.mjs';

const limits = createTsRequire(process.cwd())('./lib/video-model-limits');

test('legacy official video configurations use the documented model limits', () => {
  const canonical = limits.getVideoModelLimits({ rawId: 'gf1-gemini-omni-1.2-flash' }, { videoTransport: 'cangyuan-videos' });
  const legacy = limits.getVideoModelLimits({ rawId: 'gf1-gemini-omni-1.2-flash' }, {
    platform: 'custom', baseUrl: 'https://ai.cangyuansuanli.cn/v1', videoTransport: 'openai-videos',
  });
  assert.deepEqual(legacy, canonical);
  assert.ok(legacy.maxSeconds >= 15);
  assert.ok(legacy.resolutions.some((value) => value.toLowerCase() === '1080p'));
});

test('applies documented model limits only to 65535', () => {
  const seedance65535 = limits.getVideoModelLimits({ rawId: 'seedance-2.0' }, { platform: '65535' });
  assert.equal(seedance65535.minSeconds, 5);
  assert.equal(seedance65535.maxSeconds, 15);
  assert.deepEqual(seedance65535.resolutions, ['720p']);
  assert.equal(seedance65535.maxReferenceImages, 9);
  assert.equal(seedance65535.maxReferenceVideos, 3);
  assert.equal(seedance65535.maxAudios, 3);

  const seedanceOther = limits.getVideoModelLimits({ rawId: 'seedance-2.0' }, { platform: 'custom', videoTransport: 'native-task' });
  assert.equal(seedanceOther.minSeconds, 1);
  assert.equal(seedanceOther.maxSeconds, 60);
  assert.deepEqual(seedanceOther.resolutions, ['480p', '720p', '1080p']);
  assert.equal(seedanceOther.maxReferenceImages, 16);
  assert.equal(seedanceOther.maxReferenceVideos, 10);
  assert.equal(seedanceOther.maxAudios, 10);
  assert.deepEqual(seedanceOther.notes, []);
});

test('recognizes legacy 65535 hosts without restricting unrelated providers', () => {
  const legacy = limits.getVideoModelLimits({ rawId: 'veo-omni-flash' }, { platform: 'custom', videoBaseUrl: 'https://task-api-1-cn.65535.space' });
  assert.equal(legacy.fixedSeconds, 10);
  assert.deepEqual(legacy.resolutions, ['720p', '1080p']);

  const unrelated = limits.getVideoModelLimits({ rawId: 'veo-omni-flash' }, { platform: 'custom', videoBaseUrl: 'https://video.example.com' });
  assert.equal(unrelated.fixedSeconds, undefined);
  assert.deepEqual(unrelated.resolutions, ['480p', '720p', '1080p']);
  assert.deepEqual(unrelated.notes, []);
});

test('uses the official Jimeng parameter profile instead of generic defaults', () => {
  const seedance25 = limits.getVideoModelLimits({ rawId: 'seedance-2.5' }, { platform: 'jimeng-cli', videoTransport: 'jimeng-cli' });
  assert.equal(seedance25.minSeconds, 4);
  assert.equal(seedance25.maxSeconds, 30);
  assert.deepEqual(seedance25.resolutions, ['480p', '720p', '1080p']);
  assert.equal(seedance25.allowedSeconds[0], 4);
  assert.equal(seedance25.allowedSeconds.at(-1), 30);
  assert.equal(seedance25.allowedSeconds.length, 27);

  const mini = limits.getVideoModelLimits({ rawId: 'seedance2.0mini' }, { platform: 'custom', videoTransport: 'jimeng-cli' });
  assert.equal(mini.minSeconds, 4);
  assert.equal(mini.maxSeconds, 15);
  assert.deepEqual(mini.resolutions, ['720p']);

  const vip = limits.getVideoModelLimits({ rawId: 'seedance2.0_vip' }, { platform: 'custom', videoTransport: 'jimeng-cli' });
  assert.equal(vip.minSeconds, 4);
  assert.equal(vip.maxSeconds, 15);
  assert.deepEqual(vip.resolutions, ['720p', '1080p', '4k']);

  const fastVip = limits.getVideoModelLimits({ rawId: 'seedance2.0fast_vip' }, { platform: 'custom', videoTransport: 'jimeng-cli' });
  assert.deepEqual(fastVip.resolutions, ['720p']);

  const other = limits.getVideoModelLimits({ rawId: 'seedance-2.5' }, { platform: 'custom', videoTransport: 'openai-videos' });
  assert.equal(other.allowedSeconds, undefined);
  assert.deepEqual(other.resolutions, ['480p', '720p', '1080p']);
});

test('uses per-line Cangyuan video limits only for exact documented public model IDs', () => {
  const seedanceFast = limits.getVideoModelLimits(
    { rawId: 'sd20-seedance-2.0-fast' },
    { platform: 'custom', videoTransport: 'cangyuan-videos' },
  );
  assert.equal(seedanceFast.minSeconds, 4);
  assert.equal(seedanceFast.maxSeconds, 15);
  assert.deepEqual(seedanceFast.resolutions, ['480p', '720p']);
  assert.equal(seedanceFast.maxReferenceImages, 9);
  assert.equal(seedanceFast.maxReferenceVideos, 3);
  assert.equal(seedanceFast.maxAudios, 3);
  assert.equal(seedanceFast.requiresDuration, true);
  assert.equal(seedanceFast.requiresAspectRatio, true);
  assert.match(seedanceFast.notes.join(' '), /建议值，不代表完整允许枚举/);
  assert.match(seedanceFast.notes.join(' '), /sd20-seedance-2\.0-fast/);
  assert.match(seedanceFast.notes.join(' '), /不支持首帧图片/);
  assert.match(seedanceFast.notes.join(' '), /不支持尾帧图片/);
  assert.doesNotMatch(seedanceFast.notes.join(' '), /音频不能作为唯一参考素材提交/);
  assert.equal(seedanceFast.maxTotalInputs, undefined);

  const caseMismatch = limits.getVideoModelLimits(
    { rawId: 'SD20-SEEDANCE-2.0-FAST' },
    { platform: 'custom', videoTransport: 'cangyuan-videos' },
  );
  assert.equal(caseMismatch.maxReferenceImages, 0);

  const unverified = limits.getVideoModelLimits(
    { rawId: 'doubao-seedance-2-0-unverified' },
    { platform: 'custom', videoTransport: 'cangyuan-videos' },
  );
  assert.equal(unverified.maxReferenceImages, 0);
  assert.equal(unverified.maxReferenceVideos, 0);
  assert.equal(unverified.maxAudios, 0);
  assert.match(unverified.notes.join(' '), /暂不可生成/);
});

test('Cangyuan limits expose per-model controls and only documented total input caps', () => {
  const provider = { platform: 'custom', videoTransport: 'cangyuan-videos' };
  const sd10 = limits.getVideoModelLimits({ rawId: 'sd10-seedance-2.0' }, provider);
  assert.deepEqual(sd10.resolutions, ['480p', '720p']);
  assert.equal(sd10.maxReferenceImages, 9);
  assert.equal(sd10.maxReferenceVideos, 3);
  assert.equal(sd10.maxAudios, 3);
  assert.match(sd10.notes.join(' '), /分辨率使用文档明确支持的枚举值/);

  const sd12 = limits.getVideoModelLimits({ rawId: 'sd12-seedance-2.0-mini' }, provider);
  assert.deepEqual(sd12.resolutions, ['480p']);
  assert.match(sd12.notes.join(' '), /提供首尾帧时不能同时使用参考音频/);

  const sd13 = limits.getVideoModelLimits({ rawId: 'sd13-seedance-2.0' }, provider);
  assert.deepEqual(sd13.resolutions, ['480p', '720p', '1080p', '4k']);
  assert.equal(sd13.maxAudios, 0);

  const sd7 = limits.getVideoModelLimits({ rawId: 'sd7-seedance-2.0-720p' }, provider);
  assert.equal(sd7.maxTotalInputs, 11);
  assert.match(sd7.notes.join(' '), /参考素材总数最多 11 个/);

  const sd8 = limits.getVideoModelLimits({ rawId: 'sd8-seedance-2.0-mini' }, provider);
  assert.equal(sd8.maxReferenceImages, 3);
  assert.equal(sd8.maxAudios, 1);
  assert.equal(sd8.maxTotalInputs, 4);

  const sd11 = limits.getVideoModelLimits({ rawId: 'sd11-seedance-2.0' }, provider);
  assert.equal(sd11.maxReferenceImages, 9);
  assert.equal(sd11.maxReferenceVideos, 3);
  assert.equal(sd11.maxAudios, 3);
  assert.match(sd11.notes.join(' '), /尾帧必须与首帧一起提供/);
});

test('applies official multiframe CLI limits from the actual input shape', () => {
  const provider = { platform: 'jimeng-cli', videoTransport: 'jimeng-cli', jimengCliPath: 'dreamina.exe' };
  const twoImages = limits.getVideoModelLimitsForInput(
    { rawId: 'seedance2.0fast' },
    provider,
    { referenceImageCount: 2, referenceMode: 'multiframe' },
  );
  assert.equal(twoImages.minSeconds, 2);
  assert.equal(twoImages.maxSeconds, 8);
  assert.deepEqual(twoImages.allowedSeconds, [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(twoImages.resolutions, ['720p', '1080p']);
  assert.equal(twoImages.durationScope, 'total');
  assert.equal(twoImages.aspectRatioSource, 'first-reference');
  assert.match(twoImages.notes.join(' '), /固定后端模型/);

  const threeImages = limits.getVideoModelLimitsForInput(
    { rawId: 'seedance2.0fast' },
    provider,
    { referenceImageCount: 3, referenceMode: 'multiframe' },
  );
  assert.equal(threeImages.minSeconds, 1);
  assert.equal(threeImages.maxSeconds, 8);
  assert.deepEqual(threeImages.allowedSeconds, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(threeImages.durationScope, 'per-transition');

  const firstFrame = limits.getVideoModelLimitsForInput(
    { rawId: 'seedance2.0fast' },
    provider,
    { hasFirstFrame: true, referenceImageCount: 2 },
  );
  assert.equal(firstFrame.minSeconds, 4);
  assert.equal(firstFrame.maxSeconds, 15);

  const multimodal = limits.getVideoModelLimitsForInput(
    { rawId: 'seedance2.0fast' },
    provider,
    { referenceImageCount: 2, audioCount: 1 },
  );
  assert.equal(multimodal.minSeconds, 4);
  assert.equal(multimodal.maxSeconds, 15);

  const allAround = limits.getVideoModelLimitsForInput(
    { rawId: 'seedance2.0fast' },
    provider,
    { referenceImageCount: 2 },
  );
  assert.equal(allAround.minSeconds, 4);
  assert.equal(allAround.maxSeconds, 15);
});

test('does not apply legacy multiframe limits to the official Canvas CLI', () => {
  const provider = { platform: 'jimeng-cli', videoTransport: 'jimeng-cli', jimengCliPath: 'dreamina-canvas.exe' };
  const canvasM2v = limits.getVideoModelLimitsForInput(
    { rawId: 'seedance2.0' },
    provider,
    { referenceImageCount: 3, referenceMode: 'multiframe' },
  );
  assert.equal(canvasM2v.minSeconds, 4);
  assert.equal(canvasM2v.maxSeconds, 15);
  assert.equal(canvasM2v.durationScope, undefined);
});
