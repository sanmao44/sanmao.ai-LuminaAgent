import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-model-bulk-'));
const previousDataDir = process.env.SANMAO_DATA_DIR;
process.env.SANMAO_DATA_DIR = root;
let persistedState;
const repository = {
  async read() { return persistedState ? structuredClone(persistedState) : null; },
  async write(state) { persistedState = structuredClone(state); },
};
const store = createTsRequire(process.cwd(), {
  './repositories/server-provider-repository': { providerStateRepository: repository },
})('./lib/store');
const modelLibrary = createTsRequire(process.cwd())('./apps/api/model-library-application');

test.after(async () => {
  if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previousDataDir;
  await rm(root, { recursive: true, force: true });
});

test('bulk model enable updates a batch atomically and skips duplicate IDs', async () => {
  const providerId = await store.addProvider({
    name: 'Test Provider', type: 'openai-compatible', platform: 'custom',
    baseUrl: 'https://models.example/v1', apiKey: 'test-key',
  });
  const models = await store.replaceProviderModels(providerId, 'Test Provider', [
    { id: 'chat-one', name: 'Chat One', capabilities: ['chat'] },
    { id: 'chat-two', name: 'Chat Two', capabilities: ['chat'] },
  ]);
  await store.setModelsEnabled([models[0].id, models[0].id, models[1].id], false);
  assert.equal(persistedState.models.filter((model) => model.enabled && model.published).length, 0);

  await store.setModelsEnabled(models.map((model) => model.id), true);
  assert.equal(persistedState.models.filter((model) => model.enabled && model.published).length, 2);
});

test('bulk model update rejects stale IDs without partially changing state', async () => {
  const before = structuredClone(persistedState.models);
  await assert.rejects(store.setModelsEnabled([before[0].id, 'missing-model'], false), /部分模型不存在/);
  assert.deepEqual(persistedState.models, before);
});

test('model library application deduplicates IDs and validates before mutation', async () => {
  const calls = [];
  const application = modelLibrary.createModelLibraryApplication({
    async setModelsEnabled(ids, enabled) {
      calls.push({ ids, enabled });
      return { updatedCount: ids.length };
    },
  });
  assert.deepEqual(await application.setBulkModelState({ ids: ['one', 'one', 'two'], enabled: true }), { updatedCount: 2 });
  assert.deepEqual(calls, [{ ids: ['one', 'two'], enabled: true }]);
  await assert.rejects(application.setBulkModelState({ ids: [' '], enabled: false }), /模型列表为空或包含无效项目/);
  assert.equal(calls.length, 1);
});
