import type { ProviderTransferBundle } from '@/packages/contracts/provider-transfer';
import { decryptBackupPayload, encryptBackupPayload, isEncryptedBackup, validateBackupPassword } from '@/lib/backup-crypto';
import { getProviderWithKey, getPublicState, mergeProviderTransferConfiguration } from '@/lib/store';

export const MAX_PROVIDER_TRANSFER_BYTES = 20 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseProviderTransferBundle(value: unknown): ProviderTransferBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('迁移文件内容无效');
  const bundle = value as Partial<ProviderTransferBundle>;
  if (bundle.format !== 'sanmao-ai-provider-transfer' || bundle.version !== 1 || typeof bundle.exportedAt !== 'string' || !Array.isArray(bundle.providers) || !Array.isArray(bundle.models)) {
    throw new Error('这不是受支持的 SANMAO.AI 服务商迁移文件');
  }
  if (!bundle.providers.length || bundle.providers.length > 500 || bundle.models.length > 100_000) throw new Error('迁移文件中的服务商或模型数量无效');

  const providerTypes = ['openai-compatible', 'google-gemini'];
  const providerPlatforms = ['custom', '65535', '65535-claude-code', 'apikl', 'a6api', 'openai', 'new-api', 'one-api', 'openrouter', 'siliconflow', 'deepseek', 'dashscope', 'volcengine', 'modelscope', 'google-gemini', 'apimart', 'jimeng-cli', 'agnes', 'gitee'];
  const textProtocols = ['chat-completions', 'responses', 'messages'];
  const videoTransports = ['auto', 'native-task', 'openai-videos', 'jimeng-cli', 'agnes-videos'];
  const modelKinds = ['chat', 'image', 'video', 'audio', 'unknown'];
  const modelCapabilities = ['chat', 'vision', 'generate', 'edit', 'reference', 'typography', 'transparent', 'upscale', 'fast', 'speech', 'web-search', 'video-generate', 'video-edit', 'video-extend', 'video-first-frame', 'video-reference', 'video-input', 'video-audio'];
  const modelIds = new Set<string>();
  const providerIds = new Set<string>();
  const providerModelIds = new Set<string>();
  for (const provider of bundle.providers) {
    if (!isRecord(provider) || typeof provider.id !== 'string' || !provider.id.trim() || provider.id.length > 240 || providerIds.has(provider.id)) throw new Error('迁移文件中的服务商 ID 无效或重复');
    if (typeof provider.name !== 'string' || !provider.name.trim() || provider.name.length > 512) throw new Error('迁移文件中的服务商名称无效');
    if (typeof provider.type !== 'string' || !providerTypes.includes(provider.type) || typeof provider.platform !== 'string' || !providerPlatforms.includes(provider.platform)) throw new Error(`服务商“${provider.name}”的平台类型不受支持`);
    if (typeof provider.modelLibraryEnabled !== 'boolean' || typeof provider.baseUrl !== 'string' || provider.baseUrl.length > 4096) throw new Error(`服务商“${provider.name}”的配置无效`);
    if (typeof provider.textProtocol !== 'string' || !textProtocols.includes(provider.textProtocol) || typeof provider.videoTransport !== 'string' || !videoTransports.includes(provider.videoTransport)) throw new Error(`服务商“${provider.name}”的协议配置不受支持`);
    if (typeof provider.apiKey !== 'string' || provider.apiKey.length > 65_536 || typeof provider.authHeader !== 'string' || typeof provider.authPrefix !== 'string') throw new Error(`服务商“${provider.name}”的访问凭证或认证配置无效`);
    if (provider.videoApiKey !== undefined && (typeof provider.videoApiKey !== 'string' || provider.videoApiKey.length > 65_536)) throw new Error(`服务商“${provider.name}”的视频 Key 无效`);
    const endpointValues = [provider.modelsPath, provider.chatPath, provider.imageGenerationPath, provider.imageEditPath, provider.imageUpscalePath, provider.imageUpscaleStatusPath, provider.responsesPath, provider.videoBaseUrl, provider.videoTaskPath, provider.videoTaskStatusPath, provider.videoGenerationPath, provider.videoQueryPath, provider.videoModelsPath, provider.videoPricingPath, provider.jimengCliPath];
    if (endpointValues.some((item) => typeof item !== 'string' || item.length > 4096)) throw new Error(`服务商“${provider.name}”的地址配置无效`);
    const localJimeng = provider.platform === 'jimeng-cli' || provider.videoTransport === 'jimeng-cli';
    if (!localJimeng && (!provider.baseUrl.trim() || !provider.apiKey.trim())) throw new Error(`服务商“${provider.name}”缺少 API 地址或访问密钥`);
    if (provider.jimengCliPollSeconds !== undefined && (typeof provider.jimengCliPollSeconds !== 'number' || !Number.isFinite(provider.jimengCliPollSeconds) || provider.jimengCliPollSeconds < 1 || provider.jimengCliPollSeconds > 30)) throw new Error(`服务商“${provider.name}”的本地轮询间隔无效`);
    providerIds.add(provider.id);
  }
  for (const model of bundle.models) {
    if (!isRecord(model) || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 240 || modelIds.has(model.id)) throw new Error('迁移文件中的模型 ID 无效或重复');
    if (typeof model.providerId !== 'string' || !providerIds.has(model.providerId) || typeof model.rawId !== 'string' || !model.rawId.trim() || model.rawId.length > 512) throw new Error('迁移文件中的模型没有对应服务商');
    if (typeof model.providerName !== 'string' || typeof model.displayName !== 'string' || !model.displayName.trim() || model.displayName.length > 512 || typeof model.enabled !== 'boolean' || typeof model.published !== 'boolean' || typeof model.kind !== 'string' || !modelKinds.includes(model.kind)) throw new Error('迁移文件中的模型配置无效');
    if (!Array.isArray(model.capabilities) || model.capabilities.some((capability) => typeof capability !== 'string' || !modelCapabilities.includes(capability))) throw new Error('迁移文件中的模型能力不受支持');
    if (model.source !== undefined && model.source !== 'manual' && model.source !== 'discovered') throw new Error('迁移文件中的模型来源无效');
    if (model.billing !== undefined && model.billing !== 'free' && model.billing !== 'paid' && model.billing !== 'temporary-free') throw new Error('迁移文件中的计费类型不受支持');
    if (model.nativeSearchProtocol !== undefined && !['openai-responses', 'gemini-grounding', 'native-chat'].includes(String(model.nativeSearchProtocol))) throw new Error('迁移文件中的搜索协议不受支持');
    if (model.nativeSearchOverride !== undefined && !['auto', 'enabled', 'disabled'].includes(String(model.nativeSearchOverride))) throw new Error('迁移文件中的搜索设置不受支持');
    if (model.nativeSearchDetection !== undefined && !['metadata', 'model-id', 'provider', 'manual'].includes(String(model.nativeSearchDetection))) throw new Error('迁移文件中的搜索检测方式不受支持');
    if (model.enabledByDefault !== undefined && typeof model.enabledByDefault !== 'boolean') throw new Error('迁移文件中的默认模型状态无效');
    for (const numeric of [model.contextWindow, model.maxInputTokens, model.maxOutputTokens]) {
      if (numeric !== undefined && (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 0)) throw new Error('迁移文件中的模型参数无效');
    }
    const providerRawId = `${model.providerId}\u0000${model.rawId}`;
    if (providerModelIds.has(providerRawId)) throw new Error('迁移文件中的服务商模型重复');
    providerModelIds.add(providerRawId);
    modelIds.add(model.id);
  }
  return bundle as ProviderTransferBundle;
}

export async function exportProviderTransfer(password: string) {
  validateBackupPassword(password);
  const state = await getPublicState();
  if (!state.providers.length) throw new Error('当前没有可导出的服务商');
  const providers = await Promise.all(state.providers.map(async (provider) => {
    const stored = await getProviderWithKey(provider.id);
    if (!stored) throw new Error(`服务商“${provider.name}”读取失败`);
    const legacy65535 = /65535\.space/i.test(provider.baseUrl) || /65535\.space/i.test(provider.videoBaseUrl || '');
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      platform: provider.platform || (provider.type === 'google-gemini' ? 'google-gemini' : 'custom'),
      modelLibraryEnabled: provider.modelLibraryEnabled,
      baseUrl: provider.baseUrl,
      modelsPath: provider.modelsPath || '/models',
      chatPath: provider.chatPath || '/chat/completions',
      imageGenerationPath: provider.imageGenerationPath || '/images/generations',
      imageEditPath: provider.imageEditPath || '/images/edits',
      imageUpscalePath: provider.imageUpscalePath || provider.imageEditPath || '/images/edits',
      imageUpscaleStatusPath: provider.imageUpscaleStatusPath || '',
      responsesPath: provider.responsesPath || (provider.platform === 'deepseek' ? 'https://api.deepseek.com/beta/responses' : '/responses'),
      textProtocol: provider.textProtocol || 'chat-completions',
      videoTransport: provider.videoTransport || (legacy65535 ? 'native-task' : provider.platform === 'agnes' ? 'agnes-videos' : 'auto'),
      videoBaseUrl: provider.videoBaseUrl || (legacy65535 ? 'https://task-api-1-cn.65535.space' : ''),
      videoTaskPath: provider.videoTaskPath || '/v1/tasks',
      videoTaskStatusPath: provider.videoTaskStatusPath || '/v1/tasks/{id}',
      videoGenerationPath: provider.videoGenerationPath || '/v1/videos',
      videoQueryPath: provider.videoQueryPath || '',
      videoModelsPath: provider.videoModelsPath || '/v1/models',
      videoPricingPath: provider.videoPricingPath || '/v1/pricing',
      jimengCliPath: stored.jimengCliPath || '',
      jimengCliPollSeconds: stored.jimengCliPollSeconds,
      authHeader: stored.authHeader || 'Authorization',
      authPrefix: stored.authPrefix ?? 'Bearer ',
      apiKey: stored.apiKey,
      ...(stored.videoApiKey ? { videoApiKey: stored.videoApiKey } : {}),
    };
  }));
  const bundle: ProviderTransferBundle = {
    format: 'sanmao-ai-provider-transfer',
    version: 1,
    exportedAt: new Date().toISOString(),
    providers,
    models: state.models.filter((model) => state.providers.some((provider) => provider.id === model.providerId)),
  };
  const payload = Buffer.from(JSON.stringify(bundle), 'utf8');
  const encrypted = encryptBackupPayload(payload, password);
  if (encrypted.length > MAX_PROVIDER_TRANSFER_BYTES) throw new Error('服务商迁移文件超过 20 MB');
  return encrypted;
}

export async function importProviderTransfer(file: Buffer, password: string) {
  validateBackupPassword(password);
  if (!file.length || file.length > MAX_PROVIDER_TRANSFER_BYTES) throw new Error('服务商迁移文件为空或超过 20 MB');
  if (!isEncryptedBackup(file)) throw new Error('服务商迁移文件未加密或格式无效');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptBackupPayload(file, password).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('服务商迁移文件内容损坏');
    throw error;
  }
  const bundle = parseProviderTransferBundle(parsed);
  if (!bundle.providers.length) throw new Error('迁移文件中没有服务商');
  return mergeProviderTransferConfiguration(bundle);
}
