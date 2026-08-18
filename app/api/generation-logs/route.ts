import { cleanupGenerationLogs, listGenerationLogs } from '@/lib/generation-log';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const limit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 200)));
  return Response.json({ logs: await listGenerationLogs(limit) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const days = Number(body.days || 0);
    const before = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
    const result = await cleanupGenerationLogs({ before, deleteImages: body.deleteImages === true, dryRun: body.dryRun === true });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '清理日志失败' }, { status: 500 });
  }
}
