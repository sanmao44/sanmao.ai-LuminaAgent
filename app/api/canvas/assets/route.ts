import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getPublicState } from '@/lib/store';
import { getDefaultStoragePath } from '@/lib/image-storage';
import { getDefaultVideoStoragePath } from '@/lib/video-storage';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

function extension(name: string, mime: string) {
  const fromName = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (fromName && /^\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|ogv)$/.test(fromName)) return fromName;
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('quicktime')) return '.mov';
  return mime.startsWith('video/') ? '.mp4' : '.png';
}
export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const mime = String(request.headers.get('content-type') || 'application/octet-stream').split(';', 1)[0].toLowerCase();
    const name = decodeURIComponent(String(request.headers.get('x-file-name') || '画布素材'));
    const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : '';
    if (!kind) return Response.json({ error: '画布只支持图片和视频素材。' }, { status: 415 });
    const length = Number(request.headers.get('content-length') || 0);
    const limit = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (length > limit) return Response.json({ error: `素材超过 ${Math.round(limit / 1024 / 1024)}MB 限制。` }, { status: 413 });
    const body = Buffer.from(await request.arrayBuffer());
    if (body.byteLength > limit) return Response.json({ error: `素材超过 ${Math.round(limit / 1024 / 1024)}MB 限制。` }, { status: 413 });
    const state = await getPublicState();
    const root = kind === 'video'
      ? path.resolve(state.settings.videoStoragePath?.trim() || getDefaultVideoStoragePath())
      : path.resolve(state.settings.imageStoragePath?.trim() || getDefaultStoragePath());
    await mkdir(root, { recursive: true });
    const filename = `canvas-${Date.now()}-${randomUUID()}${extension(name, mime)}`;
    await writeFile(path.join(root, filename), body, { flag: 'wx' });
    return Response.json({ id: randomUUID(), kind, name: name || filename, url: kind === 'video' ? `/api/storage/video?name=${encodeURIComponent(filename)}` : `/api/storage/file?name=${encodeURIComponent(filename)}`, mime, size: body.byteLength });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '素材上传失败' }, { status: 400 });
  }
}
