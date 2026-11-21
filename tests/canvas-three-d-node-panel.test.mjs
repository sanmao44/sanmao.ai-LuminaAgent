import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loadQualityOptions = createTsRequire(process.cwd(), {
  '@/components/cangyuan/CangyuanSuggestionInput': ({ ariaLabel, value }) => createElement('input', { 'aria-label': ariaLabel, value, readOnly: true }),
  '@/components/SelectMenu': ({ ariaLabel, options }) => createElement('div', { 'aria-label': ariaLabel }, ...options.map((option) =>
    createElement('span', { key: option.value, 'data-value': option.value }, option.label))),
});
const qualityOptions = loadQualityOptions('./components/cangyuan/CangyuanTripoQualityOptions');
const styles = new Proxy({}, { get: (_, key) => String(key) });
const loadPanel = createTsRequire(process.cwd(), {
  './CanvasThreeDNodePanel.module.css': styles,
  '@/components/SelectMenu': ({ ariaLabel, options }) => createElement('div', { 'aria-label': ariaLabel }, ...options.map((option) =>
    createElement('span', { key: option.value }, option.label))),
  '@/components/cangyuan/CangyuanMediaUploadField': ({ label }) => createElement('div', { 'aria-label': label }, label, ' 上传文件'),
  '@/components/cangyuan/CangyuanThreeDScenarioPicker': () => createElement('div', null, '场景预设'),
  '@/components/cangyuan/CangyuanReferenceImagePreview': () => null,
  '@/components/cangyuan/CangyuanTripoQualityOptions': {
    __esModule: true,
    default: qualityOptions.default,
    applyTripoQualityOptions: qualityOptions.applyTripoQualityOptions,
  },
  '@/lib/canvas/three-d-generation': { buildCanvasThreeDRequest: () => ({}) },
  '@/lib/cangyuan-media-task-polling': { CANGYUAN_3D_TASK_POLL_INTERVAL_MS: 1000 },
});
const panel = loadPanel('./components/canvas/CanvasThreeDNodePanel').default;
const contracts = createTsRequire(process.cwd())('./packages/contracts/cangyuan-media');

function renderModel(rawId, options = {}) {
  return renderToStaticMarkup(createElement(panel, {
    nodeId: 'three-d-1',
    models: [{
      id: `provider-1:${rawId}`,
      rawId,
      displayName: rawId,
      providerName: '测试服务商',
      enabled: true,
      published: true,
      capabilities: ['3d-generate'],
    }],
    draft: { modelId: `provider-1:${rawId}`, prompt: '一艘木船', options },
    onDraftChange: () => undefined,
    onTaskChange: () => undefined,
  }));
}

test('3D panel shows Tripo controls beside the prompt without collapsed model settings', () => {
  const markup = renderModel('tripo3d', { mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png' });

  assert.match(markup, /aria-label="模型参数"/);
  assert.match(markup, /物体描述 · 必填/);
  assert.match(markup, /参考图片/);
  assert.match(markup, /贴图质量/);
  assert.match(markup, /PBR 材质/);
  assert.match(markup, /生成三维模型/);
  assert.doesNotMatch(markup, /<details/);
});

test('3D panel keeps every Trellis and Tripo quality parameter visible', () => {
  const trellis = renderModel('trellis', { imageUrl: 'https://cdn.example.test/boat.png' });
  const tripo = renderModel('tripo3d-v3.1', { mode: 'text-to-3d' });

  for (const label of ['贴图边长', '随机种子', '网格简化', '结构引导', '结构采样步数', '细节引导', '细节采样步数']) {
    assert.match(trellis, new RegExp(label));
  }
  for (const note of ['数值越大，网格越轻', '提升轮廓贴合度', '步数越多，耗时越长', '提升细节贴合度']) {
    assert.match(trellis, new RegExp(note));
  }
  assert.match(trellis, /title="增加步数会改善轮廓，也会延长生成时间。"/);
  for (const label of ['几何质量', '贴图质量', '贴图版本', '面数上限', 'PBR 材质']) {
    assert.match(tripo, new RegExp(label));
  }
  assert.doesNotMatch(trellis, /<details/);
  assert.doesNotMatch(tripo, /<details/);
});

test('Trellis separates output reproducibility controls from mesh quality controls', () => {
  const markup = renderModel('trellis', { imageUrl: 'https://cdn.example.test/boat.png' });

  assert.match(markup, /aria-label="输出与复现参数"[\s\S]*贴图边长[\s\S]*随机种子/);
  assert.match(markup, /aria-label="模型质量与网格参数"[\s\S]*网格简化[\s\S]*结构引导[\s\S]*细节引导/);
  assert.doesNotMatch(markup, /<details/);
});

test('every registered 3D model renders its supported generation modes and ready controls', () => {
  for (const modelId of ['tripo3d', 'trellis', 'tripo3d-v3.1', 'tripo3d-p1', 'tripo3d-p2']) {
    const profile = contracts.getCangyuan3DModelProfile(modelId);
    assert.ok(profile, `${modelId} must have a UI profile`);

    for (const mode of profile.supportedModes) {
      const options = mode === 'multiview-to-3d'
        ? { mode, multiviewImages: { front: 'https://cdn.example.test/front.png', back: 'https://cdn.example.test/back.png' } }
        : mode === 'image-to-3d'
          ? { mode, imageUrl: 'https://cdn.example.test/boat.png' }
          : { mode };
      const markup = renderModel(modelId, options);

      assert.match(markup, /aria-label="模型参数"/, `${modelId} / ${mode}`);
      assert.match(markup, /aria-label="三维生成方式"/, `${modelId} / ${mode}`);
      assert.match(markup, /aria-pressed="true"/, `${modelId} / ${mode}`);
      assert.match(markup, /生成三维模型/, `${modelId} / ${mode}`);
      assert.doesNotMatch(markup, /<details/, `${modelId} / ${mode}`);
      assert.doesNotMatch(markup, /disabled=""[^>]*>生成三维模型/, `${modelId} / ${mode} should be ready with valid input`);
    }
  }
});
