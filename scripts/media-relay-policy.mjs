import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function hasProviderCredential(provider) {
  return Boolean(String(provider?.encryptedApiKey || provider?.encryptedVideoApiKey || provider?.apiKey || '').trim());
}

function hasVisionChatModel(provider, models) {
  return models.some((model) => model?.providerId === provider?.id
    && model?.kind === 'chat'
    && model?.enabled === true
    && model?.published === true
    && Array.isArray(model?.capabilities)
    && model.capabilities.includes('vision'));
}

export function requiresMediaRelay(state) {
  const cloudUpscaleReady = (state?.upscaleConnections || []).some((connection) => connection?.status === 'healthy'
    && ((connection.encryptedSecretId && connection.encryptedSecretKey)
      || (connection.encryptedAccessKeyId && connection.encryptedAccessKeySecret)));
  if (cloudUpscaleReady) return true;

  const models = Array.isArray(state?.models) ? state.models : [];
  const providers = Array.isArray(state?.providers) ? state.providers : [];
  return providers.some((provider) => {
    if (!hasProviderCredential(provider)) return false;
    const transport = String(provider.videoTransport || '').toLowerCase();
    if (transport === 'agnes-videos' || transport === 'openai-videos') return true;
    if (transport === 'auto' || !transport) {
      return models.some((model) => model?.providerId === provider.id
        && (model.kind === 'video' || model.capabilities?.includes('video-generate')))
        || hasVisionChatModel(provider, models);
    }
    return hasVisionChatModel(provider, models);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    process.exitCode = requiresMediaRelay(state) ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
