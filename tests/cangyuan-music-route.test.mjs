import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function createRoute() {
  let submitted;
  const modules = {
    '@/apps/worker/cangyuan-creative-task': {
      createCangyuanCreativeGeneration: async (input) => {
        submitted = input;
        return { id: 'local-task', kind: 'music', status: 'pending' };
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
    ...createTsRequire(process.cwd(), modules)('./app/api/cangyuan/music/route'),
    getSubmitted: () => submitted,
  };
}

function request(body) {
  return new Request('http://localhost:3210/api/cangyuan/music', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'music-request-1' },
    body: JSON.stringify(body),
  });
}

test('music route parses and forwards the documented Suno v6 option fields', async () => {
  const route = createRoute();
  const options = {
    title: 'Night Drive', style_text: 'dream pop', instrumental: false, duration: 180, n: 1,
    audioWeight: 0.4, negativeTags: 'metal', personaId: 'persona-1', personaModel: 'future-compatible-model',
    styleWeight: 0.7, version: 'v6-wild', vocalGender: 'f', weirdnessConstraint: 0.2,
  };

  const response = await route.POST(request({ modelId: 'model-record', prompt: 'ambient synth', options }));

  assert.equal(response.status, 202);
  assert.deepEqual(route.getSubmitted(), {
    kind: 'music', modelId: 'model-record', idempotencyKey: 'music-request-1',
    input: { prompt: 'ambient synth', ...options },
  });
});

test('music route rejects unknown fields and invalid transport types before dispatch', async () => {
  const route = createRoute();
  const unknown = await route.POST(request({ modelId: 'model-record', prompt: 'song', options: { referenceImage: 'https://example.test/a.png' } }));
  assert.equal(unknown.status, 400);
  assert.equal(route.getSubmitted(), undefined);

  const wrongType = await route.POST(request({ modelId: 'model-record', prompt: 'song', options: { instrumental: 'yes' } }));
  assert.equal(wrongType.status, 400);
  assert.equal(route.getSubmitted(), undefined);

  const wrongPrompt = await route.POST(request({ modelId: 'model-record', prompt: 42 }));
  assert.equal(wrongPrompt.status, 400);
  assert.equal(route.getSubmitted(), undefined);
});

test('music route permits an omitted prompt for model-specific workflows', async () => {
  const route = createRoute();
  const response = await route.POST(request({ modelId: 'model-record', options: { uploadUrl: 'https://cdn.example.test/song.mp3' } }));
  assert.equal(response.status, 202);
  assert.deepEqual(route.getSubmitted().input, { uploadUrl: 'https://cdn.example.test/song.mp3' });
});
