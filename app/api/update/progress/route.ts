import { getLatestUpdateProgress } from '@/lib/local-update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId') || undefined;
  const progress = await getLatestUpdateProgress(jobId);
  return Response.json({ progress }, { headers: { 'Cache-Control': 'no-store' } });
}
