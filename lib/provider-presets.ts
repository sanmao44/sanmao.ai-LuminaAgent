import type { ProviderConnection, ProviderPlatform, ProviderType } from './types';

export type ProviderPreset = {
  value: ProviderPlatform;
  label: string;
  short: string;
  description: string;
  type: ProviderType;
  baseUrl: string;
  needsBaseUrl: boolean;
  apiKeyUrl?: string;
  notice?: string;
  noticeTone?: 'success' | 'accent';
  recommended?: boolean;
  showInPicker?: boolean;
};

export type ResolvedProviderConfiguration = {
  platform: ProviderPlatform;
  type: ProviderType;
  baseUrl: string;
  modelsPath: string;
  chatPath: string;
  imageGenerationPath: string;
  imageEditPath: string;
  imageUpscalePath: string;
  imageUpscaleStatusPath: string;
  responsesPath: string;
  authHeader: string;
  authPrefix: string;
};

const standardCompatibility = {
  modelsPath: '/models',
  chatPath: '/chat/completions',
  imageGenerationPath: '/images/generations',
  imageEditPath: '/images/edits',
  imageUpscalePath: '/images/edits',
  imageUpscaleStatusPath: '',
  responsesPath: '/responses',
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
};

function defaultResponsesPath(platform: ProviderPlatform) {
  return platform === 'deepseek' ? 'https://api.deepseek.com/beta/responses' : standardCompatibility.responsesPath;
}

export const providerPresets: ProviderPreset[] = [
  { value: '65535', label: '65535', short: '65535', description: 'OpenAI 兼容平台，API 地址从 65535 控制台获取', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, apiKeyUrl: 'https://my.65535.space/register?aff=44291427', recommended: true },
  { value: 'new-api', label: 'New API / 中转站', short: 'New API', description: '已有连接的兼容标识；新建请使用“其他兼容平台”', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, showInPicker: false },
  { value: 'one-api', label: 'One API', short: 'One API', description: '已有连接的兼容标识；新建请使用“其他兼容平台”', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, showInPicker: false },
  { value: 'openai', label: 'OpenAI', short: 'OpenAI', description: '官方 API 地址已内置', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsBaseUrl: false, apiKeyUrl: 'https://platform.openai.com/api-keys' },
  { value: 'openrouter', label: 'OpenRouter', short: 'OpenRouter', description: '官方兼容地址已内置', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', needsBaseUrl: false, apiKeyUrl: 'https://openrouter.ai/settings/keys' },
  { value: 'siliconflow', label: '硅基流动 SiliconFlow', short: '硅基流动', description: '国内兼容平台，地址已内置', type: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', needsBaseUrl: false, apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { value: 'modelscope', label: 'ModelScope 魔搭', short: 'ModelScope', description: 'ModelScope 推理 API 地址已内置', type: 'openai-compatible', baseUrl: 'https://api-inference.modelscope.cn/v1', needsBaseUrl: false, apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken', notice: '有免费额度，可先体验', noticeTone: 'success' },
  { value: 'dashscope', label: '阿里云百炼 DashScope', short: '百炼', description: 'OpenAI 兼容模式地址已内置', type: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', needsBaseUrl: false, apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key' },
  { value: 'volcengine', label: '火山方舟 Volcengine', short: '火山方舟', description: '方舟兼容地址已内置', type: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', needsBaseUrl: false, apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
  { value: 'deepseek', label: 'DeepSeek', short: 'DeepSeek', description: '官方 API 地址已内置', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', needsBaseUrl: false, apiKeyUrl: 'https://platform.deepseek.com/api_keys' },
  { value: 'google-gemini', label: 'Google Gemini', short: 'Gemini', description: '官方地址和协议由系统处理', type: 'google-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsBaseUrl: false, apiKeyUrl: 'https://aistudio.google.com/apikey' },
  { value: 'apimart', label: 'APIMart', short: 'APIMart', description: '内置余额校验、预置模型和异步图片任务适配', type: 'openai-compatible', baseUrl: 'https://api.apimart.ai/v1', needsBaseUrl: false, apiKeyUrl: 'https://apimart.ai/console', recommended: true },
  { value: 'custom', label: '其他兼容平台', short: '其他平台', description: '适用于 New API、One API 和自建中转等 OpenAI 兼容地址', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, recommended: true },
];

export function getProviderPreset(platform: ProviderPlatform | string | undefined) {
  return providerPresets.find((preset) => preset.value === platform) || providerPresets.find((preset) => preset.value === 'custom')!;
}

export function normalizeProviderBaseUrl(value: string, preset: ProviderPreset) {
  if (!preset.needsBaseUrl) return preset.baseUrl;
  return String(value || '')
    .trim()
    .replace(/\/(models|chat\/completions|images\/(generations|edits))\/?$/i, '')
    .replace(/\/+$/, '');
}

export function resolveProviderConfiguration(
  input: {
    platform?: ProviderPlatform | string;
    baseUrl?: string;
    modelsPath?: string;
    chatPath?: string;
    imageGenerationPath?: string;
    imageEditPath?: string;
    imageUpscalePath?: string;
    imageUpscaleStatusPath?: string;
    responsesPath?: string;
    authHeader?: string;
    authPrefix?: string;
  },
  existing?: Partial<ProviderConnection> | null,
): ResolvedProviderConfiguration {
  const preset = getProviderPreset(input.platform);
  const preserveExisting = existing?.platform === preset.value;
  const pick = (key: keyof Omit<ResolvedProviderConfiguration, 'platform' | 'type' | 'baseUrl'>, fallback: string) => {
    const value = input[key];
    if (typeof value === 'string') return value;
    return preserveExisting && typeof existing?.[key] === 'string' ? String(existing[key]) : fallback;
  };
  return {
    platform: preset.value,
    type: preset.type,
    baseUrl: normalizeProviderBaseUrl(String(input.baseUrl || existing?.baseUrl || ''), preset),
    modelsPath: pick('modelsPath', standardCompatibility.modelsPath),
    chatPath: pick('chatPath', standardCompatibility.chatPath),
    imageGenerationPath: pick('imageGenerationPath', standardCompatibility.imageGenerationPath),
    imageEditPath: pick('imageEditPath', standardCompatibility.imageEditPath),
    imageUpscalePath: pick('imageUpscalePath', standardCompatibility.imageUpscalePath),
    imageUpscaleStatusPath: pick('imageUpscaleStatusPath', standardCompatibility.imageUpscaleStatusPath),
    responsesPath: pick('responsesPath', defaultResponsesPath(preset.value)),
    authHeader: pick('authHeader', standardCompatibility.authHeader),
    authPrefix: pick('authPrefix', standardCompatibility.authPrefix),
  };
}
