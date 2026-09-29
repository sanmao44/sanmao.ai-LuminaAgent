import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-storage-boundary-'));
process.env.SANMAO_DATA_DIR = dataDir;
const repositoryModule = createTsRequire(process.cwd())('./lib/repositories/task-repository');
test.after(() => rm(dataDir, { recursive: true, force: true }));

test('TaskRepository adapter preserves JSON task behavior and idempotency', async () => {
  const repository = repositoryModule.createTaskRepository({ fileName: 'boundary-tasks.json' });
  const task = { id: 'task-1', createdAt: new Date().toISOString(), idempotencyKey: 'same-key', payload: 'first' };

  const created = await repository.insert(task);
  assert.equal(created.created, true);
  assert.deepEqual(created.task, task);

  const duplicate = await repository.insert({ ...task, id: 'task-2', payload: 'duplicate' });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.task.id, task.id);

  const updated = await repository.update(task.id, { payload: 'updated' });
  assert.equal(updated.payload, 'updated');
  assert.equal((await repository.findByIdempotencyKey('same-key')).payload, 'updated');

  const stored = JSON.parse(await readFile(path.join(dataDir, 'boundary-tasks.json'), 'utf8'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].payload, 'updated');

  assert.equal((await repository.remove(task.id)).id, task.id);
  assert.equal(await repository.find(task.id), null);
});
