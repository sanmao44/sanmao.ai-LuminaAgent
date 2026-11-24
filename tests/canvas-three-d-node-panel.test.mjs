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
const panelOverrides = {
  './CanvasThreeDNodePanel.module.css': { __esModule: true, default: styles },
  '@/components/SelectMenu': ({ ariaLabel, options }) => createElement('div', { 'aria-label': ariaLabel }, ...options.map((option) =>
    createElement('span', { key: option.value }, option.label))),
  '@/components/cangyuan/CangyuanMediaUploadField': ({ label, extraAction }) => createElement('div', { 'aria-label': label }, label, ' 上传文件', extraAction),
  '@/components/cangyuan/CangyuanThreeDScenarioPicker': () => createElement('div', null, '场景预设'),
  '@/components/cangyuan/CangyuanReferenceImagePreview': () => null,
  '@/components/ThreeDModelPreview': ({ label }) => createElement('div', { 'aria-label': label || '三维模型预览' }),
  '@/components/cangyuan/CangyuanTripoQualityOptions': {
    __esModule: true,
    default: qualityOptions.default,
    applyTripoQualityOptions: qualityOptions.applyTripoQualityOptions,
  },
  '@/lib/canvas/three-d-generation': { buildCanvasThreeDRequest: () => ({}) },
  '@/lib/canvas/three-d-reference-upload': { publishCanvasThreeDReferences: async (options) => options },
  '@/lib/cangyuan-media-task-polling': { CANGYUAN_3D_TASK_POLL_INTERVAL_MS: 1000 },
};
const loadPanel = createTsRequire(process.cwd(), panelOverrides);
const panel = loadPanel('./components/canvas/CanvasThreeDNodePanel').default;
const contracts = createTsRequire(process.cwd())('./packages/contracts/cangyuan-media');

function modelProps(rawId, options = {}, extra = {}) {
  return {
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
    ...extra,
  };
}

function renderModel(rawId, options = {}, extra = {}) {
  return renderToStaticMarkup(createElement(panel, modelProps(rawId, options, extra)));
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

const connectedImage = (id) => ({
  id, type: 'media', x: 0, y: 0, width: 240, height: 180,
  data: { kind: 'image', name: `${id}视图`, url: `https://cdn.example.test/${id}.png`, status: 'completed' },
});

test('connected canvas image is previewed and enables single-image generation alongside uploading', () => {
  const markup = renderModel('trellis', { mode: 'image-to-3d' }, {
    references: [connectedImage('正面')], onPickFromCanvas: () => undefined,
  });
  assert.match(markup, /src="https:\/\/cdn\.example\.test\/正面\.png"/);
  assert.match(markup, /画布引用 · 正面视图/);
  assert.match(markup, /从画布选择参考图片/);
  assert.match(markup, /上传文件/);
  assert.doesNotMatch(markup, /disabled=""[^>]*>生成三维模型/);
});

test('multiview previews show each connected image with canvas picking and reorder actions', () => {
  const markup = renderModel('tripo3d-v3.1', { mode: 'multiview-to-3d' }, {
    references: ['正面', '背面', '左侧', '右侧'].map(connectedImage), onPickFromCanvas: () => undefined,
  });
  assert.equal((markup.match(/画布引用 · /g) || []).length, 4);
  assert.equal((markup.match(/aria-label="从画布选择/g) || []).length, 4);
  assert.equal((markup.match(/图片前移"/g) || []).length, 4);
  assert.equal((markup.match(/图片后移"/g) || []).length, 4);
  assert.match(markup, /4\/4 张/);
  assert.doesNotMatch(markup, /disabled=""[^>]*>生成三维模型/);
});

function interactionPanel(props) {
  const react = {
    useMemo: (compute) => compute(), useCallback: (callback) => callback,
    useEffect: () => undefined, useRef: (value) => ({ current: value }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
  };
  const Component = createTsRequire(process.cwd(), { ...panelOverrides, react })('./components/canvas/CanvasThreeDNodePanel').default;
  const elements = (element) => {
    if (Array.isArray(element)) return element.flatMap(elements);
    if (!element || typeof element !== 'object') return [];
    return [element, ...elements(element.props?.children), ...elements(element.props?.extraAction)];
  };
  return elements(Component(props));
}

test('each multiview canvas picker preserves the requested view and arrow changes the submitted view assignment', () => {
  const picked = [];
  const changes = [];
  const sources = [connectedImage('正面'), connectedImage('背面')];
  const elements = interactionPanel(modelProps('tripo3d-v3.1', { mode: 'multiview-to-3d' }, {
    references: sources, onPickFromCanvas: (slot) => picked.push(slot),
    onDraftChange: (_id, value) => changes.push(value),
  }));
  elements.filter((element) => element.type === 'button' && element.props.className === 'canvasPick').forEach((button) => button.props.onClick());
  assert.deepEqual(picked, ['front', 'back', 'left', 'right']);
  elements.find((element) => element.props?.['aria-label'] === '正面（必需）图片后移').props.onClick();
  const { canvasThreeDReferenceOptions } = createTsRequire(process.cwd())('./lib/canvas/three-d-references');
  assert.deepEqual(canvasThreeDReferenceOptions(changes[0], sources).multiviewImages, {
    front: sources[1].data.url, back: sources[0].data.url,
  });
});

test('switching a model keeps canvas node bindings while clearing incompatible model settings', () => {
  const changes = [];
  const props = modelProps('tripo3d', { mode: 'image-to-3d', texture: 'HD', imageUrl: 'https://cdn.example.test/upload.png' }, {
    onDraftChange: (_id, value) => changes.push(value),
  });
  props.draft.referenceNodes = { image: 'source-1' };
  props.models.push({ ...props.models[0], id: 'provider-1:trellis', rawId: 'trellis', displayName: 'Trellis' });
  const elements = interactionPanel(props);
  elements.find((element) => element.props?.ariaLabel === '选择三维生成模型').props.onChange('provider-1:trellis');
  assert.deepEqual(changes[0].referenceNodes, { image: 'source-1' });
  assert.equal(changes[0].options.texture, undefined);
  assert.equal(changes[0].options.imageUrl, 'https://cdn.example.test/upload.png');
});

test('uploads completing in reverse order merge into separate views without overwriting earlier results', async () => {
  const changes = [];
  const elements = interactionPanel(modelProps('tripo3d-v3.1', { mode: 'multiview-to-3d' }, {
    onDraftChange: (_id, value) => changes.push(value),
  }));
  const upload = (view) => elements.find((element) => element.props?.fieldId === `canvas-three-d-1-3d-${view}`).props.onChange;
  const frontUpload = upload('front');
  const backUpload = upload('back');
  let finishFront;
  let finishBack;
  const front = new Promise((resolve) => { finishFront = resolve; }).then(() => frontUpload('https://cdn.example.test/front.png'));
  const back = new Promise((resolve) => { finishBack = resolve; }).then(() => backUpload('https://cdn.example.test/back.png'));
  finishBack();
  await back;
  finishFront();
  await front;
  assert.deepEqual(changes.at(-1).options.multiviewImages, {
    front: 'https://cdn.example.test/front.png', back: 'https://cdn.example.test/back.png',
  });
});

test('an old upload completion preserves canvas view reordering and concurrent prompt edits', () => {
  const changes = [];
  const sources = [connectedImage('正面'), connectedImage('背面')];
  const elements = interactionPanel(modelProps('tripo3d-v3.1', { mode: 'multiview-to-3d' }, {
    references: sources, onDraftChange: (_id, value) => changes.push(value),
  }));
  const finishLeftUpload = elements.find((element) => element.props?.fieldId === 'canvas-three-d-1-3d-left').props.onChange;
  elements.find((element) => element.props?.['aria-label'] === '正面（必需）图片后移').props.onClick();
  elements.find((element) => element.type === 'textarea').props.onChange({ target: { value: '完成后添加的新描述' } });
  finishLeftUpload('https://cdn.example.test/upload-left.png');
  const { canvasThreeDReferenceOptions } = createTsRequire(process.cwd())('./lib/canvas/three-d-references');
  assert.deepEqual(canvasThreeDReferenceOptions(changes.at(-1), sources).multiviewImages, {
    front: sources[1].data.url, back: sources[0].data.url, left: 'https://cdn.example.test/upload-left.png',
  });
  assert.equal(changes.at(-1).prompt, '完成后添加的新描述');
});

test('a single image upload finishing after a model switch keeps the newly selected model', () => {
  const changes = [];
  const props = modelProps('tripo3d', { mode: 'image-to-3d', texture: 'HD' }, {
    onDraftChange: (_id, value) => changes.push(value),
  });
  props.models.push({ ...props.models[0], id: 'provider-1:trellis', rawId: 'trellis', displayName: 'Trellis' });
  const elements = interactionPanel(props);
  const finishImageUpload = elements.find((element) => element.props?.fieldId === 'canvas-three-d-1-3d-image').props.onChange;
  elements.find((element) => element.props?.ariaLabel === '选择三维生成模型').props.onChange('provider-1:trellis');
  finishImageUpload('https://cdn.example.test/upload.png');
  assert.equal(changes.at(-1).modelId, 'provider-1:trellis');
  assert.equal(changes.at(-1).options.texture, undefined);
  assert.equal(changes.at(-1).options.imageUrl, 'https://cdn.example.test/upload.png');
});
