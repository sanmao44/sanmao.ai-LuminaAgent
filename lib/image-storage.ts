import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratedImage } from './types';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const legacyStoragePath = path.join(process.cwd(), '..', 'image_generation_records');
const MAX_STORED_IMAGE_BYTES = 100 * 1024 * 1024;

function configuredRoot() {
  return path.resolve(process.env.SANMAO_IMAGE_STORAGE_PATH || path.join(dataDir, 'images'));
}

export function getDefaultStoragePath() { return configuredRoot(); }
export function getLegacyStoragePath() { return path.resolve(legacyStoragePath); }

export function getStorageRoots(configuredPath?: string) {
  const primary = path.resolve(configuredPath?.trim() || configuredRoot());
  if (configuredPath?.trim() || primary === getLegacyStoragePath()) return [primary];
  return [primary, getLegacyStoragePath()];
}

function imageExtension(contentType: string) {
  return contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : contentType.includes('bmp') ? 'bmp' : 'png';
}

function safeImageExtension(contentType: string) {
  const extension = imageExtension(contentType);
  return extension === 'jpg' || extension === 'webp' || extension === 'bmp' || extension === 'png' ? extension : 'png';
}

/** Saves a provider result without exposing the provider's temporary URL to the browser. */
export async function persistImageBuffer(buffer: Buffer, contentType = 'image/png', configuredPath?: string) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0) throw new Error('服务商没有返回有效的图片数据');
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) throw new Error('高清图片超过 100MB，无法保存');
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const ext = safeImageExtension(contentType);
  const name = `${Date.now()}-${randomUUID()}.${ext}`;
  await writeFile(path.join(root, name), buffer, { flag: 'wx' });
  return { url: `/api/storage/file?name=${encodeURIComponent(name)}`, path: root, name, bytes: buffer.byteLength, contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
}

async function readImageBuffer(url: string) {
  if (url.startsWith('data:image/')) {
    const match = url.match(/^data:image\/(png|jpeg|webp|bmp);base64,(.+)$/s);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
    return { buffer, ext: match[1] === 'jpeg' ? 'jpg' : match[1] };
  }
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
  const contentType = response.headers.get('content-type') || 'image/png';
  return { buffer, ext: imageExtension(contentType) };
}

export async function persistGeneratedImages(images: GeneratedImage[], configuredPath?: string) {
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const saved = await Promise.all(images.map(async (image) => {
    try {
      const loaded = await readImageBuffer(image.url);
      if (!loaded) return image;
      const name = `${Date.now()}-${randomUUID()}.${loaded.ext}`;
      await writeFile(path.join(root, name), loaded.buffer, { flag: 'wx' });
      return { ...image, url: `/api/storage/file?name=${encodeURIComponent(name)}` };
    } catch { return image; }
  }));
  return { images: saved, path: root };
}

export function resolveStoredFile(root: string, name: string) {
  const base = path.resolve(root || configuredRoot());
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

export function resolveStoredFileWithFallback(root: string, name: string) {
  const candidates = getStorageRoots(root).map((candidate) => resolveStoredFile(candidate, name)).filter(Boolean) as string[];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[0] || null;
}

export async function resolveStoredImageReference(reference: string, configuredPath?: string) {
  if (reference.startsWith('data:image/') || /^https?:\/\//i.test(reference)) return reference;
  if (!reference.startsWith('/api/storage/file?')) return reference;
  const name = new URL(reference, 'http://sanmao.local').searchParams.get('name') || '';
  const file = resolveStoredFileWithFallback(configuredPath || '', name);
  if (!file) throw new Error('无法读取原图文件，请重新选择图片后再试。');
  const data = await readFile(file);
    const mime = file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : file.toLowerCase().endsWith('.webp') ? 'image/webp' : file.toLowerCase().endsWith('.bmp') ? 'image/bmp' : 'image/png';
  return `data:${mime};base64,${data.toString('base64')}`;
}
