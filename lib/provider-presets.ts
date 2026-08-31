import type { ProviderConnection, ProviderPlatform, ProviderTextProtocol, ProviderType, VideoTransport } from './types';
// The domestic Agnes docs use api.agnes-ai.cn.  The international gateway is
// intentionally not substituted here because a Key is commonly tied to the
// region where it was created.
const AGNES_API_BASE_URL = 'https://api.agnes-ai.cn/v1';
const AGNES_API_KEY_URL = 'https://platform.agnes-ai.cn/settings/apiKeys';
const AGNES_VIDEO_BASE_URL = 'https://api.agnes-ai.cn';

export type ProviderPreset = {
  value: ProviderPlatform;
  label: string;
  short: string;
  description: string;
  logo?: string;
  type: ProviderType;
  baseUrl: string;
  needsBaseUrl: boolean;
  apiKeyUrl?: string;
  notice?: string;
  noticeTone?: 'success' | 'accent';
  recommended?: boolean;
  showInPicker?: boolean;
  videoTransport?: VideoTransport;
  videoBaseUrl?: string;
  videoModelsPath?: string;
  videoPricingPath?: string;
  videoTaskPath?: string;
  videoTaskStatusPath?: string;
  videoGenerationPath?: string;
  textProtocol?: ProviderTextProtocol;
  videoQueryPath?: string;
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
  videoTransport?: VideoTransport;
  videoBaseUrl: string;
  videoModelsPath: string;
  videoPricingPath: string;
  videoTaskPath: string;
  videoTaskStatusPath: string;
  videoGenerationPath: string;
  textProtocol: ProviderTextProtocol;
  videoQueryPath: string;
};

const standardCompatibility = {
  modelsPath: '/models',
  chatPath: '/chat/completions',
  imageGenerationPath: '/images/generations',
  imageEditPath: '/images/edits',
  imageUpscalePath: '/images/edits',
  imageUpscaleStatusPath: '',
  videoModelsPath: '/v1/models',
  videoPricingPath: '/v1/pricing',
  videoTaskPath: '/v1/tasks',
  videoTaskStatusPath: '/v1/tasks/{id}',
  videoGenerationPath: '/v1/videos',
  responsesPath: '/responses',
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
};

function defaultResponsesPath(platform: ProviderPlatform) {
  return platform === 'deepseek' ? 'https://api.deepseek.com/beta/responses' : standardCompatibility.responsesPath;
}

export const providerPresets: ProviderPreset[] = [
  { value: '65535', label: '65535', short: '65535', description: 'OpenAI 兼容平台，支持原生异步视频任务', logo: '/brand/providers/65535.ico', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, apiKeyUrl: 'https://my.65535.space/register?aff=44291427', recommended: true, videoTransport: 'native-task', videoBaseUrl: 'https://task-api-1-cn.65535.space' },
  { value: 'new-api', label: 'New API / 中转站', short: 'New API', description: '已有连接的兼容标识；新建请使用“其他兼容平台”', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, showInPicker: false },
  { value: 'one-api', label: 'One API', short: 'One API', description: '已有连接的兼容标识；新建请使用“其他兼容平台”', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, showInPicker: false },
  { value: 'openai', label: 'OpenAI', short: 'OpenAI', description: '官方 API 地址已内置', logo: '/brand/providers/openai.svg', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsBaseUrl: false, apiKeyUrl: 'https://platform.openai.com/api-keys' },
  { value: 'openrouter', label: 'OpenRouter', short: 'OpenRouter', description: '官方兼容地址已内置', logo: '/brand/providers/openrouter.svg', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', needsBaseUrl: false, apiKeyUrl: 'https://openrouter.ai/settings/keys' },
  { value: 'siliconflow', label: '硅基流动 SiliconFlow', short: '硅基流动', description: '国内兼容平台，地址已内置', logo: '/brand/providers/siliconflow.ico', type: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', needsBaseUrl: false, apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { value: 'modelscope', label: 'ModelScope 魔搭', short: 'ModelScope', description: 'ModelScope 推理 API 地址已内置', logo: '/brand/providers/modelscope.svg', type: 'openai-compatible', baseUrl: 'https://api-inference.modelscope.cn/v1', needsBaseUrl: false, apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken', notice: '有免费额度，可先体验', noticeTone: 'success' },
  { value: 'dashscope', label: '阿里云百炼 DashScope', short: '百炼', description: 'OpenAI 兼容模式地址已内置', logo: '/brand/aliyun-cloud.ico', type: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', needsBaseUrl: false, apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key' },
  { value: 'volcengine', label: '火山方舟 Volcengine', short: '火山方舟', description: '方舟兼容地址已内置', logo: '/brand/providers/volcengine.png', type: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', needsBaseUrl: false, apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
  { value: 'deepseek', label: 'DeepSeek', short: 'DeepSeek', description: '官方 API 地址已内置', logo: '/brand/providers/deepseek.svg', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', needsBaseUrl: false, apiKeyUrl: 'https://platform.deepseek.com/api_keys' },
  { value: 'google-gemini', label: 'Google Gemini', short: 'Gemini', description: '官方地址和协议由系统处理', logo: '/brand/providers/google-gemini.svg', type: 'google-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsBaseUrl: false, apiKeyUrl: 'https://aistudio.google.com/apikey' },
  { value: 'apimart', label: 'APIMart', short: 'APIMart', description: '内置余额校验、预置模型和异步图片任务适配', logo: '/brand/providers/apimart.ico', type: 'openai-compatible', baseUrl: 'https://api.apimart.ai/v1', needsBaseUrl: false, apiKeyUrl: 'https://apimart.ai/console', recommended: true },
  { value: 'agnes', label: 'Agnes AI', short: 'Agnes', description: '文本、多模态、图片与异步视频模型，官方地址已内置', logo: '/brand/providers/agnes.ico', type: 'openai-compatible', baseUrl: AGNES_API_BASE_URL, needsBaseUrl: false, apiKeyUrl: AGNES_API_KEY_URL, notice: '有免费/限时免费额度，可先体验', noticeTone: 'success', recommended: true, textProtocol: 'chat-completions', videoTransport: 'agnes-videos', videoBaseUrl: AGNES_VIDEO_BASE_URL, videoGenerationPath: '/v1/videos', videoQueryPath: '/agnesapi' },
  { value: 'jimeng-cli', label: '即梦 CLI', short: '即梦 CLI', description: '本机调用即梦图片与视频能力', type: 'openai-compatible', baseUrl: '', needsBaseUrl: false, showInPicker: false, videoTransport: 'jimeng-cli' },
  { value: 'custom', label: '其他兼容平台', short: '其他平台', description: '适用于 New API、One API 和自建中转等 OpenAI 兼容地址', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true, recommended: true },
];

export function getProviderPreset(platform: ProviderPlatform | string | undefined) {
  return providerPresets.find((preset) => preset.value === platform) || providerPresets.find((preset) => preset.value === 'custom')!;
}

export function normalizeProviderBaseUrl(value: string, preset: ProviderPreset) {
  const candidate = String(value || '').trim();
  // Agnes has separate domestic and international gateways.  Preserve an
  // explicitly selected Agnes gateway so a .com credential is not silently
  // tested against .cn (or vice versa).  New Agnes connections still use the
  // domestic preset when no address has been supplied.
  if (preset.value === 'agnes') {
    if (!candidate) return preset.baseUrl;
    try {
      const parsed = new URL(candidate);
      if (/^(?:api|apihub)\.agnes-ai\.(?:cn|com)$/i.test(parsed.hostname)) {
        return candidate.replace(/\/+$/, '');
      }
    } catch {
      // Fall back to the preset below for malformed Agnes addresses.
    }
    return preset.baseUrl;
  }
  if (!preset.needsBaseUrl) return preset.baseUrl;
  return candidate
    .trim()
    .replace(/\/(models|chat\/completions|images\/(generations|edits))\/?$/i, '')
    .replace(/\/+$/, '');
}

function agnesGatewayRegion(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (/\.agnes-ai\.cn$/i.test(hostname)) return 'cn';
    if (/\.agnes-ai\.com$/i.test(hostname)) return 'com';
  } catch {
    // Treat malformed or non-Agnes values as unknown and use the preset.
  }
  return '';
}

function agnesOrigin(value: string) {
  try {
    const parsed = new URL(value);
    if (/^(?:api|apihub)\.agnes-ai\.(?:cn|com)$/i.test(parsed.hostname)) return parsed.origin;
  } catch {
    // Use the official domestic fallback below.
  }
  return '';
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
    videoTransport?: VideoTransport;
    videoBaseUrl?: string;
    videoModelsPath?: string;
    videoPricingPath?: string;
    videoTaskPath?: string;
    videoTaskStatusPath?: string;
    videoGenerationPath?: string;
    textProtocol?: ProviderTextProtocol;
    videoQueryPath?: string;
  },
  existing?: Partial<ProviderConnection> | null,
): ResolvedProviderConfiguration {
  const preset = getProviderPreset(input.platform);
  const preserveExisting = existing?.platform === preset.value;
  const videoTransport = input.videoTransport || (preserveExisting ? existing?.videoTransport : undefined) || preset.videoTransport || 'auto';
  const defaultVideoTaskStatusPath = videoTransport === 'native-task' || preset.value === '65535' ? '/v1/tasks/{id}' : '/v1/videos/{id}';
  const pick = (key: keyof Omit<ResolvedProviderConfiguration, 'platform' | 'type' | 'baseUrl'>, fallback: string) => {
    const value = input[key];
    if (typeof value === 'string') return value;
    return preserveExisting && typeof existing?.[key] === 'string' ? String(existing[key]) : fallback;
  };
  const baseUrl = normalizeProviderBaseUrl(String(input.baseUrl || existing?.baseUrl || ''), preset);
  const explicitVideoBaseUrl = String(input.videoBaseUrl || (preserveExisting ? existing?.videoBaseUrl : '') || '').replace(/\/+$/, '');
  const agnesBaseRegion = preset.value === 'agnes' ? agnesGatewayRegion(baseUrl) : '';
  const agnesVideoRegion = preset.value === 'agnes' ? agnesGatewayRegion(explicitVideoBaseUrl) : '';
  const videoBaseUrl = preset.value === 'agnes'
    ? (explicitVideoBaseUrl && (!agnesBaseRegion || !agnesVideoRegion || agnesBaseRegion === agnesVideoRegion)
      ? explicitVideoBaseUrl
      : agnesOrigin(baseUrl) || preset.videoBaseUrl || '')
    : explicitVideoBaseUrl || preset.videoBaseUrl || '';
  return {
    platform: preset.value,
    type: preset.type,
    baseUrl,
    modelsPath: pick('modelsPath', standardCompatibility.modelsPath),
    chatPath: pick('chatPath', standardCompatibility.chatPath),
    imageGenerationPath: pick('imageGenerationPath', standardCompatibility.imageGenerationPath),
    imageEditPath: pick('imageEditPath', standardCompatibility.imageEditPath),
    imageUpscalePath: pick('imageUpscalePath', standardCompatibility.imageUpscalePath),
    imageUpscaleStatusPath: pick('imageUpscaleStatusPath', standardCompatibility.imageUpscaleStatusPath),
    responsesPath: pick('responsesPath', defaultResponsesPath(preset.value)),
    authHeader: pick('authHeader', standardCompatibility.authHeader),
    authPrefix: pick('authPrefix', standardCompatibility.authPrefix),
    videoTransport,
    videoBaseUrl,
    videoModelsPath: pick('videoModelsPath', preset.videoModelsPath || standardCompatibility.videoModelsPath),
    videoPricingPath: pick('videoPricingPath', preset.videoPricingPath || standardCompatibility.videoPricingPath),
    videoTaskPath: pick('videoTaskPath', preset.videoTaskPath || standardCompatibility.videoTaskPath),
    videoTaskStatusPath: pick('videoTaskStatusPath', preset.videoTaskStatusPath || defaultVideoTaskStatusPath),
    videoGenerationPath: pick('videoGenerationPath', preset.videoGenerationPath || standardCompatibility.videoGenerationPath),
    textProtocol: input.textProtocol || (preserveExisting ? existing?.textProtocol : undefined) || preset.textProtocol || 'chat-completions',
    videoQueryPath: String(input.videoQueryPath || (preserveExisting ? existing?.videoQueryPath : '') || preset.videoQueryPath || '').trim(),
  };
}
