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
