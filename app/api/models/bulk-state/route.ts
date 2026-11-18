import { isAdminRequest } from '@/lib/auth';
import { getPublicState, setModelsEnabled } from '@/lib/store';
import { createModelLibraryApplication, ModelLibraryInputError } from '@/apps/api/model-library-application';
import type { BulkModelStateInput } from '@/packages/contracts/model-library';

export const runtime = 'nodejs';
const modelLibraryApplication = createModelLibraryApplication({ setModelsEnabled });

export async function PATCH(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || !Array.isArray((body as { ids?: unknown }).ids) || typeof (body as { enabled?: unknown }).enabled !== 'boolean') {
      return Response.json({ error: '批量模型状态参数无效。' }, { status: 400 });
    }
    const { ids, enabled } = body as { ids: unknown[]; enabled: boolean };
    if (ids.some((id) => typeof id !== 'string')) {
      return Response.json({ error: '模型列表为空或包含无效项目。' }, { status: 400 });
    }
    const input: BulkModelStateInput = { ids: ids as string[], enabled };
    const result = await modelLibraryApplication.setBulkModelState(input);
    return Response.json({ ok: true, ...result, state: await getPublicState() });
  } catch (error) {
    const status = error instanceof ModelLibraryInputError ? 400 : error instanceof Error && /模型不存在/.test(error.message) ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : '批量更新模型失败。' }, { status });
  }
}
