import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '../data-paths';

export const SQLITE_SCHEMA_VERSION = 1;
export const SQLITE_DATABASE_FILE = 'sanmao.sqlite';
export const SQLITE_MARKER_FILE = 'database.json';

export type SqliteDatabaseMarker = {
  format: 'sanmao-sqlite-database';
  version: 1;
  schemaVersion: number;
  migrationId: string;
  activatedAt: string;
  databasePath: string;
  rollbackPath: string;
  legacyRoots: string[];
};

export function sqliteDatabasePath(dataDir = resolveLocalDataDir()) {
  return path.join(dataDir, SQLITE_DATABASE_FILE);
}

export function sqliteMarkerPath(dataDir = resolveLocalDataDir()) {
  return path.join(dataDir, SQLITE_MARKER_FILE);
}

export function openSqliteDatabase(file: string) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sanmao_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sanmao_records (
      domain TEXT NOT NULL,
      record_key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (domain, record_key)
    );
    CREATE TABLE IF NOT EXISTS sanmao_media_files (
      root_kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      PRIMARY KEY (root_kind, relative_path)
    );
  `);
  return db;
}

export function isSqliteActive(dataDir = resolveLocalDataDir()) {
  try {
    const marker = JSON.parse(readFileSync(sqliteMarkerPath(dataDir), 'utf8')) as Partial<SqliteDatabaseMarker>;
    return marker.format === 'sanmao-sqlite-database'
      && marker.version === 1
      && marker.schemaVersion === SQLITE_SCHEMA_VERSION
      && typeof marker.migrationId === 'string'
      && existsSync(sqliteDatabasePath(dataDir));
  } catch {
    return false;
  }
}

export function readSqliteMarker(dataDir = resolveLocalDataDir()): SqliteDatabaseMarker | null {
  try {
    const marker = JSON.parse(readFileSync(sqliteMarkerPath(dataDir), 'utf8')) as SqliteDatabaseMarker;
    if (marker.format !== 'sanmao-sqlite-database' || marker.version !== 1) return null;
    return marker;
  } catch {
    return null;
  }
}

export async function ensureSqliteDirectory(dataDir = resolveLocalDataDir()) {
  await mkdir(dataDir, { recursive: true });
  return dataDir;
}

export function withSqliteDatabase<T>(fn: (db: DatabaseSync) => T, dataDir = resolveLocalDataDir()) {
  const db = openSqliteDatabase(sqliteDatabasePath(dataDir));
  try { return fn(db); } finally { db.close(); }
}

export function readSqliteRecord<T>(domain: string, key: string, dataDir = resolveLocalDataDir()): T | null {
  if (!isSqliteActive(dataDir)) return null;
  return withSqliteDatabase((db) => {
    const row = db.prepare('SELECT value FROM sanmao_records WHERE domain = ? AND record_key = ?').get(domain, key) as { value?: string } | undefined;
    if (!row?.value) return null;
    return JSON.parse(row.value) as T;
  }, dataDir);
}

export function writeSqliteRecord<T>(domain: string, key: string, value: T, dataDir = resolveLocalDataDir()) {
  if (!isSqliteActive(dataDir)) throw new Error('SQLite database is not active');
  withSqliteDatabase((db) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare('SELECT sort_order FROM sanmao_records WHERE domain = ? AND record_key = ?').get(domain, key) as { sort_order?: number } | undefined;
      const order = current?.sort_order ?? Number((db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM sanmao_records WHERE domain = ?').get(domain) as { next?: number }).next || 1);
      db.prepare(`INSERT INTO sanmao_records(domain, record_key, value, updated_at, sort_order)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(domain, record_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(domain, key, JSON.stringify(value), new Date().toISOString(), order);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }, dataDir);
}

export function listSqliteRecords<T>(domain: string, dataDir = resolveLocalDataDir()): Array<{ key: string; value: T }> {
  if (!isSqliteActive(dataDir)) return [];
  return withSqliteDatabase((db) => (db.prepare('SELECT record_key as key, value FROM sanmao_records WHERE domain = ? ORDER BY sort_order DESC').all(domain) as Array<{ key: string; value: string }>).map((row) => ({ key: row.key, value: JSON.parse(row.value) as T })), dataDir);
}

export function deleteSqliteRecord(domain: string, key: string, dataDir = resolveLocalDataDir()) {
  if (!isSqliteActive(dataDir)) return;
  withSqliteDatabase((db) => { db.prepare('DELETE FROM sanmao_records WHERE domain = ? AND record_key = ?').run(domain, key); }, dataDir);
}

/** Replace one domain inside a prepared database image. This is used by
 * staged backup restore; callers atomically swap the image only after every
 * domain has validated. */
export function replaceSqliteDomain<T>(db: DatabaseSync, domain: string, records: Array<{ key: string; value: T }>) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM sanmao_records WHERE domain = ?').run(domain);
    const insert = db.prepare(`INSERT INTO sanmao_records(domain, record_key, value, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    records.forEach((record, index) => insert.run(domain, record.key, JSON.stringify(record.value), now, index));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

