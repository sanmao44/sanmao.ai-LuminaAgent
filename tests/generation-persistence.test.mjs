import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createTsRequire } from './ts-require.mjs';

test('keeps provider image results deliverable when local persistence throws', async () => {
  const root = process.cwd();
  const generationLogPath = path.resolve(root, 'lib/generation-log');
  const imageStoragePath = path.resolve(root, 'lib/image-storage');
  const logs = [];
  const load = createTsRequire(root, {
    [generationLogPath]: {
      appendGenerationLog: async (log) => logs.push(log),
      finishGenerationLog: async (_id, patch) => logs.push(patch),
    },
    [imageStoragePath]: {
      persistGeneratedImages: async () => { throw new Error('磁盘不可写'); },
    },
  });
  const persistence = load('./lib/generation-persistence');
  const providerUrl = 'https://provider.example/result.png?signature=temporary';
  const result = await persistence.persistGenerationResult({
    images: [{ url: providerUrl }],
    startedAt: 100,
    providerFinishedAt: 200,
    log: { mode: 'generate', taskKind: 'media', prompt: 'test' },
  });

  assert.deepEqual(result.images, [{ url: providerUrl }]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'success');
  assert.deepEqual(logs[0].imageUrls, [providerUrl]);
  assert.match(logs[0].storageError, /磁盘不可写/);
});
