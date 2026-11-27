import { createHash, randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { fetchSkillBytes } from '@/lib/skills';
import {
  catalogArchiveAsset,
  catalogArchiveInstallDir,
  resolveCatalogInstallRoot,
  type McpStdioCatalogEntry,
} from './catalog';

const CHUNK_BYTES = 4 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 3;
const ARCHIVE_MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const ARCHIVE_MAX_FILES = 4096;
const DIRECTORY_COMMIT_ATTEMPTS = 8;
const DIRECTORY_COMMIT_RETRY_DELAY_MS = 250;

export type CatalogArchiveInstallerDependencies = {
  fetchBytes?: typeof fetchSkillBytes;
  renamePath?: typeof rename;
};

function isTransientRenameError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY';
}

async function renameWithRetries(source: string, target: string, renamePath: typeof rename = rename) {
  let lastError: unknown;
  for (let attempt = 0; attempt < DIRECTORY_COMMIT_ATTEMPTS; attempt += 1) {
    try {
      await renamePath(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRenameError(error) || attempt === DIRECTORY_COMMIT_ATTEMPTS - 1) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, DIRECTORY_COMMIT_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法提交 Windows MCP 运行包');
}

function removePathBestEffort(target: string) {
  try {
    rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: DIRECTORY_COMMIT_ATTEMPTS,
      retryDelay: DIRECTORY_COMMIT_RETRY_DELAY_MS,
    });
  } catch {
    // Windows 可能仍持有旧可执行文件；保留备份比让成功安装变成数据丢失更安全。
  }
}

/**
 * 不先删除当前版本，提交已经解压好的运行包。
 * Windows 不能直接 rename 覆盖目录，杀毒软件或仍在运行的可执行文件也可能让旧目录暂时无法删除。
 * 先移到备份目录可以回滚，目标被占用时也不会破坏当前安装。
 */
async function commitInstalledDirectory(
  stagingPath: string,
  installPath: string,
  installRoot: string,
  version: string,
  renamePath: typeof rename = rename,
) {
  if (!existsSync(installPath)) {
    await renameWithRetries(stagingPath, installPath, renamePath);
    return;
  }

  const backupPath = path.join(installRoot, `.previous-${version}-${randomUUID()}`);
  await renameWithRetries(installPath, backupPath, renamePath);
  try {
    await renameWithRetries(stagingPath, installPath, renamePath);
  } catch (error) {
    try {
      await renameWithRetries(backupPath, installPath, renamePath);
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`Windows MCP 更新失败，且旧版本回滚失败：${rollbackMessage}`, { cause: error });
    }
    throw error;
  }
  removePathBestEffort(backupPath);
}

function safeArchivePath(root: string, archivePath: string) {
  const normalized = archivePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) throw new Error('运行包包含无效文件路径');
  const target = path.resolve(root, normalized);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('运行包包含越界文件路径');
  }
  return target;
}

async function downloadArchive(
  entry: McpStdioCatalogEntry,
  archivePath: string,
  options: { dataDir?: string; signal?: AbortSignal; onProgress?: (receivedBytes: number, totalBytes: number) => void },
  fetchBytes: typeof fetchSkillBytes,
) {
  const asset = catalogArchiveAsset(entry);
  if (!asset) throw new Error('当前 Windows 架构没有可用的桌面控制运行包');
  const fetchRange = (start: number, end: number, reportProgress: boolean) => fetchBytes(asset.url, {
    maxBytes: end - start + 1,
    accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.5',
    range: { start, end },
    signal: options.signal,
    timeoutMs: 900_000,
    onProgress: reportProgress ? (received) => options.onProgress?.(start + received, asset.size) : undefined,
  });
  let probe: Awaited<ReturnType<typeof fetchRange>> | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      probe = await fetchRange(0, 0, false);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!probe) throw lastError instanceof Error ? lastError : new Error('桌面控制运行包下载探测失败');
  if (probe.rangeTotalBytes !== asset.size) {
    rmSync(archivePath, { force: true });
    throw new Error('桌面控制运行包大小与固定版本不符，已停止安装');
  }

  let offset = existsSync(archivePath) ? statSync(archivePath).size : 0;
  if (offset > asset.size || (offset !== asset.size && offset % CHUNK_BYTES !== 0)) {
    rmSync(archivePath, { force: true });
    offset = 0;
  }
  options.onProgress?.(offset, asset.size);
  while (offset < asset.size) {
    const end = Math.min(offset + CHUNK_BYTES, asset.size) - 1;
    let chunk: Buffer | null = null;
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchRange(offset, end, true);
        if (response.rangeTotalBytes !== asset.size) throw new Error('桌面控制运行包大小在下载期间发生变化');
        chunk = response.data;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!chunk) throw lastError instanceof Error ? lastError : new Error('桌面控制运行包下载失败');
    if (offset === 0) writeFileSync(archivePath, chunk);
    else appendFileSync(archivePath, chunk);
    offset += chunk.byteLength;
    options.onProgress?.(offset, asset.size);
  }
}

export async function installCatalogArchive(
  entry: McpStdioCatalogEntry,
  options: { dataDir?: string; signal?: AbortSignal; onProgress?: (receivedBytes: number, totalBytes: number) => void } = {},
  dependencies: CatalogArchiveInstallerDependencies = {},
) {
  const asset = catalogArchiveAsset(entry);
  if (!asset) throw new Error('当前 Windows 架构没有可用的桌面控制运行包');
  const installRoot = resolveCatalogInstallRoot(entry.id, options);
  const archivePath = path.join(installRoot, `.runtime-${entry.version}.zip.part`);
  const stagingPath = path.join(installRoot, `.staging-${randomUUID()}`);
  const installPath = path.join(installRoot, catalogArchiveInstallDir(entry));
  mkdirSync(installRoot, { recursive: true });
  await downloadArchive(entry, archivePath, options, dependencies.fetchBytes || fetchSkillBytes);

  const archive = readFileSync(archivePath);
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== asset.sha256) {
    rmSync(archivePath, { force: true });
    throw new Error('桌面控制运行包 SHA-256 校验失败，已停止安装');
  }

  mkdirSync(stagingPath, { recursive: true });
  try {
    const files = unzipSync(archive);
    const executablePath = safeArchivePath(stagingPath, asset.executable);
    let unpackedBytes = 0;
    let fileCount = 0;
    let executableFound = false;
    for (const [archiveName, content] of Object.entries(files)) {
      if (archiveName.endsWith('/')) continue;
      fileCount += 1;
      unpackedBytes += content.byteLength;
      if (fileCount > ARCHIVE_MAX_FILES || unpackedBytes > ARCHIVE_MAX_UNPACKED_BYTES) {
        throw new Error('桌面控制运行包解压内容超出安全限制');
      }
      const target = safeArchivePath(stagingPath, archiveName);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
      if (target.toLowerCase() === executablePath.toLowerCase()) executableFound = true;
    }
    if (!executableFound) throw new Error('桌面控制运行包缺少主程序');
    writeFileSync(path.join(stagingPath, '.sanmao-install.json'), JSON.stringify({ version: entry.version, sha256: asset.sha256 }));
    await commitInstalledDirectory(stagingPath, installPath, installRoot, entry.version, dependencies.renamePath);
    rmSync(archivePath, { force: true });
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}
