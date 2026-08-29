import { readSignedAgnesMedia } from '@/lib/signed-media';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const media = await readSignedAgnesMedia(token);
  if (!media) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(media.data, {
    status: 200,
    headers: {
      'Content-Type': media.mime,
      'Content-Length': String(media.data.byteLength),
      'Cache-Control': 'private, max-age=60, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
