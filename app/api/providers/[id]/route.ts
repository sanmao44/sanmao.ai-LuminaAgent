import { isAdminRequest } from '@/lib/auth';
import { getProviderPreset, resolveProviderConfiguration } from '@/lib/provider-presets';
import { getProviderWithKey, getPublicState, removeProvider, setProviderModelLibraryEnabled, updateProvider } from '@/lib/store';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json();
    const existing = await getProviderWithKey(id);
    if (!existing) return Response.json({ error: '服务商不存在。' }, { status: 404 });
    if (typeof body.modelLibraryEnabled === 'boolean' && Object.keys(body).every((key) => key === 'modelLibraryEnabled')) {
      await setProviderModelLibraryEnabled(id, body.modelLibraryEnabled);
      return Response.json({ ok: true, state: await getPublicState() });
    }
    const configuration = resolveProviderConfiguration({ ...body, platform: body.platform || existing.platform }, existing);
    const name = String(body.name || '').trim() || existing.name || getProviderPreset(configuration.platform).short;
    const apiKey = String(body.apiKey || '').trim();
    if (!configuration.baseUrl) return Response.json({ error: '请填写服务商提供的 API 地址。' }, { status: 400 });
    await updateProvider(id, { name, ...configuration, ...(apiKey ? { apiKey } : {}), ...(typeof body.modelLibraryEnabled === 'boolean' ? { modelLibraryEnabled: body.modelLibraryEnabled } : {}) });
    return Response.json({ ok: true, state: await getPublicState() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '更新失败。' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    await removeProvider(id);
    return Response.json({ ok: true, state: await getPublicState() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '删除失败。' }, { status: 500 });
  }
}
