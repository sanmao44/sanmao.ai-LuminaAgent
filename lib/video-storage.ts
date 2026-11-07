import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratedVideo } from './types';
import { knownMediaRoots, mediaDirectory } from './media-paths';
import { resolveLocalDataDir } from './data-paths';
import { normalizeVideoAspect } from './video-aspect-normalizer';

const dataDir = resolveLocalDataDir();
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_DATA_URI_BYTES = 64 * 1024 * 1024;
const VIDEO_DOWNLOAD_MAX_ATTEMPTS = 3;
const VIDEO_DOWNLOAD_TOTAL_TIMEOUT_MS = 180_000;
const VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS = 120_000;
const VIDEO_DOWNLOAD_MAX_RETRY_AFTER_MS = 5_000;
type PersistedVideo = GeneratedVideo & { localPath: string };
type LoadedVideo = { buffer: Buffer; ext: string };

class VideoDownloadHttpError extends Error {
  constructor(readonly status: number) {
    super(`视频下载失败：HTTP ${status}`);
    this.name = 'VideoDownloadHttpError';
  }
}

function configuredRoot() {
  // 默认固定到用户级媒体库，换运行目录不再换掉素材。
  return path.resolve(process.env.SANMAO_VIDEO_STORAGE_PATH || mediaDirectory('video'));
}

export function getDefaultVideoStoragePath() { return configuredRoot(); }

function extensionFromContentType(contentType: string) {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('ogg')) return 'ogv';
  return 'mp4';
}

function extensionFromUrl(url: string) {
  try {
    const ext = path.extname(new URL(url, 'http://sanmao.local').pathname).replace('.', '').toLowerCase();
    return ['mp4', 'webm', 'mov', 'ogv', 'm4v'].includes(ext) ? ext : '';
  } catch { return ''; }
}

async function loadVideo(url: string): Promise<LoadedVideo> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error('视频 data URI 格式无效，无法保存');
    const encodedBytes = Buffer.byteLength(match[3], 'utf8');
    if (encodedBytes > MAX_DATA_URI_BYTES * 1.4) throw new Error('视频 data URI 超过 64 MiB 限制，无法保存');
    let buffer: Buffer;
    try {
      buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    } catch {
      throw new Error('视频 data URI 格式无效，无法保存');
    }
    if (buffer.byteLength <= 0) throw new Error('视频 data URI 没有有效内容，无法保存');
    if (buffer.byteLength > MAX_DATA_URI_BYTES) throw new Error('视频 data URI 超过 64 MiB 限制，无法保存');
    return { buffer, ext: extensionFromContentType(match[1] || 'video/mp4') };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('视频结果不是可读取的 data URL 或 HTTP 地址，无法保存到本地');
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 0; attempt < VIDEO_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = VIDEO_DOWNLOAD_TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS, remainingMs)),
      });
      if (!response.ok) {
        const error = new VideoDownloadHttpError(response.status);
        if (!isRetryableVideoDownloadError(error) || attempt + 1 >= VIDEO_DOWNLOAD_MAX_ATTEMPTS) throw error;
        await waitBeforeVideoDownloadRetry(retryAfterDelay(response.headers.get('retry-after'), attempt), startedAt);
        continue;
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_VIDEO_BYTES) throw new Error('视频超过 1 GiB，无法保存');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_VIDEO_BYTES) throw new Error('视频超过 1 GiB，无法保存');
      return { buffer, ext: extensionFromContentType(response.headers.get('content-type') || '') || extensionFromUrl(url) || 'mp4' };
    } catch (error) {
      lastError = error;
      if (!isRetryableVideoDownloadError(error) || attempt + 1 >= VIDEO_DOWNLOAD_MAX_ATTEMPTS) throw error;
      await waitBeforeVideoDownloadRetry(retryAfterDelay(undefined, attempt), startedAt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('视频下载超时');
}

function isRetryableVideoDownloadError(error: unknown) {
  if (error instanceof VideoDownloadHttpError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError) return true;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && /^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT)$/.test(code);
}

function retryAfterDelay(value: string | null | undefined, attempt: number) {
  if (value) {
    const seconds = Number(value.trim());
    const retryAt = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds * 1000) : Date.parse(value);
    if (Number.isFinite(retryAt)) return Math.min(VIDEO_DOWNLOAD_MAX_RETRY_AFTER_MS, Math.max(0, retryAt - Date.now()));
  }
  return Math.min(VIDEO_DOWNLOAD_MAX_RETRY_AFTER_MS, 250 * (2 ** attempt));
}

async function waitBeforeVideoDownloadRetry(delayMs: number, startedAt: number) {
  const remainingMs = VIDEO_DOWNLOAD_TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error('视频下载超过 3 分钟总时限');
  const boundedDelay = Math.min(delayMs, remainingMs);
  if (boundedDelay > 0) await new Promise<void>((resolve) => setTimeout(resolve, boundedDelay));
  if (Date.now() - startedAt >= VIDEO_DOWNLOAD_TOTAL_TIMEOUT_MS) throw new Error('视频下载超过 3 分钟总时限');
}

export async function persistGeneratedVideos(videos: GeneratedVideo[], configuredPath?: string, options: { aspectRatio?: string } = {}) {
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const writtenFiles: string[] = [];
  const temporaryFiles: string[] = [];
  const failures: string[] = [];
  const saved = await Promise.all(videos.map(async (video, index): Promise<PersistedVideo | null> => {
    try {
      const loaded = await loadVideo(video.url);
      const normalized = await normalizeVideoAspect(loaded.buffer, loaded.ext, options.aspectRatio);
      const name = `${Date.now()}-${randomUUID()}.${normalized.ext}`;
      const file = path.join(root, name);
      const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
      temporaryFiles.push(temporary);
      await writeFile(temporary, normalized.buffer, { flag: 'wx' });
      await rename(temporary, file);
      writtenFiles.push(file);
      return { ...video, url: `/api/storage/video?name=${encodeURIComponent(name)}`, localPath: file };
    } catch (error) {
      failures.push(`第 ${index + 1} 个：${error instanceof Error ? error.message : '未知错误'}`);
      return null;
    }
  }));
  await Promise.all(temporaryFiles.map((file) => rm(file, { force: true }).catch(() => undefined)));
  if (failures.length) {
    await Promise.all(writtenFiles.map((file) => rm(file, { force: true }).catch(() => undefined)));
  }
  return {
    videos: failures.length ? [] : saved.filter((video): video is PersistedVideo => video !== null),
    path: root,
    storageError: failures.length ? `本地视频保存失败：${failures.join('；')}` : undefined,
  };
}

/** 保存本地渲染器产出的完整视频，供克隆成片和其它本地合成流程复用。 */
export async function persistVideoBuffer(buffer: Buffer, contentType = 'video/mp4', configuredPath?: string) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0) throw new Error('视频合成没有产生有效文件');
  if (buffer.byteLength > MAX_VIDEO_BYTES) throw new Error('合成视频超过 1 GiB，无法保存');
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const ext = extensionFromContentType(contentType);
  const name = `${Date.now()}-${randomUUID()}.${ext}`;
  const file = path.join(root, name);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, buffer, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return { url: `/api/storage/video?name=${encodeURIComponent(name)}`, path: root, name, bytes: buffer.byteLength, contentType: contentType.split(';', 1)[0].trim() || 'video/mp4' };
}

export function getLegacyVideoStoragePath() {
  return path.resolve(path.join(process.cwd(), '..', 'video_generation_records'));
}

/** 主目录优先，其后是历史运行目录与注册表目录，用于继续读取迁移前生成的视频。 */
export function getVideoStorageRoots(configuredPath?: string) {
  const primary = path.resolve(configuredPath?.trim() || configuredRoot());
  const roots = [primary];
  const candidates = [getLegacyVideoStoragePath(), path.join(dataDir, 'videos'), ...knownMediaRoots('video')];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return roots;
}

export function resolveStoredVideoFile(root: string, name: string) {
  const base = path.resolve(root || configuredRoot());
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

/** 主目录找不到时回退到历史目录，命中即返回真实文件；都没有则返回主目录候选。 */
export function resolveStoredVideoFileWithFallback(root: string, name: string) {
  const candidates = getVideoStorageRoots(root)
    .map((candidate) => resolveStoredVideoFile(candidate, name))
    .filter(Boolean) as string[];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[0] || null;
}

export function isStoredVideo(root: string, name: string) {
  const file = resolveStoredVideoFile(root, name);
  return Boolean(file && existsSync(file));
}

export async function readStoredVideo(root: string, name: string) {
  const file = resolveStoredVideoFile(root, name);
  if (!file) return null;
  try { return { file, data: await readFile(file) }; } catch { return null; }
}
