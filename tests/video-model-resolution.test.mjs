import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-model-resolution-'));
const previousDataDir = process.env.SANMAO_DATA_DIR;
process.env.SANMAO_DATA_DIR = dataDir;

let persistedState;
const repository = {
  async read() { return persistedState ? structuredClone(persistedState) : null; },
  async write(value) { persistedState = structuredClone(value); },
};
const store = createTsRequire(process.cwd(), {
  './repositories/server-provider-repository': { providerStateRepository: repository },
})('./lib/store');

test.after(async () => {
  if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

test('explicit video model selection never falls back to another provider', async () => {
  const cangyuanProvider = {
    id: 'cangyuan-provider', name: 'Cangyuan', type: 'openai-compatible', platform: 'cangyuan',
    baseUrl: 'https://api.cangyuan.example/v1', modelLibraryEnabled: true,
    encryptedApiKey: await store.encryptSecret('cangyuan-key'), status: 'healthy',
  };
  const fallbackProvider = {
    id: 'fallback-provider', name: 'Fallback', type: 'openai-compatible', platform: 'custom',
    baseUrl: 'https://openai-compatible.example/v1', modelLibraryEnabled: true,
    encryptedApiKey: await store.encryptSecret('fallback-key'), status: 'healthy',
  };
  persistedState = {
    schemaVersion: 3,
    providers: [cangyuanProvider, fallbackProvider],
    models: [
      {
        id: 'selected-cangyuan-video', providerId: cangyuanProvider.id, providerName: cangyuanProvider.name,
        rawId: 'mu1-muse-video-20s', displayName: 'Muse Video 20s', kind: 'video',
        capabilities: ['video-generate', 'video-first-frame'], enabled: true, published: true,
      },
      {
        id: 'default-openai-video', providerId: fallbackProvider.id, providerName: fallbackProvider.name,
        rawId: 'sora-video', displayName: 'Sora Video', kind: 'video',
        capabilities: ['video-generate'], enabled: true, published: true,
      },
    ],
    settings: { defaultVideoModelId: 'default-openai-video', defaultProviderId: fallbackProvider.id },
    upscaleConnections: [],
  };

  const selected = await store.getRuntimeVideoModel('selected-cangyuan-video');
  assert.equal(selected?.model.id, 'selected-cangyuan-video');
  assert.equal(selected?.provider.id, cangyuanProvider.id);

  const automatic = await store.getRuntimeVideoModel('auto');
  assert.equal(automatic?.model.id, 'default-openai-video');

  assert.equal(await store.getRuntimeVideoModel('deleted-cangyuan-model'), null);
  persistedState.models[0].enabled = false;
  assert.equal(await store.getRuntimeVideoModel('selected-cangyuan-video'), null);
});
