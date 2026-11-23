export type CangyuanProviderIdentity = {
  platform?: string;
  baseUrl?: string;
  videoBaseUrl?: string;
};

const CANGYUAN_API_HOSTS = new Set([
  'ai.cangyuansuanli.cn',
  'direct-api.cangyuansuanli.cn',
]);

export function isCangyuanProvider(provider?: CangyuanProviderIdentity | null) {
  if (!provider) return false;
  if (provider.platform === 'cangyuan') return true;
  return [provider.baseUrl, provider.videoBaseUrl].some(isCangyuanApiUrl);
}

/** Old model discovery saved the generic video transport for official URLs. */
export function usesCangyuanVideoProtocol(provider?: (CangyuanProviderIdentity & { videoTransport?: string }) | null) {
  if (!provider) return false;
  if (provider.videoTransport === 'cangyuan-videos') return true;
  return (!provider.videoTransport || provider.videoTransport === 'auto' || provider.videoTransport === 'openai-videos')
    && isCangyuanProvider(provider);
}

export function cangyuanMediaBaseUrl(provider: CangyuanProviderIdentity) {
  const baseUrl = cleanBaseUrl(provider.baseUrl);
  const videoBaseUrl = cleanBaseUrl(provider.videoBaseUrl);
  if (isCangyuanApiUrl(baseUrl)) return baseUrl;
  if (isCangyuanApiUrl(videoBaseUrl)) return videoBaseUrl;
  return provider.platform === 'cangyuan' ? baseUrl || videoBaseUrl : baseUrl;
}

function isCangyuanApiUrl(value?: string) {
  if (!value) return false;
  try { return CANGYUAN_API_HOSTS.has(new URL(value).hostname.toLowerCase()); } catch { return false; }
}

function cleanBaseUrl(value?: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}
