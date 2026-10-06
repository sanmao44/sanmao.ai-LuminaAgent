import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const preparation = createTsRequire(process.cwd())('./lib/agent/reference-preparation');

test('prepares image references through the injected compressor', async () => {
  const calls = [];
  const result = await preparation.prepareAgentReferences([
    { id: 'image-1', kind: 'image', name: 'Image', dataUrl: 'data:image/png;base64,raw' },
  ], async (url) => {
    calls.push(url);
    return 'data:image/webp;base64,compressed';
  });

  assert.deepEqual(calls, ['data:image/png;base64,raw']);
  assert.deepEqual(result, [{
    id: 'image-1',
    kind: 'image',
    name: 'Image',
    url: 'data:image/webp;base64,compressed',
  }]);
});

test('keeps video and text references unchanged and preserves their metadata', async () => {
  let calls = 0;
  const result = await preparation.prepareAgentReferences([
    { id: 'video-1', kind: 'video', name: 'Video', url: '/video.mp4', mimeType: 'video/mp4' },
    { id: 'text-1', kind: 'text', name: 'Notes', text: 'hello', mimeType: 'text/plain' },
  ], async (url) => {
    calls += 1;
    return url;
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, [
    { id: 'video-1', kind: 'video', name: 'Video', url: '/video.mp4', mimeType: 'video/mp4' },
    { id: 'text-1', kind: 'text', name: 'Notes', text: 'hello', mimeType: 'text/plain' },
  ]);
});

test('normalizes legacy references, limits the request to sixteen items, and keeps order', async () => {
  const references = Array.from({ length: 18 }, (_, index) => ({
    dataUrl: `data:image/png;base64,${index}`,
  }));
  const result = await preparation.prepareAgentReferences(references, async (url) => url);

  assert.equal(result.length, 16);
  assert.deepEqual(result.slice(0, 2).map((reference) => reference.id), ['ref-1', 'ref-2']);
  assert.deepEqual(result.slice(-1)[0], {
    id: 'ref-16',
    kind: 'image',
    name: '参考图 16',
    url: 'data:image/png;base64,15',
  });
});
