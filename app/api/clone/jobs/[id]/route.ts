import { isTrustedAppRequest } from '@/lib/auth';
import { cleanupCloneJobDirectory, runCloneJob } from '@/lib/clone/pipeline';
import { findCloneJob, removeCloneJob, updateCloneJob } from '@/lib/clone/store';
import type { CloneShot } from '@/lib/clone/types';

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
  if (action === 'confirm') {
    if (job.stage !== 'planned') return Response.json({ error: '镜头计划尚未生成' }, { status: 400 });
    const rawShots = body && typeof body === 'object' ? (body as { shots?: unknown }).shots : undefined;
    let shots = job.shots;
    if (rawShots !== undefined) {
      if (!Array.isArray(rawShots) || rawShots.length !== job.shots.length) return Response.json({ error: '镜头计划数量不匹配' }, { status: 400 });
      const allowed = new Set(['reference', 'keyframe', 'text', 'static']);
      shots = rawShots.map((value, index) => {
        const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        const original = job.shots[index];
        const strategy = typeof source.strategy === 'string' && allowed.has(source.strategy) ? source.strategy as CloneShot['strategy'] : original.strategy;
        const assetIds = Array.isArray(source.assetIds) ? source.assetIds.filter((item): item is string => typeof item === 'string').slice(0, 16) : original.assetIds;
        return { ...original, assetIds, strategy, preserveIdentity: Boolean(source.preserveIdentity ?? original.preserveIdentity), preserveProduct: Boolean(source.preserveProduct ?? original.preserveProduct) };
      });
    }
    const updated = await updateCloneJob(id, { planConfirmed: true, shots, stage: 'queued', message: '已确认镜头计划，等待生成' });
    void runCloneJob(id).catch(() => undefined);
    return Response.json({ ok: true, job: updated }, { status: 202 });
  }
  if (action !== 'resume') return Response.json({ error: '不支持的操作。' }, { status: 400 });
  if (job.stage === 'done' || job.stage === 'cancelled') {
    return Response.json({ error: '这条任务已经结束了，请重新设置参数再开始。' }, { status: 400 });
  }
  // 续跑是后台任务，立刻把任务交回前端轮询。
  void runCloneJob(id).catch(() => undefined);
  return Response.json({ ok: true, job: await findCloneJob(id) }, { status: 202 });
}

/**
 * 删除一条任务记录。
 * 任务还在跑时先标记取消：管线在下一个检查点会退出，不会留下一条没人认领的后台任务继续生图、生视频。
 * 只删任务记录与任务目录；已经落到素材库的图片 / 视频 / 配音不删——它们可能已经放进画布了。
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const job = await findCloneJob(id);
  if (!job) return Response.json({ ok: true, deleted: false });
  const wasRunning = job.stage !== 'done' && job.stage !== 'failed' && job.stage !== 'cancelled';
  if (wasRunning) await updateCloneJob(id, { cancelRequested: true });
  const removed = await removeCloneJob(id);
  await cleanupCloneJobDirectory(id);
  return Response.json({ ok: true, deleted: Boolean(removed), cancelled: wasRunning });
}
