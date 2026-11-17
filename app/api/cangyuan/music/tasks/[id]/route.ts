import { getCangyuanCreativeGeneration } from '@/apps/worker/cangyuan-creative-task';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const refresh = new URL(request.url).searchParams.get('refresh') !== 'false';
  const task = await getCangyuanCreativeGeneration(id, 'music', refresh);
  if (!task) return Response.json({ ok: false, error: '音乐任务不存在' }, { status: 404 });
  return Response.json({ ok: true, task }, { headers: { 'Cache-Control': 'no-store' } });
}
