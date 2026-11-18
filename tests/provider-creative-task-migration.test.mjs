import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-provider-creative-migration-'));
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

test('legacy generic connections to the official creative task API keep working', async () => {
  await repository.write({
    schemaVersion: 3,
    providers: [{
      id: 'legacy-custom-cangyuan',
      name: 'Legacy direct connection',
      type: 'openai-compatible',
      platform: 'custom',
      modelLibraryEnabled: true,
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1',
      encryptedApiKey: '',
      status: 'idle',
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    models: [],
    settings: {},
    upscaleConnections: [],
  });

  const state = await store.getPublicState();
  assert.equal(state.providers[0].creativeTaskProtocol, 'cangyuan-creative-v1');
  assert.equal(persistedState.providers[0].creativeTaskProtocol, 'cangyuan-creative-v1');
});
