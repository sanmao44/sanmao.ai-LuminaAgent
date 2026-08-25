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
