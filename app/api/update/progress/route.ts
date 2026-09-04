import { clearUpdateProgress, getLatestUpdateProgress } from '@/lib/local-update';
import { isTrustedAppRequest } from '@/lib/auth';
import { currentVersion } from '@/lib/update';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jobId = params.get('jobId') || undefined;
  // Clear progress left by an updater after the app has already reached the
  // recorded version (including a restart that stopped at 98%).
  const progress = await getLatestUpdateProgress(jobId, currentVersion);
  // The progress record is intentionally cleared once the new server is up.
  // Keep the server version in the response so an older page can still tell
  // that the update succeeded and ask the user to refresh.
  return Response.json({ progress, currentVersion }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) {
    return Response.json({ error: '请求未通过本地安全校验' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const body = await request.json().catch(() => ({}));
  const action = body && typeof body === 'object' ? (body as { action?: unknown }).action : undefined;
  if (action !== 'dismiss') {
    return Response.json({ error: '不支持的操作' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const jobId = body && typeof body === 'object' ? (body as { jobId?: unknown }).jobId : undefined;
  await clearUpdateProgress(typeof jobId === 'string' ? jobId : undefined);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
