import { isTrustedAppRequest } from '@/lib/auth';
import { publicUpscaleTask, refreshUpscaleTask } from '@/lib/upscale-service';
import { findUpscaleTask, removeUpscaleTask } from '@/lib/upscale-task-store';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const id = (await context.params).id;
  const task = await refreshUpscaleTask(id);
  if (!task) return Response.json({ error: '高清任务不存在。' }, { status: 404 });
  return Response.json({ task: publicUpscaleTask(task), images: task.localImageUrl ? [{ url: task.localImageUrl }] : [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const id = (await context.params).id;
  const task = await findUpscaleTask(id);
  if (!task) return Response.json({ error: '高清任务不存在。' }, { status: 404 });
  if (task.status === 'queued' || task.status === 'processing') return Response.json({ error: '高清任务正在处理中，完成或失败后才能删除。' }, { status: 409 });
  await removeUpscaleTask(id);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
