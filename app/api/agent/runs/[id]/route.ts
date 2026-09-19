import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest } from '@/lib/runtime-operation';
import { RESUME_TIMEOUT_MS, resumeAgentRun } from '@/lib/agent/resume';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * 待到确认操作的续跑（任务书 §15）。
 *
 * 请求体只认 action。执行哪个 tool call 完全由服务端存下来的那份记录决定，
 * 前端既改不了参数，也伪造不出一个新调用。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '非法请求来源。' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  let release: (() => Promise<void>) | null = null;
  try {
    release = await beginRuntimeRequest('agent');
  } catch {
    // 正在更新或维护时不开新的外部执行。
    return Response.json({ error: '应用正在更新或维护，请稍后再试。', retryable: true }, { status: 409 });
  }
  try {
    const { id } = await context.params;
    const outcome = await resumeAgentRun({ id: decode(id), action: (body as { action?: unknown })?.action, signal: AbortSignal.timeout(RESUME_TIMEOUT_MS) });
    return Response.json(outcome.body, { status: outcome.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '续跑失败，请重试。' }, { status: 502 });
  } finally {
    await release();
  }
}