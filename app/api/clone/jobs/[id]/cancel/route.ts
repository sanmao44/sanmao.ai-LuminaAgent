import { isTrustedAppRequest } from '@/lib/auth';
import { findCloneJob, updateCloneJob } from '@/lib/clone/store';

export const runtime = 'nodejs';

/**
 * 取消：只把本地任务标记为取消，正在跑的后台管线会在下一个检查点退出。
 * 已经提交给服务商的生图/生视频请求可能仍在计费，界面上要如实说明。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const job = await findCloneJob(id);
  if (!job) return Response.json({ error: '任务不存在。' }, { status: 404 });
  if (job.stage === 'done' || job.stage === 'failed') return Response.json({ ok: true, job });
  const updated = await updateCloneJob(id, {
    cancelRequested: true,
    stage: 'cancelled',
    message: '已取消（已经提交给服务商的生成请求可能仍在计费）',
    finishedAt: new Date().toISOString(),
  });
  return Response.json({ ok: true, job: updated });
}
