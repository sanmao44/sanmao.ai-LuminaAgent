import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isTrustedAppRequest } from '@/lib/auth';
import { ensureMediaLibrary } from '@/lib/media-library';
import { type WorkspaceSnapshot } from '@/lib/workspace-types';
import { validateWorkspaceShape } from '@/lib/workspace-format';
import { WORKSPACE_TEMP_PATTERN, sweepStaleWorkspaceTemps } from '@/lib/workspace-temps';
import { ensureDataFoundation } from '@/lib/data-foundation';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { isSqliteActive } from '@/lib/database/sqlite';
import { readAuthoritativeWorkspace, writeAuthoritativeWorkspace, type StoredWorkspaceSnapshot } from '@/lib/repositories/server-workspace-repository';

export const runtime = 'nodejs';

const dataDir = resolveLocalDataDir();
const workspacePath = path.join(dataDir, 'workspace.json');
const workspaceMetaPath = path.join(dataDir, 'workspace-meta.json');
const maxWorkspaceBytes = 80 * 1024 * 1024;
const workspaceTempSweepIntervalMs = 60 * 1000;
let lastWorkspaceTempSweepAt = 0;
let workspaceMutationChain: Promise<unknown> = Promise.resolve();

function revisionOf(workspace: StoredWorkspaceSnapshot | null) {
  const value = Number(workspace?.revision || 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function contentHashOf(workspace: StoredWorkspaceSnapshot | null) {
  if (!workspace) return null;
  const { revision: _revision, ...content } = workspace;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function runWorkspaceMutation<T>(operation: () => Promise<T>) {
  const result = workspaceMutationChain.then(operation, operation);
  workspaceMutationChain = result.then(() => undefined, () => undefined);
  return result;
}

function parseWorkspace(raw: string) {
  if (!raw.trim()) return null;
  return validateWorkspaceShape(JSON.parse(raw)) as unknown as StoredWorkspaceSnapshot;
}

async function recoverWorkspace() {
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  const candidates = (await Promise.all(entries
    .filter((entry) => entry.isFile() && WORKSPACE_TEMP_PATTERN.test(entry.name))
    .map(async (entry) => {
      const file = path.join(dataDir, entry.name);
      try { return { file, mtimeMs: (await stat(file)).mtimeMs }; }
      catch { return null; }
    })))
    .filter((candidate): candidate is { file: string; mtimeMs: number } => Boolean(candidate))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 32);

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate.file, 'utf8');
      const workspace = parseWorkspace(raw);
      if (!workspace) continue;
      await writeAtomic(raw);
      return workspace;
    } catch {}
  }
  return null;
}

async function readWorkspace() {
  if (isSqliteActive(dataDir)) return readAuthoritativeWorkspace(dataDir);
  try {
    const raw = await readFile(workspacePath, 'utf8');
    return parseWorkspace(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    const recovered = await recoverWorkspace();
    if (recovered) return recovered;
    throw error;
  }
}

async function readWorkspaceMetadata() {
  if (isSqliteActive(dataDir)) {
    const workspace = readAuthoritativeWorkspace(dataDir);
    return workspace ? { updatedAt: Number(workspace.updatedAt) || 0, revision: revisionOf(workspace) } : null;
  }
  try {
    const raw = await readFile(workspaceMetaPath, 'utf8');
    const value = JSON.parse(raw) as { updatedAt?: unknown; revision?: unknown };
    return {
      updatedAt: Number(value.updatedAt) || 0,
      revision: Number(value.revision) || 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }

  // Older workspaces do not have the sidecar yet. Read only the beginning of
  // the pretty-printed snapshot, where updatedAt is written, instead of
  // parsing the entire multi-megabyte history file on every metadata poll.
  try {
    const handle = await open(workspacePath, 'r');
    const buffer = Buffer.alloc(4096);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    await handle.close();
    const raw = buffer.subarray(0, result.bytesRead).toString('utf8');
    const updatedAt = raw.match(/"updatedAt"\s*:\s*(\d+)/)?.[1];
    if (!updatedAt) return null;
    return {
      updatedAt: Number(updatedAt) || 0,
      revision: 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomic(content: string) {
  if (isSqliteActive(dataDir)) {
    const workspace = parseWorkspace(content);
    if (!workspace) throw new Error('workspace is empty');
    writeAuthoritativeWorkspace(dataDir, workspace);
    return;
  }
  await mkdir(dataDir, { recursive: true });
  const temporary = `${workspacePath}.${Date.now()}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flush: true });
    parseWorkspace(await readFile(temporary, 'utf8'));
    await renameWorkspaceSnapshot(temporary);
    const updatedAt = content.match(/"updatedAt"\s*:\s*(\d+)/)?.[1];
    const revision = content.match(/"revision"\s*:\s*(\d+)/)?.[1];
    if (updatedAt) {
      await writeFile(workspaceMetaPath, JSON.stringify({
        updatedAt: Number(updatedAt) || 0,
        revision: Number(revision) || 0,
      }), { encoding: 'utf8', flush: true }).catch(() => undefined);
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  if (Date.now() - lastWorkspaceTempSweepAt >= workspaceTempSweepIntervalMs) {
    lastWorkspaceTempSweepAt = Date.now();
    await sweepStaleWorkspaceTemps(dataDir).catch(() => 0);
  }
}

async function renameWorkspaceSnapshot(temporary: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, workspacePath);
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录后访问工作区。' }, { status: 401 });
  if (new URL(request.url).searchParams.get('meta') === '1') {
    try {
      const metadata = await readWorkspaceMetadata();
      return Response.json({
        ok: true,
        workspace: null,
        updatedAt: metadata?.updatedAt || null,
        revision: metadata?.revision || 0,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '读取工作区元数据失败' }, { status: 500 });
    }
  }
  // 客户端启动时会读工作区：借这个时机把历史目录里的素材并入固定媒体库。
  try {
    await ensureDataFoundation();
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '本地数据迁移失败，已保留原数据' }, { status: 503 });
  }
  void ensureMediaLibrary();
  try {
    const workspace = await readWorkspace();
    return Response.json({
      ok: true,
      workspace,
      updatedAt: workspace?.updatedAt || null,
      revision: revisionOf(workspace),
      contentHash: contentHashOf(workspace),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '读取工作区失败' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录后保存工作区。' }, { status: 401 });
  try {
    await ensureDataFoundation();
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '本地数据迁移失败，已保留原数据' }, { status: 503 });
  }
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > maxWorkspaceBytes + 4096) throw new Error('工作区数据超过 80MB');
    const body = await request.json();
    const hasExpectedRevision = Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'expectedRevision'));
    const expectedRevision = hasExpectedRevision && Number.isInteger(Number(body.expectedRevision))
      ? Math.max(0, Number(body.expectedRevision))
      : 0;
    const result = await runWorkspaceMutation(async () => {
      const workspace = validateWorkspaceShape(body?.workspace) as unknown as StoredWorkspaceSnapshot;
      const previous = await readWorkspace();
      const currentRevision = revisionOf(previous);
      // Requests from pre-CAS clients did not carry expectedRevision. Keep
      // those clients writable; only new clients opt into conflict detection.
      if (hasExpectedRevision && expectedRevision !== currentRevision) {
        return Response.json({ ok: false, code: 'WORKSPACE_CONFLICT', error: '工作区已被其他窗口更新，请刷新后再保存', revision: currentRevision, updatedAt: previous?.updatedAt || null, contentHash: contentHashOf(previous) }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }
      workspace.updatedAt = Math.max(
        Date.now(),
        Number(workspace.updatedAt),
        Number(previous?.updatedAt || 0) + 1,
      );
      workspace.revision = currentRevision + 1;
      const content = `${JSON.stringify(workspace, null, 2)}\n`;
      if (Buffer.byteLength(content, 'utf8') > maxWorkspaceBytes) throw new Error('工作区数据超过 80MB');
      await writeAtomic(content);
      return Response.json({ ok: true, updatedAt: workspace.updatedAt, revision: workspace.revision, contentHash: contentHashOf(workspace) }, { headers: { 'Cache-Control': 'no-store' } });
    });
    return result;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '保存工作区失败' }, { status: 400 });
  }
}
