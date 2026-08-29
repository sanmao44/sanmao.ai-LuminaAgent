import { getAgnesMediaTransportStatus } from '@/lib/signed-media';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(getAgnesMediaTransportStatus(), { headers: { 'Cache-Control': 'no-store' } });
}
