export type VideoProviderIdentity = {
  platform?: string;
  videoTransport?: string;
  baseUrl?: string;
  videoBaseUrl?: string;
};

/**
 * 65535 is identified by its platform id or one of its service hosts.
 * Transport is deliberately not part of this check: a custom provider may
 * also expose a native task endpoint without sharing 65535's model limits.
 */
export function is65535Provider(provider?: VideoProviderIdentity | null) {
  return Boolean(provider && (
    provider.platform === '65535'
    || /65535\.space/i.test(provider.baseUrl || '')
    || /65535\.space/i.test(provider.videoBaseUrl || '')
  ));
}

export function isJimengProvider(provider?: VideoProviderIdentity | null) {
  return Boolean(provider && (
    provider.platform === 'jimeng-cli'
    || provider.videoTransport === 'jimeng-cli'
  ));
}

export function isAgnesProvider(provider?: VideoProviderIdentity | null) {
  const host = (value: string) => { try { return new URL(value).hostname; } catch { return value; } };
  return Boolean(provider && (
    provider.platform === 'agnes'
    || /(^|\.)api(?:hub)?\.agnes-ai\.(?:com|cn)$/i.test(host(provider.baseUrl || ''))
    || /(^|\.)api(?:hub)?\.agnes-ai\.(?:com|cn)$/i.test(host(provider.videoBaseUrl || ''))
  ));
}

/**
 * Remote video APIs that receive media as URLs cannot read a browser's local
 * data URL or local storage path. Native task APIs and the local Jimeng CLI
 * receive inline/local media instead, so they must not start the relay.
 *
 * For an auto provider the launcher supplies `hasVideoModel` after inspecting
 * the saved model catalog. The runtime already has a selected video model,
 * so it can use the default (true) behavior.
 */
export function requiresPublicMediaRelay(
  provider?: VideoProviderIdentity | null,
  options: { hasVideoModel?: boolean } = {},
) {
  if (!provider || isJimengProvider(provider) || is65535Provider(provider) || provider.videoTransport === 'native-task') return false;
  if (provider.videoTransport === 'agnes-videos' || provider.videoTransport === 'openai-videos') return true;
  if (isAgnesProvider(provider)) return options.hasVideoModel !== false;
  return (provider.videoTransport === 'auto' || !provider.videoTransport) && options.hasVideoModel === true;
}
