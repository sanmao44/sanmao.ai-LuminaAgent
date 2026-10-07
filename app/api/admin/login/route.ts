import { adminCookie, adminProtectionEnabled, verifyAdminPassword } from '@/lib/auth';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!verifyAdminPassword(String(body.password || ''))) return Response.json({ error: '管理员密码错误。' }, { status: 401 });
  const headers = new Headers();
  if (adminProtectionEnabled()) headers.set('Set-Cookie', adminCookie(request));
  return Response.json({ ok: true }, { headers });
}
