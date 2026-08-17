import { isAdminRequest } from '@/lib/auth';
import { getPublicState, patchModel } from '@/lib/store';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    for (const key of ['displayName', 'kind', 'enabled', 'published', 'capabilities']) if (key in body) allowed[key] = body[key];
    await patchModel(id, allowed as any);
    return Response.json({ ok: true, state: await getPublicState() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '更新模型失败。' }, { status: 400 });
  }
}
