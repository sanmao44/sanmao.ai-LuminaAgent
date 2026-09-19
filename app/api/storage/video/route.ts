import { open, readFile, stat } from 'node:fs/promises';
import { isTrustedAppRequest } from '@/lib/auth';
import { ensureMediaLibrary } from '@/lib/media-library';
import { getPublicState } from '@/lib/store';
import { resolveStoredVideoFileWithFallback } from '@/lib/video-storage';

export const runtime = 'nodejs';

function contentType(file: string) {
  const lower = file.toLowerCase();
  return lower.endsWith('.webm') ? 'video/webm' : lower.endsWith('.mov') ? 'video/quicktime' : lower.endsWith('.ogv') ? 'video/ogg' : 'video/mp4';
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  // 后台把历史运行目录里的素材并入固定媒体库，不阻塞本次读取。
  void ensureMediaLibrary();
  const name = new URL(request.url).searchParams.get('name') || '';
  const state = await getPublicState();
  const file = resolveStoredVideoFileWithFallback(state.settings.videoStoragePath || '', name);
  if (!file) return new Response('Invalid file path', { status: 400 });
  try {
    const metadata = await stat(file);
    const range = request.headers.get('range');
    const headers = {
      'Content-Type': contentType(file),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (!range) {
      const data = await readFile(file);
      return new Response(data, { headers: { ...headers, 'Content-Length': String(metadata.size) } });
    }
    const match = range.match(/^bytes=(\d*)-(\d*)$/i);
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${metadata.size}` } });
    }
    const suffixLength = !match[1] ? Number(match[2]) : 0;
    if (!match[1] && (!Number.isSafeInteger(suffixLength) || suffixLength <= 0)) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${metadata.size}` } });
    }
    const start = suffixLength
      ? Math.max(0, metadata.size - suffixLength)
      : Number(match[1]);
    const requestedEnd = match[1] && match[2] ? Number(match[2]) : metadata.size - 1;
    const end = Math.min(metadata.size - 1, requestedEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= metadata.size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${metadata.size}` } });
    }
    const length = end - start + 1;
    const handle = await open(file, 'r');
    try {
      const data = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(data, 0, length, start);
      return new Response(data.subarray(0, bytesRead), {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(bytesRead),
          'Content-Range': `bytes ${start}-${start + bytesRead - 1}/${metadata.size}`,
        },
      });
    } finally {
      await handle.close();
    }
  } catch { return new Response('Not found', { status: 404 }); }
}
