import { getLatestUpdateProgress } from '@/lib/local-update';
import { currentVersion } from '@/lib/update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jobId = params.get('jobId') || undefined;
  const requestedVersion = params.get('currentVersion') || currentVersion;
  const progress = await getLatestUpdateProgress(jobId, requestedVersion);
  return Response.json({ progress }, { headers: { 'Cache-Control': 'no-store' } });
}
