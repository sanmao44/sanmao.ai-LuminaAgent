import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratedVideo } from './types';
import { knownMediaRoots, mediaDirectory } from './media-paths';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_DATA_URI_BYTES = 64 * 1024 * 1024;
type PersistedVideo = GeneratedVideo & { localPath: string };
type LoadedVideo = { buffer: Buffer; ext: string };

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
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`视频下载失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_VIDEO_BYTES) throw new Error('视频超过 1 GiB，无法保存');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_VIDEO_BYTES) throw new Error('视频超过 1 GiB，无法保存');
  return { buffer, ext: extensionFromContentType(response.headers.get('content-type') || '') || extensionFromUrl(url) || 'mp4' };
}

export async function persistGeneratedVideos(videos: GeneratedVideo[], configuredPath?: string) {
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const writtenFiles: string[] = [];
  const temporaryFiles: string[] = [];
  const failures: string[] = [];
  const saved = await Promise.all(videos.map(async (video, index): Promise<PersistedVideo | null> => {
    try {
      const loaded = await loadVideo(video.url);
      const name = `${Date.now()}-${randomUUID()}.${loaded.ext}`;
      const file = path.join(root, name);
      const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
      temporaryFiles.push(temporary);
      await writeFile(temporary, loaded.buffer, { flag: 'wx' });
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
