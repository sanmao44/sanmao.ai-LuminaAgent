import { readFile } from 'node:fs/promises';
import { getPublicState } from '@/lib/store';
import { audioContentType, getDefaultAudioStoragePath, resolveStoredAudioFile } from '@/lib/audio-storage';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  const name = new URL(request.url).searchParams.get('name') || '';
  await getPublicState();
  const file = resolveStoredAudioFile(process.env.SANMAO_AUDIO_STORAGE_PATH || getDefaultAudioStoragePath(), name);
  if (!file) return new Response('Invalid file path', { status: 400 });
  try {
    const data = await readFile(file);
    return new Response(data, { headers: { 'Content-Type': audioContentType(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
