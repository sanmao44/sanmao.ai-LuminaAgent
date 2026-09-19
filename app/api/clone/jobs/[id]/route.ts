import { isTrustedAppRequest } from '@/lib/auth';
import { runCloneJob } from '@/lib/clone/pipeline';
import { findCloneJob, updateCloneJob } from '@/lib/clone/store';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const job = await findCloneJob(id);
  if (!job) return Response.json({ error: '任务不存在。' }, { status: 404 });
  return Response.json({ ok: true, job });
}

/**
 * 两个动作都是「就地改这条任务」，所以挂在同一个路由上：
 * · resume  —— 失败/中断后接着跑：已生成的镜头、配音会跳过，不重复计费。
 * · applied —— 成片已经放进画布，重开弹窗不再重复提示。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body && typeof body === 'object' ? String((body as { action?: unknown }).action || '') : '';
  const job = await findCloneJob(id);
  if (!job) return Response.json({ error: '任务不存在。' }, { status: 404 });
  if (action === 'applied') {
    return Response.json({ ok: true, job: await updateCloneJob(id, { appliedAt: job.appliedAt || new Date().toISOString() }) });
  }
  if (action !== 'resume') return Response.json({ error: '不支持的操作。' }, { status: 400 });
  if (job.stage === 'done' || job.stage === 'cancelled') {
    return Response.json({ error: '这条任务已经结束了，请重新设置参数再开始。' }, { status: 400 });
  }
  // 续跑是后台任务，立刻把任务交回前端轮询。
  void runCloneJob(id).catch(() => undefined);
  return Response.json({ ok: true, job: await findCloneJob(id) }, { status: 202 });
}
