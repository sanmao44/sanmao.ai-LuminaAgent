import { getActiveUpdateProgress, getUpdateProgress } from '@/lib/local-update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId') || undefined;
  const progress = jobId ? getUpdateProgress(jobId) : getActiveUpdateProgress();
  return Response.json({ progress }, { headers: { 'Cache-Control': 'no-store' } });
}
