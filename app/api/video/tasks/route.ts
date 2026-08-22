import { isTrustedAppRequest } from '@/lib/auth';
import { listVideoTasks } from '@/lib/video-task-store';
import { refreshVideoTask } from '@/lib/video-task-service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 50)));
  const tasks = await listVideoTasks(limit);
  const refreshed = await Promise.all(tasks.map((task) => task.status === 'pending' || task.status === 'running' ? refreshVideoTask(task.id) : task));
  return Response.json({ tasks: refreshed.filter(Boolean) }, { headers: { 'Cache-Control': 'no-store' } });
}
