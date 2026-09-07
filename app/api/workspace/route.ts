import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isTrustedAppRequest } from '@/lib/auth';
import { type WorkspaceSnapshot } from '@/lib/workspace-types';
import { validateWorkspaceShape } from '@/lib/workspace-format';

export const runtime = 'nodejs';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const workspacePath = path.join(dataDir, 'workspace.json');
const maxWorkspaceBytes = 80 * 1024 * 1024;
const workspaceTempPattern = /^workspace\.json\.\d+\.\d+\.tmp$/;

function parseWorkspace(raw: string) {
  if (!raw.trim()) return null;
  return validateWorkspaceShape(JSON.parse(raw)) as unknown as WorkspaceSnapshot;
}

async function recoverWorkspace() {
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  const candidates = (await Promise.all(entries
    .filter((entry) => entry.isFile() && workspaceTempPattern.test(entry.name))
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

async function writeAtomic(content: string) {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${workspacePath}.${Date.now()}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flush: true });
  parseWorkspace(await readFile(temporary, 'utf8'));
  await rename(temporary, workspacePath);
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录后访问工作区。' }, { status: 401 });
  try {
    const workspace = await readWorkspace();
    return Response.json({ ok: true, workspace, updatedAt: workspace?.updatedAt || null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '读取工作区失败' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录后保存工作区。' }, { status: 401 });
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > maxWorkspaceBytes + 4096) throw new Error('工作区数据超过 80MB');
    const body = await request.json();
    const workspace = validateWorkspaceShape(body?.workspace) as unknown as WorkspaceSnapshot;
    const previous = await readWorkspace();
    workspace.updatedAt = Math.max(
      Date.now(),
      Number(workspace.updatedAt),
      Number(previous?.updatedAt || 0) + 1,
    );
    const content = `${JSON.stringify(workspace, null, 2)}\n`;
    if (Buffer.byteLength(content, 'utf8') > maxWorkspaceBytes) throw new Error('工作区数据超过 80MB');
    await writeAtomic(content);
    return Response.json({ ok: true, updatedAt: workspace.updatedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '保存工作区失败' }, { status: 400 });
  }
}
