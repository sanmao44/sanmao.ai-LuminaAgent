import { copyFile, mkdir, readFile, rename, rm, stat, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveLocalDataDir, resolveProviderConfigDir } from '../data-paths';
import { validateWorkspaceShape } from '../workspace-format';
import { createHash } from 'node:crypto';
import { isSqliteActive, openSqliteDatabase, readSqliteMarker, sqliteDatabasePath, SQLITE_DATABASE_FILE, SQLITE_MARKER_FILE, SQLITE_SCHEMA_VERSION, type SqliteDatabaseMarker } from './sqlite';

export type DatabaseMigrationOptions = {
  dataDir?: string;
  providerConfigDir?: string;
  failAfter?: 'stage' | 'validate' | 'before-commit';
  now?: () => string;
};

export type DatabaseMigrationResult = {
  migrationId: string;
  databasePath: string;
  rollbackPath: string;
  imported: Record<string, number>;
  legacyRoots: string[];
  activated: boolean;
};

type DatabaseMigrationJournal = {
  migrationId: string;
  phase: 'staging' | 'validated' | 'database-installing' | 'database-installed' | 'activated' | 'rolled-back';
  databasePath: string;
  rollbackPath: string;
  updatedAt: string;
};

const TASK_FILES = ['agent-progress.json', 'clone-jobs.json', 'upscale-tasks.json', 'video-tasks.json'];

async function readJson(file: string) {
  try { return JSON.parse(await readFile(file, 'utf8')) as unknown; } catch { return null; }
}

function sha256(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }

async function copyIfExists(source: string, target: string) {
  try { await stat(source); } catch { return false; }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return true;
}

async function writeMigrationJournal(file: string, journal: DatabaseMigrationJournal) {
  await writeFile(file, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', flush: true });
}

async function recoverDatabaseMigrations(dataDir: string) {
  const migrationsRoot = path.join(dataDir, 'migrations');
  for (const entry of await readdir(migrationsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const root = path.join(migrationsRoot, entry.name);
    const journalPath = path.join(root, 'journal.json');
    let journal: DatabaseMigrationJournal;
    try { journal = JSON.parse(await readFile(journalPath, 'utf8')) as DatabaseMigrationJournal; } catch { continue; }
    if ((journal.phase === 'database-installing' || journal.phase === 'database-installed') && !readSqliteMarker(dataDir)) {
      if (path.resolve(journal.databasePath) === path.resolve(sqliteDatabasePath(dataDir))) await rm(journal.databasePath, { force: true });
      await rm(root, { recursive: true, force: true });
    } else if (journal.phase === 'staging' || journal.phase === 'validated') {
      await rm(root, { recursive: true, force: true });
    }
  }
}

function asArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')) : []; }

export async function migrateLegacyStorageToSqlite(options: DatabaseMigrationOptions = {}): Promise<DatabaseMigrationResult> {
  const dataDir = path.resolve(options.dataDir || resolveLocalDataDir());
  const providerConfigDir = path.resolve(options.providerConfigDir || resolveProviderConfigDir());
  const now = options.now || (() => new Date().toISOString());
  await mkdir(dataDir, { recursive: true });
  await recoverDatabaseMigrations(dataDir);
  const active = readSqliteMarker(dataDir);
  if (active && !isSqliteActive(dataDir)) throw new Error('SQLite marker exists but database is missing or invalid; restore from rollback before retrying');
  if (active && isSqliteActive(dataDir)) {
    return { migrationId: active.migrationId, databasePath: active.databasePath, rollbackPath: active.rollbackPath, imported: {}, legacyRoots: active.legacyRoots, activated: true };
  }
  const migrationId = `db-${now().replace(/[^0-9A-Za-z]/g, '')}-${randomUUID().slice(0, 8)}`;
  const root = path.join(dataDir, 'migrations', migrationId);
  const staging = path.join(root, 'staging');
  const rollback = path.join(root, 'rollback');
  const journalPath = path.join(root, 'journal.json');
  const databasePath = path.join(staging, SQLITE_DATABASE_FILE);
  await mkdir(staging, { recursive: true });
  await mkdir(rollback, { recursive: true });
  await writeMigrationJournal(journalPath, { migrationId, phase: 'staging', databasePath: path.join(dataDir, SQLITE_DATABASE_FILE), rollbackPath: rollback, updatedAt: now() });
  const rollbackSources = [
    { source: path.join(dataDir, 'workspace.json'), relative: 'data/workspace.json' },
    { source: path.join(providerConfigDir, 'state.json'), relative: 'provider/state.json' },
    { source: path.join(dataDir, 'mcp', 'servers.json'), relative: 'data/mcp/servers.json' },
    ...TASK_FILES.map((file) => ({ source: path.join(dataDir, file), relative: `data/${file}` })),
  ];
  for (const item of rollbackSources) await copyIfExists(item.source, path.join(rollback, item.relative));
  const db = openSqliteDatabase(databasePath);
  const imported: Record<string, number> = {};
  const insert = db.prepare('INSERT INTO sanmao_records(domain, record_key, value, updated_at, sort_order) VALUES (?, ?, ?, ?, ?)');
  let order = 0;
  const put = (domain: string, key: string, value: unknown) => { insert.run(domain, key, JSON.stringify(value), now(), order++); imported[domain] = (imported[domain] || 0) + 1; };
  try {
    db.exec('BEGIN IMMEDIATE');
    const workspace = await readJson(path.join(dataDir, 'workspace.json'));
    if (workspace) { validateWorkspaceShape(workspace); put('workspace', 'primary', workspace); }
    const state = await readJson(path.join(providerConfigDir, 'state.json'));
    if (state) put('provider-config', 'primary', state);
    const mcp = await readJson(path.join(dataDir, 'mcp', 'servers.json'));
    if (mcp) put('mcp', 'primary', mcp);
    for (const file of TASK_FILES) {
      const tasks = asArray(await readJson(path.join(dataDir, file)));
      for (const task of tasks) put(`task:${file}`, String(task.id), task);
    }
    if (options.failAfter === 'stage') throw new Error('Injected database migration failure after staging');
    db.prepare("INSERT INTO sanmao_meta(key, value) VALUES ('schemaVersion', ?)").run(String(SQLITE_SCHEMA_VERSION));
    db.prepare("INSERT INTO sanmao_meta(key, value) VALUES ('canonical', ?)").run('sqlite');
    db.exec('COMMIT');
    await writeMigrationJournal(journalPath, { migrationId, phase: 'validated', databasePath: path.join(dataDir, SQLITE_DATABASE_FILE), rollbackPath: rollback, updatedAt: now() });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    db.close();
    throw error;
  }
  db.close();
  if (options.failAfter === 'validate' || options.failAfter === 'before-commit') throw new Error('Injected database migration failure before cutover');
  const activePath = path.join(dataDir, SQLITE_DATABASE_FILE);
  const marker: SqliteDatabaseMarker = { format: 'sanmao-sqlite-database', version: 1, schemaVersion: SQLITE_SCHEMA_VERSION, migrationId, activatedAt: now(), databasePath: activePath, rollbackPath: rollback, legacyRoots: [dataDir, providerConfigDir] };
  const tempActive = `${activePath}.${migrationId}.tmp`;
  await copyFile(databasePath, tempActive);
  await writeMigrationJournal(journalPath, { migrationId, phase: 'database-installing', databasePath: activePath, rollbackPath: rollback, updatedAt: now() });
  await rename(tempActive, activePath);
  await writeMigrationJournal(journalPath, { migrationId, phase: 'database-installed', databasePath: activePath, rollbackPath: rollback, updatedAt: now() });
  await writeFile(path.join(dataDir, SQLITE_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', flush: true });
  await writeMigrationJournal(journalPath, { migrationId, phase: 'activated', databasePath: activePath, rollbackPath: rollback, updatedAt: now() });
  // The marker is the cutover fence. Legacy JSON stays untouched as an
  // explicit rollback source; all new server writes route to SQLite.
  return { migrationId, databasePath: activePath, rollbackPath: rollback, imported, legacyRoots: [dataDir, providerConfigDir], activated: true };
}

export async function rollbackSqliteMigration(dataDir = resolveLocalDataDir()) {
  const marker = await readJson(path.join(dataDir, SQLITE_MARKER_FILE)) as SqliteDatabaseMarker | null;
  if (!marker || marker.format !== 'sanmao-sqlite-database') throw new Error('No active SQLite migration');
  const rollbackRoot = path.resolve(marker.rollbackPath);
  const restore = async (root: string, relative = '') => {
    const entries = await (await import('node:fs/promises')).readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) { await restore(root, child); continue; }
      if (!entry.isFile()) continue;
      const source = path.join(root, child);
      const targetRelative = child.startsWith(`data${path.sep}`) ? child.slice(`data${path.sep}`.length) : child.startsWith(`provider${path.sep}`) ? child.slice(`provider${path.sep}`.length) : child;
      const targetRoot = child.startsWith(`provider${path.sep}`) ? path.resolve(marker.legacyRoots[1] || dataDir) : path.resolve(marker.legacyRoots[0] || dataDir);
      const target = path.join(targetRoot, targetRelative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  };
  await restore(rollbackRoot);
  /*
   * The SQLite file is removed only after all rollback sources are restored.
   * This keeps a failed rollback recoverable from the marker and journal.
   */
  await rm(path.join(dataDir, SQLITE_DATABASE_FILE), { force: true });
  await rm(path.join(dataDir, SQLITE_MARKER_FILE), { force: true });
  const journalPath = path.join(path.dirname(rollbackRoot), 'journal.json');
  await writeMigrationJournal(journalPath, { migrationId: marker.migrationId, phase: 'rolled-back', databasePath: sqliteDatabasePath(dataDir), rollbackPath: rollbackRoot, updatedAt: new Date().toISOString() }).catch(() => undefined);
  return { migrationId: marker.migrationId, rolledBack: true };
}

