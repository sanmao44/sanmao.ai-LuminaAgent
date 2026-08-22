import { readFile } from 'node:fs/promises';
import { isTrustedAppRequest } from '@/lib/auth';
import { getPublicState } from '@/lib/store';
import { resolveStoredVideoFile } from '@/lib/video-storage';

export const runtime = 'nodejs';

function contentType(file: string) {
  const lower = file.toLowerCase();
  return lower.endsWith('.webm') ? 'video/webm' : lower.endsWith('.mov') ? 'video/quicktime' : lower.endsWith('.ogv') ? 'video/ogg' : 'video/mp4';
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  const name = new URL(request.url).searchParams.get('name') || '';
  const state = await getPublicState();
  const file = resolveStoredVideoFile(state.settings.videoStoragePath || '', name);
  if (!file) return new Response('Invalid file path', { status: 400 });
  try {
    const data = await readFile(file);
    return new Response(data, { headers: { 'Content-Type': contentType(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
