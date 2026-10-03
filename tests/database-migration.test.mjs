import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const migration = createTsRequire(process.cwd())('./lib/database/migration');
const sqlite = createTsRequire(process.cwd())('./lib/database/sqlite');

function workspace() {
  return { schemaVersion: 1, updatedAt: 1, clientId: 'test', canvas: { projects: [], activeId: null, documents: {}, ui: {} }, gallery: [], chatSessions: [], assetIndex: [], assetCollections: [], preferences: {} };
}

test('database migration stages multiple roots and activates one authoritative sqlite store', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-db-migration-'));
  const provider = path.join(root, 'provider');
  await mkdir(provider, { recursive: true });
  await writeFile(path.join(root, 'workspace.json'), JSON.stringify(workspace()));
  await writeFile(path.join(root, 'agent-progress.json'), JSON.stringify([{ id: 'run-1', createdAt: 'now' }]));
  await writeFile(path.join(provider, 'state.json'), JSON.stringify({ schemaVersion: 3, providers: [], models: [], settings: {} }));
  const result = await migration.migrateLegacyStorageToSqlite({ dataDir: root, providerConfigDir: provider, now: () => '2026-01-01T00:00:00.000Z' });
  assert.equal(result.activated, true);
  assert.equal(sqlite.isSqliteActive(root), true);
  assert.equal(sqlite.readSqliteRecord('workspace', 'primary', root).clientId, 'test');
  assert.equal(sqlite.readSqliteRecord('task:agent-progress.json', 'run-1', root).id, 'run-1');
  await stat(path.join(result.rollbackPath, 'data', 'workspace.json'));
});

test('database migration failure before cutover does not activate sqlite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-db-failure-'));
  await writeFile(path.join(root, 'workspace.json'), JSON.stringify(workspace()));
  await assert.rejects(() => migration.migrateLegacyStorageToSqlite({ dataDir: root, providerConfigDir: root, failAfter: 'before-commit' }));
  assert.equal(sqlite.isSqliteActive(root), false);
  assert.equal(JSON.parse(await readFile(path.join(root, 'workspace.json'), 'utf8')).clientId, 'test');
});

test('database rollback restores legacy roots and leaves an auditable journal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-db-rollback-'));
  const provider = path.join(root, 'provider');
  await mkdir(provider, { recursive: true });
  await writeFile(path.join(root, 'workspace.json'), JSON.stringify(workspace()));
  await writeFile(path.join(provider, 'state.json'), JSON.stringify({ schemaVersion: 3, providers: [], models: [], settings: {} }));
  const result = await migration.migrateLegacyStorageToSqlite({ dataDir: root, providerConfigDir: provider, now: () => '2026-01-01T00:00:00.000Z' });
  const journal = JSON.parse(await readFile(path.join(root, 'migrations', result.migrationId, 'journal.json'), 'utf8'));
  assert.equal(journal.phase, 'activated');
  await migration.rollbackSqliteMigration(root);
  assert.equal(sqlite.isSqliteActive(root), false);
  assert.equal(JSON.parse(await readFile(path.join(root, 'workspace.json'), 'utf8')).clientId, 'test');
  assert.equal(JSON.parse(await readFile(path.join(provider, 'state.json'), 'utf8')).schemaVersion, 3);
  const rollbackJournal = JSON.parse(await readFile(path.join(root, 'migrations', result.migrationId, 'journal.json'), 'utf8'));
  assert.equal(rollbackJournal.phase, 'rolled-back');
});

