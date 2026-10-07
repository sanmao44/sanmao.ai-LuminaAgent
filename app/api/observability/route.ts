import { isAdminRequest } from '@/lib/auth';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { recentRuntimeEvents } from '@/packages/observability/index';
import path from 'node:path';

export const runtime = 'nodejs';

/** Read-only operational view over redacted runtime lifecycle events. */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const limit = new URL(request.url).searchParams.get('limit') || undefined;
  const events = await recentRuntimeEvents({
    directory: path.join(resolveLocalDataDir(), 'runtime-events'),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  return Response.json({ events }, { headers: { 'Cache-Control': 'no-store' } });
}
