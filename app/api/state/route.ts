import { getPublicState } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(await getPublicState());
}
