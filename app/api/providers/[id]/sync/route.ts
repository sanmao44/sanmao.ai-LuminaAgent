import { isAdminRequest } from '@/lib/auth';
import { discoverModels } from '@/lib/providers';
import { getProviderWithKey, getPublicState, replaceProviderModels, setProviderStatus, updateProvider } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(_request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const provider = await getProviderWithKey(id);
  if (!provider) return Response.json({ error: '服务商不存在。' }, { status: 404 });
  try {
    const originalBaseUrl = provider.baseUrl;
    const models = await discoverModels(provider);
    if (provider.baseUrl !== originalBaseUrl) {
      await updateProvider(provider.id, {
        name: provider.name,
        type: provider.type,
        platform: provider.platform,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        modelsPath: provider.modelsPath,
        chatPath: provider.chatPath,
        imageGenerationPath: provider.imageGenerationPath,
        imageEditPath: provider.imageEditPath,
        imageUpscalePath: provider.imageUpscalePath,
        imageUpscaleStatusPath: provider.imageUpscaleStatusPath,
        responsesPath: provider.responsesPath,
        authHeader: provider.authHeader,
        authPrefix: provider.authPrefix,
      });
    }
    await replaceProviderModels(provider.id, provider.name, models);
    await setProviderStatus(provider.id, 'healthy', new Date().toLocaleString('zh-CN', { hour12: false }));
    return Response.json({ ok: true, count: models.length, state: await getPublicState() });
  } catch (error) {
    await setProviderStatus(provider.id, 'error');
    return Response.json({ error: error instanceof Error ? error.message : '模型同步失败。' }, { status: 502 });
  }
}
