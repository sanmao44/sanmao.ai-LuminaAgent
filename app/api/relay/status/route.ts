import { getPublicMediaTransportStatus } from '@/lib/signed-media';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(getPublicMediaTransportStatus(), { headers: { 'Cache-Control': 'no-store' } });
}
