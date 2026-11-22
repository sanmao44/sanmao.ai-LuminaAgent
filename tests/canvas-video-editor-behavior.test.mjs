import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const controls = [];
let modelPicker;
let advancedParameters;
const loader = createTsRequire(process.cwd(), {
  './VideoDurationField.css': {},
  './ModelPicker': {
    __esModule: true,
    default: (props) => { modelPicker = props; return createElement('button', { type: 'button' }, '选择模型'); },
  },
  './SelectMenu': {
    __esModule: true,
    default: (props) => {
      controls.push(props);
      return createElement('div', { 'aria-label': props.ariaLabel }, props.options.map((option) =>
        createElement('span', { key: option.value, 'data-value': option.value }, option.label)));
    },
  },
  './EditableSuggestionField': {
    __esModule: true,
    default: (props) => {
      controls.push(props);
      return createElement('div', { 'aria-label': props.ariaLabel }, props.options.map((option) =>
        createElement('span', { key: option, 'data-value': option }, props.optionLabel?.(option) ?? option)));
    },
  },
  '@/components/cangyuan/CangyuanImageModelOptions': { __esModule: true, default: () => null },
  '@/components/cangyuan/CangyuanVideoModelParameters': {
    __esModule: true,
    default: (props) => { advancedParameters = props; return null; },
  },
});
const CreationParameterEditor = loader('./components/CreationParameterEditor').default;
const { getCangyuanVideoModelCatalog } = loader('./lib/cangyuan-video-model-catalog');
const { getCangyuanVideoModelProfile } = loader('./lib/cangyuan-video-capabilities');
const catalog = getCangyuanVideoModelCatalog();
const models = catalog.map((entry) => ({
  id: `cangyuan:${entry.publicModel}`, rawId: entry.publicModel, displayName: entry.title,
  providerId: 'cangyuan', providerName: '沧元算力', kind: 'video',
  enabled: true, published: true, source: 'discovered', capabilities: ['video-generate'],
}));
const runtime = {
  models,
  providers: [{
    id: 'cangyuan', name: '沧元算力', type: 'openai-compatible',
    baseUrl: 'https://ai.cangyuansuanli.cn/v1', videoTransport: 'openai-videos',
    apiKeyConfigured: true, modelLibraryEnabled: true,
  }],
  settings: { defaultProviderId: 'cangyuan', defaultVideoModelId: models[0].id },
};

function renderEditor(rawId, overrides = {}, onChange = () => undefined) {
  controls.length = 0;
  modelPicker = undefined;
  advancedParameters = undefined;
  const profile = getCangyuanVideoModelProfile(rawId);
  const settings = {
    kind: 'video', model: `cangyuan:${rawId}`, operation: 'generate', inputMode: 'text',
    duration: profile?.durationDefault ?? profile?.minSeconds ?? 5,
    aspect: profile?.aspectRatioDefault ?? profile?.suggestedAspectRatios[0] ?? '16:9',
    resolution: profile?.resolutionDefault ?? profile?.suggestedResolutions[0] ?? '720p',
    audio: true, agnesWidth: 1152, agnesHeight: 768, agnesNumFrames: 81, agnesFrameRate: 24,
    modelParameters: {}, ...overrides,
  };
  const markup = renderToStaticMarkup(createElement(CreationParameterEditor, {
    settings, runtime, variant: 'canvas-flat', onChange,
  }));
  return { markup, settings };
}

test('every documented video model exposes only its supported primary controls in the canvas editor', () => {
  assert.ok(catalog.length >= 146);
  for (const entry of catalog) {
    const profile = getCangyuanVideoModelProfile(entry.publicModel);
    const { markup } = renderEditor(entry.publicModel);
    const labels = controls.map((control) => control.ariaLabel);
    if (!profile) {
      assert.equal(entry.spec.params.length, 0, `${entry.publicModel}: no verified parameters`);
      assert.ok(!labels.some((label) => ['视频时长', '视频比例', '视频分辨率'].includes(label)), entry.publicModel);
      assert.match(markup, /当前型号的参数与素材要求尚未核实/u);
      continue;
    }
    assert.equal(labels.includes('视频时长'), profile.supportsDuration, `${entry.publicModel}: duration`);
    assert.equal(labels.includes('视频比例'), profile.supportsAspectRatio, `${entry.publicModel}: aspect ratio`);
    assert.equal(labels.includes('视频分辨率'), profile.supportsResolution, `${entry.publicModel}: resolution`);
    assert.equal(markup.includes('aria-label="视频随机种子"'), profile.supportsSeed, `${entry.publicModel}: seed`);
    assert.equal(markup.includes('原生音频'), Boolean(profile.supportsGenerateAudio), `${entry.publicModel}: audio`);
    const modeOptions = controls.find((control) => control.ariaLabel === '视频生成方式')?.options ?? [];
    const expectedModes = [
      ...(profile.allowsNoReferences !== false && !profile.requiresReferenceImage ? ['text'] : []),
      ...(profile.supportsFirstFrame && profile.allowsFirstFrameWithoutLastFrame !== false ? ['first-frame'] : []),
      ...(profile.supportsFirstLastFrames ? ['frames'] : []),
      ...(profile.supportsReferenceImages || profile.supportsReferenceVideos || profile.supportsReferenceAudios ? ['reference'] : []),
    ];
    assert.deepEqual(modeOptions.map((option) => option.value), expectedModes.length > 1 ? expectedModes : [],
      `${entry.publicModel}: supported input modes`);
  }
});

test('models with frame input but no reference-image list retain their first-frame choice', () => {
  renderEditor('kl1-kling-3.0');
  const modes = controls.find((control) => control.ariaLabel === '视频生成方式').options.map((option) => option.value);
  assert.deepEqual(modes, ['text', 'first-frame', 'frames']);
});

test('strict resolution choices match lowercase saved settings and display localized labels', () => {
  const { markup } = renderEditor('gemini-omni-1.2-flash', { resolution: '1080p' });
  const resolution = controls.find((control) => control.ariaLabel === '视频分辨率');
  assert.equal(resolution.value, '1080P');
  assert.deepEqual(resolution.options.map((option) => option.value), ['360P', '720P', '1080P', '4K']);
  assert.match(markup, /1080p（全高清）/u);
  assert.match(markup, /自动|横屏/u);
});

test('suggested aspect and resolution choices use Chinese presentation labels', () => {
  const { markup } = renderEditor('sd11-seedance-2.0');
  assert.match(markup, /自适应/u);
  assert.match(markup, /480p（标清）/u);
  assert.match(markup, /9:16（竖屏）/u);
});

test('switching from frame input to a reference-only model preserves the usable reference mode', () => {
  let changed;
  renderEditor('gf1-gemini-omni-1.2-flash', {
    inputMode: 'first-frame', duration: 15, aspect: '9:16', resolution: '1080p',
    modelParameters: { seed: '42', camera_movement: 'orbit' },
  }, (value) => { changed = value; });
  modelPicker.onChange('cangyuan:sd20-seedance-2.0-fast');
  assert.equal(changed.inputMode, 'reference');
  assert.equal(changed.audio, false);
  assert.equal(changed.duration, 5);
  assert.equal(changed.resolution, '480p');
  assert.equal('seed' in changed.modelParameters, false);
  assert.equal('camera_movement' in changed.modelParameters, false);
});

test('the seed remains saved when another model setting is changed', () => {
  let changed;
  renderEditor('gf1-gemini-omni-1.2-flash', { modelParameters: { seed: '42' } }, (value) => { changed = value; });
  assert.equal(advancedParameters.values.seed, '42');
  controls.find((control) => control.ariaLabel === '视频时长').onChange(8);
  assert.equal(changed.duration, 8);
  assert.equal(changed.modelParameters.seed, '42');
});

test('switching to a required-reference model removes the unusable text-only input mode', () => {
  let changed;
  renderEditor('gf1-gemini-omni-1.2-flash', {}, (value) => { changed = value; });
  modelPicker.onChange('cangyuan:grok-video-1.5');
  assert.equal(changed.inputMode, 'reference');
});

test('explicitly forbidden resolutions are absent from suggestions', () => {
  renderEditor('sd11-seedance-2.0');
  const resolution = controls.find((control) => control.ariaLabel === '视频分辨率');
  assert.equal(resolution.options.some((option) => String(option.value ?? option).toLowerCase() === '4k'), false);
});

test('changing resolution corrects a duration forbidden for that resolution', () => {
  let changed;
  renderEditor('sd10-seedance-2.5', { resolution: '480p', duration: 20 }, (value) => { changed = value; });
  controls.find((control) => control.ariaLabel === '视频分辨率').onChange('720p');
  assert.equal(changed.resolution, '720p');
  assert.equal(changed.duration, 12);
  renderEditor('sd10-seedance-2.5', { resolution: '720p', duration: 12 });
  const duration = controls.find((control) => control.ariaLabel === '视频时长');
  assert.ok(duration.options.every((option) => option.value <= 12));
});

test('long podcast durations retain direct entry and use a compact preset menu', () => {
  const { markup } = renderEditor('mu1-muse-podcast', { duration: 125 });
  const duration = controls.find((control) => control.ariaLabel === '视频时长');
  assert.ok(duration.options.length <= 11);
  assert.ok(duration.options.some((option) => option.label === '30 分钟'));
  assert.match(markup, /aria-label="视频时长（秒）"/u);
  assert.match(markup, /value="125"/u);
  assert.match(markup, /当前 2 分 5 秒/u);
  assert.match(markup, /class="creation-field video-duration-wide"/u);
});

test('every model seed uses the bounded project input and short durations retain compact cells', () => {
  for (const entry of catalog) {
    const profile = getCangyuanVideoModelProfile(entry.publicModel);
    const { markup } = renderEditor(entry.publicModel);
    assert.match(markup, /class="creation-parameter-grid primary video-primary-grid"/u, entry.publicModel);
    if (profile?.supportsSeed) {
      assert.match(markup, /<input class="creation-field-input" type="number" aria-label="视频随机种子"/u, entry.publicModel);
    }
    if (!profile?.supportsDuration || profile.maxSeconds <= 60) {
      assert.doesNotMatch(markup, /class="creation-field video-duration-wide"/u, entry.publicModel);
    }
  }
});
