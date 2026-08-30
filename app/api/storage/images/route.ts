import { persistGeneratedImages } from '@/lib/image-storage';
import { getPublicState } from '@/lib/store';
import { isTrustedAppRequest } from '@/lib/auth';
import type { GeneratedImage } from '@/lib/types';

export const runtime = 'nodejs';

function isAllowedImageReference(value: string) {
  if (value.startsWith('data:image/')) return /^data:image\/(png|jpeg|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(value) && value.length <= 140 * 1024 * 1024;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host === '169.254.169.254' || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return value.length <= 4096;
  } catch { return false; }
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const images = Array.isArray(body.images)
      ? body.images.filter((item: unknown): item is GeneratedImage => Boolean(item && typeof item === 'object' && typeof (item as GeneratedImage).url === 'string' && isAllowedImageReference((item as GeneratedImage).url))).slice(0, 16)
      : [];
    if (!images.length) return Response.json({ error: '请提供 images 数组' }, { status: 400 });
    const state = await getPublicState();
    const result = await persistGeneratedImages(images, state.settings.imageStoragePath);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '图片保存失败' }, { status: 400 });
  }
}
