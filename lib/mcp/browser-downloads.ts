/**
 * 浏览器下载 → Artifact。
 *
 * Playwright MCP 把下载的文件写进受控目录（启动参数里的 --output-dir），这里把新增的文件
 * 收成 artifact，聊天里才会出现文件卡片。二进制绝不进对话上下文：模型只看到「有个文件生成了」，
 * 真正的字节留在服务端，靠 artifactId 取件（任务书 §44）。
 *
 * 只收「这一轮之后新出现的文件」：上一轮的下载不该在下一轮又被当成新产物。
 * 已经收过的文件按「路径 + 大小 + 修改时间」去重，避免同一份文件被反复存一遍。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { artifactStore, type ArtifactStore } from '@/lib/artifacts/storage';

/** 单个下载文件的上限：再大的东西不该走聊天文件卡片，让用户自己在浏览器里存。 */
export const BROWSER_DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;
/** 一张卡片列表最多记多少条指纹，防止长时间运行后内存里越攒越多。 */
const IMPORTED_FINGERPRINT_LIMIT = 200;
/** 浏览器写盘时的中间态后缀：还在下载的文件不能收。 */
const INCOMPLETE_SUFFIXES = ['.tmp', '.crdownload', '.part', '.partial', '.download'];

const MIME_TYPES: Record<string, string> = {
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  svg: 'image/svg+xml',
  txt: 'text/plain;charset=utf-8',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  zip: 'application/zip',
};

export type BrowserArtifactFile = {
  name: string;
  mimeType: string;
  size: number;
  artifactId: string;
  downloadUrl: string;
};

/** 浏览器产物的落地目录：和 --output-dir 必须是同一个（见 lib/mcp/catalog.ts 的 args）。 */
export function resolveBrowserDownloadDir(options: { dataDir?: string } = {}) {
  return path.join(options.dataDir || resolveLocalDataDir(), 'browser', 'downloads');
}

function mimeTypeOf(fileName: string) {
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase();
  return MIME_TYPES[extension] || 'application/octet-stream';
}

/** 已收过的文件：路径 + 大小 + mtime 唯一确定一份内容。 */
const imported = new Map<string, string>();

function fingerprint(file: string, size: number, mtimeMs: number) {
  return `${file}\u0000${size}\u0000${Math.round(mtimeMs)}`;
}

function rememberFingerprint(key: string, artifactId: string) {
  imported.set(key, artifactId);
  while (imported.size > IMPORTED_FINGERPRINT_LIMIT) {
    const oldest = imported.keys().next();
    if (oldest.done) break;
    imported.delete(oldest.value);
  }
}

export type ImportBrowserArtifactsOptions = {
  dataDir?: string;
  /** 这一轮开始的时间：只收这之后写下的文件。 */
  since: number;
  store?: ArtifactStore;
  /** 这一轮最多收几个文件。 */
  max?: number;
};

/**
 * 收下浏览器目录里这一轮新出现的文件。出错一律吞掉：下载收不上来不该让整轮对话失败，
 * 用户至少还能看到助手说「文件已经下载到本机目录」。
 */
export async function importBrowserArtifacts(options: ImportBrowserArtifactsOptions): Promise<{ files: BrowserArtifactFile[]; skipped: number }> {
  const dir = resolveBrowserDownloadDir(options);
  const store = options.store || artifactStore;
  const since = Number(options.since) || 0;
  const max = Math.max(0, Math.min(options.max ?? 8, 8));
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ file: string; name: string; size: number; mtimeMs: number; key: string }> = [];
  let skipped = 0;
  for (const entry of entries) {
    // 只认目录里的普通文件：Playwright 的临时目录（.playwright-artifacts-*）直接跳过。
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (INCOMPLETE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) continue;
    const file = path.join(dir, entry.name);
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile() || info.size <= 0) continue;
    // 留 2 秒余量：落盘时间和这一轮开始时间可能只差几毫秒。
    if (info.mtimeMs < since - 2000) continue;
    if (info.size > BROWSER_DOWNLOAD_MAX_BYTES) {
      skipped += 1;
      continue;
    }
    const key = fingerprint(file, info.size, info.mtimeMs);
    if (imported.has(key)) continue;
    candidates.push({ file, name: entry.name, size: info.size, mtimeMs: info.mtimeMs, key });
  }
  if (!candidates.length) return { files: [], skipped };
  // 早下载的排在前面：用户先看到的文件先出现在卡片列表里。
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs);
  const files: BrowserArtifactFile[] = [];
  for (const candidate of candidates.slice(0, max)) {
    try {
      const data = await readFile(candidate.file);
      const descriptor = await store.save({ kind: 'file', name: candidate.name, data, mimeType: mimeTypeOf(candidate.name) });
      rememberFingerprint(candidate.key, descriptor.id);
      files.push({
        name: descriptor.name,
        mimeType: descriptor.mimeType,
        size: descriptor.size,
        artifactId: descriptor.id,
        downloadUrl: descriptor.downloadUrl,
      });
    } catch {
      // 单个文件收不上来（超大、被占用、磁盘满）只跳过它，其他文件照收。
      skipped += 1;
    }
  }
  return { files, skipped };
}

/** 测试与状态面板用：忘掉指纹（只影响「同一份文件是否重复收」）。 */
export function resetBrowserArtifactImports() {
  imported.clear();
}