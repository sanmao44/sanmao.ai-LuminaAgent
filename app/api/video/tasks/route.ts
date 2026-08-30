import { isTrustedAppRequest } from '@/lib/auth';
import { listVideoTasksPage } from '@/lib/video-task-store';
import { refreshVideoTask } from '@/lib/video-task-service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const requestedLimit = params.get('pageSize') || params.get('limit') || '50';
  const pageSize = Math.min(100, Math.max(1, Number(requestedLimit)));
  const page = Math.max(1, Number(params.get('page') || 1));
  const source = params.get('source') || 'all';
  const media = params.get('media') || 'video';
  const result = await listVideoTasksPage({
    page,
    pageSize,
    search: params.get('search') || '',
    source,
    media,
  });
  const refreshed = await Promise.all(result.tasks.map((task) => task.status === 'pending' || task.status === 'running' ? refreshVideoTask(task.id) : task));
  return Response.json({ ...result, tasks: refreshed.filter(Boolean) }, { headers: { 'Cache-Control': 'no-store' } });
}
