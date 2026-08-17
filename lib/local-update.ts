import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { UpdateStatus } from '@/lib/update';

const MAX_UPDATE_BYTES = 150 * 1024 * 1024;

function updaterScriptName() {
  return process.platform === 'win32' ? 'apply-update.ps1' : 'apply-update.sh';
}

function updaterCommand() {
  if (process.platform === 'win32') return 'powershell.exe';
  return 'sh';
}

function updaterArguments(scriptPath: string, archivePath: string, targetPath: string, version: string) {
  if (process.platform === 'win32') {
    return [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-ArchivePath',
      archivePath,
      '-TargetPath',
      targetPath,
      '-ProcessId',
      String(process.pid),
      '-Version',
      version,
    ];
  }
  return [scriptPath, archivePath, targetPath, String(process.pid), version];
}

async function downloadToFile(url: string, destination: string, expectedSha256: string) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { Accept: 'application/zip, application/octet-stream', 'User-Agent': 'SANMAO.AI local updater' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`更新包下载失败：HTTP ${response.status}`);

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_UPDATE_BYTES) throw new Error('更新包超过 150 MB，已停止更新');

  const handle = await open(destination, 'w');
  const hash = createHash('sha256');
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const buffer = Buffer.from(chunk.value);
      total += buffer.byteLength;
      if (total > MAX_UPDATE_BYTES) throw new Error('更新包超过 150 MB，已停止更新');
      hash.update(buffer);
      await handle.write(buffer);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await handle.close();
  }

  const actualSha256 = hash.digest('hex');
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error('更新包 SHA-256 校验失败，已拒绝执行');
  }
  return { bytes: total, sha256: actualSha256 };
}

export async function startLocalUpdate(status: UpdateStatus) {
  if (!status.hasUpdate || !status.canApply || !status.packageUrl || !status.sha256 || !status.latestVersion) {
    throw new Error('当前更新没有满足本地安全更新条件');
  }

  const root = process.cwd();
  const scriptsDir = join(root, 'scripts');
  const updaterSource = join(scriptsDir, updaterScriptName());
  await access(updaterSource, constants.R_OK);

  const stagingDir = join(root, '.data', 'update-staging');
  await mkdir(stagingDir, { recursive: true });
  const lockPath = join(stagingDir, 'update.lock');
  let lockHandle;
  try {
    lockHandle = await open(lockPath, 'wx');
  } catch {
    throw new Error('已有更新任务正在进行，请稍候');
  }

  const safeVersion = status.latestVersion.replace(/[^0-9A-Za-z._-]/g, '_');
  const archivePath = join(stagingDir, `sanmao-update-${safeVersion}.zip`);
  const updaterPath = join(stagingDir, `apply-update-${safeVersion}${process.platform === 'win32' ? '.ps1' : '.sh'}`);
  const metadataPath = join(stagingDir, `sanmao-update-${safeVersion}.json`);

  try {
    await lockHandle.writeFile(JSON.stringify({ version: status.latestVersion, startedAt: new Date().toISOString() }));
    await lockHandle.close();
    await rm(archivePath, { force: true });
    await copyFile(updaterSource, updaterPath);
    const download = await downloadToFile(status.packageUrl, archivePath, status.sha256);
    await writeFile(metadataPath, JSON.stringify({
      format: 'sanmao-local-update',
      version: status.latestVersion,
      releaseUrl: status.releaseUrl,
      archive: archivePath,
      bytes: download.bytes,
      sha256: download.sha256,
      createdAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    const child = spawn(updaterCommand(), updaterArguments(updaterPath, archivePath, root, status.latestVersion), {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { started: true, version: status.latestVersion };
  } catch (error) {
    await rm(archivePath, { force: true }).catch(() => undefined);
    await rm(updaterPath, { force: true }).catch(() => undefined);
    await rm(metadataPath, { force: true }).catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
