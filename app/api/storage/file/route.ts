import { readFile } from 'node:fs/promises';
import { resolveStoredFileWithFallback } from '@/lib/image-storage';
import { getPublicState } from '@/lib/store';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || '';
  const state = await getPublicState();
  const file = resolveStoredFileWithFallback(state.settings.imageStoragePath || '', name);
  if (!file) return new Response('Invalid file path', { status: 400 });
  try {
    const data = await readFile(file);
    const type = file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.bmp') ? 'image/bmp' : 'image/png';
    return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
