import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const IMAGE_DATA = 'data:image/png;base64,aGVsbG8=';
const PUBLIC_IMAGE = 'https://relay.example.test/three-d-reference.png';

function harness(t, { readDataUrl, response } = {}) {
  const reads = [];
  const uploads = [];
  const generations = [];
  const load = createTsRequire(process.cwd(), {
    './api': {
      asDataUrl: async (url) => {
        reads.push(url);
        return readDataUrl ? readDataUrl(url) : IMAGE_DATA;
      },
    },
  });
  const { publishCanvasThreeDReferences } = load('./lib/canvas/three-d-reference-upload');
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === '/api/cangyuan/3d') {
      generations.push({ url, init });
      return Response.json({ ok: true });
    }
    assert.equal(url, '/api/cangyuan/media/upload');
    assert.equal(init.method, 'POST');
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('kind'), 'image');
    const file = init.body.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.type, 'image/png');
    assert.equal(await file.text(), 'hello');
    uploads.push({ url, file });
    return response ? response() : Response.json({ url: PUBLIC_IMAGE });
  });
  return { publish: publishCanvasThreeDReferences, reads, uploads, generations };
}

test('public HTTP and HTTPS references are submitted unchanged without uploading', async (t) => {
  const { publish, reads, uploads } = harness(t);
  for (const imageUrl of ['https://cdn.example.test/model.png?token=example', 'http://cdn.example.test/model.jpg']) {
    const original = { mode: 'image-to-3d', imageUrl, pbr: true };
    const ready = await publish(original);
    assert.deepEqual(ready, original);
    assert.notEqual(ready, original);
    assert.deepEqual(original, { mode: 'image-to-3d', imageUrl, pbr: true });
  }
  assert.deepEqual(reads, []);
  assert.deepEqual(uploads, []);
});

const LOCAL_REFERENCES = [
  ['relative storage reference', '/api/storage/file?name=reference.png'],
  ['relative image path', '/uploads/reference.png'],
  ['browser blob reference', 'blob:https://app.example.test/reference-1'],
  ['inline image', IMAGE_DATA],
  ['localhost reference', 'http://localhost:3210/api/storage/file?name=reference.png'],
  ['IPv4 loopback reference', 'http://127.0.0.1:3210/reference.png'],
  ['IPv6 loopback reference', 'http://[::1]:3210/reference.png'],
  ['private 192.168 reference', 'http://192.168.1.10:3210/reference.png'],
  ['private 10.x reference', 'http://10.1.2.3/reference.png'],
  ['private 172.16 reference', 'http://172.16.1.10/reference.png'],
  ['private IPv6 reference', 'http://[fd12::1]/reference.png'],
  ['internal hostname reference', 'http://studio.internal/reference.png'],
  ['protected storage on a public hostname', 'https://app.example.test/api/storage/file?name=reference.png'],
];

for (const [label, imageUrl] of LOCAL_REFERENCES) {
  test(`${label} is converted and published through the existing image relay`, async (t) => {
    const { publish, reads, uploads } = harness(t);
    const original = { mode: 'image-to-3d', imageUrl, texture: true };
    const ready = await publish(original);
    assert.equal(ready.imageUrl, PUBLIC_IMAGE);
    assert.equal(ready.texture, true);
    assert.equal(original.imageUrl, imageUrl);
    assert.deepEqual(reads, [imageUrl]);
    assert.equal(uploads.length, 1);
  });
}

test('concurrent views sharing one local image read and upload it only once', async (t) => {
  let releaseRead;
  const dataReady = new Promise((resolve) => { releaseRead = resolve; });
  const { publish, reads, uploads } = harness(t, { readDataUrl: () => dataReady });
  const original = {
    mode: 'multiview-to-3d',
    multiviewImages: {
      front: 'blob:one-reference',
      back: 'blob:one-reference',
      left: 'blob:one-reference',
      right: 'https://cdn.example.test/right.png',
    },
  };
  const pending = publish(original);
  assert.deepEqual(reads, ['blob:one-reference']);
  assert.equal(uploads.length, 0);
  releaseRead(IMAGE_DATA);
  const ready = await pending;
  assert.equal(uploads.length, 1);
  assert.deepEqual(ready.multiviewImages, {
    front: PUBLIC_IMAGE,
    back: PUBLIC_IMAGE,
    left: PUBLIC_IMAGE,
    right: 'https://cdn.example.test/right.png',
  });
  assert.equal(original.multiviewImages.front, 'blob:one-reference');
});

test('only the selected generation mode prepares its image inputs', async (t) => {
  const { publish, reads } = harness(t);
  await publish({ mode: 'text-to-3d', imageUrl: 'blob:unused-single', multiviewImages: { front: 'blob:unused-front' } });
  assert.deepEqual(reads, []);
  await publish({ mode: 'image-to-3d', imageUrl: 'blob:single', multiviewImages: { front: 'blob:unused-front' } });
  assert.deepEqual(reads, ['blob:single']);
  await publish({ mode: 'multiview-to-3d', imageUrl: 'blob:unused-single', multiviewImages: { front: 'blob:front' } });
  assert.deepEqual(reads, ['blob:single', 'blob:front']);
});

test('relay errors preserve the actionable Chinese message', async (t) => {
  const { publish, uploads } = harness(t, {
    response: () => Response.json({ error: '图片中转服务暂不可用，请稍后重试。' }, { status: 503 }),
  });
  await assert.rejects(() => publish({ mode: 'image-to-3d', imageUrl: 'blob:reference' }), {
    message: '图片中转服务暂不可用，请稍后重试。',
  });
  assert.equal(uploads.length, 1);
});

const INVALID_RESPONSES = [
  ['missing URL', () => Response.json({})],
  ['non-string URL', () => Response.json({ url: 123 })],
  ['empty URL', () => Response.json({ url: '' })],
  ['private URL', () => Response.json({ url: 'http://192.168.1.10/reference.png' })],
  ['relative URL', () => Response.json({ url: '/api/storage/file?name=reference.png' })],
  ['invalid URL', () => Response.json({ url: 'not-an-image-url' })],
  ['JSON null', () => Response.json(null)],
  ['non-JSON response', () => new Response('<html>Service unavailable</html>', { status: 502 })],
  ['empty response', () => new Response(null, { status: 204 })],
];

for (const [label, response] of INVALID_RESPONSES) {
  test(`${label} rejects preparation before a caller can submit generation`, async (t) => {
    const { publish, uploads, generations } = harness(t, { response });
    await assert.rejects(async () => {
      const options = await publish({ mode: 'image-to-3d', imageUrl: 'blob:reference' });
      await fetch('/api/cangyuan/3d', { method: 'POST', body: JSON.stringify({ options }) });
    }, { message: '画布参考图准备失败，请重新选择。' });
    assert.equal(uploads.length, 1);
    assert.deepEqual(generations, []);
  });
}

test('an unreadable canvas image rejects before uploading or generation', async (t) => {
  const { publish, uploads, generations } = harness(t, {
    readDataUrl: async () => { throw new Error('本地图片文件已丢失，请重新导入。'); },
  });
  await assert.rejects(async () => {
    const options = await publish({ mode: 'image-to-3d', imageUrl: '/api/storage/file?name=lost.png' });
    await fetch('/api/cangyuan/3d', { method: 'POST', body: JSON.stringify({ options }) });
  }, { message: '本地图片文件已丢失，请重新导入。' });
  assert.deepEqual(uploads, []);
  assert.deepEqual(generations, []);
});
