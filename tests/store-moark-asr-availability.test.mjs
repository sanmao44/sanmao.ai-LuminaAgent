import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-store-moark-asr-'));
const previousDataDir = process.env.SANMAO_DATA_DIR;
process.env.SANMAO_DATA_DIR = dataDir;

let persistedState;
const repository = {
  async read() { return persistedState ? structuredClone(persistedState) : null; },
  async write(state) { persistedState = structuredClone(state); },
};
const store = createTsRequire(process.cwd(), {
  './repositories/server-provider-repository': { providerStateRepository: repository },
})('./lib/store');

test.after(async () => {
  if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

async function seedMoarkProvider(modelLibraryEnabled) {
  persistedState = {
    schemaVersion: 3,
    providers: [{
      id: 'moark',
      name: '模力方舟',
      type: 'openai-compatible',
      platform: 'gitee',
      modelLibraryEnabled,
      baseUrl: 'https://api.moark.com/v1',
      encryptedApiKey: await store.encryptSecret('test-key'),
      status: 'healthy',
    }],
    models: [],
    settings: {},
    upscaleConnections: [],
  };
}

test('Moark ASR respects the provider model-library enabled state', async () => {
  await seedMoarkProvider(false);
  assert.equal(await store.getRuntimeMoarkAudioProvider(), null);

  await seedMoarkProvider(true);
  const runtimeProvider = await store.getRuntimeMoarkAudioProvider();
  assert.equal(runtimeProvider?.apiKey, 'test-key');
});
