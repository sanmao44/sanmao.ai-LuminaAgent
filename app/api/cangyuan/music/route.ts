import { createCangyuanCreativeGeneration, listCangyuanCreativeGenerations } from '@/apps/worker/cangyuan-creative-task';
import { parseCangyuanMusicOptions } from '@/packages/contracts/cangyuan-media';
import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 32_000) return Response.json({ error: '音乐生成请求内容过大。' }, { status: 413 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('cangyuan-music-generate');
    const raw = await request.json() as Record<string, unknown>;
    if (raw.kind !== undefined && raw.kind !== 'music') return Response.json({ error: '请求类型与音乐生成接口不匹配。' }, { status: 400 });
    if (raw.prompt !== undefined && typeof raw.prompt !== 'string') return Response.json({ error: '音乐描述必须是字符串。' }, { status: 400 });
    const options = parseCangyuanMusicOptions(raw.options);
    const modelId = String(raw.modelId || '').trim();
    const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : undefined;
    if (!modelId) return Response.json({ error: '必须选择音乐模型。' }, { status: 400 });
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim();
    if (!idempotencyKey) return Response.json({ error: '缺少 Idempotency-Key，请为每次新生成创建唯一请求标识。' }, { status: 400 });
    const task = await createCangyuanCreativeGeneration({
      kind: 'music',
      modelId,
      input: {
        ...(prompt !== undefined ? { prompt } : {}),
        ...options,
      },
      idempotencyKey,
    });
    return Response.json({ ok: task.status !== 'failed', task }, { status: task.status === 'failed' ? 502 : 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '音乐生成失败' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 50)));
  const tasks = await listCangyuanCreativeGenerations('music', limit);
  return Response.json({ ok: true, tasks, total: tasks.length }, { headers: { 'Cache-Control': 'no-store' } });
}
