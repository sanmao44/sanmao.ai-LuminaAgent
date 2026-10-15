import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLocalDataDir } from '../data-paths';
import { validateWorkspaceShape } from '../workspace-format';
import { WORKSPACE_TEMP_PATTERN, sweepStaleWorkspaceTemps } from '../workspace-temps';
import { createSqliteAuthorityFence, isSqliteActive, readSqliteRecord, writeSqliteRecord } from '../database/sqlite';
import type { WorkspaceSnapshot } from '../workspace-types';
import type { ServerWorkspaceRepository } from '@/packages/contracts/storage';

export type StoredWorkspaceSnapshot = WorkspaceSnapshot & { revision?: number };

const paths = (dataDir = resolveLocalDataDir()) => ({
  dataDir,
  workspace: path.join(dataDir, 'workspace.json'),
  metadata: path.join(dataDir, 'workspace-meta.json'),
});
const assertStoreStable = createSqliteAuthorityFence();

type WorkspaceMetadata = { updatedAt: number; revision: number };

type LegacyMetadataCache = {
  dataDir: string;
  workspaceMtimeMs: number;
  metadataMtimeMs: number;
  value: WorkspaceMetadata | null;
};

let legacyMetadataCache: LegacyMetadataCache | null = null;

function parse(raw: string) {
  if (!raw.trim()) return null;
  return validateWorkspaceShape(JSON.parse(raw)) as unknown as StoredWorkspaceSnapshot;
}

async function recover(dataDir: string) {
  const root = paths(dataDir);
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  const candidates = (await Promise.all(entries
    .filter((entry) => entry.isFile() && WORKSPACE_TEMP_PATTERN.test(entry.name))
    .map(async (entry) => {
      const file = path.join(dataDir, entry.name);
      try { return { file, mtimeMs: (await stat(file)).mtimeMs }; } catch { return null; }
    })))
    .filter((candidate): candidate is { file: string; mtimeMs: number } => Boolean(candidate))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 32);
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate.file, 'utf8');
      const workspace = parse(raw);
      if (!workspace) continue;
      await writeLegacy(root, raw);
      return workspace;
    } catch {}
  }
  return null;
}

async function writeLegacy(root: ReturnType<typeof paths>, content: string) {
  await mkdir(root.dataDir, { recursive: true });
  const temporary = `${root.workspace}.${Date.now()}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flush: true });
    const workspace = parse(await readFile(temporary, 'utf8'));
    if (!workspace) throw new Error('Workspace snapshot is empty');
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, root.workspace); break; }
      catch (error) { if (attempt >= 2) throw error; await new Promise((resolve) => setTimeout(resolve, 150)); }
    }
    await writeFile(root.metadata, JSON.stringify({
      updatedAt: Number(workspace.updatedAt) || 0,
      revision: Number(workspace.revision) || 0,
    }), { encoding: 'utf8', flush: true }).catch(() => undefined);
    legacyMetadataCache = null;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await sweepStaleWorkspaceTemps(root.dataDir).catch(() => 0);
}

async function readLegacyMetadata(root: ReturnType<typeof paths>): Promise<WorkspaceMetadata | null> {
  const workspaceInfo = await stat(root.workspace).catch(() => null);
  const metadataInfo = await stat(root.metadata).catch(() => null);
  if (!workspaceInfo) {
    legacyMetadataCache = null;
    return null;
  }
  if (legacyMetadataCache
    && legacyMetadataCache.dataDir === root.dataDir
    && legacyMetadataCache.workspaceMtimeMs === workspaceInfo.mtimeMs
    && legacyMetadataCache.metadataMtimeMs === (metadataInfo?.mtimeMs || 0)) {
    return legacyMetadataCache.value;
  }

  const workspace = parse(await readFile(root.workspace, 'utf8'));
  const value = workspace
    ? { updatedAt: Number(workspace.updatedAt) || 0, revision: Number(workspace.revision) || 0 }
    : null;
  const stored = await readFile(root.metadata, 'utf8')
    .then((raw) => JSON.parse(raw) as Partial<WorkspaceMetadata>)
    .then((metadata) => ({ updatedAt: Number(metadata.updatedAt) || 0, revision: Number(metadata.revision) || 0 }))
    .catch(() => null);
  if (value && (stored?.updatedAt !== value.updatedAt || stored?.revision !== value.revision)) {
    await writeFile(root.metadata, JSON.stringify(value), { encoding: 'utf8', flush: true }).catch(() => undefined);
  }
  const repairedMetadataInfo = await stat(root.metadata).catch(() => null);
  legacyMetadataCache = {
    dataDir: root.dataDir,
    workspaceMtimeMs: workspaceInfo.mtimeMs,
    metadataMtimeMs: repairedMetadataInfo?.mtimeMs || 0,
    value,
  };
  return value || stored;
}

export const serverWorkspaceRepository: ServerWorkspaceRepository<StoredWorkspaceSnapshot> = {
  async read() {
    const root = paths();
    assertStoreStable();
    if (isSqliteActive(root.dataDir)) return readAuthoritativeWorkspace(root.dataDir);
    try { return parse(await readFile(root.workspace, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      const recovered = await recover(root.dataDir);
      if (recovered) return recovered;
      throw error;
    }
  },
  async metadata() {
    const root = paths();
    assertStoreStable();
    if (isSqliteActive(root.dataDir)) {
      const workspace = readAuthoritativeWorkspace(root.dataDir);
      return workspace ? { updatedAt: Number(workspace.updatedAt) || 0, revision: Number(workspace.revision) || 0 } : null;
    }
    return readLegacyMetadata(root);
  },
  async write(value) {
    const root = paths();
    assertStoreStable();
    const workspace = validateWorkspaceShape(value) as unknown as StoredWorkspaceSnapshot;
    if (isSqliteActive(root.dataDir)) { writeAuthoritativeWorkspace(root.dataDir, workspace); return; }
    await writeLegacy(root, `${JSON.stringify(workspace, null, 2)}\n`);
  },
};

/** Server persistence boundary for the workspace API. */
export function readAuthoritativeWorkspace(dataDir: string) {
  return isSqliteActive(dataDir)
    ? readSqliteRecord<StoredWorkspaceSnapshot>('workspace', 'primary', dataDir)
    : null;
}

export function writeAuthoritativeWorkspace(dataDir: string, workspace: StoredWorkspaceSnapshot) {
  if (!isSqliteActive(dataDir)) return false;
  writeSqliteRecord('workspace', 'primary', workspace, dataDir);
  return true;
}
