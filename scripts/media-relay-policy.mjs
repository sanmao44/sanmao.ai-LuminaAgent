import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RELEASE_RELAY_CONFIG_URL = new URL('../relay/default-config.json', import.meta.url);
let releaseDefaultMediaRelayUrl = '';
try {
  const config = JSON.parse(readFileSync(RELEASE_RELAY_CONFIG_URL, 'utf8'));
  releaseDefaultMediaRelayUrl = String(config.defaultMediaRelayUrl || '').trim();
} catch {}

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

function providerUsesPublicImageInputs(provider) {
  const platform = String(provider?.platform || '').toLowerCase();
  if (platform === '65535' || platform === 'apimart') return true;

  for (const value of [provider?.baseUrl, provider?.videoBaseUrl]) {
    try {
      const hostname = new URL(String(value || '')).hostname.toLowerCase();
      if (hostname === '65535.space' || hostname.endsWith('.65535.space')
        || hostname === 'api.apimart.ai' || hostname.endsWith('.api.apimart.ai')) return true;
    } catch {}
  }
  return false;
}

function hasReferenceImageModel(provider, models) {
  return models.some((model) => model?.providerId === provider?.id
    && model?.kind === 'image'
    && model?.enabled === true
    && model?.published === true
    && Array.isArray(model?.capabilities)
    && (model.capabilities.includes('edit') || model.capabilities.includes('reference')));
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
    if (providerUsesPublicImageInputs(provider) && hasReferenceImageModel(provider, models)) return true;
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

export function isPublicMediaRelayUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && host !== 'localhost'
      && host !== '::1'
      && !host.endsWith('.local')
      && !/^127\./u.test(host)
      && !/^10\./u.test(host)
      && !/^192\.168\./u.test(host)
      && !/^169\.254\./u.test(host)
      && !/^172\.(1[6-9]|2\d|3[01])\./u.test(host);
  } catch {
    return false;
  }
}

export function getDefaultMediaRelayUrl(env = process.env, releaseDefault = releaseDefaultMediaRelayUrl) {
  const override = String(env.SANMAO_DEFAULT_MEDIA_RELAY_URL || '').trim();
  if (override && isPublicMediaRelayUrl(override)) return override.replace(/\/+$/, '');
  const configured = String(releaseDefault || '').trim();
  return isPublicMediaRelayUrl(configured) ? configured.replace(/\/+$/, '') : '';
}

export function hasDefaultMediaRelay(env = process.env, releaseDefault = releaseDefaultMediaRelayUrl) {
  return Boolean(getDefaultMediaRelayUrl(env, releaseDefault));
}

export function isReleaseMediaRelayConfigValid(config) {
  const configuredUrl = String(config?.defaultMediaRelayUrl || '').trim();
  return !configuredUrl || isPublicMediaRelayUrl(configuredUrl);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { loadEnvConfig } = (await import('@next/env')).default;
    loadEnvConfig(dirname(dirname(fileURLToPath(import.meta.url))), false);
    if (process.argv[2] === '--has-default-relay') {
      process.exitCode = hasDefaultMediaRelay() ? 0 : 1;
    } else if (process.argv[2] === '--print-default-relay-url') {
      process.stdout.write(getDefaultMediaRelayUrl());
    } else {
      const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
      process.exitCode = requiresMediaRelay(state) ? 0 : 1;
    }
  } catch {
    process.exitCode = 1;
  }
}
