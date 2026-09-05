import { isAdminRequest } from '@/lib/auth';
import { clearWebSearchApiConfig, getPublicState, patchSettings, setWebSearchApiConfig } from '@/lib/store';
import { isLikelyBaiduQianfanApiKey, normalizeSearchApiKey } from '@/lib/web-search';
import type { WebSearchApiProvider } from '@/lib/types';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    await patchSettings({
      ...('agentModelId' in body ? { agentModelId: body.agentModelId || null } : {}),
      ...('defaultImageModelId' in body ? { defaultImageModelId: body.defaultImageModelId || null } : {}),
      ...('defaultVideoModelId' in body ? { defaultVideoModelId: body.defaultVideoModelId || null } : {}),
      ...('defaultProviderId' in body ? { defaultProviderId: body.defaultProviderId || null } : {}),
      ...('imageStoragePath' in body ? { imageStoragePath: String(body.imageStoragePath || '') } : {}),
      ...('videoStoragePath' in body ? { videoStoragePath: String(body.videoStoragePath || '') } : {}),
    });
    if (body.webSearchApi && typeof body.webSearchApi === 'object') {
      const provider = (String(body.webSearchApi.provider || 'baidu-qianfan') || 'baidu-qianfan') as WebSearchApiProvider;
      const apiKey = normalizeSearchApiKey(body.webSearchApi.apiKey);
      if (!['anysearch', 'baidu-qianfan'].includes(provider)) throw new Error('不支持的联网搜索服务商');
      if (provider === 'anysearch' && apiKey) throw new Error('AnySearch Key 请配置为环境变量 ANYSEARCH_API_KEY');
      if (provider === 'baidu-qianfan' && apiKey && !isLikelyBaiduQianfanApiKey(apiKey)) throw new Error('百度千帆 API Key 格式不正确，请粘贴控制台生成的完整 Key（通常以 bce-v3/ 开头）');
      if (apiKey) await setWebSearchApiConfig(provider, apiKey);
      else if (body.webSearchApi.clear === true) await clearWebSearchApiConfig();
    }
    return Response.json({ ok: true, state: await getPublicState() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '保存设置失败。' }, { status: 400 });
  }
}
