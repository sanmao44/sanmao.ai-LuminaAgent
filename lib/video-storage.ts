import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratedVideo } from './types';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_DATA_URI_BYTES = 64 * 1024 * 1024;

function configuredRoot() {
  return path.resolve(process.env.SANMAO_VIDEO_STORAGE_PATH || path.join(dataDir, 'videos'));
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

async function loadVideo(url: string) {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) return null;
    const encodedBytes = Buffer.byteLength(match[3], 'utf8');
    if (encodedBytes > MAX_DATA_URI_BYTES * 1.4) throw new Error('视频 data URI 超过 64 MiB 限制，无法保存');
    const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    if (buffer.byteLength > MAX_DATA_URI_BYTES) throw new Error('视频 data URI 超过 64 MiB 限制，无法保存');
    return { buffer, ext: extensionFromContentType(match[1] || 'video/mp4') };
  }
  if (!/^https?:\/\//i.test(url)) return null;
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
  let storageError = '';
  const saved = await Promise.all(videos.map(async (video) => {
    try {
      const loaded = await loadVideo(video.url);
      if (!loaded) return video;
      const name = `${Date.now()}-${randomUUID()}.${loaded.ext}`;
      await writeFile(path.join(root, name), loaded.buffer, { flag: 'wx' });
      return { ...video, url: `/api/storage/video?name=${encodeURIComponent(name)}`, localPath: path.join(root, name) };
    } catch (error) { storageError ||= error instanceof Error ? error.message : '本地视频保存失败'; return video; }
  }));
  return { videos: saved, path: root, storageError: storageError || undefined };
}

export function resolveStoredVideoFile(root: string, name: string) {
  const base = path.resolve(root || configuredRoot());
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
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
