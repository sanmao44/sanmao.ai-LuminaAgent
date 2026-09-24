import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DataProfile, DataProfileMode } from './data-paths';

export const DATA_MANIFEST_FORMAT = 'sanmao-local-data';
export const DATA_MANIFEST_VERSION = 1;
export const DATA_MANIFEST_FILE = 'manifest.json';

export type DataComponentVersions = Record<string, string | number>;

export const CURRENT_DATA_COMPONENT_VERSIONS: DataComponentVersions = {
  workspace: 1,
  indexedDb: 4,
  canvas: 'sanmao-canvas-3',
  providerConfig: 3,
  mediaRoots: 1,
  backupArchive: 2,
  autoSnapshot: 1,
};

export type DataManifest = {
  format: typeof DATA_MANIFEST_FORMAT;
  manifestVersion: typeof DATA_MANIFEST_VERSION;
  profileMode: DataProfileMode;
  components: DataComponentVersions;
  activeGeneration: string;
  lastMigrationId?: string;
  updatedAt: string;
};

const EMPTY_DATA_COMPONENT_VERSIONS: DataComponentVersions = {
  workspace: 0,
  indexedDb: 0,
  canvas: 'legacy',
  providerConfig: 0,
  mediaRoots: 0,
  backupArchive: 0,
  autoSnapshot: 0,
};

export function dataManifestPath(dataDir: string) {
  return path.join(dataDir, DATA_MANIFEST_FILE);
}

export function initialDataManifest(
  profileMode: DataProfileMode,
  now = new Date().toISOString(),
  components: DataComponentVersions = EMPTY_DATA_COMPONENT_VERSIONS,
): DataManifest {
  return {
    format: DATA_MANIFEST_FORMAT,
    manifestVersion: DATA_MANIFEST_VERSION,
    profileMode,
    components: { ...components },
    activeGeneration: 'legacy',
    updatedAt: now,
  };
}

async function readOptionalJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Detects versions already present on disk. This is deliberately a light
 * probe: it records each subsystem's native version instead of migrating it
 * or copying any media. Browser-only versions remain the current contract
 * until the browser sends a workspace snapshot through /api/workspace.
 */
export async function detectDataComponentVersions(profile: Pick<DataProfile, 'dataDir' | 'providerConfigDir'>) {
  const defaults = { ...EMPTY_DATA_COMPONENT_VERSIONS };
  const workspace = await readOptionalJson(path.join(profile.dataDir, 'workspace.json'));
  const provider = await readOptionalJson(path.join(profile.providerConfigDir, 'state.json'));
  const mediaRoots = await readOptionalJson(path.join(profile.dataDir, 'media-roots.json'));
  return {
    ...defaults,
    ...(workspace ? { workspace: typeof workspace.schemaVersion === 'number' ? workspace.schemaVersion : 0 } : { workspace: CURRENT_DATA_COMPONENT_VERSIONS.workspace }),
    ...(provider ? { providerConfig: typeof provider.schemaVersion === 'number' ? provider.schemaVersion : 0 } : { providerConfig: CURRENT_DATA_COMPONENT_VERSIONS.providerConfig }),
    ...(mediaRoots ? { mediaRoots: typeof mediaRoots.version === 'number' ? mediaRoots.version : 0 } : { mediaRoots: CURRENT_DATA_COMPONENT_VERSIONS.mediaRoots }),
    indexedDb: CURRENT_DATA_COMPONENT_VERSIONS.indexedDb,
    canvas: CURRENT_DATA_COMPONENT_VERSIONS.canvas,
    backupArchive: CURRENT_DATA_COMPONENT_VERSIONS.backupArchive,
    autoSnapshot: CURRENT_DATA_COMPONENT_VERSIONS.autoSnapshot,
  } satisfies DataComponentVersions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function validateDataManifest(value: unknown): DataManifest {
  if (!isRecord(value)
    || value.format !== DATA_MANIFEST_FORMAT
    || value.manifestVersion !== DATA_MANIFEST_VERSION
    || typeof value.profileMode !== 'string'
    || !isRecord(value.components)
    || typeof value.activeGeneration !== 'string'
    || typeof value.updatedAt !== 'string') {
    throw new Error('本地数据 manifest 格式不受支持');
  }
  const components: DataComponentVersions = {};
  for (const [key, version] of Object.entries(value.components)) {
    if ((typeof version !== 'string' && typeof version !== 'number') || !key.trim()) throw new Error('本地数据 manifest 组件版本无效');
    components[key] = version;
  }
  return {
    format: DATA_MANIFEST_FORMAT,
    manifestVersion: DATA_MANIFEST_VERSION,
    profileMode: value.profileMode as DataProfileMode,
    components,
    activeGeneration: value.activeGeneration,
    ...(typeof value.lastMigrationId === 'string' ? { lastMigrationId: value.lastMigrationId } : {}),
    updatedAt: value.updatedAt,
  };
}

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flush: true });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readDataManifest(dataDir: string) {
  try {
    return validateDataManifest(JSON.parse(await readFile(dataManifestPath(dataDir), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeDataManifest(profile: Pick<DataProfile, 'dataDir'>, manifest: DataManifest) {
  const validated = validateDataManifest(manifest);
  await writeJsonAtomic(dataManifestPath(profile.dataDir), validated);
  return validated;
}

export async function ensureDataManifest(profile: Pick<DataProfile, 'dataDir' | 'mode' | 'providerConfigDir'>, now = new Date().toISOString()) {
  const existing = await readDataManifest(profile.dataDir);
  if (existing) return existing;
  const components = await detectDataComponentVersions(profile);
  return writeDataManifest(profile, initialDataManifest(profile.mode, now, components));
}
