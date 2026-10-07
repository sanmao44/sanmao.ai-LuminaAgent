import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-task-sqlite-atomic-'));
process.env.SANMAO_DATA_DIR = dataDir;
const load = createTsRequire(process.cwd());
const migration = load('./lib/database/migration');
const sqlite = load('./lib/database/sqlite');
const { createTaskRepository } = load('./lib/repositories/task-repository');
const workspace = { schemaVersion: 1, updatedAt: 1, clientId: 'test', canvas: { projects: [], activeId: null, documents: {}, ui: {} }, gallery: [], chatSessions: [], assetIndex: [], assetCollections: [], preferences: {} };
await writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
await migration.migrateLegacyStorageToSqlite({ dataDir, providerConfigDir: dataDir });

test.after(() => rm(dataDir, { recursive: true, force: true }));

test('SQLite task mutation rolls back every task when a later record cannot be serialized', async () => {
  const repo = createTaskRepository({ fileName: 'atomic.json' });
  await repo.insert({ id: 'a', createdAt: new Date().toISOString() });
  await assert.rejects(() => repo.mutate((tasks) => {
    tasks.push({ id: 'b', createdAt: new Date().toISOString() });
    tasks.push({ id: 'c', createdAt: new Date().toISOString(), circular: tasks });
    return 'should fail';
  }));
  assert.deepEqual((await repo.list(10)).map((task) => task.id), ['a']);
  assert.equal(sqlite.readSqliteRecord('task:atomic.json', 'b', dataDir), null);
});
