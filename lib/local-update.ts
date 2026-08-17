import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { UpdateStatus } from '@/lib/update';

const MAX_UPDATE_BYTES = 150 * 1024 * 1024;
const STALE_LOCK_MS = 10 * 60 * 1000;

export type UpdateProgressStage = 'queued' | 'downloading' | 'verifying' | 'starting' | 'completed' | 'failed';

export type UpdateProgress = {
  jobId: string;
  version: string;
  stage: UpdateProgressStage;
  message: string;
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  startedAt: string;
  updatedAt: string;
  error?: string;
};

const progressJobs = new Map<string, UpdateProgress>();

function nowIso() {
  return new Date().toISOString();
}

export function createUpdateJob(version: string) {
  const jobId = randomUUID();
  const now = nowIso();
  const progress: UpdateProgress = {
    jobId,
    version,
    stage: 'queued',
    message: '正在准备更新任务…',
    percent: 0,
    downloadedBytes: 0,
    totalBytes: null,
    startedAt: now,
    updatedAt: now,
  };
  progressJobs.set(jobId, progress);
  return progress;
}

export function getUpdateProgress(jobId: string) {
  return progressJobs.get(jobId) || null;
}

export function getActiveUpdateProgress() {
  return [...progressJobs.values()]
    .filter((progress) => !['completed', 'failed'].includes(progress.stage))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null;
}

function setUpdateProgress(jobId: string, patch: Partial<UpdateProgress>) {
  const current = progressJobs.get(jobId);
  if (!current) return;
  progressJobs.set(jobId, { ...current, ...patch, updatedAt: nowIso() });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, Math.round(value))} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

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

async function downloadToFile(
  url: string,
  destination: string,
  expectedSha256: string,
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void,
) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { Accept: 'application/zip, application/octet-stream', 'User-Agent': 'SANMAO.AI local updater' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`更新包下载失败：HTTP ${response.status}`);

  const contentLength = Number(response.headers.get('content-length') || 0);
  const totalBytes = contentLength > 0 ? contentLength : null;
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
      onProgress?.(total, totalBytes);
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

async function downloadFromSources(
  sources: string[],
  destination: string,
  expectedSha256: string,
  onAttempt: (index: number, total: number) => void,
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void,
) {
  let lastError: unknown;
  const totalAttempts = sources.length * 2;
  let attemptIndex = 0;
  for (const source of sources) {
    for (let retry = 0; retry < 2; retry += 1) {
      onAttempt(attemptIndex, totalAttempts);
      attemptIndex += 1;
      try {
        return await downloadToFile(source, destination, expectedSha256, onProgress);
      } catch (error) {
        lastError = error;
        await rm(destination, { force: true }).catch(() => undefined);
        if (retry === 0) await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('更新包下载失败，请检查网络后重试');
}

export async function startLocalUpdate(status: UpdateStatus, jobId = createUpdateJob(status.latestVersion || 'unknown').jobId) {
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
    try {
      lockHandle = await open(lockPath, 'wx');
    } catch {
      try {
        const lockInfo = await stat(lockPath);
        if (Date.now() - lockInfo.mtimeMs > STALE_LOCK_MS) {
          await rm(lockPath, { force: true });
          lockHandle = await open(lockPath, 'wx');
        } else {
          throw new Error('已有更新任务正在进行，请稍候');
        }
      } catch (lockError) {
        if (lockError instanceof Error && lockError.message === '已有更新任务正在进行，请稍候') throw lockError;
        throw new Error('更新任务锁定失败，请稍后重试');
      }
    }
    setUpdateProgress(jobId, { stage: 'queued', message: '正在准备更新任务…', percent: 0 });
  } catch {
    setUpdateProgress(jobId, { stage: 'failed', message: '更新任务无法启动', error: '已有更新任务正在进行，请稍候' });
    throw new Error('已有更新任务正在进行，请稍候');
  }

  const safeVersion = status.latestVersion.replace(/[^0-9A-Za-z._-]/g, '_');
  const archivePath = join(stagingDir, `sanmao-update-${safeVersion}.zip`);
  const updaterPath = join(stagingDir, `apply-update-${safeVersion}${process.platform === 'win32' ? '.ps1' : '.sh'}`);
  const metadataPath = join(stagingDir, `sanmao-update-${safeVersion}.json`);

  try {
    await lockHandle.writeFile(JSON.stringify({ jobId, version: status.latestVersion, startedAt: nowIso() }));
    await lockHandle.close();
    await rm(archivePath, { force: true });
    await copyFile(updaterSource, updaterPath);
    const configuredMirrors = (process.env.SANMAO_UPDATE_MIRRORS || '')
      .split(/[\r\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const sources = [...new Set([status.packageUrl, ...(status.mirrorUrls || []), ...configuredMirrors].filter(Boolean))] as string[];
    setUpdateProgress(jobId, { stage: 'downloading', message: '正在连接更新源…', percent: 1, downloadedBytes: 0, totalBytes: null });
    let lastReportedAt = 0;
    const download = await downloadFromSources(
      sources,
      archivePath,
      status.sha256,
      (attempt, total) => setUpdateProgress(jobId, {
        stage: 'downloading',
        message: total > 1 ? `正在连接更新源（${attempt + 1}/${total}）…` : '正在下载更新包…',
        percent: 1,
        downloadedBytes: 0,
        totalBytes: null,
      }),
      (downloadedBytes, totalBytes) => {
        const now = Date.now();
        if (now - lastReportedAt < 120 && downloadedBytes !== totalBytes) return;
        lastReportedAt = now;
        const percent = totalBytes ? Math.min(92, Math.max(1, Math.round((downloadedBytes / totalBytes) * 92))) : null;
        setUpdateProgress(jobId, {
          stage: 'downloading',
          message: totalBytes ? `正在下载更新包… ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}` : `正在下载更新包… ${formatBytes(downloadedBytes)}`,
          percent,
          downloadedBytes,
          totalBytes,
        });
      },
    );
    setUpdateProgress(jobId, { stage: 'verifying', message: '正在校验更新包完整性…', percent: 96, downloadedBytes: download.bytes, totalBytes: download.bytes });
    await writeFile(metadataPath, JSON.stringify({
      format: 'sanmao-local-update',
      version: status.latestVersion,
      releaseUrl: status.releaseUrl,
      archive: archivePath,
      bytes: download.bytes,
      sha256: download.sha256,
      createdAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    setUpdateProgress(jobId, { stage: 'starting', message: '更新包已校验，正在启动更新程序…', percent: 98 });
    const child = spawn(updaterCommand(), updaterArguments(updaterPath, archivePath, root, status.latestVersion), {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    setUpdateProgress(jobId, { stage: 'completed', message: '更新已开始，应用即将重启…', percent: 100 });
    return { started: true, version: status.latestVersion };
  } catch (error) {
    setUpdateProgress(jobId, {
      stage: 'failed',
      message: '更新失败，请检查网络后重试',
      error: error instanceof Error ? error.message : '本地更新失败',
    });
    await rm(archivePath, { force: true }).catch(() => undefined);
    await rm(updaterPath, { force: true }).catch(() => undefined);
    await rm(metadataPath, { force: true }).catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
