import { getUpdateStatus } from '@/lib/update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('force') === '1';
  return Response.json(await getUpdateStatus(force), { headers: { 'Cache-Control': 'no-store' } });
}
