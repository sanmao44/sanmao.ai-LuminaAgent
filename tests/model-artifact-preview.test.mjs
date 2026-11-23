import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const previewReader = createTsRequire(process.cwd())('./lib/model-artifact-preview-reader');
const previewApplication = createTsRequire(process.cwd())('./apps/api/model-artifact-preview-application');

function validGlb() {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  bytes.set([0x67, 0x6c, 0x54, 0x46], 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, 4, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set([0x7b, 0x7d, 0x20, 0x20], 20);
  return bytes;
}

function createReader({ bytes = validGlb(), addresses = [{ address: '8.8.8.8', family: 4 }], contentLength } = {}) {
  let fetchCount = 0;
  let disposeCount = 0;
  const reader = previewReader.createModelArtifactPreviewReader({
    resolveAddresses: async () => addresses,
    fetchAsset: async () => {
      fetchCount += 1;
      const response = new Response(bytes, {
        headers: { 'Content-Length': String(contentLength ?? bytes.byteLength) },
      });
      return { response, dispose: async () => { disposeCount += 1; } };
    },
  });
  return { reader, get fetchCount() { return fetchCount; }, get disposeCount() { return disposeCount; } };
}

async function readAll(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    chunks.push(value);
  }
}

test('model preview streams a validated GLB and closes the upstream connection', async () => {
  const fixture = createReader();
  const asset = await fixture.reader.open('https://assets.example/model.glb');

  assert.equal(asset.contentType, 'model/gltf-binary');
  assert.equal(asset.contentLength, 24);
  assert.deepEqual(await readAll(asset.body), Buffer.from(validGlb()));
  assert.equal(fixture.fetchCount, 1);
  assert.equal(fixture.disposeCount, 1);
});

test('model preview rejects unsafe hosts and DNS results before fetching', async () => {
  const localName = createReader();
  await assert.rejects(localName.reader.open('http://localhost/model.glb'), /不安全/);
  assert.equal(localName.fetchCount, 0);

  const privateAddress = createReader({ addresses: [{ address: '192.168.1.15', family: 4 }] });
  await assert.rejects(privateAddress.reader.open('https://assets.example/model.glb'), /非公网地址/);
  assert.equal(privateAddress.fetchCount, 0);
});

test('model preview rejects non-global and special-purpose IPv6 before fetching', async () => {
  for (const address of [
    '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:1::1', '2001:db8::1', '2002:c000:0201::1', '3fff::1',
  ]) {
    const fixture = createReader({ addresses: [{ address, family: 6 }] });
    await assert.rejects(fixture.reader.open('https://assets.example/model.glb'), /非公网地址/);
    assert.equal(fixture.fetchCount, 0, `must not fetch ${address}`);
  }
});

test('model preview permits global-unicast IPv6 and releases the stream on cancel', async () => {
  const fixture = createReader({ addresses: [{ address: '2001:4860:4860::8888', family: 6 }] });
  const asset = await fixture.reader.open('https://[2001:4860:4860::8888]/model.glb');

  assert.equal(asset.contentType, 'model/gltf-binary');
  assert.equal(fixture.fetchCount, 1);
  await asset.body.cancel();
  assert.equal(fixture.disposeCount, 1);
});

test('model preview rejects malformed GLB data and releases its source', async () => {
  const fixture = createReader({ bytes: new Uint8Array(24) });

  await assert.rejects(fixture.reader.open('https://assets.example/model.glb'), /不是有效的 GLB/);
  assert.equal(fixture.disposeCount, 1);
});

test('model preview rejects oversized declared assets before reading them', async () => {
  const fixture = createReader({ contentLength: 200 * 1024 * 1024 + 1 });

  await assert.rejects(fixture.reader.open('https://assets.example/model.glb'), /超过 200 MiB/);
  assert.equal(fixture.disposeCount, 1);
});

test('preview application only opens completed GLB outputs owned by the requested task', async () => {
  const task = {
    id: 'task-1', kind: '3d', status: 'succeeded', outputs: [{ url: 'https://assets.example/model.glb', artifactType: 'glb' }],
  };
  const opened = [];
  const application = previewApplication.createModelArtifactPreviewApplication({
    findTask: async (taskId) => taskId === task.id ? task : null,
    reader: { open: async (url) => { opened.push(url); return { body: new ReadableStream(), contentLength: 12, contentType: 'model/gltf-binary' }; } },
  });

  await assert.rejects(application.openThreeDOutput('missing', 0), { code: 'not-found' });
  await assert.rejects(application.openThreeDOutput(task.id, 1), { code: 'unsupported' });
  await assert.rejects(application.openThreeDOutput(task.id, -1), { code: 'unsupported' });
  task.status = 'running';
  await assert.rejects(application.openThreeDOutput(task.id, 0), { code: 'not-ready' });
  task.status = 'succeeded';
  await application.openThreeDOutput(task.id, 0);

  task.status = 'cancelled';
  await application.openThreeDOutput(task.id, 0);

  assert.deepEqual(opened, ['https://assets.example/model.glb', 'https://assets.example/model.glb']);
});
