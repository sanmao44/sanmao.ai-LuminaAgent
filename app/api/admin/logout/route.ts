import { clearAdminCookie } from '@/lib/auth';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearAdminCookie(request) } });
}
