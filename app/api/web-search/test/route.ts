import { isAdminRequest } from '@/lib/auth';
import { testWebSearchApi } from '@/lib/web-search';
import { getWebSearchApiConfig } from '@/lib/store';
import type { WebSearchApiProvider } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const provider = String(body.provider || 'baidu-qianfan') as WebSearchApiProvider;
    const apiKey = String(body.apiKey || '').trim();
    if (!['anysearch', 'baidu-qianfan'].includes(provider)) return Response.json({ error: '不支持的联网搜索服务商。' }, { status: 400 });
    const envKey = provider === 'anysearch' ? process.env.ANYSEARCH_API_KEY?.trim() : process.env.QIANFAN_API_KEY?.trim();
    const stored = await getWebSearchApiConfig();
    const anonymousAnySearch = provider === 'anysearch' && !apiKey && !envKey && !(stored?.provider === 'anysearch' && stored.apiKey);
    const config = apiKey
      ? { provider, apiKey }
      : body.useStored === true
        ? stored?.provider === provider ? stored : envKey ? { provider, apiKey: envKey } : anonymousAnySearch ? { provider, apiKey: '' } : null
        : envKey ? { provider, apiKey: envKey } : anonymousAnySearch ? { provider, apiKey: '' } : null;
    if (!config || config.provider !== provider || (provider !== 'anysearch' && !config.apiKey)) return Response.json({ error: provider === 'anysearch' ? 'AnySearch 可直接使用匿名免费额度；如需更高额度，可设置 ANYSEARCH_API_KEY。' : '请先填写、保存或设置 QIANFAN_API_KEY。' }, { status: 400 });
    return Response.json({ ok: true, ...(await testWebSearchApi(config)) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '搜索 API 测试失败。' }, { status: 502 });
  }
}
