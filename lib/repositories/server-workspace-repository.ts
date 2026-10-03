import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLocalDataDir } from '../data-paths';
import { validateWorkspaceShape } from '../workspace-format';
import { WORKSPACE_TEMP_PATTERN, sweepStaleWorkspaceTemps } from '../workspace-temps';
import { isSqliteActive, readSqliteRecord, writeSqliteRecord } from '../database/sqlite';
import type { WorkspaceSnapshot } from '../workspace-types';
import type { ServerWorkspaceRepository } from '@/packages/contracts/storage';

export type StoredWorkspaceSnapshot = WorkspaceSnapshot & { revision?: number };

const paths = (dataDir = resolveLocalDataDir()) => ({
  dataDir,
  workspace: path.join(dataDir, 'workspace.json'),
  metadata: path.join(dataDir, 'workspace-meta.json'),
});

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
    parse(await readFile(temporary, 'utf8'));
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, root.workspace); break; }
      catch (error) { if (attempt >= 2) throw error; await new Promise((resolve) => setTimeout(resolve, 150)); }
    }
    const updatedAt = content.match(/"updatedAt"\s*:\s*(\d+)/)?.[1];
    const revision = content.match(/"revision"\s*:\s*(\d+)/)?.[1];
    if (updatedAt) await writeFile(root.metadata, JSON.stringify({ updatedAt: Number(updatedAt) || 0, revision: Number(revision) || 0 }), { encoding: 'utf8', flush: true }).catch(() => undefined);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await sweepStaleWorkspaceTemps(root.dataDir).catch(() => 0);
}

export const serverWorkspaceRepository: ServerWorkspaceRepository<StoredWorkspaceSnapshot> = {
  async read() {
    const root = paths();
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
    if (isSqliteActive(root.dataDir)) {
      const workspace = readAuthoritativeWorkspace(root.dataDir);
      return workspace ? { updatedAt: Number(workspace.updatedAt) || 0, revision: Number(workspace.revision) || 0 } : null;
    }
    try {
      const value = JSON.parse(await readFile(root.metadata, 'utf8')) as { updatedAt?: unknown; revision?: unknown };
      return { updatedAt: Number(value.updatedAt) || 0, revision: Number(value.revision) || 0 };
    } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error; }
    try {
      const handle = await open(root.workspace, 'r');
      const buffer = Buffer.alloc(4096);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      await handle.close();
      const updatedAt = buffer.subarray(0, result.bytesRead).toString('utf8').match(/"updatedAt"\s*:\s*(\d+)/)?.[1];
      return updatedAt ? { updatedAt: Number(updatedAt) || 0, revision: 0 } : null;
    } catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null; throw error; }
  },
  async write(value) {
    const root = paths();
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
