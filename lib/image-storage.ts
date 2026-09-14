import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { GeneratedImage } from './types';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const legacyStoragePath = path.join(process.cwd(), '..', 'image_generation_records');
const MAX_STORED_IMAGE_BYTES = 100 * 1024 * 1024;

export type ImageDownloadAuth = {
  headers: Record<string, string>;
  trustedHosts: string[];
  trustedHostSuffixes?: string[];
};

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

function canUseDownloadAuth(url: string, auth?: ImageDownloadAuth) {
  if (!auth?.headers || (!auth.trustedHosts.length && !auth.trustedHostSuffixes?.length)) return false;
  try {
    const target = new URL(url);
    // Never forward an API key over plain HTTP, even when the hostname matches.
    if (target.protocol !== 'https:') return false;
    if (auth.trustedHosts.some((host) => host === target.host)) return true;
    return auth.trustedHostSuffixes?.some((suffix) => target.hostname === suffix || target.hostname.endsWith(`.${suffix}`)) || false;
  } catch {
    return false;
  }
}

async function fetchImageResponse(url: string, downloadAuth?: ImageDownloadAuth) {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    const headers = canUseDownloadAuth(currentUrl, downloadAuth) ? downloadAuth!.headers : undefined;
    const response = await fetch(currentUrl, {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
      redirect: 'manual',
    });
    if ((response.status === 401 || response.status === 403) && headers) {
      const unauthenticated = await fetch(currentUrl, {
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
        redirect: 'manual',
      });
      if (unauthenticated.status !== 401 && unauthenticated.status !== 403) return unauthenticated;
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount === 3) throw new Error('下载服务商图片失败：重定向次数过多');
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error('下载服务商图片失败：重定向次数过多');
}

function compactBase64(value: string) {
  const compact = value.trim().replace(/\s/g, '');
  return compact.length >= 16 && compact.length % 4 !== 1 && /^[A-Za-z0-9+/=_-]+$/.test(compact) ? compact : '';
}

function imageReferenceFromPayload(value: unknown, key = '', depth = 0): { url?: string; data?: string } | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^data:image\//i.test(text)) return { data: text };
    if (/^https?:\/\//i.test(text) && /(?:url|uri|href|image|output|result|download|file)/i.test(key)) return { url: text };
    if (/(?:base64|b64|image|data|result|output)/i.test(key)) {
      const encoded = compactBase64(text);
      if (encoded) return { data: `data:image/png;base64,${encoded}` };
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageReferenceFromPayload(item, key, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:task[_-]?id|request[_-]?id|status|state|message|error|model|prompt)$/i.test(childKey)) continue;
    const found = imageReferenceFromPayload(childValue, childKey, depth + 1);
    if (found) return found;
  }
  return null;
}

async function readImagePayload(value: unknown, sourceUrl: string, downloadAuth: ImageDownloadAuth | undefined, depth: number): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  if (typeof value !== 'string') throw invalidImageError();
  const reference = value.trim();
  if (reference.startsWith('data:image/')) {
    const match = reference.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
    if (!match) throw invalidImageError();
    const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    const mime = await validateImageBuffer(buffer);
    return { buffer, mime, ext: imageExtension(mime) };
  }
  const encoded = compactBase64(reference);
  if (encoded) {
    const buffer = Buffer.from(encoded, 'base64');
    try {
      const mime = await validateImageBuffer(buffer);
      return { buffer, mime, ext: imageExtension(mime) };
    } catch { /* It may be a JSON/base64 wrapper; continue below. */ }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(reference); } catch { throw invalidImageError(); }
  const nested = imageReferenceFromPayload(parsed);
  if (!nested || depth >= 2) throw invalidImageError();
  if (nested.data) return readImagePayload(nested.data, sourceUrl, downloadAuth, depth + 1);
  if (nested.url && nested.url !== sourceUrl) return readImageBuffer(nested.url, downloadAuth, depth + 1);
  throw invalidImageError();
}

async function readImageBuffer(url: string, downloadAuth?: ImageDownloadAuth, depth = 0): Promise<{ buffer: Buffer; mime: string; ext: string }> {
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
  const response = await fetchImageResponse(url, downloadAuth);
  if (!response.ok) throw new Error(`下载服务商图片失败：HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) throw new Error('图片超过 100MB，无法保存');
  let mime: string;
  try {
    mime = await validateImageBuffer(buffer);
  } catch {
    if (depth < 2) {
      try {
        return await readImagePayload(buffer.toString('utf8'), url, downloadAuth, depth + 1);
      } catch { /* Preserve the safe metadata error below. */ }
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim() || 'unknown';
    const host = (() => { try { return new URL(url).host; } catch { return 'unknown'; } })();
    throw new Error(`${invalidImageError().message}（来源 ${host}，HTTP ${response.status}，Content-Type ${contentType}）`);
  }
  return { buffer, mime, ext: imageExtension(mime) };
}

export async function persistGeneratedImages(images: GeneratedImage[], configuredPath?: string, downloadAuth?: ImageDownloadAuth) {
  const root = path.resolve(configuredPath?.trim() || configuredRoot());
  await mkdir(root, { recursive: true });
  const writtenFiles: string[] = [];
  const failures: string[] = [];
  const saved = await Promise.all(images.map(async (image, index) => {
    try {
      const loaded = await readImageBuffer(image.url, downloadAuth);
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
