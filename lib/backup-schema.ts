import type { WorkspaceSnapshot } from './workspace-types';

export const CURRENT_BACKUP_SCHEMA_VERSION = 1;

export type CanonicalBackupClient = {
  workspace: WorkspaceSnapshot;
};

export type BackupManifestInput = Record<string, unknown>;

export function detectBackupSchemaVersion(input: BackupManifestInput) {
  const value = Number(input.schemaVersion);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizeV1(manifest: BackupManifestInput): BackupManifestInput {
  return {
    ...manifest,
    schemaVersion: 1,
    canonical: { workspace: 'client/client.json' },
  };
}

export function migrateBackupManifest(input: BackupManifestInput): BackupManifestInput {
  let current = normalizeV1(input);
  const version = detectBackupSchemaVersion(input);
  if (version > CURRENT_BACKUP_SCHEMA_VERSION) throw new Error('Unsupported backup schema version');
  // Keep future migrations here as v1 -> v2 -> current steps rather than in restore.
  return current;
}

export function validateCurrentBackupManifest(input: BackupManifestInput) {
  const manifest = migrateBackupManifest(input);
  if (manifest.schemaVersion !== CURRENT_BACKUP_SCHEMA_VERSION) throw new Error('Unsupported backup schema version');
  if (manifest.canonical && (manifest.canonical as { workspace?: unknown }).workspace !== 'client/client.json') throw new Error('Unsupported canonical workspace');
  return manifest;
}
