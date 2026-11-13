import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-provider-transfer-'));
const previousDataDir = process.env.SANMAO_DATA_DIR;

function createContext(dataDir) {
  process.env.SANMAO_DATA_DIR = dataDir;
  let persistedState;
  const repository = {
    async read() {
      return persistedState ? structuredClone(persistedState) : null;
    },
    async write(value) {
      persistedState = structuredClone(value);
    },
    snapshot() {
      return persistedState ? structuredClone(persistedState) : null;
    },
  };
  const load = createTsRequire(process.cwd(), {
    './repositories/server-provider-repository': { providerStateRepository: repository },
  });
  return {
    app: load('./apps/api/provider-transfer-application'),
    repository,
    store: load('./lib/store'),
  };
}

const source = createContext(path.join(root, 'source'));
const target = createContext(path.join(root, 'target'));

test.after(async () => {
  if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previousDataDir;
  await rm(root, { recursive: true, force: true });
});

test('encrypted provider transfer moves provider keys and models while preserving target data', async () => {
  const sourceProviderId = await source.store.addProvider({
    name: 'Source Gateway',
    type: 'openai-compatible',
    platform: 'custom',
    baseUrl: 'https://source.example/v1',
    apiKey: 'source-api-secret',
    videoApiKey: 'source-video-secret',
    authHeader: 'X-API-Key',
    authPrefix: '',
  });
  const sourceModels = await source.store.replaceProviderModels(sourceProviderId, 'Source Gateway', [
    { id: 'chat-model', name: 'Source Chat', capabilities: ['chat'], contextWindow: 32768 },
  ]);
  await source.store.patchModel(sourceModels[0].id, { enabled: false, published: false });
  const sourceEncryptedKey = source.repository.snapshot().providers[0].encryptedApiKey;
  const password = 'provider-transfer-password';
  const file = await source.app.exportProviderTransfer(password);

  assert.equal(file.includes(Buffer.from('source-api-secret')), false);
  assert.equal(file.includes(Buffer.from('source-video-secret')), false);
  await assert.rejects(target.app.importProviderTransfer(file, 'wrong-password-12'), /密码错误或备份文件已被篡改/);
  assert.equal(target.repository.snapshot(), null);

  const localProviderId = await target.store.addProvider({
    name: 'Target Only',
    type: 'openai-compatible',
    platform: 'custom',
    baseUrl: 'https://target.example/v1',
    apiKey: 'target-api-secret',
  });
  const localModels = await target.store.replaceProviderModels(localProviderId, 'Target Only', [
    { id: 'local-model', name: 'Local Chat', capabilities: ['chat'] },
  ]);
  const localWebSearchKey = await target.store.encryptSecret('target-web-search-secret');
  const localUpscaleKey = await target.store.encryptSecret('target-upscale-secret');
  const localState = target.repository.snapshot();
  localState.settings.agentModelId = localModels[0].id;
  localState.settings.defaultProviderId = localProviderId;
  localState.webSearch = { provider: 'baidu-qianfan', encryptedApiKey: localWebSearchKey };
  localState.upscaleConnections = [{
    provider: 'tencent-ci',
    encryptedSecretId: await target.store.encryptSecret('secret-id'),
    encryptedSecretKey: localUpscaleKey,
    status: 'healthy',
    updatedAt: '2026-11-13T00:00:00.000Z',
  }];
  await target.repository.write(localState);

  const result = await target.app.importProviderTransfer(file, password);
  assert.deepEqual(result, { addedProviders: 1, updatedProviders: 0, importedModels: 1 });

  const importedProvider = await target.store.getProviderWithKey(sourceProviderId);
  assert.equal(importedProvider.apiKey, 'source-api-secret');
  assert.equal(importedProvider.videoApiKey, 'source-video-secret');
  assert.equal(importedProvider.authHeader, 'X-API-Key');
  assert.equal(importedProvider.authPrefix, '');
  assert.notEqual(target.repository.snapshot().providers.find((provider) => provider.id === sourceProviderId).encryptedApiKey, sourceEncryptedKey);
  assert.equal((await target.store.getProviderWithKey(localProviderId)).apiKey, 'target-api-secret');

  const merged = target.repository.snapshot();
  assert.equal(merged.providers.length, 2);
  assert.deepEqual(merged.settings, localState.settings);
  assert.deepEqual(merged.webSearch, localState.webSearch);
  assert.deepEqual(merged.upscaleConnections, localState.upscaleConnections);
  assert.deepEqual(merged.models.map((model) => model.rawId).sort(), ['chat-model', 'local-model']);
  const transferredModel = merged.models.find((model) => model.rawId === 'chat-model');
  assert.equal(transferredModel.enabled, false);
  assert.equal(transferredModel.published, false);

  const repeated = await target.app.importProviderTransfer(file, password);
  assert.deepEqual(repeated, { addedProviders: 0, updatedProviders: 1, importedModels: 1 });
  assert.equal(target.repository.snapshot().providers.length, 2);
  assert.equal(target.repository.snapshot().models.length, 2);
});
