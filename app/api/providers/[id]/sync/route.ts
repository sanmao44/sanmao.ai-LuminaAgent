import { isAdminRequest } from '@/lib/auth';
import { jimengImageModels } from '@/lib/jimeng-image';
import { discoverModels } from '@/lib/providers';
import { enableProviderModels, getProviderWithKey, getPublicState, replaceProviderModels, setProviderStatus, updateProvider } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(_request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const provider = await getProviderWithKey(id);
  if (!provider) return Response.json({ error: '服务商不存在。' }, { status: 404 });
  try {
    const originalBaseUrl = provider.baseUrl;
    const originalVideoTransport = provider.videoTransport;
    const models = provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli'
      ? [...jimengImageModels, {
          id: 'jimeng-cli-video',
          name: '即梦 · CLI 视频自动选择',
          capabilities: ['video-generate', 'video-edit', 'video-extend', 'video-first-frame', 'video-reference', 'video-audio'],
        }]
      : await discoverModels(provider);
    if (provider.baseUrl !== originalBaseUrl || provider.videoTransport !== originalVideoTransport) {
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
        videoTransport: provider.videoTransport,
        authHeader: provider.authHeader,
        authPrefix: provider.authPrefix,
      });
    }
    await replaceProviderModels(provider.id, provider.name, models);
    if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') await enableProviderModels(provider.id);
    await setProviderStatus(provider.id, 'healthy', new Date().toLocaleString('zh-CN', { hour12: false }));
    return Response.json({ ok: true, count: models.length, state: await getPublicState() });
  } catch (error) {
    await setProviderStatus(provider.id, 'error');
    return Response.json({ error: error instanceof Error ? error.message : '模型同步失败。' }, { status: 502 });
  }
}
