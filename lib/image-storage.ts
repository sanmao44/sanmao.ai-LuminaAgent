import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
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

function imageMimeFromBytes(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return '';
}

function imageExtension(mime: string) {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : mime === 'image/bmp' ? 'bmp' : 'png';
}

function invalidImageError() {
  return new Error('服务商返回的内容不是有效的 PNG、JPEG、WebP、GIF 或 BMP 图片，无法保存到本地。');
}

async function validateImageBuffer(buffer: Buffer) {
  const mime = imageMimeFromBytes(buffer);
  if (!mime) throw invalidImageError();
  try {
    await sharp(buffer).metadata();
  } catch {
    throw invalidImageError();
  }
  return mime;
}

/** Saves a provider result without exposing the provider's temporary URL to the browser. */
export async function persistImageBuffer(buffer: Buffer, _contentType = 'image/png', configuredPath?: string) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0) throw new Error('服务商没有返回有效的图片数据');
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) throw new Error('高清图片超过 100MB，无法保存');
  const mime = await validateImageBuffer(buffer);
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const name = `${Date.now()}-${randomUUID()}.${imageExtension(mime)}`;
  await writeFile(path.join(root, name), buffer, { flag: 'wx' });
  return { url: `/api/storage/file?name=${encodeURIComponent(name)}`, path: root, name, bytes: buffer.byteLength, contentType: mime };
}

async function readImageBuffer(url: string) {
  if (url.startsWith('data:image/')) {
    const match = url.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
    if (!match) throw invalidImageError();
    let buffer: Buffer;
    try {
      buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    } catch {
      throw invalidImageError();
    }
    if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
    const mime = await validateImageBuffer(buffer);
    return { buffer, mime, ext: imageExtension(mime) };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('图片结果不是可读取的 data URL 或 HTTP 地址，无法保存到本地');
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`下载服务商图片失败：HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
  const mime = await validateImageBuffer(buffer);
  return { buffer, mime, ext: imageExtension(mime) };
}

export async function persistGeneratedImages(images: GeneratedImage[], configuredPath?: string) {
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const writtenFiles: string[] = [];
  const failures: string[] = [];
  const saved = await Promise.all(images.map(async (image, index) => {
    try {
      const loaded = await readImageBuffer(image.url);
      const name = `${Date.now()}-${randomUUID()}.${loaded.ext}`;
      const file = path.join(root, name);
      writtenFiles.push(file);
      await writeFile(file, loaded.buffer, { flag: 'wx' });
      return { ...image, url: `/api/storage/file?name=${encodeURIComponent(name)}` };
    } catch (error) {
      failures.push(`第 ${index + 1} 张：${error instanceof Error ? error.message : '未知错误'}`);
      return null;
    }
  }));
  if (failures.length) {
    await Promise.all(writtenFiles.map((file) => rm(file, { force: true }).catch(() => undefined)));
    throw new Error(`本地图片保存失败：${failures.join('；')}`);
  }
  return { images: saved as GeneratedImage[], path: root };
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
  if (!file) throw new Error('无法读取原图文件，请重新选择图片后再试');
  const data = await readFile(file);
  const mime = file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : file.toLowerCase().endsWith('.webp') ? 'image/webp' : file.toLowerCase().endsWith('.gif') ? 'image/gif' : file.toLowerCase().endsWith('.bmp') ? 'image/bmp' : 'image/png';
  return `data:${mime};base64,${data.toString('base64')}`;
}
