import { isTrustedAppRequest } from '@/lib/auth';
import { findCloneJob } from '@/lib/clone/store';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const job = await findCloneJob(id);
  if (!job) return Response.json({ error: '任务不存在。' }, { status: 404 });
  return Response.json({ ok: true, job });
}
