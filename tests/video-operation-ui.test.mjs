import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const [videoStudio, parameterEditor] = await Promise.all([
  readFile(new URL('../components/VideoStudio.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/CreationParameterEditor.tsx', import.meta.url), 'utf8'),
]);

const loadEditor = createTsRequire(process.cwd(), {
  './VideoDurationField.css': {},
  '@/components/cangyuan/CangyuanImageModelOptions': { __esModule: true, default: () => null },
  '@/components/cangyuan/CangyuanVideoModelParameters': {
    __esModule: true,
    default: ({ spec, values }) => createElement('output', {
      'aria-label': '当前型号的更多设置',
      'data-model': spec.publicModel,
    }, JSON.stringify(values)),
  },
  './ModelPicker': { __esModule: true, default: () => null },
  './EditableSuggestionField': { __esModule: true, default: () => null },
  './SelectMenu': {
    __esModule: true,
    default: ({ options, ariaLabel }) => createElement('div', { 'aria-label': ariaLabel },
      ...options.map((option) => createElement('span', { key: String(option.value) }, option.label))),
  },
});
const CreationParameterEditor = loadEditor('./components/CreationParameterEditor').default;

function renderVideoEditor({ provider, rawId, capabilities = ['video-generate'], modelParameters = {} }) {
  const model = {
    id: `${provider.id}-model`,
    providerId: provider.id,
    providerName: provider.name,
    rawId,
    displayName: rawId,
    kind: 'video',
    enabled: true,
    published: true,
    capabilities,
  };
  const runtime = {
    providers: [provider],
    models: [model],
    settings: { defaultProviderId: provider.id, defaultVideoModelId: model.id },
  };
  const settings = {
    kind: 'video',
    model: model.id,
    operation: 'generate',
    inputMode: 'text',
    duration: 5,
    aspect: '16:9',
    resolution: '720p',
    audio: false,
    agnesWidth: 1152,
    agnesHeight: 768,
    agnesNumFrames: 81,
    agnesFrameRate: 24,
    modelParameters,
  };
  return renderToStaticMarkup(createElement(CreationParameterEditor, {
    settings,
    runtime,
    onChange: () => undefined,
  }));
}

test('video studio uses the shared model library picker', () => {
  assert.match(videoStudio, /import ModelPicker from '@\/components\/ModelPicker'/);
  assert.match(videoStudio, /const videoPickerModels =/);
  assert.match(videoStudio, /<ModelPicker\s+models=\{videoPickerModels\}[\s\S]*?capability="video-generate"/);
  assert.doesNotMatch(videoStudio, /const modelOptions = \[\{ value: 'auto'/);
});

test('hides the video operation selector when generation is the only supported operation', () => {
  assert.match(videoStudio, /const showOperationField = operationOptions\.length > 1/);
  assert.match(videoStudio, /\{showOperationField && <label className="video-field"><span>操作类型<\/span>/);
  assert.match(parameterEditor, /const showOperationField = operationOptions\.length > 1/);
  assert.match(parameterEditor, /\{showOperationField && \(\s*<label className="creation-field">/s);
});

test('keeps edit and extend operation options capability-driven', () => {
  assert.match(videoStudio, /supportsEdit/);
  assert.match(videoStudio, /supportsExtend/);
  assert.match(parameterEditor, /supportsOperationEdit/);
  assert.match(parameterEditor, /supportsOperationExtend/);
});

test('video editor exposes the selected model documented duration range', () => {
  const markup = renderVideoEditor({
    provider: { id: 'cangyuan', name: '沧元算力', platform: 'cangyuan', videoTransport: 'cangyuan-videos' },
    rawId: 'gf1-gemini-omni-1.2-flash',
  });

  assert.match(markup, /aria-label="视频时长"/);
  assert.match(markup, /15 秒/);
  assert.doesNotMatch(markup, /30 秒/);
});

test('coarse video-generate models render image input modes', () => {
  const markup = renderVideoEditor({
    provider: { id: 'generic', name: 'Generic', platform: 'openai', videoTransport: 'openai-videos' },
    rawId: 'video-model',
  });

  assert.match(markup, /图生视频 · 首帧/);
  assert.match(markup, /参考图生视频/);
});

test('unverified Cangyuan models show a verification notice while Seedance exposes documented inputs', () => {
  const provider = { id: 'cangyuan', name: '沧元算力', platform: 'cangyuan', videoTransport: 'cangyuan-videos' };
  const unlisted = renderVideoEditor({ provider, rawId: 'unlisted-model' });
  assert.match(unlisted, /当前型号的参数与素材要求尚未核实，请先选择已支持的型号/);
  assert.doesNotMatch(unlisted, /图生视频|首尾帧|参考图生视频|aria-label="视频时长"|aria-label="视频分辨率"/);

  const seedance = renderVideoEditor({ provider, rawId: 'sd20-seedance-2.0-fast' });
  assert.match(seedance, /不支持首帧图片/);
  assert.match(seedance, /不支持尾帧图片/);
  assert.doesNotMatch(seedance, /首尾帧必须成对/);
  assert.match(seedance, /参考图生视频/);
  assert.doesNotMatch(seedance, /原生音频/);
});

test('canvas video editor exposes only the selected Cangyuan model parameters', () => {
  const provider = { id: 'cangyuan', name: '沧元算力', platform: 'cangyuan', videoTransport: 'cangyuan-videos' };
  const markup = renderVideoEditor({
    provider,
    rawId: 'doubao-seedance-2-0-260128',
    modelParameters: { face_mode: 'asset', seed: '42', stale_parameter: 'remove-me' },
  });

  assert.match(markup, /aria-label="当前型号的更多设置"/);
  assert.match(markup, /data-model="doubao-seedance-2-0-260128"/);
  assert.match(markup, /face_mode/);
  assert.match(markup, /seed/);
  assert.doesNotMatch(markup, /stale_parameter|remove-me/);
});
