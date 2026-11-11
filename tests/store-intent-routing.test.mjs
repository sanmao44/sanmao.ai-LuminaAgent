import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-store-intent-routing-'));
const previousDataDir = process.env.SANMAO_DATA_DIR;
process.env.SANMAO_DATA_DIR = dataDir;

let persistedState;
const repository = {
  async read() {
    return persistedState ? structuredClone(persistedState) : null;
  },
  async write(value) {
    persistedState = structuredClone(value);
  },
};

const load = createTsRequire(process.cwd(), {
  './repositories/server-provider-repository': { providerStateRepository: repository },
});
const store = load('./lib/store');

test.after(async () => {
  if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

function model(id, rawId) {
  return {
    id,
    providerId: 'provider-1',
    providerName: 'Test Provider',
    rawId,
    displayName: rawId,
    kind: 'chat',
    enabled: true,
    published: true,
    capabilities: ['chat'],
  };
}

async function seedState(settings = {}) {
  persistedState = {
    schemaVersion: 3,
    providers: [{
      id: 'provider-1',
      name: 'Test Provider',
      type: 'openai-compatible',
      platform: 'custom',
      modelLibraryEnabled: true,
      baseUrl: 'https://provider.example/v1',
      encryptedApiKey: await store.encryptSecret('test-key'),
      status: 'healthy',
    }],
    models: [
      model('jev-legacy', 'provider/jev-1.13'),
      model('jev-current', 'provider/jev-1.14'),
      model('chat-default', 'gpt-5.6-sol'),
    ],
    settings: {
      agentModelId: 'chat-default',
      intentClassifierModelId: 'jev-current',
      defaultImageModelId: null,
      defaultVideoModelId: null,
      defaultProviderId: 'provider-1',
      imageStoragePath: '',
      videoStoragePath: '',
      ...settings,
    },
    upscaleConnections: [],
  };
}

test('JEV 1.13 is excluded from explicit and automatic Agent chat candidates', async () => {
  await seedState({ agentModelId: 'jev-legacy' });

  const explicit = await store.getRuntimeModelCandidates('jev-legacy', 'chat');
  const automatic = await store.getRuntimeModelCandidates('auto', 'chat');

  assert.deepEqual(explicit.map(({ model: candidate }) => candidate.id), ['chat-default']);
  assert.deepEqual(automatic.map(({ model: candidate }) => candidate.id), ['chat-default']);
  assert.ok([...explicit, ...automatic].every(({ model: candidate }) => !/^jev-1\.(?:13|14)$/.test(candidate.rawId.split('/').at(-1))));
});

test('JEV 1.14 remains available only through the dedicated intent-classifier resolver', async () => {
  await seedState();

  const chatCandidates = await store.getRuntimeModelCandidates('auto', 'chat');
  const classifier = await store.getRuntimeIntentClassifierModel();

  assert.deepEqual(chatCandidates.map(({ model: candidate }) => candidate.id), ['chat-default']);
  assert.equal(classifier?.model.id, 'jev-current');
  assert.equal(classifier?.model.rawId, 'provider/jev-1.14');
});

test('Agent defaults reject JEV and persisted JEV routing settings are migrated', async () => {
  await seedState({ agentModelId: 'jev-legacy', intentClassifierModelId: 'jev-legacy' });

  await assert.rejects(store.patchSettings({ agentModelId: 'jev-legacy' }), /对话模型/);

  const classifier = await store.getRuntimeIntentClassifierModel();
  assert.equal(persistedState.settings.agentModelId, null);
  assert.equal(persistedState.settings.intentClassifierModelId, null);
  assert.equal(classifier?.model.id, 'jev-current');
});
