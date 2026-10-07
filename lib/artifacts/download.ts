import { readFile } from 'node:fs/promises';
import { isValidArtifactId } from './sanitize';
import { artifactStore, type ArtifactStore } from './storage';

/** 中文文件名走 RFC 5987 `filename*`，同时保留 ASCII 回退值。 */
export function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').trim() || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function buildArtifactResponse(id: string, store: ArtifactStore = artifactStore): Promise<Response> {
  if (!isValidArtifactId(id)) return new Response('Invalid artifact id', { status: 400 });
  const stored = await store.read(id.trim());
  if (!stored) return new Response('Not found', { status: 404 });
  let data: Buffer;
  try {
    data = await readFile(stored.filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': stored.descriptor.mimeType,
      'Content-Length': String(data.length),
      'Content-Disposition': contentDisposition(stored.descriptor.name),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
