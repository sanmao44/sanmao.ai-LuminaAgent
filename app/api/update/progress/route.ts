import { getLatestUpdateProgress } from '@/lib/local-update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jobId = params.get('jobId') || undefined;
  // Keep this request compatible with the updater runtime shipped by older
  // releases. The client compares versions after the restarted app is ready.
  const progress = await getLatestUpdateProgress(jobId);
  return Response.json({ progress }, { headers: { 'Cache-Control': 'no-store' } });
}
