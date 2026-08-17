import { isLocalLifecycleEnabled, releaseLocalSession, touchLocalSession } from '@/lib/local-lifecycle';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 8 && value.trim().length <= 128;
}

export async function GET() {
  return Response.json({ enabled: isLocalLifecycleEnabled() }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401, headers: noStoreHeaders });
  if (!isLocalLifecycleEnabled()) return Response.json({ enabled: false }, { status: 404, headers: noStoreHeaders });

  try {
    const body = await request.json() as { sessionId?: unknown; event?: unknown };
    if (!validSessionId(body.sessionId)) return Response.json({ error: '无效的生命周期会话' }, { status: 400, headers: noStoreHeaders });

    const sessionId = body.sessionId.trim();
    if (body.event === 'heartbeat') touchLocalSession(sessionId);
    else if (body.event === 'close') releaseLocalSession(sessionId);
    else return Response.json({ error: '无效的生命周期事件' }, { status: 400, headers: noStoreHeaders });

    return new Response(null, { status: 204, headers: noStoreHeaders });
  } catch {
    return Response.json({ error: '生命周期请求格式无效' }, { status: 400, headers: noStoreHeaders });
  }
}
