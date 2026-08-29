import { getLatestUpdateProgress } from '@/lib/local-update';
import { currentVersion } from '@/lib/update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jobId = params.get('jobId') || undefined;
  // Clear progress left by an updater after the app has already reached the
  // recorded version (including a restart that stopped at 98%).
  const progress = await getLatestUpdateProgress(jobId, currentVersion);
  return Response.json({ progress }, { headers: { 'Cache-Control': 'no-store' } });
}
