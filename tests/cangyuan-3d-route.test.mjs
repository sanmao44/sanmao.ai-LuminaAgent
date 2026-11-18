import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function createRoute() {
  let submitted;
  const modules = {
    '@/apps/worker/cangyuan-creative-task': {
      createCangyuanCreativeGeneration: async (input) => {
        submitted = input;
        return { id: 'local-3d-task', kind: '3d', status: 'pending' };
      },
      listCangyuanCreativeGenerations: async () => [],
    },
    '@/lib/auth': { isTrustedAppRequest: () => true },
    '@/lib/runtime-operation': {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
  };
  return {
    ...createTsRequire(process.cwd(), modules)('./app/api/cangyuan/3d/route'),
    getSubmitted: () => submitted,
  };
}

function request(body) {
  return new Request('http://localhost:3210/api/cangyuan/3d', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'tripo-request-1' },
    body: JSON.stringify(body),
  });
}

test('3D route forwards documented Tripo text and image options to the worker', async () => {
  const route = createRoute();
  const textResponse = await route.POST(request({
    modelId: 'tripo-model-record', prompt: 'A wooden boat',
    options: { mode: 'text-to-3d', texture: 'HD', pbr: true },
  }));
  assert.equal(textResponse.status, 202);
  assert.deepEqual(route.getSubmitted(), {
    kind: '3d', modelId: 'tripo-model-record', idempotencyKey: 'tripo-request-1',
    input: { prompt: 'A wooden boat', mode: 'text-to-3d', texture: 'HD', pbr: true },
  });

  const imageResponse = await route.POST(request({
    modelId: 'tripo-model-record', prompt: 'A wooden boat',
    options: { mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png', texture: 'standard', pbr: false },
  }));
  assert.equal(imageResponse.status, 202);
  assert.equal(route.getSubmitted().input.imageUrl, 'https://cdn.example.test/boat.png');
});

test('3D route accepts an omitted optional prompt for Trellis image-only generation', async () => {
  const route = createRoute();
  const response = await route.POST(request({
    modelId: 'trellis-model-record',
    options: { imageUrl: 'https://cdn.example.test/object.png', textureSize: '3072' },
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(route.getSubmitted(), {
    kind: '3d', modelId: 'trellis-model-record', idempotencyKey: 'tripo-request-1',
    input: { prompt: '', imageUrl: 'https://cdn.example.test/object.png', textureSize: '3072' },
  });
});

test('3D route forwards Tripo multi-view inputs and model-specific options', async () => {
  const route = createRoute();
  const response = await route.POST(request({
    modelId: 'tripo3d-p1-model',
    options: {
      mode: 'multiview-to-3d',
      multiviewImages: {
        front: 'https://cdn.example.test/front.png',
        right: 'https://cdn.example.test/right.png',
      },
      faceLimit: 12_000,
    },
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(route.getSubmitted().input, {
    prompt: '',
    mode: 'multiview-to-3d',
    multiviewImages: {
      front: 'https://cdn.example.test/front.png',
      right: 'https://cdn.example.test/right.png',
    },
    faceLimit: 12_000,
  });
});

test('3D route rejects malformed options instead of silently dropping them', async () => {
  const route = createRoute();
  for (const body of [
    { modelId: 'tripo', prompt: 'Boat', options: [] },
    { modelId: 'tripo', prompt: 'Boat', options: { mode: 'image-to-3d', imageUrl: 42 } },
    { modelId: 'tripo', prompt: 'Boat', options: { pbr: 'false' } },
    { modelId: 'tripo', prompt: 'Boat', options: { texture: '' } },
    { modelId: 'tripo', prompt: 'Boat', options: { image: 'https://cdn.example.test/a.png' } },
    { modelId: 42, prompt: 'Boat', options: { mode: 'text-to-3d' } },
    { modelId: 'tripo', prompt: 42, options: { mode: 'text-to-3d' } },
  ]) {
    const response = await route.POST(request(body));
    assert.equal(response.status, 400);
  }
  assert.equal(route.getSubmitted(), undefined);
});
