import { isAdminRequest } from '@/lib/auth';
import { resolveProviderConfiguration } from '@/lib/provider-presets';
import { testProviderConnection } from '@/lib/providers';
import { getProviderWithKey } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const providerId = String(body.providerId || '').trim();
    const saved = providerId ? await getProviderWithKey(providerId) : null;
    let apiKey = String(body.apiKey || '').trim();
    if (!apiKey && saved) apiKey = saved.apiKey;
    const localJimeng = String(body.videoTransport || saved?.videoTransport || '') === 'jimeng-cli' || String(body.platform || saved?.platform || '') === 'jimeng-cli';
    if (!apiKey && !localJimeng) return Response.json({ error: '请先填写访问密钥。' }, { status: 400 });
    const configuration = resolveProviderConfiguration({ ...body, platform: body.platform || saved?.platform }, saved);
    if (!configuration.baseUrl && configuration.videoTransport !== 'jimeng-cli' && configuration.platform !== 'jimeng-cli') return Response.json({ error: '请先填写服务商提供的 API 地址。' }, { status: 400 });
    const result = await testProviderConnection({ id: providerId || 'test', name: saved?.name || '连接测试', apiKey, videoApiKey: String(body.videoApiKey || '').trim() || saved?.videoApiKey, ...configuration });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const failure = error as Error & { status?: number; providerStatus?: number; providerRequestId?: string; providerUrl?: string; code?: string };
    const upstreamStatus = Number(failure.providerStatus || failure.status || 0);
    const status = upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 502;
    return Response.json({
      error: failure instanceof Error ? failure.message : '连接测试失败。',
      providerStatus: upstreamStatus || undefined,
      requestId: failure.providerRequestId || undefined,
      endpoint: failure.providerUrl || undefined,
      code: failure.code || undefined,
    }, { status });
  }
}
