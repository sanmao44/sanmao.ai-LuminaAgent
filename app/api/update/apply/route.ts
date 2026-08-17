import { isTrustedAppRequest } from '@/lib/auth';
import { startLocalUpdate } from '@/lib/local-update';
import { getUpdateStatus } from '@/lib/update';

export const runtime = 'nodejs';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

function sameLocalOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    return source.protocol === target.protocol && source.host === target.host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request) || !sameLocalOrigin(request)) {
    return Response.json({ error: '更新请求未通过本地安全校验' }, { status: 403, headers: noStoreHeaders });
  }

  try {
    const status = await getUpdateStatus(true);
    if (!status.hasUpdate) return Response.json({ error: '当前已经是最新版本' }, { status: 409, headers: noStoreHeaders });
    if (!status.canApply) return Response.json({ error: '此更新没有可验证的本地更新包，请前往 GitHub 下载' }, { status: 409, headers: noStoreHeaders });
    const result = await startLocalUpdate(status);
    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '本地更新失败' }, { status: 500, headers: noStoreHeaders });
  }
}
