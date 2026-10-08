import { isTrustedAppRequest } from '@/lib/auth';
import { publicUpscaleTask } from '@/lib/upscale-service';
import { cancelUpscaleTask, getUpscaleTask, removeUpscaleTask, retryUpscaleTask, TaskControlConflictError } from '@/apps/worker/task-control';
import { getUpscaleCatalogModel } from '@/lib/upscale-catalog';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const id = (await context.params).id;
  const task = await getUpscaleTask(id);
  if (!task) return Response.json({ error: '高清任务不存在。' }, { status: 404 });
  const model = getUpscaleCatalogModel(task.model);
  const publicTask = publicUpscaleTask(task);
  return Response.json({
    task: publicTask,
    model: model ? { id: model.id, name: model.displayName, provider: model.providerName } : undefined,
    images: publicTask?.localImageUrl ? [{ url: publicTask.localImageUrl }] : [],
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/** 取消 / 重试高清任务：取消只停止本地轮询，重试用保存下来的原图引用重新提交。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const id = (await context.params).id;
  let action = '';
  try { action = String((await request.json() as { action?: unknown })?.action || ''); } catch {}
  if (action !== 'cancel' && action !== 'retry') return Response.json({ error: '不支持的操作。' }, { status: 400 });
  try {
    const task = action === 'cancel' ? await cancelUpscaleTask(id) : await retryUpscaleTask(id);
    if (!task) return Response.json({ error: '高清任务不存在。' }, { status: 404 });
    return Response.json({ ok: true, task: publicUpscaleTask(task) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const id = (await context.params).id;
  try {
    const task = await removeUpscaleTask(id);
    if (!task) return Response.json({ error: '高清任务不存在。' }, { status: 404 });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof TaskControlConflictError) return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '删除高清任务失败' }, { status: 500 });
  }
}
