import { isAdminRequest } from '@/lib/auth';
import { clearWebSearchApiConfig, getPublicState, patchSettings, setWebSearchApiConfig } from '@/lib/store';
import type { WebSearchApiProvider } from '@/lib/types';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    await patchSettings({
      ...('agentModelId' in body ? { agentModelId: body.agentModelId || null } : {}),
      ...('defaultImageModelId' in body ? { defaultImageModelId: body.defaultImageModelId || null } : {}),
      ...('defaultProviderId' in body ? { defaultProviderId: body.defaultProviderId || null } : {}),
      ...('imageStoragePath' in body ? { imageStoragePath: String(body.imageStoragePath || '') } : {}),
    });
    if (body.webSearchApi && typeof body.webSearchApi === 'object') {
      const provider = (String(body.webSearchApi.provider || 'baidu-qianfan') || 'baidu-qianfan') as WebSearchApiProvider;
      const apiKey = String(body.webSearchApi.apiKey || '').trim();
      if (!['anysearch', 'baidu-qianfan'].includes(provider)) throw new Error('不支持的联网搜索服务商');
      if (provider === 'anysearch' && apiKey) throw new Error('AnySearch Key 请配置为环境变量 ANYSEARCH_API_KEY');
      if (apiKey) await setWebSearchApiConfig(provider, apiKey);
      else if (body.webSearchApi.clear === true) await clearWebSearchApiConfig();
    }
    return Response.json({ ok: true, state: await getPublicState() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '保存设置失败。' }, { status: 400 });
  }
}
