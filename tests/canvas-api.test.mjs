import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  let compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  if (compiled.includes('from "../agent-client"')) {
    const dependencyUrl = new URL('../lib/agent-client.ts', import.meta.url);
    const dependencySource = await readFile(dependencyUrl, 'utf8');
    const dependencyCompiled = ts.transpileModule(dependencySource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: dependencyUrl.pathname,
    }).outputText;
    const dependencyDataUrl = `data:text/javascript;base64,${Buffer.from(dependencyCompiled).toString('base64')}`;
    compiled = compiled.replace('from "../agent-client"', `from "${dependencyDataUrl}"`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const api = await loadTypeScript('../lib/canvas/api.ts');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), async json() { return body; } };
}

async function withFetch(handler, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

function withImageCanvas(options = {}) {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const canvasSizes = [];
  const encodedTypes = [];
  const width = options.width || 1200;
  const height = options.height || 800;
  const outputBytes = options.outputBytes || 1024;

  class MockImage {
    naturalWidth = width;
    naturalHeight = height;
    width = width;
    height = height;
    onload;
    onerror;

    set src(value) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }
  }

  globalThis.URL.createObjectURL = () => 'blob:canvas-test';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Image = MockImage;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            clearRect() {},
            drawImage() {},
            getImageData() {
              return { data: new Uint8ClampedArray([255, 255, 255, options.transparent ? 0 : 255]) };
            },
          };
        },
        toBlob(callback, type) {
          encodedTypes.push(type);
          if (options.failEncoding || (type === 'image/webp' && options.webpUnsupported)) {
            callback(null);
            return;
          }
          callback(new Blob([new Uint8Array(outputBytes)], { type }));
        },
        toDataURL(type) {
          encodedTypes.push(type);
          return `data:${type};base64,AA==`;
        },
      };
      canvasSizes.push(canvas);
      return canvas;
    },
  };

  return {
    canvasSizes,
    encodedTypes,
    restore() {
      globalThis.Image = originalImage;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      globalThis.URL.createObjectURL = originalCreateObjectUrl;
      globalThis.URL.revokeObjectURL = originalRevokeObjectUrl;
    },
  };
}

function imageFile(name, type, size = 1) {
  return new File([new ArrayBuffer(size)], name, { type, lastModified: 123 });
}

test('canvas image generation follows SANMAO response protocol', async () => {
  let request;
  const result = await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ images: [{ url: '/api/storage/file?name=generated.png' }] });
  }, () => api.generateCanvasImage({ prompt: '紫色云海', model: 'image-model', count: 2, aspect: '16:9' }));

  assert.deepEqual(result.images, [{ url: '/api/storage/file?name=generated.png' }]);
  assert.equal(request.input, '/api/generate');
  assert.deepEqual(JSON.parse(request.options.body), {
    source: 'canvas', prompt: '紫色云海', model: 'image-model', count: 2, aspectRatio: '16:9',
    resolution: '自动', quality: '自动', references: [], referenceImages: [],
  });
});

test('canvas image generation only sends a mask when one is present', async () => {
  let request;
  await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ images: [{ url: '/generated.png' }] });
  }, () => api.generateCanvasImage({
    prompt: '局部修改',
    model: 'image-model',
    maskUrl: 'data:image/png;base64,mask',
  }));

  const payload = JSON.parse(request.options.body);
  assert.equal(payload.mask, 'data:image/png;base64,mask');
  assert.equal('maskUrl' in payload, false);
});

test('canvas upload keeps small images and videos unchanged', async () => {
  const mocks = withImageCanvas({ width: 1200, height: 800 });
  try {
    const image = imageFile('small.png', 'image/png', 1024);
    const imageResult = await api.optimizeCanvasUploadFile(image);
    assert.equal(imageResult.file, image);
    assert.equal(imageResult.changed, false);
    assert.equal(mocks.canvasSizes.length, 0);

    const video = imageFile('clip.mp4', 'video/mp4', 1024);
    const videoResult = await api.optimizeCanvasUploadFile(video);
    assert.equal(videoResult.file, video);
    assert.equal(videoResult.changed, false);
  } finally {
    mocks.restore();
  }
});

test('canvas upload compresses oversized images, preserves ratio, and fixes extension', async () => {
  const mocks = withImageCanvas({ width: 12000, height: 6000, outputBytes: 2048 });
  try {
    const source = imageFile('panorama.png', 'image/png', api.CANVAS_IMAGE_MAX_BYTES + 1);
    let request;
    const asset = await withFetch(async (input, options) => {
      request = { input, options };
      return jsonResponse({ id: 'asset-1', kind: 'image', name: 'panorama.jpg', url: '/image.jpg', mime: 'image/jpeg', size: 2048 });
    }, () => api.uploadCanvasAsset(source));

    assert.deepEqual([mocks.canvasSizes[0].width, mocks.canvasSizes[0].height], [6144, 3072]);
    assert.equal(request.input, '/api/canvas/assets');
    assert.equal(request.options.headers['Content-Type'], 'image/jpeg');
    assert.equal(request.options.headers['X-File-Name'], 'panorama.jpg');
    assert.equal(request.options.body.type, 'image/jpeg');
    assert.equal(request.options.body.name, 'panorama.jpg');
    assert.equal(request.options.body.size, 2048);
    assert.equal(asset.optimized, true);
    assert.equal(asset.originalSize, source.size);
    assert.equal(asset.uploadedSize, 2048);
  } finally {
    mocks.restore();
  }
});

test('canvas upload keeps transparent images in an alpha-capable format', async () => {
  const mocks = withImageCanvas({ transparent: true, webpUnsupported: true, outputBytes: 1024 });
  try {
    const source = imageFile('alpha.png', 'image/png', api.CANVAS_IMAGE_MAX_BYTES + 1);
    const result = await api.optimizeCanvasUploadFile(source);
    assert.equal(result.file.type, 'image/png');
    assert.equal(result.file.name, 'alpha.png');
    assert.deepEqual(mocks.encodedTypes.slice(0, 2), ['image/webp', 'image/png']);
  } finally {
    mocks.restore();
  }
});

test('canvas upload blocks oversized images when local encoding fails', async () => {
  const mocks = withImageCanvas({ failEncoding: true });
  try {
    const source = imageFile('broken.png', 'image/png', api.CANVAS_IMAGE_MAX_BYTES + 1);
    let fetchCalled = false;
    await assert.rejects(
      () => withFetch(async () => {
        fetchCalled = true;
        return jsonResponse({});
      }, () => api.uploadCanvasAsset(source)),
      /图片压缩失败/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    mocks.restore();
  }
});

test('canvas video generation creates a task without leaking boolean audio', async () => {
  let request;
  const task = await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ task: { id: 'video-1', status: 'pending' } });
  }, () => api.generateCanvasVideo({ prompt: '镜头推进', model: 'video-model', duration: 8, audio: true }));

  assert.deepEqual(task, { id: 'video-1', status: 'pending' });
  const payload = JSON.parse(request.options.body);
  assert.equal(request.input, '/api/video/generate');
  assert.equal(payload.source, 'canvas');
  assert.equal(payload.model, 'video-model');
  assert.deepEqual(payload.input, { prompt: '镜头推进', seconds: 8, aspectRatio: '16:9', resolution: '720p', referenceImages: [] });
  assert.equal('audio' in payload.input, false);
});

test('canvas image generation compresses reference images before submitting', async () => {
  const mocks = withImageCanvas({ width: 3200, height: 1800 });
  try {
    let request;
    await withFetch(async (input, options) => {
      request = { input, options };
      return jsonResponse({ images: [{ url: '/generated.png' }] });
    }, () => api.generateCanvasImage({
      prompt: '统一风格',
      references: [{ url: 'data:image/png;base64,ORIGINAL' }],
    }));

    assert.deepEqual(JSON.parse(request.options.body).references, ['data:image/jpeg;base64,AA==']);
    assert.deepEqual(mocks.encodedTypes, ['image/jpeg']);
  } finally {
    mocks.restore();
  }
});

test('canvas video generation sends explicit reference mode inputs', async () => {
  const mocks = withImageCanvas();
  try {
    let request;
    await withFetch(async (input, options) => {
      request = { input, options };
      return jsonResponse({ task: { id: 'video-reference', status: 'pending' } });
    }, () => api.generateCanvasVideo({
      prompt: '保持人物和服装',
      model: 'video-model',
      inputMode: 'reference',
      references: [{ url: 'data:image/png;base64,one' }, { url: 'data:image/png;base64,two' }],
    }));

    const payload = JSON.parse(request.options.body);
    assert.equal(payload.input.videoMode, 'reference');
    assert.deepEqual(payload.input.referenceImages, ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,AA==']);
    assert.equal('firstFrame' in payload.input, false);
    assert.equal('lastFrame' in payload.input, false);
  } finally {
    mocks.restore();
  }
});

test('canvas video generation does not leak reference video into image-only modes', async () => {
  const mocks = withImageCanvas();
  try {
    let request;
    await withFetch(async (input, options) => {
      request = JSON.parse(options.body);
      return jsonResponse({ task: { id: 'video-filtered', status: 'pending' } });
    }, () => api.generateCanvasVideo({
      prompt: '首帧图片',
      model: 'video-model',
      inputMode: 'first-frame',
      references: [{ url: 'data:image/png;base64,first' }],
      referenceVideo: 'data:video/mp4;base64,should-not-be-sent',
    }));

    assert.equal('referenceVideo' in request.input, false);
  } finally {
    mocks.restore();
  }
});

test('canvas video generation sends explicit first-frame and first/last-frame inputs', async () => {
  const mocks = withImageCanvas();
  try {
    const requests = [];
    await withFetch(async (input, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse({ task: { id: `video-${requests.length}`, status: 'pending' } });
    }, async () => {
      await api.generateCanvasVideo({
        prompt: '从首帧开始',
        model: 'video-model',
        inputMode: 'first-frame',
        references: [{ url: 'data:image/png;base64,first' }],
      });
      await api.generateCanvasVideo({
        prompt: '从白天过渡到夜晚',
        model: 'video-model',
        inputMode: 'frames',
        references: [{ url: 'data:image/png;base64,first' }, { url: 'data:image/png;base64,last' }],
      });
    });

    assert.equal('videoMode' in requests[0].input, false);
    assert.equal(requests[0].input.firstFrame, 'data:image/jpeg;base64,AA==');
    assert.equal('lastFrame' in requests[0].input, false);
    assert.deepEqual(requests[0].input.referenceImages, []);
    assert.equal(requests[1].input.videoMode, 'keyframe');
    assert.equal(requests[1].input.firstFrame, 'data:image/jpeg;base64,AA==');
    assert.equal(requests[1].input.lastFrame, 'data:image/jpeg;base64,AA==');
    assert.deepEqual(requests[1].input.referenceImages, []);
  } finally {
    mocks.restore();
  }
});

test('canvas video generation blocks incomplete frame inputs before network submission', async () => {
  const mocks = withImageCanvas();
  let fetchCalled = false;
  try {
    await assert.rejects(
      () => withFetch(async () => {
        fetchCalled = true;
        return jsonResponse({ task: { id: 'should-not-submit', status: 'pending' } });
      }, () => api.generateCanvasVideo({
        prompt: '首尾帧不完整',
        inputMode: 'frames',
        references: [{ url: 'data:image/png;base64,first' }],
      })),
      /首尾帧模式请先添加首帧和尾帧图片/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    mocks.restore();
  }
});

test('canvas agent generation marks the request as canvas-originated', async () => {
  let request;
  await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ ok: true, message: '已完成' });
  }, () => api.generateCanvasAgent({
    messages: [{ role: 'user', content: '生成一张海报' }],
    model: 'provider-a-chat-model',
    webMode: 'off',
  }));

  assert.equal(request.input, '/api/agent');
  assert.deepEqual(JSON.parse(request.options.body), {
    source: 'canvas',
    messages: [{ role: 'user', content: '生成一张海报', references: [], files: [] }],
    model: 'provider-a-chat-model',
    webMode: 'off',
    webSearch: false,
    references: [],
    stream: true,
  });
});

test('canvas agent consumes status, delta, and final SSE events', async () => {
  const events = [
    'data: {"type":"status","stage":"answering","message":"正在生成回复…"}\n\n',
    'data: {"type":"delta","text":"第一段"}\n\n',
    'data: {"type":"delta","text":"第二段"}\n\n',
    'data: {"type":"final","message":"第一段第二段","model":"Agnes 2.5 Flash"}\n\n',
  ];
  const received = [];
  const encoded = events.map((value) => new TextEncoder().encode(value));
  const result = await withFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader() {
        let index = 0;
        return { read: async () => index < encoded.length ? { done: false, value: encoded[index++] } : { done: true, value: undefined } };
      },
    },
  }), () => api.generateCanvasAgent({
    messages: [{ role: 'user', content: '描述这张图' }],
    model: 'provider-a-chat-model',
  }, (event) => received.push(event)));

  assert.equal(result.message, '第一段第二段');
  assert.equal(result.model, 'Agnes 2.5 Flash');
  assert.deepEqual(received.map((event) => event.type), ['status', 'delta', 'delta', 'final']);
});

test('canvas agent forwards the same explicit deliverable contract as the main Agent', async () => {
  let request;
  await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ ok: true, message: '这是一幅水墨画。', deliverable: 'TEXT', images: [] });
  }, () => api.generateCanvasAgent({
    messages: [{ role: 'user', content: '描述下这个画面' }],
    model: 'provider-a-chat-model',
    deliverable: 'TEXT',
    intentReason: '检测到文字描述任务',
  }));

  const payload = JSON.parse(request.options.body);
  assert.equal(payload.stream, true);
  assert.equal(payload.deliverable, 'TEXT');
  assert.equal(payload.intentReason, '检测到文字描述任务');
});

test('canvas agent forwards explicit reverse-prompt tasks', async () => {
  const mocks = withImageCanvas();
  try {
    let request;
    await withFetch(async (input, options) => {
      request = { input, options };
      return jsonResponse({ ok: true, message: '已完成' });
    }, () => api.generateCanvasAgent({
      messages: [{ role: 'user', content: '反推图片提示词' }],
      model: 'provider-a-chat-model',
      task: 'reverse_prompt',
      references: [{ url: 'data:image/jpeg;base64,AA==', name: '参考图' }],
    }));

    assert.equal(JSON.parse(request.options.body).task, 'reverse_prompt');
  } finally {
    mocks.restore();
  }
});

test('canvas agent task inference only applies image-backed prompt work', () => {
  assert.equal(api.inferCanvasAgentTask('反推图片提示词', true), 'reverse_prompt');
  assert.equal(api.inferCanvasAgentTask('反推图片提示词', false), undefined);
  assert.equal(api.inferCanvasAgentTask('请优化这段提示词', true), 'optimize_prompt');
});

test('canvas agent references use the compact image format before sending', async () => {
  const mocks = withImageCanvas({ width: 3200, height: 1800 });
  try {
    let request;
    await withFetch(async (input, options) => {
      request = { input, options };
      return jsonResponse({ ok: true, message: '已完成' });
    }, () => api.generateCanvasAgent({
      messages: [{ role: 'user', content: '请反推提示词' }],
      model: 'provider-a-chat-model',
      references: [
        { url: 'data:image/png;base64,ORIGINAL-1', name: '第一张' },
        { url: 'data:image/png;base64,ORIGINAL-2', name: '第二张' },
      ],
    }));

    const payload = JSON.parse(request.options.body);
    assert.equal(request.input, '/api/agent');
    assert.deepEqual(payload.messages[0].references, [
      { id: 'canvas-ref-1', kind: 'image', name: '第一张', url: 'data:image/jpeg;base64,AA==' },
      { id: 'canvas-ref-2', kind: 'image', name: '第二张', url: 'data:image/jpeg;base64,AA==' },
    ]);
    assert.deepEqual(mocks.encodedTypes, ['image/jpeg', 'image/jpeg']);
  } finally {
    mocks.restore();
  }
});

test('canvas agent reuses a bounded prepared-reference cache and invalidates by URL', async () => {
  const mocks = withImageCanvas({ width: 2600, height: 1800 });
  try {
    const firstUrl = 'data:image/png;base64,CACHE-UNIQUE-A';
    const secondUrl = 'data:image/png;base64,CACHE-UNIQUE-B';
    await Promise.all([
      api.prepareCanvasAgentReferences([{ url: firstUrl }]),
      api.prepareCanvasAgentReferences([{ url: firstUrl }]),
    ]);
    assert.equal(mocks.encodedTypes.length, 1);
    await api.prepareCanvasAgentReferences([{ url: secondUrl }]);
    assert.equal(mocks.encodedTypes.length, 2);
    assert.equal(api.CANVAS_AGENT_REFERENCE_CACHE_LIMIT, 16);
  } finally {
    mocks.restore();
  }
});

test('canvas upscale marks the request as canvas-originated', async () => {
  let request;
  await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ images: [] });
  }, () => api.generateCanvasUpscale({ referenceUrl: 'data:image/png;base64,AA==', scale: 2 }));

  assert.equal(request.input, '/api/upscale');
  assert.equal(JSON.parse(request.options.body).source, 'canvas');
});

test('canvas Tencent upscale sends only the Tencent-supported parameters', async () => {
  let request;
  await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ images: [{ url: '/tencent.png' }], status: 'succeeded' });
  }, () => api.generateCanvasUpscale({
    taskId: 'canvas-run-1',
    sourceImageId: 'source-image-1',
    model: 'tencent-super-resolution',
    referenceUrl: 'data:image/png;base64,AA==',
    scale: 4,
    cloud: true,
    seed: 123,
    colorCorrection: 'none',
    resizeMethod: 'nearest',
  }));

  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload, {
    source: 'canvas',
    taskId: 'canvas-run-1',
    prompt: 'Upscale this image',
    model: 'tencent-super-resolution',
    reference: 'data:image/png;base64,AA==',
    referenceImages: [{ name: '超分原图', url: 'data:image/png;base64,AA==' }],
    sourceImageId: 'source-image-1',
    scale: 4,
  });
});

test('canvas Alibaba upscale sends its output format and JPG quality', async () => {
  let request;
  await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ images: [{ url: '/aliyun.jpg' }], status: 'succeeded' });
  }, () => api.generateCanvasUpscale({
    model: 'aliyun-standard-super-resolution',
    referenceUrl: 'data:image/png;base64,AA==',
    scale: 3,
    cloud: true,
    outputFormat: 'jpg',
    outputQuality: 72,
    size: '2048x2048',
    seed: 123,
    colorCorrection: 'none',
    resizeMethod: 'nearest',
  }));

  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, 'aliyun-standard-super-resolution');
  assert.equal(payload.scale, 3);
  assert.equal(payload.outputFormat, 'jpg');
  assert.equal(payload.outputQuality, 72);
  assert.equal('size' in payload, false);
  assert.equal('seed' in payload, false);
  assert.equal('colorCorrection' in payload, false);
  assert.equal('resizeMethod' in payload, false);
});

test('canvas video polling uses the SANMAO task endpoint', async () => {
  let request;
  const result = await withFetch(async (input, options) => {
    request = { input, options };
    return jsonResponse({ task: { id: 'task/1', status: 'done', videoUrls: ['/video.mp4'] } });
  }, () => api.getCanvasVideoTask('task/1'));

  assert.equal(request.input, '/api/video/tasks/task%2F1');
  assert.deepEqual(request.options, { cache: 'no-store' });
  assert.deepEqual(result.task.videoUrls, ['/video.mp4']);
});
