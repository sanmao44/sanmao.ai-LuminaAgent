import { readFile } from 'node:fs/promises';
import { imageMimeFromBytes, resolveStoredFileWithFallback } from '@/lib/image-storage';
import { ensureMediaLibrary } from '@/lib/media-library';
import { getPublicState } from '@/lib/store';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  // 后台把历史运行目录里的素材并入固定媒体库，不阻塞本次读取。
  void ensureMediaLibrary();
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || '';
  const state = await getPublicState();
  const file = resolveStoredFileWithFallback(state.settings.imageStoragePath || '', name);
  if (!file) return new Response('Invalid file path', { status: 400 });
  try {
    const data = await readFile(file);
    // 按字节判断真实类型：损坏的残留文件（例如只剩几十字节）不是图片，
    // 直接按“素材已丢失”返回，避免画布反复重试并误报成服务重启。
    const type = imageMimeFromBytes(data);
    if (!type) return new Response('Not a valid image', { status: 404 });
    return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
