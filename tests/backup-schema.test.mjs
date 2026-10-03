import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const schema = createTsRequire(process.cwd())('./lib/backup-schema');

test('backup schema normalizes legacy manifests into the current canonical boundary', () => {
  const manifest = schema.validateCurrentBackupManifest({ format: 'sanmao-ai-local-backup-archive', version: 2 });
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.canonical, { workspace: 'client/client.json' });
});

test('backup schema rejects future versions before restore', () => {
  assert.throws(() => schema.validateCurrentBackupManifest({ schemaVersion: 99 }), /Unsupported backup schema version/);
});

test('backup schema migration remains a versioned pipeline boundary', () => {
  const migrated = schema.migrateBackupManifest({ schemaVersion: 1, canonical: { workspace: 'legacy.json' } });
  assert.equal(migrated.schemaVersion, schema.CURRENT_BACKUP_SCHEMA_VERSION);
  assert.deepEqual(migrated.canonical, { workspace: 'client/client.json' });
  assert.equal(schema.detectBackupSchemaVersion({}), 1);
});
