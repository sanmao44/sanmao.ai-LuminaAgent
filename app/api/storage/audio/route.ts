import { readFile } from 'node:fs/promises';
import { ensureMediaLibrary } from '@/lib/media-library';
import { getPublicState } from '@/lib/store';
import { audioContentType, resolveStoredAudioFileWithFallback } from '@/lib/audio-storage';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  // 后台把历史运行目录里的素材并入固定媒体库，不阻塞本次读取。
  void ensureMediaLibrary();
  const name = new URL(request.url).searchParams.get('name') || '';
  await getPublicState();
  const file = resolveStoredAudioFileWithFallback('', name);
  if (!file) return new Response('Invalid file path', { status: 400 });
  try {
    const data = await readFile(file);
    return new Response(data, { headers: { 'Content-Type': audioContentType(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
