import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { resolveStoredImageReference } from './image-storage';

export const ALIYUN_UPSCALE_MAX_BYTES = 5 * 1024 * 1024;
export const ALIYUN_UPSCALE_MAX_WIDTH = 1920;
export const ALIYUN_UPSCALE_MAX_HEIGHT = 1080;

type ImageBytes = { bytes: Buffer; mime: string };

function parseDataUrl(value: string): ImageBytes | null {
  const match = String(value || '').match(/^data:(image\/[^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  try {
    return { mime: match[1].toLowerCase(), bytes: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8') };
  } catch { return null; }
}

function dataUrl(bytes: Buffer, mime: string) {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function readImageBytes(reference: string, storagePath?: string): Promise<ImageBytes> {
  const input = String(reference || '').trim();
  const data = parseDataUrl(input);
  if (data) return data;
  if (input.startsWith('/api/storage/file?')) {
    const resolved = await resolveStoredImageReference(input, storagePath);
    const parsed = parseDataUrl(resolved);
    if (parsed) return parsed;
  }
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) throw new Error('无法读取原图，请确认图片地址仍然有效');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 25 * 1024 * 1024) throw new Error('原图过大，无法进行高清处理');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('原图过大，无法进行高清处理');
    return { bytes, mime: response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || 'image/png' };
  }
  throw new Error('无法读取原图，请重新选择图片后再试');
}

async function encode(bytes: Buffer, hasAlpha: boolean, maxWidth: number, maxHeight: number, quality: number): Promise<ImageBytes> {
  const pipeline = sharp(bytes, { failOn: 'none' }).rotate().resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true });
  if (hasAlpha) return { bytes: await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(), mime: 'image/png' };
  return { bytes: await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer(), mime: 'image/jpeg' };
}

async function prepareCloudUpscaleImage(reference: string, storagePath: string | undefined, providerLabel: string) {
  const original = await readImageBytes(reference, storagePath);
  const metadata = await sharp(original.bytes, { failOn: 'none' }).metadata();
  const width = Math.max(1, metadata.width || 1);
  const height = Math.max(1, metadata.height || 1);
  const hasAlpha = Boolean(metadata.hasAlpha);
  let maxWidth = ALIYUN_UPSCALE_MAX_WIDTH;
  let maxHeight = ALIYUN_UPSCALE_MAX_HEIGHT;
  let quality = 88;
  let encoded = await encode(original.bytes, hasAlpha, maxWidth, maxHeight, quality);
  for (let attempt = 0; attempt < 7 && encoded.bytes.byteLength > ALIYUN_UPSCALE_MAX_BYTES; attempt += 1) {
    quality = Math.max(55, quality - 6);
    maxWidth = Math.max(768, Math.round(maxWidth * 0.9));
    maxHeight = Math.max(432, Math.round(maxHeight * 0.9));
    encoded = await encode(original.bytes, hasAlpha, maxWidth, maxHeight, quality);
  }
  if (encoded.bytes.byteLength > ALIYUN_UPSCALE_MAX_BYTES && hasAlpha) {
    encoded = await encode(original.bytes, false, maxWidth, maxHeight, 72);
  }
  if (encoded.bytes.byteLength > ALIYUN_UPSCALE_MAX_BYTES) throw new Error(`这张图片超过${providerLabel}超分支持的 5MB 限制，请选择较小图片`);
  const outputMeta = await sharp(encoded.bytes, { failOn: 'none' }).metadata();
  return {
    dataUrl: dataUrl(encoded.bytes, encoded.mime),
    bytes: encoded.bytes,
    mime: encoded.mime,
    width: Math.max(1, outputMeta.width || width),
    height: Math.max(1, outputMeta.height || height),
    originalWidth: width,
    originalHeight: height,
    changed: encoded.bytes.byteLength !== original.bytes.byteLength || width > ALIYUN_UPSCALE_MAX_WIDTH || height > ALIYUN_UPSCALE_MAX_HEIGHT,
  };
}

/** Applies VIAPI's safe input limits and returns a self-contained image data URL. */
export async function prepareAliyunUpscaleImage(reference: string, storagePath?: string) {
  return prepareCloudUpscaleImage(reference, storagePath, '阿里云');
}

/** Applies Tencent Cloud's safe input limits and returns a self-contained image data URL. */
export async function prepareTencentUpscaleImage(reference: string, storagePath?: string) {
  return prepareCloudUpscaleImage(reference, storagePath, '腾讯云');
}

export async function readLocalImageBuffer(reference: string, storagePath?: string) {
  const input = String(reference || '').trim();
  const parsed = parseDataUrl(input);
  if (parsed) return parsed;
  if (input.startsWith('/api/storage/file?')) {
    const resolved = await resolveStoredImageReference(input, storagePath);
    const result = parseDataUrl(resolved);
    if (result) return result;
  }
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) throw new Error('无法读取原图');
    return { bytes: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || 'image/png' };
  }
  throw new Error('无法读取原图');
}
