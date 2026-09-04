import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { isTrustedAppRequest, networkMode } from '@/lib/auth';
import {
  acquireRuntimeOperationLock,
  beginRuntimeDrain,
  cancelRuntimeDrain,
  operationLockMatches,
  removeOwnedRuntimeOperationLock,
} from '@/lib/runtime-operation';
import { getActiveUpdateProgress } from '@/lib/local-update';
import { getRuntimeStatus, runtimeOperationLockPath, runtimeRestartStatusPath } from '@/lib/runtime-service';

export const runtime = 'nodejs';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

function sameLocalOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    return source.protocol === target.protocol && source.host === target.host;
  } catch {
    return false;
  }
}

function requestPort(request: Request) {
  try {
    const port = Number(new URL(request.url).port);
    return Number.isInteger(port) && port >= 1024 && port <= 65525 ? port : 3210;
  } catch {
    return 3210;
  }
}

function powershellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function waitForSpawn(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    const onSpawn = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function writeRestartStatus(status: Record<string, unknown>) {
  const file = runtimeRestartStatusPath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(status.operationId || randomUUID())}.tmp`;
  await open(temporary, 'w').then(async (handle) => {
    try { await handle.writeFile(JSON.stringify(status, null, 2)); } finally { await handle.close(); }
  });
  await rm(file, { force: true });
  await rename(temporary, file);
}

async function spawnRestartHelper(operationId: string, token: string, port: number) {
  const root = process.cwd();
  const scriptPath = path.join(root, 'scripts', process.platform === 'win32' ? 'restart.ps1' : 'restart.sh');
  if (process.platform === 'win32') {
    const scriptArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Port', String(port), '-OperationId', operationId, '-OperationToken', token]
      .map(powershellLiteral).join(', ');
    const command = `Start-Process -FilePath 'powershell.exe' -ArgumentList @(${scriptArgs}) -WorkingDirectory ${powershellLiteral(root)} -WindowStyle Hidden`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'ignore', windowsHide: true });
    await waitForSpawn(child);
    return;
  }
  const child = spawn('sh', [scriptPath, String(port), operationId, token], { cwd: root, detached: true, stdio: 'ignore' });
  await waitForSpawn(child);
  child.unref();
}

export async function GET(request: Request) {
  return Response.json({ ...(await getRuntimeStatus()), port: requestPort(request) }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request) || !sameLocalOrigin(request)) {
    return Response.json({ error: '重启请求未通过本地安全校验' }, { status: 403, headers: noStoreHeaders });
  }
  if (networkMode() !== 'local') {
    return Response.json({ error: '局域网模式请使用启动器重启，避免影响其他设备' }, { status: 409, headers: noStoreHeaders });
  }

  const parsedBody = await request.json().catch(() => ({}));
  const body = parsedBody && typeof parsedBody === 'object' ? parsedBody as { action?: unknown; force?: unknown } : {};
  if (body.action !== 'restart') return Response.json({ error: '不支持的服务操作' }, { status: 400, headers: noStoreHeaders });

  const operationId = randomUUID();
  const operation = await acquireRuntimeOperationLock('restart', operationId);
  if (!operation) {
    return Response.json({ error: '已有更新或重启任务正在进行，请稍候' }, { status: 409, headers: noStoreHeaders });
  }
  const { token } = operation;

  const drain = await beginRuntimeDrain(operationId);
  if (!drain) {
    await removeOwnedRuntimeOperationLock(token);
    return Response.json({ error: '已有重启任务正在进行，请稍候' }, { status: 409, headers: noStoreHeaders });
  }
  if (drain.activeRequests > 0 && body.force !== true) {
    await cancelRuntimeDrain(operationId);
    await removeOwnedRuntimeOperationLock(token);
    return Response.json({ error: `当前还有 ${drain.activeRequests} 个任务正在执行`, activeRequests: drain.activeRequests, requiresConfirmation: true }, { status: 409, headers: noStoreHeaders });
  }
  if (getActiveUpdateProgress()) {
    await cancelRuntimeDrain(operationId);
    await removeOwnedRuntimeOperationLock(token);
    return Response.json({ error: '更新任务正在进行，请更新完成后再重启' }, { status: 409, headers: noStoreHeaders });
  }
  const runtimeStatus = await getRuntimeStatus();
  if (runtimeStatus.dependenciesChanged) {
    await cancelRuntimeDrain(operationId);
    await removeOwnedRuntimeOperationLock(token);
    return Response.json({ error: '检测到 package.json 或 package-lock.json 已变化，请使用正式更新流程，以便安全处理依赖', requiresFormalUpdate: true }, { status: 409, headers: noStoreHeaders });
  }
  if (!(await operationLockMatches(token))) {
    await cancelRuntimeDrain(operationId);
    await removeOwnedRuntimeOperationLock(token);
    return Response.json({ error: '重启任务锁定失败，请稍候重试' }, { status: 409, headers: noStoreHeaders });
  }

  await writeRestartStatus({ operationId, state: 'starting', version: runtimeStatus.version, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activeRequests: drain.activeRequests });
  try {
    await spawnRestartHelper(operationId, token, requestPort(request));
    return Response.json({ started: true, operationId, activeRequests: drain.activeRequests }, { status: 202, headers: noStoreHeaders });
  } catch (error) {
    await cancelRuntimeDrain(operationId);
    await removeOwnedRuntimeOperationLock(token);
    await writeRestartStatus({ operationId, state: 'failed', error: error instanceof Error ? error.message : '重启程序启动失败', updatedAt: new Date().toISOString() });
    return Response.json({ error: '重启程序启动失败，请使用桌面启动器重试' }, { status: 500, headers: noStoreHeaders });
  }
}
