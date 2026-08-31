import { getPublicMediaTransportStatusLive } from '@/lib/signed-media';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(await getPublicMediaTransportStatusLive(), { headers: { 'Cache-Control': 'no-store' } });
}
