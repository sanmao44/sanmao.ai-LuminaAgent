import { getUpdateProgress } from '@/lib/local-update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId')?.trim();
  if (!jobId) return Response.json({ error: '缺少更新任务 ID' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const progress = getUpdateProgress(jobId);
  if (!progress) return Response.json({ error: '更新任务不存在或已过期' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(progress, { headers: { 'Cache-Control': 'no-store' } });
}
