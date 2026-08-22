import { unlink } from 'node:fs/promises';
import { isTrustedAppRequest } from '@/lib/auth';
import { findVideoTask, removeVideoTask } from '@/lib/video-task-store';
import { refreshVideoTask, saveVideoTaskLocally } from '@/lib/video-task-service';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const task = await findVideoTask(id);
  if (!task) return Response.json({ error: '视频任务不存在' }, { status: 404 });
  const refreshed = task.status === 'pending' || task.status === 'running' ? await refreshVideoTask(id) : task;
  return Response.json({ task: refreshed || task }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  try {
    const task = await saveVideoTaskLocally(id);
    if (!task) return Response.json({ error: '视频任务不存在' }, { status: 404 });
    return Response.json({ ok: true, task }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : '再次保存视频失败' }, { status: 400 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const existing = await findVideoTask(id);
  if (!existing) return Response.json({ error: '视频任务不存在' }, { status: 404 });
  if (existing.status === 'pending' || existing.status === 'running') {
    return Response.json({ error: '视频正在生成，完成或失败后才能删除。' }, { status: 409 });
  }

  const task = await removeVideoTask(id);
  if (!task) return Response.json({ error: '视频任务不存在' }, { status: 404 });
  await Promise.all([...new Set(task.localVideoPaths || [])].map(async (file) => {
    try { await unlink(file); } catch { /* The task record can still be removed when its file is already gone. */ }
  }));
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
