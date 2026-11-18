import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd(), {
  './CangyuanVideoModelParameters.module.css': {
    panel: 'panel', heading: 'heading', grid: 'grid', field: 'field', booleanField: 'booleanField', wideField: 'wideField',
  },
  '@/components/SelectMenu': {
    __esModule: true,
    default: ({ value, options, ariaLabel }) => createElement('select', { 'aria-label': ariaLabel, value: String(value), onChange: () => undefined },
      ...options.map((option) => createElement('option', { key: String(option.value), value: String(option.value) }, option.label))),
  },
});
const CangyuanVideoModelParameters = load('./components/cangyuan/CangyuanVideoModelParameters').default;

test('video model settings render documented field types with localized labels', () => {
  const spec = {
    publicModel: 'sample-video',
    params: [
      { name: 'model', type: 'string' },
      { name: 'prompt', type: 'string' },
      { name: 'duration', type: 'number' },
      { name: 'camera_movement', type: 'string', description: '可直接描述镜头运动。' },
      { name: 'mute_voice', type: 'string', description: 'true 时人物不出声。' },
      { name: 'shot_count', type: 'number', minimum: 0, maximum: 999 },
      { name: 'storyboard', type: 'string' },
    ],
  };
  const markup = renderToStaticMarkup(createElement(CangyuanVideoModelParameters, {
    spec,
    values: { camera_movement: '向左摇镜', mute_voice: 'true', shot_count: 123, storyboard: '镜头一' },
    onChange: () => undefined,
  }));

  assert.match(markup, /更多设置/);
  assert.match(markup, /只显示当前型号文档支持的选项/);
  assert.match(markup, /镜头运镜/);
  assert.match(markup, /人物静音/);
  assert.match(markup, /正常配音（默认）/);
  assert.match(markup, /value="true" selected/);
  assert.match(markup, /type="number"[^>]*min="0"[^>]*max="999"/);
  assert.match(markup, /textarea[^>]*aria-label="分镜表"/);
  assert.doesNotMatch(markup, /name="model"|name="prompt"|name="duration"/);
});

test('video model settings stay hidden when the current model has no advanced fields', () => {
  const markup = renderToStaticMarkup(createElement(CangyuanVideoModelParameters, {
    spec: { publicModel: 'plain-video', params: [{ name: 'prompt', type: 'string' }, { name: 'duration', type: 'number' }] },
    values: {},
    onChange: () => undefined,
  }));
  assert.equal(markup, '');
});

test('video model help text hides raw API keys and presents localized guidance', () => {
  const spec = {
    publicModel: 'documented-video',
    params: [
      { name: 'duration', type: 'number', description: 'duration。' },
      { name: 'camera_movement', type: 'string', description: '运镜。例如 pan_left、zoom_in、orbit。' },
      { name: 'face_mode', type: 'string', description: '仅当素材接口拿不到 asset_id 时才开；已有 Active 的 asset:// 不要开。' },
    ],
  };
  const markup = renderToStaticMarkup(createElement(CangyuanVideoModelParameters, {
    spec,
    values: {},
    onChange: () => undefined,
  }));

  assert.match(markup, /向左摇镜、推近、环绕/);
  assert.match(markup, /不确定时保留模型默认值/);
  assert.doesNotMatch(markup, /duration。|pan_left|zoom_in|asset_id|asset:\/\/|Active/);
});
