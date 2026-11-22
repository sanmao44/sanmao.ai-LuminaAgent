import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const controls = [];
const empty = { __esModule: true, default: () => null };
const loader = createTsRequire(process.cwd(), {
  './VideoDurationField.css': {},
  './SelectMenu': {
    __esModule: true,
    default: (props) => {
      controls.push(props);
      return createElement('div', { 'aria-label': props.ariaLabel },
        props.options.map((option) => createElement('span', { key: option.value }, option.label)));
    },
  },
  '@/components/SelectMenu': {
    __esModule: true,
    default: (props) => {
      controls.push(props);
      return createElement('div', { 'aria-label': props.ariaLabel },
        props.options.map((option) => createElement('span', { key: option.value }, option.label)));
    },
  },
  '@/components/EditableSuggestionField': {
    __esModule: true,
    default: (props) => {
      controls.push(props);
      return createElement('div', { 'aria-label': props.ariaLabel },
        props.options.map((option) => createElement('span', { key: option }, props.optionLabel?.(option) ?? option)));
    },
  },
  '@/components/ModelPicker': empty,
  '@/components/ReferenceMentionEditor': empty,
  '@/components/JimengAccountSummary': empty,
  '@/components/cangyuan/CangyuanMediaUploadField': empty,
  '@/components/cangyuan/CangyuanVideoModelParameters': {
    __esModule: true,
    default: () => createElement('div', { 'aria-label': '当前型号的更多设置' },
      createElement('input', { 'aria-label': '型号专属参数', defaultValue: '' })),
  },
  '@/lib/creation/agent': { requestPromptOptimization() {} },
});
const VideoStudio = loader('./components/VideoStudio').default;
const { getCangyuanVideoModelCatalog } = loader('./lib/cangyuan-video-model-catalog');
const { getCangyuanVideoModelProfile } = loader('./lib/cangyuan-video-capabilities');
const catalog = getCangyuanVideoModelCatalog();
const models = catalog.map((entry) => ({
  id: `cangyuan:${entry.publicModel}`, rawId: entry.publicModel, displayName: entry.title,
  providerId: 'cangyuan', providerName: '沧元算力', kind: 'video',
  enabled: true, published: true, source: 'discovered', capabilities: ['video-generate'],
}));
const providers = [{
  id: 'cangyuan', name: '沧元算力', type: 'openai-compatible',
  baseUrl: 'https://ai.cangyuansuanli.cn/v1', videoTransport: 'openai-videos',
  apiKeyConfigured: true, modelLibraryEnabled: true,
}];

function renderModel(rawId) {
  controls.length = 0;
  return renderToStaticMarkup(createElement(VideoStudio, {
    models, providers, defaultModelId: `cangyuan:${rawId}`, onNotify() {},
  }));
}

test('the main video studio matches primary controls and media modes for every documented model', () => {
  assert.ok(catalog.length >= 146);
  for (const entry of catalog) {
    const profile = getCangyuanVideoModelProfile(entry.publicModel);
    const markup = renderModel(entry.publicModel);
    const labels = controls.map((control) => control.ariaLabel);
    if (!profile) {
      assert.equal(entry.spec.params.length, 0, entry.publicModel);
      assert.match(markup, /参数说明未完善/u);
      continue;
    }
    for (const [label, supported] of [
      ['视频时长', profile.supportsDuration],
      ['视频比例', profile.supportsAspectRatio],
      ['视频分辨率', profile.supportsResolution],
    ]) assert.equal(labels.includes(label), supported, `${entry.publicModel}: ${label}`);
    assert.equal(markup.includes('aria-label="视频随机种子"'), profile.supportsSeed, entry.publicModel);
    assert.equal(markup.includes('aria-label="生成原生音频"'), Boolean(profile.supportsGenerateAudio), entry.publicModel);
    const modes = controls.find((control) => control.ariaLabel === '生成方式')?.options ?? [];
    const expectedModes = [
      ...(profile.allowsNoReferences !== false && !profile.requiresReferenceImage ? ['text'] : []),
      ...(profile.supportsFirstFrame && profile.allowsFirstFrameWithoutLastFrame !== false ? ['first-frame'] : []),
      ...(profile.supportsFirstLastFrames ? ['frames'] : []),
      ...(profile.supportsReferenceImages || profile.supportsReferenceVideos || profile.supportsReferenceAudios ? ['reference'] : []),
    ];
    assert.deepEqual(modes.map((option) => option.value), expectedModes.length > 1 ? expectedModes : [], `${entry.publicModel}: media inputs`);
    const resolutions = controls.find((control) => control.ariaLabel === '视频分辨率')?.options ?? [];
    assert.ok(resolutions.every((option) => !profile.unsupportedResolutions?.includes(String(option.value ?? option).toLowerCase())), entry.publicModel);
  }
});

test('main studio filters resolution-specific durations and localizes strict resolution enums', () => {
  renderModel('sd10-seedance-2.5');
  const durations = controls.find((control) => control.ariaLabel === '视频时长');
  assert.deepEqual(durations.options.map((option) => option.value), [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const markup = renderModel('gemini-omni-1.2-flash');
  const resolution = controls.find((control) => control.ariaLabel === '视频分辨率');
  assert.deepEqual(resolution.options.map((option) => option.value), ['360P', '720P', '1080P', '4K']);
  assert.match(markup, /1080p（全高清）/u);
});

test('every documented model keeps its controls expanded with usage notes after settings', () => {
  for (const entry of catalog) {
    const markup = renderModel(entry.publicModel);
    assert.doesNotMatch(markup, /<details\b|<summary\b/u, entry.publicModel);
    const sectionIndex = markup.indexOf('aria-label="视频生成设置"');
    assert.ok(sectionIndex >= 0, entry.publicModel);
    const extraSettingsIndex = markup.indexOf('aria-label="当前型号的更多设置"');
    if (!getCangyuanVideoModelProfile(entry.publicModel)) continue;
    assert.ok(extraSettingsIndex > sectionIndex, entry.publicModel);
    assert.ok(markup.indexOf('使用说明') > extraSettingsIndex, entry.publicModel);
    assert.match(markup, /aria-label="放大编辑提示词"/u, entry.publicModel);
  }
});

test('generic and Agnes video models keep their existing parameter controls expanded', () => {
  for (const rawId of ['generic-video', 'agnes-video-v2.0']) {
    controls.length = 0;
    const model = { id: rawId, rawId, displayName: rawId, providerId: 'generic', providerName: '通用接口', kind: 'video', capabilities: ['video-generate'], enabled: true, published: true };
    const markup = renderToStaticMarkup(createElement(VideoStudio, {
      models: [model], providers: [{ id: 'generic', name: '通用接口', platform: 'openai', baseUrl: 'https://example.com/v1', videoTransport: 'openai-videos' }],
      defaultModelId: model.id, onNotify() {},
    }));
    assert.doesNotMatch(markup, /<details\b|<summary\b/u, rawId);
    assert.match(markup, /aria-label="视频生成设置"/u, rawId);
    if (rawId.startsWith('agnes')) {
      for (const label of ['宽度', '高度', '帧数', '帧率']) assert.ok(markup.includes(`aria-label="${label}"`), label);
    } else {
      for (const label of ['视频时长', '视频比例', '视频分辨率']) assert.ok(controls.some((control) => control.ariaLabel === label), label);
    }
  }
});
