import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  CANGYUAN_SEEDANCE_FAST_MODEL,
  CANGYUAN_VIDEO_DEFAULT_PROMPT_MAX_LENGTH,
  CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES,
  buildCangyuanVideoPayload,
  cangyuanVideoImageDataUrlBytes,
  cangyuanVideoImageSizeError,
  getCangyuanVideoModelProfile,
  getCangyuanVideoPromptMaxLength,
  isCangyuanVideoModelSelectable,
  validateCangyuanVideoInput,
} = createTsRequire(process.cwd())('./lib/cangyuan-video-capabilities');
const { getCangyuanVideoModelCatalog, getCangyuanVideoModelSpec } = createTsRequire(process.cwd())('./lib/cangyuan-video-model-catalog');
const { parseVideoModelParameterValues } = createTsRequire(process.cwd())('./packages/contracts/video-generation');

function minimalDocumentedVideoInput(entry) {
  const profile = getCangyuanVideoModelProfile(entry.publicModel);
  assert.ok(profile, `${entry.publicModel} needs a verified profile`);
  const input = { prompt: 'A calm landscape with natural light.' };
  for (const parameter of entry.spec.params.filter((item) => item.required)) {
    switch (parameter.name) {
      case 'model':
      case 'prompt':
        break;
      case 'duration':
        input.seconds = profile.durationDefault ?? profile.fixedSeconds ?? profile.minSeconds;
        break;
      case 'aspect_ratio':
        input.aspectRatio = profile.aspectRatioDefault ?? profile.suggestedAspectRatios[0] ?? '16:9';
        break;
      case 'resolution':
        input.resolution = profile.resolutionDefault ?? profile.allowedResolutions?.[0] ?? profile.suggestedResolutions[0];
        break;
      default:
        assert.fail(`${entry.publicModel} added an uncovered required field: ${parameter.name}`);
    }
  }
  if (profile.requiresReferenceImage || profile.allowsNoReferences === false) {
    if (profile.supportsReferenceImages) input.referenceImages = ['https://assets.example/reference.png'];
    else if (profile.supportsFirstFrame) input.firstFrame = 'https://assets.example/first.png';
    else if (entry.spec.params.some((parameter) => parameter.name === 'video')) input.referenceVideo = 'https://assets.example/source.mp4';
    else if (profile.supportsReferenceVideos) input.referenceVideos = ['https://assets.example/reference.mp4'];
    else assert.fail(`${entry.publicModel} requires media but exposes no supported visual input`);
    if (input.firstFrame && profile.allowsFirstFrameWithoutLastFrame === false) input.lastFrame = 'https://assets.example/last.png';
  }
  return input;
}

const videoWireCatalog = getCangyuanVideoModelCatalog();
test('official video wire matrix covers all 138 documented models and eight blocked empty specs', () => {
  assert.equal(videoWireCatalog.filter((entry) => entry.spec.params.length > 0).length, 138);
  assert.equal(videoWireCatalog.filter((entry) => entry.spec.params.length === 0).length, 8);
});

for (const entry of videoWireCatalog) {
  test(`official video wire matrix: ${entry.publicModel}`, () => {
    if (entry.spec.params.length === 0) {
      assert.equal(isCangyuanVideoModelSelectable(entry.publicModel), false);
      assert.throws(() => buildCangyuanVideoPayload(entry.publicModel, { prompt: 'scene' }), /参数说明尚未补齐/);
      return;
    }
    const input = minimalDocumentedVideoInput(entry);
    const payload = buildCangyuanVideoPayload(entry.publicModel, input);
    assert.equal(isCangyuanVideoModelSelectable(entry.publicModel), true);
    assert.equal(payload.model, entry.publicModel);
    assert.equal(payload.prompt, input.prompt);
    const declaredParameters = new Map(entry.spec.params.map((parameter) => [parameter.name, parameter]));
    for (const [name, value] of Object.entries(payload)) {
      const parameter = declaredParameters.get(name);
      assert.ok(parameter, `${entry.publicModel} sent undeclared field ${name}`);
      if (parameter.type === 'array') {
        assert.ok(Array.isArray(value), `${entry.publicModel}.${name} must be an array`);
        assert.ok(parameter.maxItems === undefined || value.length <= parameter.maxItems, `${entry.publicModel}.${name} exceeds its documented item cap`);
      } else {
        assert.equal(typeof value, parameter.type, `${entry.publicModel}.${name} has the wrong wire type`);
      }
      if (typeof value === 'number') {
        assert.ok(parameter.minimum === undefined || value >= parameter.minimum, `${entry.publicModel}.${name} is below its documented minimum`);
        assert.ok(parameter.maximum === undefined || value <= parameter.maximum, `${entry.publicModel}.${name} is above its documented maximum`);
      }
      const allowed = Array.isArray(parameter.enum) ? parameter.enum : typeof parameter.enum === 'string' ? [parameter.enum] : [];
      if (allowed.length) {
        for (const item of Array.isArray(value) ? value : [value]) {
          assert.ok(allowed.includes(item), `${entry.publicModel}.${name} is outside its explicit enum`);
        }
      }
    }
    for (const parameter of entry.spec.params.filter((item) => item.required)) {
      assert.ok(payload[parameter.name] !== undefined && payload[parameter.name] !== '', `${entry.publicModel} omitted required ${parameter.name}`);
    }
    // Defaults are inserted while serializing. Revalidate those actual wire
    // values too, so a default cannot violate its own profile or combination.
    validateCangyuanVideoInput(entry.publicModel, {
      ...input,
      ...(payload.duration !== undefined ? { seconds: payload.duration } : {}),
      ...(payload.aspect_ratio !== undefined ? { aspectRatio: payload.aspect_ratio } : {}),
      ...(payload.resolution !== undefined ? { resolution: payload.resolution } : {}),
      ...(typeof payload.generate_audio === 'boolean' ? { generateAudio: payload.generate_audio } : {}),
    });
  });
}

test('Cangyuan Seedance profiles use exact documented sdN model IDs', () => {
  const profiles = [
    ['sd10-seedance-2.0', 4, 15], ['sd10-seedance-2.0-fast', 4, 15], ['sd10-seedance-2.0-mini', 5, 10],
    ['sd4-seedance-2.0', 4, 15], ['sd4-seedance-2.0-fast', 4, 15], ['sd4-seedance-2.0-mini', 4, 15],
    ['sd5-seedance-2.0', 4, 15], ['sd5-seedance-2.0-fast', 4, 15],
    ['sd11-seedance-2.0', 4, 15], ['sd11-seedance-2.0-fast', 4, 15], ['sd11-seedance-2.0-mini', 4, 15],
    ['sd12-seedance-2.0', 4, 15], ['sd12-seedance-2.0-fast', 4, 15], ['sd12-seedance-2.0-mini', 4, 15],
    ['sd13-seedance-2.0', 4, 15], ['sd13-seedance-2.0-fast', 4, 15], ['sd13-seedance-2.0-mini', 4, 15],
    ['sd14-seedance-2.0', 4, 15], ['sd15-seedance-2.0', 4, 15],
    ['sd7-seedance-2.0-720p', 4, 15], ['sd7-seedance-2.0-1080p', 4, 15],
    ['sd8-seedance-2.0-mini', 4, 15],
    ['sd16-seedance-2.0', 4, 15], ['sd16-seedance-2.0-fast', 4, 15],
    ['sd16-seedance-2.0-mini', 4, 15], ['sd16-seedance-2.0-x1', 5, 15],
    ['sd17-seedance-2.0', 5, 15], ['sd17-seedance-2.0-2', 5, 15],
    ['sd17-seedance-2.0-3', 5, 15], ['sd17-seedance-2.0-4', 5, 15],
    ['sd20-seedance-2.0-mini', 4, 15], ['sd20-seedance-2.0-fast', 4, 15],
    ['sd22-seedance-2.0', 4, 15], ['sd22-seedance-2.0-fast', 4, 15],
    ['sd22-seedance-2.0-2', 4, 15], ['sd22-seedance-2.0-fast-2', 4, 15],
    ['sd25-seedance-2.0', 4, 15],
  ];
  for (const [modelId, minSeconds, maxSeconds] of profiles) {
    const profile = getCangyuanVideoModelProfile(modelId);
    assert.equal(profile?.publicModel, modelId);
    assert.deepEqual([profile.minSeconds, profile.maxSeconds], [minSeconds, maxSeconds]);
  }
  assert.equal(CANGYUAN_SEEDANCE_FAST_MODEL, 'sd20-seedance-2.0-fast');
  assert.equal(getCangyuanVideoModelProfile('SD10-SEEDANCE-2.0'), null);
  assert.equal(getCangyuanVideoModelProfile('sd15-seedance-2.0-2'), null);
  assert.equal(getCangyuanVideoModelProfile('doubao-seedance-2-0-fast-260128').publicModel, 'doubao-seedance-2-0-fast-260128');
});

test('a documented suggestion outside its explicit duration range is never offered or sent as the default', () => {
  const model = 'sd17-seedance-2.5-3';
  const parameter = getCangyuanVideoModelSpec(model).params.find((item) => item.name === 'duration');
  assert.deepEqual([parameter.minimum, parameter.maximum, parameter.suggestedDefault], [5, 15, 30]);
  assert.equal(getCangyuanVideoModelProfile(model).durationDefault, undefined);
  assert.equal(buildCangyuanVideoPayload(model, { prompt: 'scene' }).duration, undefined);
  assert.equal(buildCangyuanVideoPayload(model, { prompt: 'scene', seconds: 15 }).duration, 15);
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'scene', seconds: 30 }), /5–15/);
});

test('the official current video catalog is complete and models with empty specs are blocked', () => {
  const catalog = getCangyuanVideoModelCatalog();
  assert.equal(catalog.length, 146);
  assert.ok(catalog.some((entry) => entry.publicModel === 'sd23-seedance-2.5-2'));
  assert.ok(catalog.every((entry) => entry.status === 'current' && entry.spec.publicModel === entry.publicModel));
  for (const entry of catalog.filter((model) => model.spec.params.length > 0)) {
    assert.equal(getCangyuanVideoModelSpec(entry.publicModel), entry.spec);
    assert.equal(isCangyuanVideoModelSelectable(entry.publicModel), Boolean(getCangyuanVideoModelProfile(entry.publicModel)));
  }
  for (const entry of catalog.filter((model) => model.spec.params.length === 0)) {
    assert.equal(getCangyuanVideoModelProfile(entry.publicModel), null);
    assert.equal(isCangyuanVideoModelSelectable(entry.publicModel), false);
    assert.throws(() => validateCangyuanVideoInput(entry.publicModel, { prompt: 'scene' }), /参数说明尚未补齐/);
  }
  assert.equal(isCangyuanVideoModelSelectable('sd20-seedance-2.0-fast'), true);
  assert.throws(() => validateCangyuanVideoInput('unlisted-video-model', { prompt: 'scene' }), /未出现在当前官方目录/);
});

test('recently added video models are selectable with their documented controls and limits', () => {
  const expected = [
    ['vd1-vidu-q4', 2, 16, ['480p', '720p', '1080p'], 10, undefined, 3],
    ['wan7-wan3.0-3', 5, 30, ['720p', '1080p'], 10, 5, 5],
    ['sd24-seedance-2.0', 4, 15, ['720p'], 9, undefined, 3],
    ['sd24-seedance-2.0-2', 5, 15, ['720p'], 9, 3, 3],
    ['sd24-seedance-2.5-1080p', 5, 30, ['1080p'], 9, undefined, 3],
    ['sd24-seedance-2.5-3', 4, 30, ['480p', '720p'], 30, 10, 10],
  ];
  for (const [model, minSeconds, maxSeconds, resolutions, images, videos, audios] of expected) {
    const spec = getCangyuanVideoModelSpec(model);
    const profile = getCangyuanVideoModelProfile(model);
    assert.ok(spec, `${model} should be in the official catalog`);
    assert.equal(isCangyuanVideoModelSelectable(model), true, `${model} should be selectable`);
    assert.equal(profile?.publicModel, model);
    assert.deepEqual([profile.minSeconds, profile.maxSeconds], [minSeconds, maxSeconds]);
    assert.deepEqual(profile.suggestedResolutions, resolutions);
    assert.equal(profile.maxReferenceImages, images);
    assert.equal(profile.maxReferenceVideos, videos);
    assert.equal(profile.supportsReferenceVideos, videos !== undefined);
    assert.equal(profile.maxReferenceAudios, audios);
  }

  assert.equal(getCangyuanVideoModelProfile('vd1-vidu-q4').requiresReferenceImage, true);
  assert.equal(getCangyuanVideoModelProfile('sd24-seedance-2.0-2').maxTotalInputs, 12);
  assert.equal(getCangyuanVideoModelProfile('sd24-seedance-2.5-3').maxTotalInputs, 50);

  assert.throws(() => validateCangyuanVideoInput('vd1-vidu-q4', {
    prompt: 'animate a scene', seconds: 5, aspectRatio: '16:9',
  }), /必须至少提供/);
  assert.throws(() => validateCangyuanVideoInput('vd1-vidu-q4', {
    prompt: 'animate a scene', seconds: 5, aspectRatio: '16:9', audios: ['https://assets.example/audio.mp3'],
  }), /必须至少提供一张参考图/);
  validateCangyuanVideoInput('vd1-vidu-q4', {
    prompt: 'animate a scene', seconds: 5, aspectRatio: '16:9',
    referenceImages: ['https://assets.example/reference.png'],
  });
  assert.throws(() => validateCangyuanVideoInput('sd24-seedance-2.0-2', {
    prompt: 'animate a scene', seconds: 5, aspectRatio: '9:16',
    referenceImages: Array(9).fill('https://assets.example/ref.png'),
    referenceVideos: Array(3).fill('https://assets.example/ref.mp4'),
    audios: ['https://assets.example/ref.wav'],
  }), /参考素材总数不能超过 12 个/);
});

test('required reference media constraints remain enforced when they are documented in prose', () => {
  for (const model of ['grok-video-1.5', 'omni-v2v', 'omni-v2v-no-water']) {
    assert.equal(getCangyuanVideoModelProfile(model).allowsNoReferences, false);
    assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'needs a source' }), /必须至少提供一项参考素材/);
    assert.deepEqual(buildCangyuanVideoPayload(model, {
      prompt: 'animate a source', referenceImages: ['https://assets.example/ref.png'],
    }).reference_image_urls, ['https://assets.example/ref.png']);
  }
});

test('explicit resolution prohibitions are enforced without closing recommendation lists', () => {
  for (const [model, unsupported, valid] of [
    ['kling-o3', ['4k'], ['480p', '720p', '1080p', 'custom-resolution']],
    ['sd11-seedance-2.0', ['4k'], ['480p', '720p', '1080p', 'custom-resolution']],
    ['sd18-seedance-2.5', ['480p', '1080p', '4k'], ['720p', 'custom-resolution']],
  ]) {
    assert.deepEqual(getCangyuanVideoModelProfile(model).unsupportedResolutions, unsupported);
    for (const resolution of unsupported.flatMap((value) => [value, value.toUpperCase()])) {
      assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'scene', resolution }), /不支持 .* 画面清晰度/);
    }
    for (const resolution of valid) {
      assert.equal(buildCangyuanVideoPayload(model, { prompt: 'scene', resolution }).resolution, resolution);
    }
  }
  const contradictory = getCangyuanVideoModelProfile('wan6-wan3.0');
  assert.equal(contradictory.unsupportedResolutions, undefined);
  assert.equal(contradictory.unsupportedSecondsByResolution, undefined);
  assert.equal(buildCangyuanVideoPayload('wan6-wan3.0', { prompt: 'scene', resolution: '1080P' }).resolution, '1080P');
});

test('SD10 Seedance 2.5 enforces the documented 720p duration combination', () => {
  const model = 'sd10-seedance-2.5';
  const profile = getCangyuanVideoModelProfile(model);
  assert.deepEqual(profile.unsupportedSecondsByResolution, { '720p': Array.from({ length: 16 }, (_, index) => index + 13) });
  for (const seconds of [4, 12]) {
    assert.equal(buildCangyuanVideoPayload(model, { prompt: 'scene', resolution: '720p', seconds }).duration, seconds);
  }
  for (const seconds of [13, 28]) {
    assert.throws(() => buildCangyuanVideoPayload(model, {
      prompt: 'scene', resolution: '720P', seconds,
    }), /720p 清晰度下不支持 .* 秒/);
  }
  assert.equal(buildCangyuanVideoPayload(model, { prompt: 'scene', resolution: '480p', seconds: 28 }).duration, 28);
  const defaults = buildCangyuanVideoPayload(model, { prompt: 'scene', seconds: 28 });
  assert.equal(defaults.resolution, '480p');
  assert.equal(defaults.duration, 28);
  assert.equal(buildCangyuanVideoPayload(model, { prompt: 'scene', resolution: '720p' }).duration, 10);
});

test('the newly documented Gemini video line supports first-frame input with its exact enums', () => {
  const model = 'gemini-omni-1.2-flash';
  const profile = getCangyuanVideoModelProfile(model);
  assert.equal(isCangyuanVideoModelSelectable(model), true);
  assert.equal(profile.supportsFirstFrame, true);
  assert.equal(profile.supportsLastFrame, false);
  assert.equal(profile.supportsGenerateAudio, false);
  assert.deepEqual([profile.minSeconds, profile.maxSeconds], [3, 15]);
  assert.deepEqual(profile.suggestedAspectRatios, ['16:9', '9:16']);
  assert.deepEqual(profile.allowedResolutions, ['360P', '720P', '1080P', '4K']);

  assert.deepEqual(buildCangyuanVideoPayload(model, {
    prompt: 'animate the first frame', seconds: 15, aspectRatio: '9:16', resolution: '1080p',
    firstFrame: 'https://assets.example/first.png',
  }), {
    model, prompt: 'animate the first frame', duration: 15, aspect_ratio: '9:16', resolution: '1080P',
    first_image_url: 'https://assets.example/first.png',
  });
  assert.equal(buildCangyuanVideoPayload(model, { prompt: 'high resolution', resolution: '4k' }).resolution, '4K');
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'invalid ratio', aspectRatio: '1:1' }), /画面比例仅支持 16:9 \/ 9:16/);
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'invalid resolution', resolution: '480p' }), /resolution 仅支持 360P \/ 720P \/ 1080P \/ 4K/);
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'unsupported tail', lastFrame: 'https://assets.example/last.png' }), /不支持或未核实.*尾帧/);
  assert.throws(() => buildCangyuanVideoPayload(model, {
    prompt: 'mixed inputs', firstFrame: 'https://assets.example/first.png', referenceImages: ['https://assets.example/reference.png'],
  }), /不能与参考图、参考视频或参考音频同时使用/);
  assert.throws(() => buildCangyuanVideoPayload(model, { prompt: 'unsupported audio', generateAudio: true }), /不支持或未核实.*generate_audio/);
});

test('documented video enum sets are enforced while recommendation lists remain open', () => {
  assert.throws(() => buildCangyuanVideoPayload('sd19-seedance-2.5', {
    prompt: 'invalid ratio', aspectRatio: 'auto',
  }), /画面比例仅支持/);
  assert.equal(buildCangyuanVideoPayload('sd10-seedance-2.0', {
    prompt: 'canonical resolution', resolution: '720P',
  }).resolution, '720p');
  assert.equal(buildCangyuanVideoPayload('gf1-gemini-omni-1.2-flash', {
    prompt: 'open recommendation', aspectRatio: 'custom-ratio', resolution: 'custom-resolution',
  }).resolution, 'custom-resolution');
});

test('video inputs are rejected when the selected model cannot serialize them', () => {
  const video = 'https://assets.example/source.mp4';
  for (const input of [
    { referenceVideo: video },
    { referenceVideos: [video] },
    { referenceVideo: video, referenceVideos: [video] },
  ]) {
    assert.throws(() => buildCangyuanVideoPayload('gemini-omni-flash', {
      prompt: 'unsupported source video', ...input,
    }), /参考视频/);
  }
});

test('single-video aliases preserve documented reference arrays without hiding excess or discarded media', () => {
  const first = 'https://assets.example/first.mp4';
  const second = 'https://assets.example/second.mp4';
  const third = 'https://assets.example/third.mp4';
  const model = 'gf1-gemini-omni-1.2-flash';
  assert.deepEqual(buildCangyuanVideoPayload(model, {
    prompt: 'single reference alias', referenceVideo: first,
  }).reference_videos, [first]);
  assert.deepEqual(buildCangyuanVideoPayload(model, {
    prompt: 'redundant legacy alias', referenceVideo: first, referenceVideos: [first, second, third],
  }).reference_videos, [first, second, third]);
  assert.throws(() => buildCangyuanVideoPayload(model, {
    prompt: 'distinct alias would be lost', referenceVideo: first, referenceVideos: [second],
  }), /参考视频/);
  assert.throws(() => buildCangyuanVideoPayload(model, {
    prompt: 'alias cannot bypass the cap', referenceVideo: first,
    referenceVideos: [first, second, third, 'https://assets.example/fourth.mp4'],
  }), /最多接收 3 个参考视频/);
});

test('models with a documented source-video slot retain source and reference video inputs', () => {
  const source = 'https://assets.example/source.mp4';
  const reference = 'https://assets.example/reference.mp4';
  const payload = buildCangyuanVideoPayload('sd18-seedance-2.5', {
    prompt: 'documented source and reference', operation: 'edit',
    referenceVideo: source, referenceVideos: [reference],
  });
  assert.equal(payload.video, source);
  assert.deepEqual(payload.reference_videos, [reference]);
  assert.equal(payload.mode, 'edit');
});

test('Cangyuan prompt length limits follow each documented model and are enforced server-side', () => {
  const documentedLimits = getCangyuanVideoModelCatalog()
    .map((entry) => [entry.publicModel, entry.spec.params.find((parameter) => parameter.name === 'prompt')?.maxLength])
    .filter(([, maxLength]) => maxLength !== undefined);
  assert.equal(documentedLimits.length, 12);

  for (const [model, maxLength] of documentedLimits) {
    assert.equal(getCangyuanVideoPromptMaxLength(model), maxLength, `${model} should expose its documented prompt limit`);
    assert.throws(
      () => validateCangyuanVideoInput(model, { prompt: 'x'.repeat(maxLength + 1) }),
      new RegExp(`画面描述最多 ${maxLength} 个字符`),
      `${model} should reject prompts above its documented limit`,
    );
    let exactLimitError;
    try {
      validateCangyuanVideoInput(model, { prompt: 'x'.repeat(maxLength) });
    } catch (error) {
      exactLimitError = error;
    }
    assert.doesNotMatch(exactLimitError?.message || '', /画面描述最多/, `${model} should accept its exact documented limit`);
  }

  const model = 'sd10-seedance-2.0';
  const maxLength = getCangyuanVideoPromptMaxLength(model);
  assert.equal(maxLength, 10000);
  assert.equal(getCangyuanVideoPromptMaxLength('suno-v6'), undefined);

  const undocumentedModel = 'sd20-seedance-2.0-fast';
  assert.equal(getCangyuanVideoPromptMaxLength(undocumentedModel), undefined);
  assert.equal(CANGYUAN_VIDEO_DEFAULT_PROMPT_MAX_LENGTH, 6000);
  let exactDefaultLimitError;
  try {
    validateCangyuanVideoInput(undocumentedModel, { prompt: 'x'.repeat(CANGYUAN_VIDEO_DEFAULT_PROMPT_MAX_LENGTH) });
  } catch (error) {
    exactDefaultLimitError = error;
  }
  assert.doesNotMatch(exactDefaultLimitError?.message || '', /提示词上限|画面描述最多/);
  assert.throws(
    () => validateCangyuanVideoInput(undocumentedModel, { prompt: 'x'.repeat(CANGYUAN_VIDEO_DEFAULT_PROMPT_MAX_LENGTH + 1) }),
    /当前平台对未注明提示词上限的沧元型号，限制画面描述最多 6000 个字符/,
  );
});

test('Cangyuan profiles expose line-specific input and frame capabilities', () => {
  const sd10 = getCangyuanVideoModelProfile('sd10-seedance-2.0');
  assert.deepEqual(
    [sd10.maxReferenceImages, sd10.maxReferenceVideos, sd10.maxReferenceAudios],
    [9, 3, 3],
  );
  assert.equal(sd10.supportsFirstFrame, false);
  assert.equal(sd10.supportsLastFrame, false);
  assert.equal(sd10.requiresImageWithVideoOrAudio, true);
  assert.deepEqual(sd10.allowedResolutions, ['480p', '720p']);

  const sd8Mini = getCangyuanVideoModelProfile('sd8-seedance-2.0-mini');
  assert.deepEqual(
    [sd8Mini.maxReferenceImages, sd8Mini.maxReferenceVideos, sd8Mini.maxReferenceAudios],
    [3, 0, 1],
  );
  assert.equal(sd8Mini.supportsReferenceVideos, false);
  assert.equal(sd8Mini.maxTotalInputs, 4);
  assert.equal(getCangyuanVideoModelProfile('sd7-seedance-2.0-720p').maxTotalInputs, 11);

  const sd11 = getCangyuanVideoModelProfile('sd11-seedance-2.0');
  assert.equal(sd11.supportsFirstFrame, true);
  assert.equal(sd11.supportsLastFrame, true);
  assert.equal(sd11.supportsFirstLastFrames, true);
  assert.equal(sd11.allowsFirstFrameWithoutLastFrame, true);
  assert.equal(sd11.requiresFirstFrameForLastFrame, true);
  assert.equal(sd11.supportsSeed, true);

  const sd12 = getCangyuanVideoModelProfile('sd12-seedance-2.0-fast');
  assert.deepEqual(sd12.suggestedResolutions, ['480p']);
  assert.equal(sd12.allowsFramesWithAudio, false);

  const sd13 = getCangyuanVideoModelProfile('sd13-seedance-2.0');
  assert.equal(sd13.supportsReferenceAudios, false);
  assert.equal(sd13.supportsLastFrame, false);
  assert.deepEqual(sd13.suggestedResolutions, ['480p', '720p', '1080p', '4k']);

  const sd16 = getCangyuanVideoModelProfile('sd16-seedance-2.0-fast');
  assert.equal(sd16.supportsFirstFrame, true);
  assert.equal(sd16.supportsLastFrame, true);
  assert.equal(sd16.allowsFirstFrameWithoutLastFrame, false);
  assert.equal(sd16.allowsFramesWithReferences, undefined);

  const sd20Fast = getCangyuanVideoModelProfile('sd20-seedance-2.0-fast');
  assert.equal(sd20Fast.requiresDuration, true);
  assert.equal(sd20Fast.requiresAspectRatio, true);
  assert.deepEqual(sd20Fast.suggestedResolutions, ['480p', '720p']);

  const sd4 = getCangyuanVideoModelProfile('sd4-seedance-2.0');
  assert.deepEqual([sd4.maxReferenceImages, sd4.maxReferenceVideos, sd4.maxReferenceAudios], [4, 3, 1]);
  assert.deepEqual(sd4.suggestedResolutions, ['480p', '720p']);
  assert.deepEqual(sd4.suggestedAspectRatios, ['16:9', '9:16', '1:1', '21:9', '3:4', '4:3']);
  assert.equal(sd4.supportsFirstLastFrames, true);
  assert.equal(sd4.allowsFirstFrameWithoutLastFrame, false);
  assert.equal(sd4.allowsFramesWithReferences, false);
  assert.equal(sd4.maxReferenceImageFileBytes, 25 * 1024 * 1024);
  assert.equal(sd4.maxReferenceVideoFileBytes, 200 * 1024 * 1024);
  assert.equal(sd4.minReferenceVideoSeconds, 4);
  assert.equal(sd4.maxTotalReferenceVideoSeconds, 15);
  assert.equal(sd4.maxReferenceAudioFileBytes, 15 * 1024 * 1024);

  const sd5 = getCangyuanVideoModelProfile('sd5-seedance-2.0-fast');
  assert.deepEqual([sd5.maxReferenceImages, sd5.maxReferenceVideos, sd5.maxReferenceAudios, sd5.maxTotalInputs], [9, 3, 3, 12]);
  assert.equal(sd5.supportsSeed, true);
  assert.equal(sd5.seedWireType, 'number');
  assert.equal(sd5.seedMin, 0);
  assert.equal(sd5.seedMax, 2_147_483_647);
  assert.deepEqual(sd5.suggestedResolutions, ['480p', '720p']);
  assert.deepEqual(sd5.suggestedAspectRatios, ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
  assert.equal(sd5.minReferenceVideoSeconds, 1);
  assert.equal(sd5.maxReferenceVideoSeconds, 15);
  assert.equal(sd5.maxTotalReferenceVideoSeconds, 45);
  assert.equal(sd5.maxReferenceAudioSeconds, 15);

  const sd25 = getCangyuanVideoModelProfile('sd25-seedance-2.0');
  assert.equal(sd25.supportsFirstFrame, true);
  assert.equal(sd25.supportsLastFrame, true);
  assert.equal(sd25.allowsFirstFrameWithoutLastFrame, true);
  assert.equal(sd25.requiresFirstFrameForLastFrame, true);
  assert.equal(sd25.allowsFramesWithReferences, false);
  assert.equal(sd25.requiresDuration, true);
});

test('Cangyuan payload accepts documented duration and serializes public IDs unchanged', () => {
  const model = 'sd20-seedance-2.0-fast';
  assert.deepEqual(buildCangyuanVideoPayload(model, {
    prompt: 'a quiet lakeside at dawn',
    seconds: 15,
    aspectRatio: 'custom-ratio',
    resolution: 'custom-resolution',
    referenceImages: ['https://assets.example/reference.png'],
  }), {
    model,
    prompt: 'a quiet lakeside at dawn',
    duration: 15,
    aspect_ratio: 'custom-ratio',
    resolution: 'custom-resolution',
    reference_image_urls: ['https://assets.example/reference.png'],
  });
  assert.deepEqual(buildCangyuanVideoPayload(model, {
    prompt: 'a quiet lakeside at dawn',
    seconds: 8,
    aspectRatio: '16:9',
  }), {
    model,
    prompt: 'a quiet lakeside at dawn',
    duration: 8,
    aspect_ratio: '16:9',
    resolution: '480p',
  });

  assert.throws(() => validateCangyuanVideoInput(model, { prompt: 'scene', seconds: 3, aspectRatio: '16:9' }), /4–15 秒/);
  assert.throws(() => validateCangyuanVideoInput(model, { prompt: 'scene', seconds: 16, aspectRatio: '16:9' }), /4–15 秒/);
  assert.throws(() => validateCangyuanVideoInput('sd25-seedance-2.0', { prompt: 'scene', seconds: 16 }), /4–15 秒/);
  assert.throws(() => validateCangyuanVideoInput(model, { prompt: 'scene', seconds: 5 }), /必须指定画面比例/);
  assert.throws(() => validateCangyuanVideoInput(model, { prompt: 'scene' }), /必须指定视频时长/);
  assert.throws(() => validateCangyuanVideoInput('sd22-seedance-2.0', { prompt: 'scene' }), /必须指定视频时长/);
  assert.throws(() => validateCangyuanVideoInput('sd10-seedance-2.0', {
    prompt: 'scene', resolution: '1080p',
  }), /仅支持 480p \/ 720p/);
});

test('SD25 defaults generate_audio to true and preserves an explicit false', () => {
  assert.deepEqual(buildCangyuanVideoPayload('sd25-seedance-2.0', {
    prompt: 'a quiet lakeside at dawn', seconds: 5,
  }), {
    model: 'sd25-seedance-2.0',
    prompt: 'a quiet lakeside at dawn',
    duration: 5,
    aspect_ratio: '9:16',
    generate_audio: true,
    resolution: '720p',
  });
  assert.deepEqual(buildCangyuanVideoPayload('sd25-seedance-2.0', {
    prompt: 'a quiet lakeside at dawn', seconds: 5, generateAudio: false,
  }), {
    model: 'sd25-seedance-2.0',
    prompt: 'a quiet lakeside at dawn',
    duration: 5,
    aspect_ratio: '9:16',
    generate_audio: false,
    resolution: '720p',
  });
});

test('unverified string generate_audio contracts are never guessed or emitted', () => {
  const sd11Payload = buildCangyuanVideoPayload('sd11-seedance-2.0', { prompt: 'animate the subject' });
  const sd4Payload = buildCangyuanVideoPayload('sd4-seedance-2.0', { prompt: 'animate the subject' });
  const sd5Payload = buildCangyuanVideoPayload('sd5-seedance-2.0', { prompt: 'animate the subject' });
  for (const payload of [sd11Payload, sd4Payload, sd5Payload]) assert.equal('generate_audio' in payload, false);
  assert.throws(() => buildCangyuanVideoPayload('sd11-seedance-2.0', {
    prompt: 'animate the subject', generateAudio: false,
  }), /generate_audio/);
  assert.throws(() => buildCangyuanVideoPayload('sd4-seedance-2.0', {
    prompt: 'animate the subject', generateAudio: false,
  }), /generate_audio/);
  assert.throws(() => buildCangyuanVideoPayload('sd5-seedance-2.0', {
    prompt: 'animate the subject', generateAudio: true,
  }), /generate_audio/);
});

test('SD4 and SD5 frame and reference constraints match their documented model lines', () => {
  assert.deepEqual(buildCangyuanVideoPayload('sd4-seedance-2.0', {
    prompt: 'animate these endpoints',
    firstFrame: 'https://assets.example/first.png',
    lastFrame: 'https://assets.example/last.png',
  }), {
    model: 'sd4-seedance-2.0',
    prompt: 'animate these endpoints',
    first_image_url: 'https://assets.example/first.png',
    last_image_url: 'https://assets.example/last.png',
  });
  assert.throws(() => validateCangyuanVideoInput('sd4-seedance-2.0', {
    prompt: 'only a start', firstFrame: 'https://assets.example/first.png',
  }), /必须成对提供/);
  assert.throws(() => validateCangyuanVideoInput('sd5-seedance-2.0', {
    prompt: 'too many images', referenceImages: Array(10).fill('https://assets.example/ref.png'),
  }), /最多接收 9 张/);
  assert.throws(() => validateCangyuanVideoInput('sd5-seedance-2.0', {
    prompt: 'too many total references',
    referenceImages: Array(9).fill('https://assets.example/ref.png'),
    referenceVideos: Array(3).fill('https://assets.example/ref.mp4'),
    audios: ['https://assets.example/ref.mp3'],
  }), /总数不能超过 12 个/);
  assert.throws(() => validateCangyuanVideoInput('sd4-seedance-2.0', {
    prompt: 'mixed inputs',
    firstFrame: 'https://assets.example/first.png',
    lastFrame: 'https://assets.example/last.png',
    referenceImages: ['https://assets.example/ref.png'],
  }), /不能与参考图、参考视频或参考音频同时使用/);
  assert.deepEqual(buildCangyuanVideoPayload('sd5-seedance-2.0', {
    prompt: 'seeded scene', seed: 17,
  }), {
    model: 'sd5-seedance-2.0', prompt: 'seeded scene', seed: 17,
  });
  assert.deepEqual(buildCangyuanVideoPayload('sd5-seedance-2.0-fast', {
    prompt: 'seeded scene', seed: 2_147_483_647,
  }), {
    model: 'sd5-seedance-2.0-fast', prompt: 'seeded scene', seed: 2_147_483_647,
  });
  assert.equal(buildCangyuanVideoPayload('sd5-seedance-2.0', {
    prompt: 'zero seed', seed: 0,
  }).seed, 0);
  assert.throws(() => validateCangyuanVideoInput('sd5-seedance-2.0', {
    prompt: 'seed below range', seed: -1,
  }), /随机种子不能小于 0/);
  assert.throws(() => validateCangyuanVideoInput('sd5-seedance-2.0-fast', {
    prompt: 'seed above range', seed: 2_147_483_648,
  }), /随机种子不能大于 2147483647/);
  assert.throws(() => validateCangyuanVideoInput('sd5-seedance-2.0', {
    prompt: 'fractional seed', seed: 1.5,
  }), /seed 必须是安全整数/);
});

test('Cangyuan filters per-line unsupported media and reference combinations', () => {
  assert.throws(() => buildCangyuanVideoPayload('sd8-seedance-2.0-mini', {
    prompt: 'scene',
    referenceVideos: ['https://assets.example/reference.mp4'],
  }), /不支持或未核实.*参考视频/);
  assert.throws(() => buildCangyuanVideoPayload('sd13-seedance-2.0', {
    prompt: 'scene',
    audios: ['https://assets.example/reference.wav'],
  }), /不支持或未核实.*参考音频/);
  assert.throws(() => buildCangyuanVideoPayload('sd20-seedance-2.0-fast', {
    prompt: 'scene',
    seconds: 5,
    aspectRatio: '16:9',
    firstFrame: 'https://assets.example/first.png',
  }), /不支持或未核实.*首帧/);
  assert.throws(() => buildCangyuanVideoPayload('sd10-seedance-2.0', {
    prompt: 'scene',
    referenceVideos: ['https://assets.example/reference.mp4'],
  }), /必须至少再提供一张参考图/);
  assert.throws(() => buildCangyuanVideoPayload('sd14-seedance-2.0', {
    prompt: 'scene',
    firstFrame: 'https://assets.example/first.png',
    lastFrame: 'https://assets.example/last.png',
    referenceImages: ['https://assets.example/reference.png'],
  }), /首尾帧不能与参考图、参考视频或参考音频同时使用/);
  assert.throws(() => buildCangyuanVideoPayload('sd12-seedance-2.0', {
    prompt: 'scene',
    firstFrame: 'https://assets.example/first.png',
    audios: ['https://assets.example/reference.wav'],
  }), /提供首尾帧时不能同时使用参考音频/);
  assert.throws(() => buildCangyuanVideoPayload('sd16-seedance-2.0', {
    prompt: 'scene',
    firstFrame: 'https://assets.example/first.png',
  }), /首帧和尾帧必须成对提供/);
});

test('Cangyuan allows a standalone first frame where documented and requires one for SD25 tail frames', () => {
  assert.deepEqual(buildCangyuanVideoPayload('sd11-seedance-2.0', {
    prompt: 'animate the first frame',
    firstFrame: 'https://assets.example/first.png',
  }), {
    model: 'sd11-seedance-2.0',
    prompt: 'animate the first frame',
    resolution: '480p',
    first_image_url: 'https://assets.example/first.png',
  });
  assert.deepEqual(buildCangyuanVideoPayload('sd25-seedance-2.0', {
    prompt: 'animate the first frame',
    seconds: 5,
    firstFrame: 'https://assets.example/first.png',
  }), {
    model: 'sd25-seedance-2.0',
    prompt: 'animate the first frame',
    duration: 5,
    generate_audio: true,
    aspect_ratio: '9:16',
    resolution: '720p',
    first_image_url: 'https://assets.example/first.png',
  });
  assert.throws(() => buildCangyuanVideoPayload('sd25-seedance-2.0', {
    prompt: 'end on this image',
    seconds: 5,
    lastFrame: 'https://assets.example/last.png',
  }), /使用尾帧时必须同时提供首帧/);
});

test('unsupported inputs and unverified models are not silently mapped', () => {
  assert.throws(() => buildCangyuanVideoPayload('sd20-seedance-2.0-fast', {
    prompt: 'scene',
    seconds: 5,
    aspectRatio: '16:9',
    seed: 7,
  }), /不支持或未核实.*seed/);
  assert.deepEqual(buildCangyuanVideoPayload('sd20-seedance-2.0-fast', {
    prompt: 'scene',
    seconds: 5,
    aspectRatio: '16:9',
    audios: ['https://assets.example/reference.wav'],
  }), {
    model: 'sd20-seedance-2.0-fast',
    prompt: 'scene',
    duration: 5,
    aspect_ratio: '16:9',
    resolution: '480p',
    reference_audios: ['https://assets.example/reference.wav'],
  });
  assert.throws(() => buildCangyuanVideoPayload('sd10-seedance-2.0', {
    prompt: 'scene',
    audios: ['https://assets.example/reference.wav'],
  }), /必须至少再提供一张参考图/);

  assert.throws(() => buildCangyuanVideoPayload('fixture-video-model', { prompt: 'scene' }), /未出现在当前官方目录/);
});

test('model-specific advanced parameters are type-checked and forwarded from the official spec', () => {
  const model = 'mu1-muse-video';
  assert.deepEqual(buildCangyuanVideoPayload(model, {
    prompt: 'A cinematic city at night',
    modelParameters: {
      camera_movement: 'slow orbit',
      negative_prompt: 'watermark, blurry text',
      style_preset: 'cyberpunk_neon',
      mute_voice: 'true',
    },
  }), {
    model,
    prompt: 'A cinematic city at night',
    camera_movement: 'slow orbit',
    mute_voice: 'true',
    negative_prompt: 'watermark, blurry text',
    style_preset: 'cyberpunk_neon',
  });
  assert.throws(() => buildCangyuanVideoPayload(model, {
    prompt: 'A cinematic city at night', modelParameters: { camera_movement: 7 },
  }), /运镜格式不正确/);
  assert.throws(() => buildCangyuanVideoPayload('sd18-seedance-2.5', {
    prompt: 'Edit a scene', modelParameters: { mode: 'unknown' },
  }), /生成方式仅支持 edit、extend/);
});

test('video model parameter contract accepts bounded string lists and rejects structured values', () => {
  assert.deepEqual(parseVideoModelParameterValues({ voices: ['alloy', 'echo'] }), { voices: ['alloy', 'echo'] });
  assert.throws(() => parseVideoModelParameterValues({ voices: [{ id: 'alloy' }] }), /文本列表/);
  assert.throws(() => parseVideoModelParameterValues({ voices: Array(101).fill('voice') }), /文本列表/);
});

test('Cangyuan image byte validation enforces the site inline-image safety cap', () => {
  const model = 'sd20-seedance-2.0-fast';
  assert.equal(cangyuanVideoImageSizeError(model, CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES), null);
  assert.equal(cangyuanVideoImageSizeError(model, CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES - 1), null);
  assert.match(
    cangyuanVideoImageSizeError(model, CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES + 1),
    /30 MiB.*安全上限/,
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
  const model = 'sd20-seedance-2.0-fast';
  const maxBytes = CANGYUAN_VIDEO_MAX_REFERENCE_IMAGE_BYTES;
  const encodedLength = Math.ceil((maxBytes + 1) / 3) * 4;
  const oversizedDataUrl = `data:image/png;base64,${'A'.repeat(encodedLength)}`;
  assert.throws(() => validateCangyuanVideoInput(model, {
    prompt: 'animate the image',
    seconds: 5,
    aspectRatio: '16:9',
    referenceImages: [oversizedDataUrl],
  }, { requirePublicMedia: false }), /30 MiB.*安全上限/);
});
