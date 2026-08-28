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
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const api = await loadTypeScript('../lib/canvas/api.ts');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
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
  assert.deepEqual(payload.input, { prompt: '镜头推进', seconds: 8, aspectRatio: '16:9', resolution: '720P', referenceImages: [] });
  assert.equal('audio' in payload.input, false);
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
    stream: false,
  });
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
      'data:image/jpeg;base64,AA==',
      'data:image/jpeg;base64,AA==',
    ]);
    assert.deepEqual(mocks.encodedTypes, ['image/jpeg', 'image/jpeg']);
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
