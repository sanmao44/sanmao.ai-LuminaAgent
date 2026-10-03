import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTsRequire } from './ts-require.mjs';

const migration = createTsRequire(process.cwd())('./lib/database/migration');
const sqlite = createTsRequire(process.cwd())('./lib/database/sqlite');
const execFileAsync = promisify(execFile);

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

test('database migration and rollback emit bounded observer events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-db-observer-'));
  const observer = new (createTsRequire(process.cwd())('./packages/contracts/observability').BufferedRuntimeObserver)();
  await writeFile(path.join(root, 'workspace.json'), JSON.stringify(workspace()));
  const result = await migration.migrateLegacyStorageToSqlite({ dataDir: root, providerConfigDir: root, observer });
  await migration.rollbackSqliteMigration(root, observer);
  const events = observer.snapshot().filter((event) => event.kind === 'database');
  assert.deepEqual(events.map((event) => event.phase), ['started', 'completed', 'started', 'completed']);
  assert.equal(events.some((event) => JSON.stringify(event).includes('workspace.json')), false);
  assert.ok(result.migrationId);
  await rm(root, { recursive: true, force: true });
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

test('database rollback refuses after a post-cutover write instead of losing new data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-db-rollback-window-'));
  await writeFile(path.join(root, 'workspace.json'), JSON.stringify(workspace()));
  const result = await migration.migrateLegacyStorageToSqlite({ dataDir: root, providerConfigDir: root, now: () => '2026-01-01T00:00:00.000Z' });
  sqlite.writeSqliteRecord('workspace', 'primary', { ...workspace(), clientId: 'after-cutover' }, root);
  await assert.rejects(() => migration.rollbackSqliteMigration(root), /普通 rollback 已拒绝/);
  assert.equal(sqlite.isSqliteActive(root), true);
  assert.equal(sqlite.readSqliteRecord('workspace', 'primary', root).clientId, 'after-cutover');
  assert.ok(result.restartRequired);
});

test('migration command drains runtime and reports restart-required cutover', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-db-command-'));
  await writeFile(path.join(root, 'workspace.json'), JSON.stringify(workspace()));
  try {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/migrate-database.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, SANMAO_DATA_DIR: root, SANMAO_PROVIDER_CONFIG_DIR: root },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.restartRequired, true);
    assert.equal(JSON.parse(await readFile(path.join(root, 'runtime-draining.json'), 'utf8')).operationId.startsWith('database-migration-'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

