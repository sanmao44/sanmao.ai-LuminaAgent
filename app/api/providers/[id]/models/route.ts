import { isAdminRequest } from '@/lib/auth';
import { addManualProviderModel, getPublicState } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json();
    const model = await addManualProviderModel(id, {
      rawId: body?.rawId,
      displayName: body?.displayName,
      kind: body?.kind,
    });
    return Response.json({ ok: true, model, state: await getPublicState() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '登记模型失败。' }, { status: 400 });
  }
}
