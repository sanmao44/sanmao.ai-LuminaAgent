import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const { CanvasCore } = load('./packages/canvas-core/runtime');
const { replaceCanvasNodeMedia, replaceCanvasMediaFile } = load('./lib/canvas/media-replacement');
const { applyCanvasMediaNaturalSizes } = load('./lib/canvas/media-natural-size');

function fixture(kind = 'image') {
  const source = {
    id: 'missing', type: 'media', x: 123, y: 456, w: 320, h: 240, groupId: 'group-a', zIndex: 3,
    data: {
      kind, url: '/missing', name: '主角参考', status: 'completed',
      model: 'old-model', providerName: 'old-provider', assetId: 'old-asset', sourceAssetId: 'old-source', storageKey: 'old-key',
      jobId: 'old-task', progress: 100, durationMs: 50000, sourceDurationMs: 60000, nativeWidth: 1920, nativeHeight: 1080,
      videoClip: { version: 1, startTime: 20, endTime: 25 },
      mask: { url: '/old-mask' }, maskApplied: true, maskSourceNodeId: 'old-mask-source',
      params: { kind, model: 'draft-model', aspect: '16:9', mask: { url: '/old-mask' } },
      prompt: '保留的提示词', generation: { kind, taskId: 'old-task', params: { kind }, prompt: '旧生成记录' },
      editor: { draftPrompt: '未提交的修改', draftParams: { kind, model: 'editor-model', mask: { url: '/old-mask' } } },
      history: [{ id: 'history-a', prompt: '历史提示词' }],
    },
  };
  const target = { id: 'target', type: 'media', x: 800, y: 500, data: { kind: 'video', url: '/target' } };
  return { version: '1', nodes: [source, target], groups: [{ id: 'group-a', nodeIds: ['missing'] }], edges: [{ id: 'edge-a', source: 'missing', target: 'target' }], camera: { x: 1, y: 2, zoom: .8 } };
}

function asset(kind = 'image') {
  return { id: 'replacement', kind, url: '/replacement', name: 'file-name', mime: `${kind}/test`, size: 20, storageKey: 'new-key' };
}

function harness(document = fixture()) {
  const core = new CanvasCore(document);
  core.setSelection({ nodeIds: ['missing'], groupId: 'group-a' });
  return {
    core,
    options: {
      nodeId: 'missing', file: new File(['test'], 'replacement.png', { type: `${document.nodes[0].data.kind}/test` }),
      readDocument: () => core.document(),
      commit: (apply) => { core.apply({ id: 'replace-media', label: 'replace', apply }); return true; },
      uploadAsset: async () => asset(document.nodes[0].data.kind),
    },
  };
}

for (const kind of ['image', 'video']) {
  test(`${kind} replacement keeps node identity, geometry, connections, selection and Core undo/redo`, async () => {
    const original = fixture(kind);
    const { core, options } = harness(original);
    await replaceCanvasMediaFile(options);
    const next = core.document();
    const node = next.nodes[0];
    assert.deepEqual({ ...node, data: undefined }, { ...original.nodes[0], data: undefined });
    assert.equal(node.data.url, '/replacement');
    assert.equal(node.data.name, '主角参考');
    assert.equal(node.data.assetId, 'replacement');
    assert.equal(node.data.sourceAssetId, 'replacement');
    assert.equal(node.data.storageKey, 'new-key');
    assert.strictEqual(next.edges, original.edges);
    assert.strictEqual(next.groups, original.groups);
    assert.strictEqual(next.nodes[1], original.nodes[1]);
    assert.strictEqual(next.camera, original.camera);
    assert.deepEqual(core.selection(), { nodeIds: ['missing'], groupId: 'group-a' });
    assert.equal(core.history().past.length, 1);
    assert.equal(core.undo().nodes[0].data.url, '/missing');
    assert.equal(core.redo().nodes[0].data.url, '/replacement');
    const measured = applyCanvasMediaNaturalSizes(next, [{ nodeId: 'missing', width: 800, height: 800, sourceUrl: '/replacement' }]);
    assert.equal(measured.nodes[0].w, 320);
    assert.equal(measured.nodes[0].h, 240);
  });
}

test('replacement clears source-specific metadata and masks while retaining editing intent and history', () => {
  const original = fixture();
  const node = replaceCanvasNodeMedia(original, original.nodes[0], asset()).nodes[0];
  for (const key of ['generation', 'model', 'providerName', 'jobId', 'videoClip', 'durationMs', 'sourceDurationMs', 'nativeWidth', 'nativeHeight', 'mask', 'maskApplied', 'maskSourceNodeId']) {
    assert.equal(key in node.data, false, key);
  }
  assert.equal(node.data.params.model, 'draft-model');
  assert.equal('mask' in node.data.params, false);
  assert.equal(node.data.editor.draftPrompt, '未提交的修改');
  assert.equal(node.data.editor.draftParams.model, 'editor-model');
  assert.equal('mask' in node.data.editor.draftParams, false);
  assert.equal(node.data.prompt, '保留的提示词');
  assert.deepEqual(node.data.history, original.nodes[0].data.history);
  assert.equal(original.nodes[0].data.params.mask.url, '/old-mask');
  assert.equal(original.nodes[0].data.editor.draftParams.mask.url, '/old-mask');
});

test('legacy generation-only nodes keep reusable prompt and parameters after replacement', () => {
  const original = fixture();
  delete original.nodes[0].data.params;
  delete original.nodes[0].data.prompt;
  const node = replaceCanvasNodeMedia(original, original.nodes[0], asset()).nodes[0];
  assert.equal(node.data.prompt, '旧生成记录');
  assert.deepEqual(node.data.params, { kind: 'image' });
});

test('wrong media type is rejected before upload and leaves the original document unchanged', async () => {
  const { core, options } = harness();
  const original = core.document();
  options.file = new File(['test'], 'wrong.mp4', { type: 'video/mp4' });
  options.uploadAsset = async () => { assert.fail('must not upload'); };
  await assert.rejects(replaceCanvasMediaFile(options), /保持素材类型一致/u);
  assert.strictEqual(core.document(), original);
  assert.equal(core.history().past.length, 0);
});

test('upload errors retain the original media and do not create an undo entry', async () => {
  const { core, options } = harness();
  const original = core.document();
  options.uploadAsset = async () => { throw new Error('上传失败'); };
  await assert.rejects(replaceCanvasMediaFile(options), /上传失败/u);
  assert.strictEqual(core.document(), original);
  assert.equal(core.history().past.length, 0);
});

for (const change of ['delete', 'replace', 'generate']) {
  test(`late uploads cannot overwrite a node changed during upload: ${change}`, async () => {
    const { core, options } = harness();
    options.uploadAsset = async () => {
      core.apply({ id: 'concurrent', label: 'concurrent', apply: (document) => ({
        ...document,
        nodes: change === 'delete' ? document.nodes.slice(1) : document.nodes.map((node) => node.id !== 'missing' ? node : {
          ...node, data: { ...node.data, ...(change === 'replace' ? { url: '/newer-file' } : { status: 'running', jobId: 'new-task' }) },
        }),
      }) });
      return asset();
    };
    await assert.rejects(replaceCanvasMediaFile(options), /未覆盖当前内容/u);
    assert.equal(core.history().past.length, 1);
    assert.notEqual(core.document().nodes.find((node) => node.id === 'missing')?.data.url, '/replacement');
  });
}

test('edits made while uploading remain in the latest committed document', async () => {
  const { core, options } = harness();
  options.uploadAsset = async () => {
    core.apply({ id: 'rename', label: 'rename', apply: (document) => ({ ...document, nodes: document.nodes.map((node) => node.id === 'missing' ? { ...node, x: 700, data: { ...node.data, name: '新名称', prompt: '新提示词' } } : node) }) });
    return asset();
  };
  await replaceCanvasMediaFile(options);
  assert.equal(core.document().nodes[0].x, 700);
  assert.equal(core.document().nodes[0].data.name, '新名称');
  assert.equal(core.document().nodes[0].data.prompt, '新提示词');
});

test('unexpected upload results do not change the original node', async () => {
  const { core, options } = harness();
  const original = core.document();
  options.uploadAsset = async () => asset('video');
  await assert.rejects(replaceCanvasMediaFile(options), /类型不符/u);
  assert.strictEqual(core.document(), original);
});

test('failed project persistence is reported instead of claiming successful recovery', async () => {
  const { options } = harness();
  options.waitForPersistence = async () => false;
  await assert.rejects(replaceCanvasMediaFile(options), /画布保存失败/u);
});

const RecoveryActions = load('./components/canvas/CanvasMediaRecoveryActions').default;
const cardModules = createTsRequire(process.cwd(), {
  '@/components/canvas/CanvasMediaRecoveryActions': { __esModule: true, default: RecoveryActions },
  '@/components/canvas/CanvasAudioPlayer': { __esModule: true, default: () => null },
  '@/components/canvas/CanvasProcessingIndicator': { __esModule: true, default: () => null },
  '@/components/canvas/CanvasInlineNameEditor': { __esModule: true, default: () => null },
  '@/components/canvas/useCanvasMediaPlayback': { useCanvasMediaPlayback: () => ({
    mediaUnavailable: true, mediaLoadMessage: 'missing', retryMediaLoad: () => {},
  }) },
});
const MediaCard = cardModules('./components/canvas/CanvasMediaNodeCard').default;

for (const kind of ['image', 'video']) {
  test(`missing ${kind} cards expose replacement picker and avoid obsolete media overlays`, () => {
    const markup = renderToStaticMarkup(createElement(MediaCard, {
      node: fixture(kind).nodes[0], pending: false, failed: false,
      processingLabel: '', processingKind: kind, imageResolution: '1920 × 1080', videoResolution: '1920 × 1080', videoDuration: '50s',
      mediaFooterStatus: '完成', onNaturalSize: () => {}, onLocalEdit: () => {}, onReplaceMedia: async () => {},
      maskState: { status: 'pending' },
    }));
    assert.match(markup, /上传替换/u);
    assert.match(markup, /重试加载/u);
    assert.match(markup, new RegExp(`accept="${kind}/\\*"`, 'u'));
    assert.doesNotMatch(markup, /canvas-node-asset-drag-handle|canvas-node-mask-badge|canvas-image-resolution|canvas-video-mark/u);
  });
}

test('replacement picker resets the file, prevents duplicate uploads and exposes errors with retry available', async () => {
  const slots = [];
  let cursor = 0;
  const react = {
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useState(initial) {
      const state = slots[cursor++] ||= { value: initial };
      return [state.value, (value) => { state.value = value; }];
    },
  };
  const Actions = createTsRequire(process.cwd(), { react })('./components/canvas/CanvasMediaRecoveryActions').default;
  let rejectUpload;
  let uploadCount = 0;
  const pending = new Promise((_resolve, reject) => { rejectUpload = reject; });
  const props = { kind: 'image', onRetry: () => {}, onReplace: () => { uploadCount += 1; return pending; } };
  const render = () => { cursor = 0; return Actions(props); };
  const elements = (element) => {
    if (!element || typeof element !== 'object') return [];
    return [element, ...[element.props?.children].flat().flatMap(elements)];
  };
  const input = elements(render()).find((element) => element.type === 'input');
  const file = new File(['test'], 'replacement.png', { type: 'image/png' });
  const target = { files: [file], value: 'replacement.png' };
  const operation = input.props.onChange({ currentTarget: target });
  await input.props.onChange({ currentTarget: { files: [file], value: 'replacement.png' } });
  assert.equal(target.value, '');
  assert.equal(uploadCount, 1);
  assert.equal(elements(render()).filter((element) => element.type === 'button').every((element) => element.props.disabled), true);
  rejectUpload(new Error('网络中断，请重试'));
  await operation;
  const recovered = elements(render());
  assert.equal(recovered.find((element) => element.props?.role === 'alert').props.children, '网络中断，请重试');
  assert.equal(recovered.filter((element) => element.type === 'button').every((element) => !element.props.disabled), true);
});
