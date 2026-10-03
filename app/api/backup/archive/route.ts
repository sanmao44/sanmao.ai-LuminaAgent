import { isAdminRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import { createBackupExportFile, getBackupLimits, restoreBackupArchiveFile } from '@/lib/backup-application-service';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BufferedRuntimeObserver, CompositeRuntimeObserver } from '@/packages/contracts/observability';
import { FileRuntimeObserver } from '@/packages/observability/index';
import { resolveLocalDataDir } from '@/lib/data-paths';

export const runtime = 'nodejs';

async function stageRequestBody(request: Request, target: string, maxBytes: number) {
  if (!request.body) throw new Error('备份上传内容为空');
  const reader = request.body.getReader();
  const output = createWriteStream(target, { flags: 'wx' });
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error(`备份归档超过 ${maxBytes / (1024 * 1024 * 1024)}GB，无法恢复`);
      if (output.write(chunk)) continue;
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { output.off('drain', onDrain); reject(error); };
        const onDrain = () => { output.off('error', onError); resolve(); };
        output.once('error', onError);
        output.once('drain', onDrain);
      });
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { output.off('finish', onFinish); reject(error); };
      const onFinish = () => { output.off('error', onError); resolve(); };
      output.once('error', onError);
      output.once('finish', onFinish);
      output.end();
    });
    return bytes;
  } catch (error) {
    output.destroy();
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  const runtimeObserver = new CompositeRuntimeObserver([
    new BufferedRuntimeObserver(64),
    new FileRuntimeObserver({ directory: path.join(resolveLocalDataDir(), 'runtime-events') }),
  ]);
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('backup-export');
    const body = await request.json();
    const client = body?.client;
    const { maxClientBytes } = getBackupLimits();
    const clientBytes = Buffer.byteLength(JSON.stringify(client || {}), 'utf8');
    if (clientBytes > maxClientBytes) throw new Error('浏览器历史过大，无法生成备份');
    const backupPassword = String(body?.backupPassword || '');
    const backupMode = body?.backupMode === 'complete' ? 'complete' : body?.backupMode === 'content' ? 'content' : null;
    if (!backupMode) throw new Error('必须明确选择内容备份或完整加密备份');
    const result = await createBackupExportFile(client, backupPassword, backupMode, runtimeObserver);
    const stream = createReadStream(result.filePath, { highWaterMark: 1024 * 1024 });
    stream.once('close', () => { void rm(result.cleanupPath, { recursive: true, force: true }); });
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="SANMAO-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sanmao-backup"`,
        'X-SANMAO-Backup-Version': '2',
        'X-SANMAO-Backup-Encrypted': '1',
        'X-SANMAO-Backup-Mode': result.manifest.backupMode,
        'X-SANMAO-Backup-Skills': String(result.manifest.skillCount),
      },
    });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '生成完整备份失败' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}

export async function PUT(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  const runtimeObserver = new CompositeRuntimeObserver([
    new BufferedRuntimeObserver(64),
    new FileRuntimeObserver({ directory: path.join(resolveLocalDataDir(), 'runtime-events') }),
  ]);
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('backup-restore');
    const backupPassword = request.headers.get('x-sanmao-backup-password') || '';
    const { maxArchiveBytes, maxArchiveLabel } = getBackupLimits();
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > maxArchiveBytes) throw new Error(`备份归档超过 ${maxArchiveLabel}，无法恢复`);
    const staging = await mkdtemp(path.join(tmpdir(), 'sanmao-http-restore-'));
    const uploadedPath = path.join(staging, 'uploaded.backup');
    try {
      const uploadedBytes = await stageRequestBody(request, uploadedPath, maxArchiveBytes);
      const result = await restoreBackupArchiveFile(uploadedPath, backupPassword, uploadedBytes, runtimeObserver);
      return Response.json({ ok: true, ...result });
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '恢复完整备份失败' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}
