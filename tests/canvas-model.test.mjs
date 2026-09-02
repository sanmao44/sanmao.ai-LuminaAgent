import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  if (sourceUrl.pathname.endsWith('/lib/canvas/model.ts')) {
    const settingsUrl = new URL('../lib/creation/settings.ts', import.meta.url);
    const maskUrl = new URL('../lib/canvas/mask.ts', import.meta.url);
    const layersUrl = new URL('../lib/canvas/layers.ts', import.meta.url);
    const localEditUrl = new URL('../lib/local-edit.ts', import.meta.url);
    const settingsSource = await readFile(settingsUrl, 'utf8');
    const maskSource = await readFile(maskUrl, 'utf8');
    const layersSource = await readFile(layersUrl, 'utf8');
    const localEditSource = await readFile(localEditUrl, 'utf8');
    const localEditRuntime = ts.transpileModule(localEditSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: localEditUrl.pathname,
    }).outputText.replace(/\bexport\s+/g, '');
    const settingsCompiled = ts.transpileModule(settingsSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: settingsUrl.pathname,
    }).outputText.replace(
      /^\s*import\s+\{\s*getLastModelCall\s*\}\s+from\s+["']\.\.\/model-preferences["'];?\s*$/m,
      'const getLastModelCall = () => null;',
    ).replace(
      /^\s*import\s+\{\s*selectAutomaticModel\s*\}\s+from\s+["']\.\.\/model-selection["'];?\s*$/m,
      `const selectAutomaticModel = (models, defaultProviderId, defaultModelId) => {
        const providerModels = defaultProviderId ? models.filter((model) => model.providerId === defaultProviderId) : [];
        return providerModels.find((model) => model.id === defaultModelId)
          || providerModels[0]
          || models.find((model) => model.id === defaultModelId)
        || models[0];
      };`,
    ).replace(
      /^\s*import\s+\{\s*normalizeLocalEditAnnotations\s*\}\s+from\s+["']\.\.\/local-edit["'];?\s*$/m,
      '',
    );
    const maskCompiled = ts.transpileModule(maskSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: maskUrl.pathname,
    }).outputText
      .replace(/\bobjectValue\b/g, 'maskObjectValue')
      .replace(/\bfiniteNumber\b/g, 'maskFiniteNumber')
      .replace(
        /^\s*import\s+\{\s*normalizeLocalEditAnnotations\s*\}\s+from\s+["']\.\.\/local-edit["'];?\s*$/m,
        '',
      );
    const layersCompiled = ts.transpileModule(layersSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: layersUrl.pathname,
    }).outputText;
    const modelCompiled = compiled.replace(
      /^\s*import\s+\{\s*normalizeCreationSettings\s*\}\s+from\s+["']\.\.\/creation\/settings["'];?\s*$/m,
      '',
    ).replace(
      /^\s*import\s+\{\s*normalizeCanvasMaskState\s*\}\s+from\s+["']\.\/mask["'];?\s*$/m,
      '',
    ).replace(
      /^\s*import\s+\{\s*normalizeCanvasNodeLayers\s*\}\s+from\s+["']\.\/layers["'];?\s*$/m,
      '',
    );
    return import(`data:text/javascript;base64,${Buffer.from(`${localEditRuntime}\n${settingsCompiled}\n${maskCompiled}\n${layersCompiled}\n${modelCompiled}`).toString('base64')}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const model = await loadTypeScript('../lib/canvas/model.ts');
const storageSource = await readFile(new URL('../lib/canvas/storage.ts', import.meta.url), 'utf8');

test('normalizes NOVA-compatible documents and drops invalid graph references', () => {
  const result = model.normalizeDocument({
    nodes: [
      { id: 'image-1', type: 'media', x: 10, y: 20, data: { kind: 'image', url: '/api/storage/file?name=a.png' } },
      { id: 'text-1', type: 'prompt', x: 100, y: 200, data: { text: '夜晚' } },
      { id: 'bad', type: 'media', x: 'nope', y: 0, data: {} },
    ],
    groups: [{ id: 'group-1', name: '参考组', nodeIds: ['image-1', 'text-1', 'missing'] }],
    edges: [
      { id: 'edge-1', source: 'image-1', target: 'text-1' },
      { id: 'edge-bad', source: 'missing', target: 'text-1' },
    ],
    camera: { x: 20, y: 30, zoom: 9 },
  });
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.groups[0].nodeIds, ['image-1', 'text-1']);
  assert.equal(result.edges.length, 1);
  assert.equal(result.camera.zoom, 3);
});

test('recovers interrupted local canvas work while preserving remote video tasks', () => {
  const document = model.normalizeDocument({
    nodes: [
      { id: 'agent-1', type: 'prompt', x: 0, y: 0, data: { text: '描述画面', status: 'running', processingStartedAt: 99 } },
      { id: 'image-1', type: 'media', x: 200, y: 0, data: { kind: 'image', status: 'running', processingStartedAt: 99 } },
      { id: 'video-1', type: 'media', x: 400, y: 0, data: { kind: 'video', status: 'running', jobId: 'remote-video-1', generation: { kind: 'video', taskId: 'remote-video-1', prompt: '镜头推进', params: {} } } },
    ],
    edges: [],
  });

  const result = model.recoverInterruptedCanvasDocument(document, 123);
  assert.equal(result.recoveredCount, 2);
  assert.equal(result.document.nodes.find((node) => node.id === 'agent-1').data.status, 'failed');
  assert.equal(result.document.nodes.find((node) => node.id === 'agent-1').data.statusLabel, '上次 Agent 请求已中断，可重试');
  assert.equal(result.document.nodes.find((node) => node.id === 'image-1').data.status, 'failed');
  assert.equal(result.document.nodes.find((node) => node.id === 'video-1').data.status, 'running');
});

test('hydrates legacy video media params from generation params', () => {
  const result = model.normalizeDocument({
    nodes: [
      {
        id: 'legacy-video',
        type: 'media',
        x: 0,
        y: 0,
        data: {
          kind: 'video',
          url: '/legacy-video.mp4',
          generation: {
            kind: 'video',
            prompt: '镜头推进',
            params: { model: 'legacy-video-model', inputMode: 'frames', duration: 8 },
          },
        },
      },
    ],
  });

  const legacy = result.nodes[0];
  assert.equal(legacy.data.params.inputMode, 'frames');
  assert.equal(legacy.data.params.model, 'legacy-video-model');
  assert.equal(legacy.data.generation.params.inputMode, 'frames');
  assert.equal(legacy.data.videoInputModeAuto, true);

  const created = model.createMedia('video', '/created-video.mp4', '创建的视频', { x: 0, y: 0 }, {
    generation: {
      kind: 'video',
      prompt: '参考生成',
      params: { model: 'created-video-model', inputMode: 'reference' },
    },
  });
  assert.equal(created.data.params.inputMode, 'reference');
  assert.equal(created.data.params.model, 'created-video-model');
});

test('sizes video cards from the requested aspect ratio and intrinsic metadata', () => {
  const wide = model.createMedia('video', '/wide.mp4', '宽屏视频', { x: 0, y: 0 }, {
    params: { kind: 'video', aspect: '16:9' },
  });
  const portrait = model.createMedia('video', '/portrait.mp4', '竖屏视频', { x: 0, y: 0 }, {
    params: { kind: 'video', aspect: '9:16' },
  });
  const square = model.createMedia('video', '/square.mp4', '方形视频', { x: 0, y: 0 }, {
    params: { kind: 'video', aspect: '1:1' },
  });
  const automatic = model.createMedia('video', '/automatic.mp4', '自动视频', { x: 0, y: 0 }, {
    params: { kind: 'video', aspect: 'auto' },
  });
  const defaultSize = model.mediaCardSizeForRatio(undefined, 'video');

  const previewRatio = (node) => node.w / (node.h - 42);
  assert.ok(Math.abs(previewRatio(wide) - 16 / 9) < 0.02);
  assert.ok(Math.abs(previewRatio(portrait) - 9 / 16) < 0.02);
  assert.ok(Math.abs(previewRatio(square) - 1) < 0.02);
  assert.ok(Math.abs(previewRatio(automatic) - 16 / 9) < 0.02);
  assert.ok(Math.abs(defaultSize.w / (defaultSize.h - 42) - 16 / 9) < 0.02);
  assert.ok(portrait.h > wide.h);

  const intrinsic = model.createMedia('video', '/intrinsic.mp4', '真实尺寸视频', { x: 0, y: 0 }, {
    nativeWidth: 1080,
    nativeHeight: 1920,
    params: { kind: 'video', aspect: '16:9' },
  });
  assert.ok(Math.abs(previewRatio(intrinsic) - 9 / 16) < 0.02);

  const normalized = model.normalizeDocument({
    nodes: [{
      id: 'legacy-video-size',
      type: 'media',
      x: 0,
      y: 0,
      w: 420,
      h: 290,
      data: {
        kind: 'video',
        url: '/legacy-portrait.mp4',
        nativeWidth: 1080,
        nativeHeight: 1920,
        params: { kind: 'video', aspect: '16:9' },
      },
    }],
  });
  const normalizedVideo = normalized.nodes[0];
  assert.ok(Math.abs(previewRatio(normalizedVideo) - 9 / 16) < 0.02);

  const manual = model.normalizeDocument({
    nodes: [{
      id: 'manual-video-size',
      type: 'media',
      x: 0,
      y: 0,
      w: 510,
      h: 330,
      data: {
        kind: 'video',
        url: '/manual-video.mp4',
        autoFit: false,
        nativeWidth: 1080,
        nativeHeight: 1920,
      },
    }],
  }).nodes[0];
  assert.equal(manual.w, 510);
  assert.equal(manual.h, 330);
});

test('canvas upscale nodes preserve provider-specific settings', () => {
  const cloud = model.createUpscaleNode({ x: 0, y: 0 }, {
    model: 'aliyun-standard-super-resolution',
    scale: 3,
    outputFormat: 'jpg',
    outputQuality: 72,
  });
  assert.equal(cloud.data.params.model, 'aliyun-standard-super-resolution');
  assert.equal(cloud.data.params.scale, 3);
  assert.equal(cloud.data.params.outputFormat, 'jpg');
  assert.equal(cloud.data.params.outputQuality, 72);

  const legacy = model.createUpscaleNode({ x: 0, y: 0 }, {
    model: 'seedvr2-7b',
    scale: 4,
    target: '4K',
    seed: 123,
    colorCorrection: 'none',
    algorithm: 'nearest',
  });
  assert.equal(legacy.data.params.target, '4K');
  assert.equal(legacy.data.params.seed, 123);
  assert.equal(legacy.data.params.colorCorrection, 'none');
  assert.equal(legacy.data.params.algorithm, 'nearest');
});

test('completed upscale result cards follow intrinsic image proportions', () => {
  const base = model.createUpscaleNode({ x: 0, y: 0 });
  const portrait = model.normalizeDocument({
    nodes: [{
      ...base,
      data: {
        ...base.data,
        url: '/portrait-upscaled.png',
        nativeWidth: 3456,
        nativeHeight: 6144,
        status: 'completed',
      },
    }],
  }).nodes[0];
  const expected = model.upscaleCardSizeForRatio(3456 / 6144);

  assert.equal(portrait.w, expected.w);
  assert.equal(portrait.h, expected.h);
  assert.equal(portrait.data.autoFit, true);

  const manual = model.normalizeDocument({
    nodes: [{
      ...base,
      w: 510,
      h: 330,
      data: {
        ...base.data,
        autoFit: false,
        url: '/portrait-upscaled.png',
        nativeWidth: 3456,
        nativeHeight: 6144,
        status: 'completed',
      },
    }],
  }).nodes[0];
  assert.equal(manual.w, 510);
  assert.equal(manual.h, 330);
});

function layerNode(id, zIndex) {
  return {
    id,
    type: 'media',
    x: 0,
    y: 0,
    ...(zIndex === undefined ? {} : { zIndex }),
    data: { kind: 'image', url: `/${id}.png`, name: id },
  };
}

function layerDocument(nodes) {
  return {
    version: 'sanmao-canvas-3',
    nodes,
    edges: [],
    groups: [],
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

test('migrates missing node layers from the legacy array order', () => {
  const result = model.normalizeDocument({
    nodes: [layerNode('first'), layerNode('second'), layerNode('third')],
  });

  assert.equal(result.version, 'sanmao-canvas-3');
  assert.deepEqual(result.nodes.map((node) => node.zIndex), [30, 31, 32]);
  assert.deepEqual(
    model.sortCanvasNodesByLayer(result.nodes).map((node) => node.id),
    ['first', 'second', 'third'],
  );
});

test('normalizes duplicate, invalid, and missing layer values stably', () => {
  const result = model.normalizeDocument({
    nodes: [
      layerNode('missing'),
      layerNode('duplicate-a', 100),
      layerNode('duplicate-b', 100),
      layerNode('invalid', 'not-a-layer'),
    ],
  });

  assert.deepEqual(
    model.sortCanvasNodesByLayer(result.nodes).map((node) => node.id),
    ['missing', 'invalid', 'duplicate-a', 'duplicate-b'],
  );
  assert.deepEqual(
    [...result.nodes].sort((left, right) => left.zIndex - right.zIndex).map((node) => node.zIndex),
    [30, 31, 32, 33],
  );
});

test('reorders single and multi-selection layers without changing the node array', () => {
  const document = layerDocument(['a', 'b', 'c', 'd'].map((id) => layerNode(id)));
  const originalIds = document.nodes.map((node) => node.id);

  const raised = model.reorderCanvasNodes(document, ['b'], 'raise');
  assert.deepEqual(model.sortCanvasNodesByLayer(raised.nodes).map((node) => node.id), ['a', 'c', 'b', 'd']);
  assert.deepEqual(raised.nodes.map((node) => node.id), originalIds);

  const blockToFront = model.reorderCanvasNodes(document, ['b', 'd'], 'bring-to-front');
  assert.deepEqual(model.sortCanvasNodesByLayer(blockToFront.nodes).map((node) => node.id), ['a', 'c', 'b', 'd']);
  const blockToBack = model.reorderCanvasNodes(blockToFront, ['b', 'd'], 'lower');
  assert.deepEqual(model.sortCanvasNodesByLayer(blockToBack.nodes).map((node) => node.id), ['a', 'b', 'd', 'c']);

  const front = model.reorderCanvasNodes(document, ['a', 'c'], 'bring-to-front');
  assert.deepEqual(model.sortCanvasNodesByLayer(front.nodes).map((node) => node.id), ['b', 'd', 'a', 'c']);
  const back = model.reorderCanvasNodes(front, ['a', 'c'], 'bring-to-back');
  assert.deepEqual(model.sortCanvasNodesByLayer(back.nodes).map((node) => node.id), ['a', 'c', 'b', 'd']);
});

test('new, copied, and imported nodes are appended above existing layers', () => {
  const previous = layerDocument(['old-a', 'old-b'].map((id) => layerNode(id)));
  const imported = layerNode('imported', 0);
  const copied = layerNode('copied', 0);
  const next = model.normalizeCanvasDocumentLayers(previous, {
    ...previous,
    nodes: [...previous.nodes, imported, copied],
  });

  assert.deepEqual(model.sortCanvasNodesByLayer(next.nodes).map((node) => node.id), ['old-a', 'old-b', 'imported', 'copied']);
  assert.ok(next.nodes.find((node) => node.id === 'imported').zIndex > next.nodes.find((node) => node.id === 'old-b').zIndex);
  assert.ok(next.nodes.find((node) => node.id === 'copied').zIndex > next.nodes.find((node) => node.id === 'imported').zIndex);
});

test('migrates legacy image params.mask into persistent pending mask metadata', () => {
  const result = model.normalizeDocument({
    nodes: [
      {
        id: 'legacy-mask-image',
        type: 'media',
        x: 0,
        y: 0,
        data: {
          kind: 'image',
          url: '/source.png',
          params: { mask: { assetId: 'legacy-mask', url: '/legacy-mask.png' } },
        },
      },
      {
        id: 'legacy-generation-mask-image',
        type: 'media',
        x: 400,
        y: 0,
        data: {
          kind: 'image',
          url: '/source-2.png',
          generation: {
            kind: 'image',
            prompt: '局部修改',
            params: { mask: { assetId: 'legacy-mask-2', url: '/legacy-mask-2.png' } },
          },
        },
      },
    ],
  });

  assert.deepEqual(result.nodes.map((node) => node.data.mask), [
    { assetId: 'legacy-mask', url: '/legacy-mask.png', status: 'pending' },
    { assetId: 'legacy-mask-2', url: '/legacy-mask-2.png', status: 'pending' },
  ]);
});

test('maps legacy base-image connections to ordered references without losing assets', () => {
  const source = model.createMedia('image', '/legacy-base.png', '历史基底图', { x: 0, y: 0 });
  const second = model.createMedia('image', '/second-reference.png', '第二张参考图', { x: 0, y: 300 });
  const target = model.createGenerator('image', { x: 720, y: 0 });
  const result = model.normalizeDocument({
    nodes: [source, second, target],
    edges: [
      { id: 'legacy-base-edge', source: source.id, target: target.id, inputRole: 'base-image' },
      { id: 'reference-edge', source: second.id, target: target.id, inputRole: 'reference-image', order: 1 },
    ],
  });

  assert.equal(result.edges.length, 2);
  assert.equal(result.edges.find((edge) => edge.id === 'legacy-base-edge')?.inputRole, 'reference-image');
  assert.deepEqual(model.incomingReferences(result, target.id).map((node) => node.data.name), ['历史基底图', '第二张参考图']);
  assert.deepEqual(result.nodes.filter((node) => node.data.url).map((node) => node.data.url), ['/legacy-base.png', '/second-reference.png']);
});

test('allows multiple image references on the same target after legacy migration', () => {
  const first = model.createMedia('image', '/first.png', '第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/second.png', '第二张', { x: 0, y: 300 });
  const target = model.createGenerator('image', { x: 720, y: 0 });
  const document = model.normalizeDocument({ nodes: [first, second, target], edges: [] });
  const withFirst = model.addEdge(document, first.id, target.id, 'right', 'left', 'reference', 'reference-image', 0);
  const withSecond = model.addEdge(withFirst, second.id, target.id, 'right', 'left', 'reference', 'reference-image', 1);

  assert.equal(withSecond.edges.length, 2);
  assert.deepEqual(model.incomingReferences(withSecond, target.id).map((node) => node.id), [first.id, second.id]);
});

test('backfills ordinary image-to-video edges with frame roles and rejects video-to-image input', () => {
  const first = model.createMedia('image', '/first-frame.png', '首帧', { x: 0, y: 0 });
  const second = model.createMedia('image', '/last-frame.png', '尾帧', { x: 0, y: 300 });
  const video = model.createGenerator('video', { x: 720, y: 0 }, { inputMode: 'frames' });
  const image = model.createGenerator('image', { x: 1080, y: 0 });
  const sourceVideo = model.createMedia('video', '/source.mp4', '视频', { x: 0, y: 600 });
  const document = model.normalizeDocument({
    nodes: [first, second, video, image, sourceVideo],
    edges: [
      { id: 'first-edge', source: first.id, target: video.id },
      { id: 'last-edge', source: second.id, target: video.id },
    ],
  });

  assert.equal(document.edges.find((edge) => edge.id === 'first-edge')?.inputRole, 'first-frame');
  assert.equal(document.edges.find((edge) => edge.id === 'last-edge')?.inputRole, 'last-frame');
  assert.deepEqual(model.incomingReferences(document, video.id).map((node) => node.id), [first.id, second.id]);
  assert.equal(model.canConnect(document, sourceVideo.id, image.id).ok, false);
  assert.match(model.canConnect(document, sourceVideo.id, image.id).reason, /不能接收视频/);
});

test('does not let a video input consume a frame slot and restores roles by edge order', () => {
  const first = model.createMedia('image', '/first-frame.png', '首帧', { x: 0, y: 0 });
  const last = model.createMedia('image', '/last-frame.png', '尾帧', { x: 0, y: 300 });
  const sourceVideo = model.createMedia('video', '/source.mp4', '参考视频', { x: 0, y: 600 });
  const target = model.createGenerator('video', { x: 720, y: 0 }, { inputMode: 'frames' });
  const result = model.normalizeDocument({
    nodes: [first, last, sourceVideo, target],
    edges: [
      { id: 'last-edge', source: last.id, target: target.id, order: 2 },
      { id: 'video-edge', source: sourceVideo.id, target: target.id },
      { id: 'first-edge', source: first.id, target: target.id, order: 1 },
    ],
  });

  assert.equal(result.edges.find((edge) => edge.id === 'first-edge')?.inputRole, 'first-frame');
  assert.equal(result.edges.find((edge) => edge.id === 'last-edge')?.inputRole, 'last-frame');
  assert.equal(result.edges.find((edge) => edge.id === 'video-edge')?.inputRole, 'video');

  const empty = model.normalizeDocument({ nodes: [first, last, sourceVideo, target], edges: [] });
  const withVideo = model.addEdge(empty, sourceVideo.id, target.id);
  const withFirst = model.addEdge(withVideo, first.id, target.id);
  assert.equal(withFirst.edges.find((edge) => edge.source === first.id)?.inputRole, 'first-frame');
});

test('incoming context follows persisted edge order after refresh', () => {
  const first = model.createMedia('image', '/one.png', '一', { x: 0, y: 0 });
  const second = model.createMedia('image', '/two.png', '二', { x: 0, y: 300 });
  const target = model.createGenerator('image', { x: 720, y: 0 });
  const document = model.normalizeDocument({
    nodes: [first, second, target],
    edges: [
      { id: 'second', source: second.id, target: target.id, order: 1 },
      { id: 'first', source: first.id, target: target.id, order: 0 },
    ],
  });
  assert.deepEqual(model.incomingContext(document, target.id).map((node) => node.id), [first.id, second.id]);
});

test('exposes completed upscale output as an image reference for downstream nodes', () => {
  const source = model.createMedia('image', '/source.png', '原图', { x: 0, y: 0 });
  const upscaleBase = model.createUpscaleNode({ x: 420, y: 0 });
  const upscale = {
    ...upscaleBase,
    data: {
      ...upscaleBase.data,
      url: '/upscaled.png',
      name: '超分结果',
      status: 'completed',
    },
  };
  const consumer = model.createGenerator('image', { x: 840, y: 0 });
  const nextUpscale = model.createUpscaleNode({ x: 1260, y: 0 });
  let document = model.normalizeDocument({
    nodes: [source, upscale, consumer, nextUpscale],
    edges: [
      { id: 'upscale-input', source: source.id, target: upscale.id, inputRole: 'upscale-image' },
      { id: 'upscale-output', source: upscale.id, target: consumer.id, inputRole: 'reference-image' },
    ],
  });

  assert.deepEqual(model.incomingReferences(document, consumer.id).map((node) => node.id), [upscale.id]);
  document = model.addEdge(document, upscale.id, nextUpscale.id, 'right', 'left', 'manual', 'upscale-image');
  assert.equal(document.edges.some((edge) => edge.source === upscale.id && edge.target === nextUpscale.id), true);
});

test('migrates legacy standalone upscale results into the owning node', () => {
  const source = model.createMedia('image', '/source.png', '原图', { x: 0, y: 0 });
  const upscale = model.createUpscaleNode({ x: 480, y: 0 });
  const legacyResult = model.createMedia('image', '/upscaled.png', '原图 · 超分', { x: 900, y: 0 }, {
    role: '超分结果',
    nativeWidth: 2048,
    nativeHeight: 2048,
    generation: {
      kind: 'image',
      prompt: 'Upscale this image',
      params: {
        kind: 'upscale',
        model: 'upscale-model',
        scale: 4,
        target: '2K',
        seed: 7,
        colorCorrection: 'none',
        algorithm: 'bicubic',
      },
      operation: 'upscale',
      referenceIds: [source.id],
      parentNodeId: upscale.id,
      createdAt: 100,
    },
  });
  const consumer = model.createGenerator('image', { x: 1320, y: 0 });
  const result = model.normalizeDocument({
    nodes: [source, upscale, legacyResult, consumer],
    groups: [{ id: 'upscale-group', name: '超分链路', nodeIds: [source.id, legacyResult.id] }],
    edges: [
      { id: 'input', source: source.id, target: upscale.id, inputRole: 'upscale-image' },
      { id: 'legacy-output', source: upscale.id, target: legacyResult.id, kind: 'lineage' },
      { id: 'follow-up', source: legacyResult.id, target: consumer.id, kind: 'lineage' },
    ],
  });

  const migrated = result.nodes.find((node) => node.id === upscale.id);
  assert.ok(migrated);
  assert.equal(result.nodes.some((node) => node.id === legacyResult.id), false);
  assert.equal(migrated.data.url, '/upscaled.png');
  assert.equal(migrated.data.resultSource, 'upscale-node');
  assert.equal(migrated.data.statusLabel, '超分节点生成的结果');
  assert.equal(migrated.data.params.scale, 4);
  assert.equal(migrated.data.params.algorithm, 'bicubic');
  assert.equal(migrated.data.generation.parentNodeId, upscale.id);
  assert.deepEqual(result.groups[0].nodeIds, [source.id, upscale.id]);
  assert.equal(migrated.groupId, 'upscale-group');
  assert.equal(result.edges.some((edge) => edge.source === source.id && edge.target === upscale.id), true);
  assert.equal(result.edges.some((edge) => edge.source === upscale.id && edge.target === consumer.id), true);
  assert.equal(result.edges.some((edge) => edge.target === legacyResult.id), false);
});

test('creates media, prompt, generator, groups, edges and reference order', () => {
  const empty = model.normalizeDocument(null);
  const image = model.createMedia('image', '/image.png', '参考图', { x: 0, y: 0 });
  const prompt = model.createPrompt({ x: 360, y: 0 }, '保留主体');
  const generator = model.createGenerator('image', { x: 720, y: 0 }, { model: 'image-model' });
  let document = { ...empty, nodes: [image, prompt, generator] };
  document = model.addEdge(document, image.id, generator.id);
  document = model.addEdge(document, prompt.id, generator.id);
  assert.equal(model.incomingReferences(document, generator.id).length, 1);
  assert.equal(model.incomingContext(document, generator.id).length, 2);
  const grouped = model.createGroup(document, [image.id, prompt.id]);
  assert.equal(grouped.groups.length, 1);
  assert.equal(grouped.groups[0].nodeIds.length, 2);
  assert.equal(model.edgePath(grouped, grouped.edges[0]).startsWith('M '), true);
});

test('supports group-level connections without expanding into member edges', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/group-first.png', '组内第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/group-second.png', '组内第二张', { x: 360, y: 0 });
  const third = model.createMedia('image', '/other-first.png', '另一组第一张', { x: 0, y: 500 });
  const fourth = model.createMedia('image', '/other-second.png', '另一组第二张', { x: 360, y: 500 });
  const target = model.createGenerator('image', { x: 760, y: 180 });
  let document = { ...empty, nodes: [first, second, third, fourth, target] };
  document = model.createGroup(document, [first.id, second.id]);
  document = model.createGroup(document, [third.id, fourth.id]);
  const groups = document.groups;
  const sourceGroup = groups.find((group) => group.nodeIds.includes(first.id));
  const targetGroup = groups.find((group) => group.nodeIds.includes(third.id));
  assert.ok(sourceGroup);
  assert.ok(targetGroup);

  document = model.addEdge(document, sourceGroup.id, target.id);
  assert.equal(document.edges.length, 1);
  assert.match(model.edgePath(document, document.edges[0]), /M /);
  assert.deepEqual(model.incomingContext(document, target.id).map((node) => node.id), [first.id, second.id]);

  document = model.addEdge(document, target.id, targetGroup.id);
  document = model.addEdge(document, sourceGroup.id, targetGroup.id);
  assert.equal(document.edges.length, 3);
  assert.equal(model.addEdge(document, sourceGroup.id, targetGroup.id).edges.length, 3);
  assert.equal(model.addEdge(document, sourceGroup.id, sourceGroup.id).edges.length, 3);
});

test('expands every media member when a group feeds a video node', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/group-video-first.png', '第一张参考图', { x: 0, y: 0 });
  const second = model.createMedia('image', '/group-video-second.png', '第二张参考图', { x: 0, y: 300 });
  const third = model.createMedia('image', '/group-video-third.png', '第三张参考图', { x: 0, y: 600 });
  const target = model.createGenerator('video', { x: 760, y: 220 }, { inputMode: 'reference' });
  let document = { ...empty, nodes: [first, second, third, target] };
  document = model.createGroup(document, [first.id, second.id, third.id]);
  const sourceGroup = document.groups[0];

  document = model.addEdge(document, sourceGroup.id, target.id);
  assert.deepEqual(
    model.incomingReferences(document, target.id).map((node) => node.id),
    [first.id, second.id, third.id],
  );
  assert.equal(document.edges[0].source, sourceGroup.id);
});

test('keeps a member connection scoped to that member instead of its group', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/member-first.png', '缁勫唴绗竴寮犲弬鑰冨浘', { x: 0, y: 0 });
  const second = model.createMedia('image', '/member-second.png', '缁勫唴绗簩寮犲弬鑰冨浘', { x: 0, y: 300 });
  const third = model.createMedia('image', '/member-third.png', '缁勫唴绗笁寮犲弬鑰冨浘', { x: 0, y: 600 });
  const target = model.createGenerator('video', { x: 760, y: 220 }, { inputMode: 'reference' });
  let document = { ...empty, nodes: [first, second, third, target] };
  document = model.createGroup(document, [first.id, second.id, third.id]);

  document = model.addEdge(document, second.id, target.id);

  assert.deepEqual(
    model.incomingReferences(document, target.id).map((node) => node.id),
    [second.id],
  );
  assert.equal(document.edges[0].source, second.id);
});

test('normalizes variant requirements by removing blank lines and capping at eight', () => {
  const requirements = model.normalizeVariantRequirements(
    '  夜景  \n\n俯拍视角\r\n  \n替换成红色包装\n' +
      Array.from({ length: 8 }, (_, index) => `变体 ${index + 4}`).join('\n'),
  );
  assert.deepEqual(requirements, [
    '夜景',
    '俯拍视角',
    '替换成红色包装',
    '变体 4',
    '变体 5',
    '变体 6',
    '变体 7',
    '变体 8',
  ]);
  assert.deepEqual(model.normalizeVariantRequirements([]), ['']);
});

test('keeps legacy advanced generators compatible as a single default variant', () => {
  const document = model.normalizeDocument({
    nodes: [
      {
        id: 'legacy-generator',
        type: 'generator',
        x: 0,
        y: 0,
        data: {
          kind: 'image',
          prompt: '保留主体并优化光影',
          params: { model: 'legacy-image-model', count: 2 },
        },
      },
    ],
  });
  const generator = document.nodes[0];
  assert.deepEqual(generator.data.variantRequirements, ['']);
  assert.equal(generator.data.variantRequirementsText, '');
  assert.deepEqual(generator.data.variantStates, undefined);
  assert.equal(generator.data.prompt, '保留主体并优化光影');
  assert.equal(generator.data.params.model, 'legacy-image-model');
  assert.equal(generator.data.params.count, 2);
});

test('normalizes saved variant states and preserves batch metadata', () => {
  const document = model.normalizeDocument({
    nodes: [
      {
        id: 'variant-generator',
        type: 'generator',
        x: 0,
        y: 0,
        data: {
          kind: 'video',
          variantRequirementsText: '夜景\n\n俯拍视角\n替换包装',
          variantBatchId: 'batch-42',
          variantGroupId: 'group-42',
          variantStates: [
            {
              id: 'v-1',
              status: 'completed',
              instruction: '旧文案',
              resultIds: ['result-1'],
              taskIds: ['task-1'],
              progress: 100,
            },
            { status: 'not-a-status', resultIds: 'not-an-array' },
          ],
        },
      },
    ],
  });
  const data = document.nodes[0].data;
  assert.deepEqual(data.variantRequirements, ['夜景', '俯拍视角', '替换包装']);
  assert.equal(data.variantRequirementsText, '夜景\n\n俯拍视角\n替换包装');
  assert.equal(data.variantBatchId, 'batch-42');
  assert.equal(data.variantGroupId, 'group-42');
  assert.deepEqual(data.variantStates, [
    {
      id: 'v-1',
      instruction: '旧文案',
      status: 'completed',
      resultIds: ['result-1'],
      taskIds: ['task-1'],
      progress: 100,
    },
    {
      id: 'variant-2',
      instruction: '俯拍视角',
      status: 'pending',
      resultIds: [],
    },
  ]);
});

test('preserves named variant batch groups and result lineage in stable variant order', () => {
  const generator = model.createGenerator('image', { x: 0, y: 0 });
  const first = model.createMedia('image', '/variant-1.png', '图片变体 1-1', { x: 420, y: 0 }, {
    role: '变体结果',
    generation: {
      kind: 'image',
      prompt: '共同提示词\n变体要求：夜景',
      params: generator.data.params,
      sourceGeneratorId: generator.id,
      variantBatchId: 'batch-1',
      variantIndex: 0,
      variantInstruction: '夜景',
    },
  });
  const second = model.createMedia('image', '/variant-2.png', '图片变体 2-1', { x: 420, y: 300 }, {
    role: '变体结果',
    generation: {
      kind: 'image',
      prompt: '共同提示词\n变体要求：俯拍视角',
      params: generator.data.params,
      sourceGeneratorId: generator.id,
      variantBatchId: 'batch-1',
      variantIndex: 1,
      variantInstruction: '俯拍视角',
    },
  });
  let document = model.normalizeDocument({
    nodes: [generator, first, second],
    edges: [],
    groups: [],
  });
  document = model.createGroup(document, [first.id, second.id], '图片变体批次');
  const group = document.groups[0];
  const results = group.nodeIds.map((id) => model.nodeById(document, id));
  assert.equal(group.name, '图片变体批次');
  assert.deepEqual(results.map((node) => node.data.generation.variantIndex), [0, 1]);
  assert.deepEqual(results.map((node) => node.data.generation.variantInstruction), ['夜景', '俯拍视角']);
  assert.equal(results.every((node) => node.data.generation.sourceGeneratorId === generator.id), true);
  assert.equal(results.every((node) => node.data.generation.variantBatchId === 'batch-1'), true);
});

test('supports selectable canvas edge path styles', () => {
  const empty = model.normalizeDocument(null);
  const source = model.createPrompt({ x: 0, y: 0 }, '输入');
  const target = model.createGenerator('image', { x: 480, y: 160 });
  const document = model.addEdge(
    { ...empty, nodes: [source, target] },
    source.id,
    target.id,
  );
  const edge = document.edges[0];
  assert.match(model.edgePath(document, edge, 'curve'), / C /);
  assert.match(model.edgePath(document, edge, 'straight'), / L /);
  assert.match(model.edgePath(document, edge, 'orthogonal'), / H .* V .* H /);
});

test('marks directly related node and group connections for selected-edge effects', () => {
  const empty = model.normalizeDocument(null);
  const source = model.createPrompt({ x: 0, y: 0 }, '来源');
  const selected = model.createMedia('image', '/selected.png', '选中', { x: 360, y: 0 });
  const groupMember = model.createMedia('image', '/group-member.png', '组内节点', { x: 360, y: 360 });
  const target = model.createGenerator('image', { x: 800, y: 0 });
  const unrelated = model.createPrompt({ x: 800, y: 360 }, '无关');
  let document = {
    ...empty,
    nodes: [source, selected, groupMember, target, unrelated],
  };
  document = model.createGroup(document, [selected.id, groupMember.id]);
  const group = document.groups[0];
  document = model.addEdge(document, source.id, selected.id);
  document = model.addEdge(document, selected.id, target.id);
  document = model.addEdge(document, group.id, target.id);
  document = model.addEdge(document, target.id, unrelated.id);

  const incoming = document.edges.find((edge) => edge.target === selected.id);
  const outgoing = document.edges.find((edge) => edge.source === selected.id);
  const groupEdge = document.edges.find((edge) => edge.source === group.id);
  const unrelatedEdge = document.edges.find((edge) => edge.target === unrelated.id);

  assert.equal(model.edgeTouchesSelection(document, incoming, [selected.id]), true);
  assert.equal(model.edgeTouchesSelection(document, outgoing, [selected.id]), true);
  assert.equal(model.edgeTouchesSelection(document, groupEdge, [selected.id]), true);
  assert.equal(model.edgeTouchesSelection(document, groupEdge, [], group.id), true);
  assert.equal(model.edgeTouchesSelection(document, unrelatedEdge, [selected.id]), false);
  assert.equal(
    model.edgeTouchesSelection(document, unrelatedEdge, [selected.id, unrelated.id]),
    true,
  );
});

test('shares connection geometry across ports and scaled minimap coordinates', () => {
  const start = { x: 120, y: 80 };
  const end = { x: 40, y: 180 };
  const curve = model.connectionPath(start, end, 'curve', 'left', 'right');
  assert.match(curve, /M 120 80 C 48 80, 112 180, 40 180/);

  const straight = model.connectionPath(start, end, 'straight', 'left', 'right');
  assert.equal(straight, 'M 120 80 L 40 180');
  assert.doesNotMatch(straight, /[CHV]/);

  const orthogonal = model.connectionPath(start, end, 'orthogonal', 'left', 'right');
  assert.match(orthogonal, /M 120 80 H 80 V 180 H 40/);

  const scaled = model.connectionPath(
    { x: 12, y: 8 },
    { x: 4, y: 18 },
    'curve',
    'left',
    'right',
    0.1,
  );
  assert.match(scaled, /C 4.8 8, 11.2 18/);

  const scaledOrthogonal = model.connectionPath(
    { x: 0, y: 0 },
    { x: 2, y: 10 },
    'orthogonal',
    'left',
    'left',
    0.1,
  );
  assert.match(scaledOrthogonal, /H -5.6 V 10 H 2/);
});

test('uses group boundary ports for shared edge geometry', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/group-first.png', '组内第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/group-second.png', '组内第二张', { x: 360, y: 0 });
  const target = model.createGenerator('image', { x: 800, y: 120 });
  let document = { ...empty, nodes: [first, second, target] };
  document = model.createGroup(document, [first.id, second.id]);
  const group = document.groups[0];
  document = model.addEdge(document, group.id, target.id);
  const edge = document.edges[0];
  const groupPoint = model.entityPortPoint(document, group.id, 'right');
  const targetPoint = model.entityPortPoint(document, target.id, 'left');
  assert.match(
    model.edgePath(document, edge, 'straight'),
    new RegExp(`^M ${groupPoint.x} ${groupPoint.y} L ${targetPoint.x} ${targetPoint.y}$`),
  );
});

test('expands an explicit group source into all media references and preserves manual order', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/first.png', '第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/second.png', '第二张', { x: 360, y: 0 });
  const generator = model.createGenerator('image', { x: 720, y: 0 });
  let document = { ...empty, nodes: [first, second, generator] };
  document = model.createGroup(document, [first.id, second.id]);
  document = model.addEdge(document, document.groups[0].id, generator.id);
  assert.deepEqual(model.incomingReferences(document, generator.id).map((node) => node.data.name), ['第一张', '第二张']);
  document = model.reorderReferences(document, generator.id, [second.id, first.id]);
  assert.deepEqual(model.incomingReferences(document, generator.id).map((node) => node.data.name), ['第二张', '第一张']);
});

test('removing an input edge also removes its persisted reference metadata', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/remove-first.png', '第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/remove-second.png', '第二张', { x: 360, y: 0 });
  const target = model.createGenerator('video', { x: 720, y: 0 }, { inputMode: 'frames' });
  let document = {
    ...empty,
    nodes: [
      first,
      second,
      {
        ...target,
        data: {
          ...target.data,
          referenceOrder: [first.id, second.id],
          generation: { kind: 'video', prompt: '', params: target.data.params, referenceIds: [first.id, second.id] },
        },
      },
    ],
  };
  document = model.addEdge(document, first.id, target.id, 'right', 'left', 'reference', 'first-frame', 0);
  document = model.addEdge(document, second.id, target.id, 'right', 'left', 'reference', 'last-frame', 1);
  const firstEdge = document.edges.find((edge) => edge.source === first.id);
  assert.ok(firstEdge);

  const next = model.removeEdge(document, firstEdge.id);
  assert.deepEqual(model.incomingReferences(next, target.id).map((node) => node.id), [second.id]);
  assert.deepEqual(next.nodes.find((node) => node.id === target.id)?.data.referenceOrder, [second.id]);
  assert.deepEqual(next.nodes.find((node) => node.id === target.id)?.data.generation?.referenceIds, [second.id]);
});

test('removes one member from a grouped reference without dropping the other members', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/group-remove-first.png', '第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/group-remove-second.png', '第二张', { x: 360, y: 0 });
  const third = model.createMedia('image', '/group-remove-third.png', '第三张', { x: 720, y: 0 });
  const target = model.createGenerator('video', { x: 1100, y: 0 }, { inputMode: 'reference' });
  let document = { ...empty, nodes: [first, second, third, target] };
  document = model.createGroup(document, [first.id, second.id, third.id]);
  const group = document.groups[0];
  document = model.addEdge(document, group.id, target.id, 'right', 'left', 'reference');

  const next = model.removeCanvasReference(document, target.id, second.id);
  assert.deepEqual(model.incomingReferences(next, target.id).map((node) => node.id), [first.id, third.id]);
  assert.equal(next.groups.some((item) => item.id === group.id), true);
  const groupEdge = next.edges.find((edge) => edge.source === group.id && edge.target === target.id);
  assert.ok(groupEdge);
  assert.deepEqual(groupEdge.sourceNodeIds, [first.id, third.id]);
  assert.deepEqual(next.nodes.find((node) => node.id === target.id)?.data.referenceOrder, [first.id, third.id]);
});

test('adds dropped nodes to the group under the pointer and keeps membership consistent', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/group-first.png', '组内第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/group-second.png', '组内第二张', { x: 360, y: 0 });
  const dropped = model.createMedia('image', '/dropped.png', '拖入图片', { x: 160, y: 180 });
  let document = { ...empty, nodes: [first, second, dropped] };
  document = model.createGroup(document, [first.id, second.id]);
  const group = document.groups[0];
  assert.equal(model.groupAtPoint(document, { x: 160, y: 180 })?.id, group.id);

  const next = model.moveNodesToGroup(document, [dropped.id], group.id);
  assert.equal(next.nodes.find((node) => node.id === dropped.id)?.groupId, group.id);
  assert.deepEqual(next.groups[0].nodeIds, [first.id, second.id, dropped.id]);
});

test('moving a node out of a two-node group removes the invalid old group cleanly', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/first.png', '第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/second.png', '第二张', { x: 360, y: 0 });
  const targetFirst = model.createMedia('image', '/target-first.png', '目标第一张', { x: 0, y: 500 });
  const targetSecond = model.createMedia('image', '/target-second.png', '目标第二张', { x: 360, y: 500 });
  let document = { ...empty, nodes: [first, second, targetFirst, targetSecond] };
  document = model.createGroup(document, [first.id, second.id]);
  document = model.createGroup(document, [targetFirst.id, targetSecond.id]);
  const sourceGroup = document.groups.find((group) => group.nodeIds.includes(first.id));
  const targetGroup = document.groups.find((group) => group.nodeIds.includes(targetFirst.id));
  assert.ok(sourceGroup);
  assert.ok(targetGroup);

  const next = model.moveNodesToGroup(document, [first.id], targetGroup.id);
  assert.equal(next.groups.some((group) => group.id === sourceGroup.id), false);
  assert.equal(next.nodes.find((node) => node.id === second.id)?.groupId, undefined);
  assert.equal(next.nodes.find((node) => node.id === first.id)?.groupId, targetGroup.id);
});

test('detaches a node from a group without changing its position or own edges', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/detach-first.png', '第一张', { x: 40, y: 80 });
  const second = model.createMedia('image', '/detach-second.png', '第二张', { x: 420, y: 80 });
  const third = model.createMedia('image', '/detach-third.png', '第三张', { x: 800, y: 80 });
  const target = model.createGenerator('image', { x: 1200, y: 80 });
  let document = { ...empty, nodes: [first, second, third, target] };
  document = model.createGroup(document, [first.id, second.id, third.id], '待脱组');
  const group = document.groups[0];
  document = model.addEdge(document, first.id, target.id);
  document = model.addEdge(document, group.id, target.id);
  const before = { x: first.x, y: first.y };

  const next = model.detachNodesFromGroups(document, [first.id]);

  assert.deepEqual({ x: next.nodes.find((node) => node.id === first.id).x, y: next.nodes.find((node) => node.id === first.id).y }, before);
  assert.equal(next.nodes.find((node) => node.id === first.id)?.groupId, undefined);
  assert.equal(next.nodes.find((node) => node.id === second.id)?.groupId, group.id);
  assert.equal(next.nodes.find((node) => node.id === third.id)?.groupId, group.id);
  assert.equal(next.edges.some((edge) => edge.source === first.id && edge.target === target.id), true);
  assert.equal(next.edges.some((edge) => edge.source === group.id), true);
});

test('detaching one node from a two-node group removes the empty group and group edges', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/detach-two-first.png', '第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/detach-two-second.png', '第二张', { x: 360, y: 0 });
  const target = model.createGenerator('image', { x: 720, y: 0 });
  let document = { ...empty, nodes: [first, second, target] };
  document = model.createGroup(document, [first.id, second.id], '两节点组');
  const group = document.groups[0];
  document = model.addEdge(document, first.id, target.id);
  document = model.addEdge(document, group.id, target.id);

  const next = model.detachNodesFromGroups(document, [first.id]);

  assert.equal(next.groups.some((item) => item.id === group.id), false);
  assert.equal(next.nodes.find((node) => node.id === first.id)?.groupId, undefined);
  assert.equal(next.nodes.find((node) => node.id === second.id)?.groupId, undefined);
  assert.equal(next.edges.some((edge) => edge.source === first.id && edge.target === target.id), true);
  assert.equal(next.edges.some((edge) => edge.source === group.id || edge.target === group.id), false);
});

function arrangeDocument(nodes, edges = [], groups = []) {
  const empty = model.normalizeDocument(null);
  return model.normalizeDocument({ ...empty, nodes, edges, groups });
}

function overlaps(left, right, gap = 0) {
  const document = { nodes: [left, right], groups: [], edges: [] };
  const a = model.entityBounds(document, left.id);
  const b = model.entityBounds(document, right.id);
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

test('arranges a directed workflow from inputs to outputs without overlap', () => {
  const prompt = model.createPrompt({ x: 900, y: 500 }, '构图');
  const source = model.createMedia('image', '/source.png', '输入', { x: 80, y: 900 });
  const generator = model.createGenerator('image', { x: -300, y: -300 });
  const result = model.createMedia('image', '/result.png', '结果', { x: -600, y: 1200 });
  let document = arrangeDocument([prompt, source, generator, result]);
  document = model.addEdge(document, prompt.id, generator.id);
  document = model.addEdge(document, source.id, generator.id);
  document = model.addEdge(document, generator.id, result.id);
  const arranged = model.arrangeCanvas(document);
  const byId = (id) => arranged.document.nodes.find((node) => node.id === id);
  assert.equal(arranged.changed, true);
  assert.ok(byId(prompt.id).x < byId(generator.id).x);
  assert.ok(byId(source.id).x < byId(generator.id).x);
  assert.ok(byId(generator.id).x < byId(result.id).x);
  assert.equal(overlaps(byId(prompt.id), byId(source.id)), false);
});

test('arranges unconnected nodes in a non-overlapping grid', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => model.createMedia('image', `/grid-${index}.png`, `网格 ${index}`, { x: index * 17, y: index * 13 }));
  const document = arrangeDocument(nodes);
  const arranged = model.arrangeCanvas(document).document;
  for (let left = 0; left < arranged.nodes.length; left += 1) {
    for (let right = left + 1; right < arranged.nodes.length; right += 1) assert.equal(overlaps(arranged.nodes[left], arranged.nodes[right]), false);
  }
});

test('selection-only arrangement leaves unselected nodes and external edges unchanged', () => {
  const first = model.createPrompt({ x: 800, y: 800 }, '输入');
  const second = model.createGenerator('image', { x: -800, y: -800 });
  const outside = model.createMedia('image', '/outside.png', '外部节点', { x: 2400, y: 70 });
  let document = arrangeDocument([first, second, outside]);
  document = model.addEdge(document, first.id, second.id);
  document = model.addEdge(document, second.id, outside.id);
  const beforeOutside = { x: outside.x, y: outside.y };
  const beforeEdges = JSON.stringify(document.edges);
  const arranged = model.arrangeCanvas(document, [first.id, second.id]);
  const nextOutside = arranged.document.nodes.find((node) => node.id === outside.id);
  assert.deepEqual({ x: nextOutside.x, y: nextOutside.y }, beforeOutside);
  assert.equal(JSON.stringify(arranged.document.edges), beforeEdges);
  assert.ok(arranged.document.nodes.find((node) => node.id === first.id).x < arranged.document.nodes.find((node) => node.id === second.id).x);
});

test('keeps complete groups together and preserves relative positions for partial selection', () => {
  const first = model.createMedia('image', '/first.png', '第一张', { x: 600, y: 400 });
  const second = model.createMedia('image', '/second.png', '第二张', { x: 1100, y: 650 });
  const result = model.createGenerator('image', { x: -500, y: -500 });
  let document = arrangeDocument([first, second, result]);
  document = model.createGroup(document, [first.id, second.id]);
  document = model.addEdge(document, first.id, result.id);
  const grouped = model.arrangeCanvas(document);
  const groupedFirst = grouped.document.nodes.find((node) => node.id === first.id);
  const groupedSecond = grouped.document.nodes.find((node) => node.id === second.id);
  assert.equal(groupedSecond.x - groupedFirst.x, second.x - first.x);
  assert.equal(groupedSecond.y - groupedFirst.y, second.y - first.y);
  const partial = model.arrangeCanvas(document, [first.id, result.id]);
  const partialFirst = partial.document.nodes.find((node) => node.id === first.id);
  const partialSecond = partial.document.nodes.find((node) => node.id === second.id);
  assert.equal(partialFirst.groupId, partialSecond.groupId);
  assert.deepEqual({ x: partialSecond.x, y: partialSecond.y }, { x: second.x, y: second.y });
});

test('arranges cards inside a selected group without moving the group or external graph', () => {
  const first = model.createMedia('image', '/group-first.png', '第一张', { x: 1240, y: 420 });
  const second = model.createGenerator('image', { x: 120, y: 760 });
  const third = model.createMedia('image', '/group-third.png', '第三张', { x: 360, y: 120 });
  const outside = model.createPrompt({ x: 2400, y: 1400 }, '组外节点');
  let document = arrangeDocument([first, second, third, outside]);
  document = model.createGroup(document, [first.id, second.id, third.id], '待整理组');
  const group = document.groups[0];
  document = model.addEdge(document, second.id, first.id);
  document = model.addEdge(document, group.id, outside.id);
  document = model.addEdge(document, third.id, outside.id);

  const beforeOutside = { x: outside.x, y: outside.y };
  const beforeEdges = JSON.stringify(document.edges);
  const beforeGroups = JSON.stringify(document.groups);
  const beforeGroupBounds = model.groupBounds(document, group.id);
  const arranged = model.arrangeCanvasGroup(document, group.id);
  const byId = (id) => arranged.document.nodes.find((node) => node.id === id);
  const arrangedFirst = byId(first.id);
  const arrangedSecond = byId(second.id);
  const arrangedThird = byId(third.id);
  const arrangedOutside = byId(outside.id);

  assert.equal(arranged.changed, true);
  assert.deepEqual(arranged.arrangedIds, group.nodeIds);
  assert.ok(arrangedSecond.x < arrangedFirst.x);
  assert.equal(overlaps(arrangedFirst, arrangedSecond), false);
  assert.equal(overlaps(arrangedFirst, arrangedThird), false);
  assert.equal(overlaps(arrangedSecond, arrangedThird), false);
  assert.deepEqual({ x: arrangedOutside.x, y: arrangedOutside.y }, beforeOutside);
  assert.equal(JSON.stringify(arranged.document.edges), beforeEdges);
  assert.equal(JSON.stringify(arranged.document.groups), beforeGroups);
  assert.deepEqual(
    { x: model.groupBounds(arranged.document, group.id).x, y: model.groupBounds(arranged.document, group.id).y },
    { x: beforeGroupBounds.x, y: beforeGroupBounds.y },
  );
});

test('handles cycles, empty selections, and deterministic output', () => {
  const first = model.createPrompt({ x: 1000, y: 20 }, 'A');
  const second = model.createGenerator('image', { x: -1000, y: 20 });
  let document = arrangeDocument([first, second]);
  document = model.addEdge(document, first.id, second.id);
  document = model.addEdge(document, second.id, first.id);
  const arranged = model.arrangeCanvas(document);
  assert.equal(overlaps(arranged.document.nodes[0], arranged.document.nodes[1]), false);
  assert.deepEqual(model.arrangeCanvas(document).document.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })), arranged.document.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })));
  const emptySelection = model.arrangeCanvas(document, []);
  assert.equal(emptySelection.changed, false);
  assert.deepEqual(emptySelection.arrangedIds, []);
});

test('aligns selected nodes to their outer bounds across all six directions', () => {
  const left = model.createPrompt({ x: 120, y: 340 }, '左');
  left.w = 240;
  left.h = 140;
  const middle = model.createMedia('image', '/middle.png', '中', { x: 430, y: 210 });
  middle.w = 380;
  middle.h = 270;
  const right = model.createGenerator('image', { x: 880, y: 470 });
  right.w = 300;
  right.h = 220;
  const outside = model.createMedia('image', '/outside.png', '未选中', { x: 1800, y: 20 });
  const document = arrangeDocument([left, middle, right, outside]);
  const selected = [left.id, middle.id, right.id];
  const originalOutside = { x: outside.x, y: outside.y };
  const originalSizes = selected.map((id) => {
    const node = document.nodes.find((item) => item.id === id);
    return { id, w: node.w, h: node.h };
  });
  const bounds = {
    left: Math.min(left.x, middle.x, right.x),
    top: Math.min(left.y, middle.y, right.y),
    right: Math.max(left.x + left.w, middle.x + middle.w, right.x + right.w),
    bottom: Math.max(left.y + left.h, middle.y + middle.h, right.y + right.h),
  };
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;

  const expectations = {
    left: (node) => ({ x: bounds.left, y: node.y }),
    'center-x': (node) => ({ x: centerX - node.w / 2, y: node.y }),
    right: (node) => ({ x: bounds.right - node.w, y: node.y }),
    top: (node) => ({ x: node.x, y: bounds.top }),
    'center-y': (node) => ({ x: node.x, y: centerY - node.h / 2 }),
    bottom: (node) => ({ x: node.x, y: bounds.bottom - node.h }),
  };

  Object.entries(expectations).forEach(([alignment, expectedPosition]) => {
    const result = model.alignCanvasNodes(document, selected, alignment);
    assert.equal(result.changed, true);
    assert.deepEqual(result.alignedIds, selected);
    selected.forEach((id) => {
      const before = document.nodes.find((node) => node.id === id);
      const after = result.document.nodes.find((node) => node.id === id);
      assert.deepEqual({ x: after.x, y: after.y }, expectedPosition(before));
    });
    assert.deepEqual(
      result.document.nodes.find((node) => node.id === outside.id),
      document.nodes.find((node) => node.id === outside.id),
    );
    assert.deepEqual(
      selected.map((id) => {
        const node = result.document.nodes.find((item) => item.id === id);
        return { id, w: node.w, h: node.h };
      }),
      originalSizes,
    );
  });
  assert.deepEqual({ x: outside.x, y: outside.y }, originalOutside);
  assert.deepEqual(
    document.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    [left, middle, right, outside].map((node) => ({ id: node.id, x: node.x, y: node.y })),
  );
});

test('does not change the document when alignment has fewer than two valid nodes', () => {
  const node = model.createPrompt({ x: 100, y: 200 }, '单个');
  const document = arrangeDocument([node]);
  const result = model.alignCanvasNodes(document, [node.id, 'missing'], 'top');
  assert.equal(result.changed, false);
  assert.deepEqual(result.alignedIds, [node.id]);
  assert.deepEqual(result.document, document);
});

test('reports an already aligned selection as unchanged', () => {
  const first = model.createPrompt({ x: 100, y: 240 }, '第一');
  const second = model.createMedia('image', '/second.png', '第二', { x: 600, y: 240 });
  const document = arrangeDocument([first, second]);
  const result = model.alignCanvasNodes(document, [first.id, second.id], 'top');
  assert.equal(result.changed, false);
  assert.deepEqual(result.document, document);
});

test('distributes different-sized nodes with equal horizontal edge gaps', () => {
  const first = model.createPrompt({ x: 100, y: 40 }, '第一');
  first.w = 100;
  first.h = 70;
  const middle = model.createMedia('image', '/middle.png', '中间', { x: 300, y: 240 });
  middle.w = 200;
  middle.h = 150;
  const last = model.createGenerator('image', { x: 700, y: 520 });
  last.w = 80;
  last.h = 110;
  const outside = model.createMedia('image', '/outside.png', '未选中', { x: 1200, y: 900 });
  const document = arrangeDocument([first, middle, last, outside]);
  const original = model.clone(document);
  const result = model.distributeCanvasNodes(
    document,
    [first.id, middle.id, last.id],
    'horizontal',
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.alignedIds, [first.id, middle.id, last.id]);
  const nextFirst = result.document.nodes.find((node) => node.id === first.id);
  const nextMiddle = result.document.nodes.find((node) => node.id === middle.id);
  const nextLast = result.document.nodes.find((node) => node.id === last.id);
  const firstGap = nextMiddle.x - (nextFirst.x + nextFirst.w);
  const secondGap = nextLast.x - (nextMiddle.x + nextMiddle.w);
  assert.equal(firstGap, 150);
  assert.equal(secondGap, 150);
  assert.deepEqual({ x: nextFirst.x, y: nextFirst.y }, { x: first.x, y: first.y });
  assert.deepEqual({ x: nextLast.x, y: nextLast.y }, { x: last.x, y: last.y });
  assert.equal(nextMiddle.y, middle.y);
  assert.deepEqual(
    result.document.nodes.find((node) => node.id === outside.id),
    document.nodes.find((node) => node.id === outside.id),
  );
  assert.deepEqual(document, original);
});

test('distributes different-sized nodes with equal vertical edge gaps', () => {
  const first = model.createPrompt({ x: 40, y: 50 }, '第一');
  first.w = 90;
  first.h = 100;
  const middle = model.createMedia('image', '/middle.png', '中间', { x: 300, y: 300 });
  middle.w = 170;
  middle.h = 200;
  const last = model.createGenerator('image', { x: 700, y: 700 });
  last.w = 110;
  last.h = 80;
  const document = arrangeDocument([first, middle, last]);
  const result = model.distributeCanvasNodes(
    document,
    [first.id, middle.id, last.id],
    'vertical',
  );

  assert.equal(result.changed, true);
  const nextFirst = result.document.nodes.find((node) => node.id === first.id);
  const nextMiddle = result.document.nodes.find((node) => node.id === middle.id);
  const nextLast = result.document.nodes.find((node) => node.id === last.id);
  const firstGap = nextMiddle.y - (nextFirst.y + nextFirst.h);
  const secondGap = nextLast.y - (nextMiddle.y + nextMiddle.h);
  assert.equal(firstGap, 175);
  assert.equal(secondGap, 175);
  assert.equal(nextMiddle.x, middle.x);
  assert.deepEqual({ x: nextFirst.x, y: nextFirst.y }, { x: first.x, y: first.y });
  assert.deepEqual({ x: nextLast.x, y: nextLast.y }, { x: last.x, y: last.y });
  assert.deepEqual(
    result.document.nodes.map((node) => ({ id: node.id, w: node.w, h: node.h })),
    document.nodes.map((node) => ({ id: node.id, w: node.w, h: node.h })),
  );
});

test('does not distribute fewer than three valid nodes or an already even selection', () => {
  const first = model.createPrompt({ x: 100, y: 100 }, '第一');
  const second = model.createMedia('image', '/second.png', '第二', { x: 400, y: 400 });
  const third = model.createGenerator('image', { x: 700, y: 700 });
  const document = arrangeDocument([first, second, third]);

  const tooFew = model.distributeCanvasNodes(document, [first.id, 'missing'], 'horizontal');
  assert.equal(tooFew.changed, false);
  assert.deepEqual(tooFew.alignedIds, [first.id]);
  assert.deepEqual(tooFew.document, document);

  const distributed = model.distributeCanvasNodes(document, [first.id, second.id, third.id], 'horizontal');
  const even = model.distributeCanvasNodes(distributed.document, [first.id, second.id, third.id], 'horizontal');
  assert.equal(even.changed, false);
  assert.deepEqual(even.document, distributed.document);
});

test('NOVA localStorage keys have a one-way migration target and no independent API config', () => {
  assert.match(storageSource, /nova\.v1\.projects/);
  assert.match(storageSource, /nova\.v1\.active/);
  assert.match(storageSource, /sanmao\.canvas\.projects/);
  assert.match(storageSource, /sanmao\.canvas\.nova-migrated/);
  assert.match(storageSource, /sanmao\.canvas\.nova-backup/);
  assert.match(storageSource, /legacyDocuments/);
  assert.doesNotMatch(storageSource, /apiKey|baseUrl|providers/);
});
