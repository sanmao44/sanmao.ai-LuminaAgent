import { isTrustedAppRequest } from '@/lib/auth';
import { cancelVideoTask, getVideoTask, removeVideoTask, retryVideoTask, saveVideoTask, TaskControlConflictError } from '@/apps/worker/task-control';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const task = await getVideoTask(id);
  if (!task) return Response.json({ error: '视频任务不存在' }, { status: 404 });
  return Response.json({ task }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  try {
    const task = await saveVideoTask(id);
    if (!task) return Response.json({ error: '视频任务不存在' }, { status: 404 });
    return Response.json({ ok: true, task }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : '再次保存视频失败' }, { status: 400 }); }
}

/** 取消 / 重试长任务。取消只停止本地轮询；重试按原参数重新提交一条新任务。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  let action = '';
  try { action = String((await request.json() as { action?: unknown })?.action || ''); } catch {}
  if (action !== 'cancel' && action !== 'retry') return Response.json({ error: '不支持的操作。' }, { status: 400 });
  try {
    const task = action === 'cancel' ? await cancelVideoTask(id) : await retryVideoTask(id);
    if (!task) return Response.json({ error: '视频任务不存在' }, { status: 404 });
    return Response.json({ ok: true, task }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  try {
    const task = await removeVideoTask(id);
    if (!task) return Response.json({ error: '视频任务不存在' }, { status: 404 });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof TaskControlConflictError) return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '删除视频任务失败' }, { status: 500 });
  }
}
