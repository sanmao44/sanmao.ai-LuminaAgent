import type { NativeSearchDetection, NativeSearchProtocol, ProviderPlatform } from './types';

export type NativeSearchInference = {
  protocol?: NativeSearchProtocol;
  detection?: NativeSearchDetection;
  detected: boolean;
};

function protocolFromValue(value: unknown): NativeSearchProtocol | undefined {
  const text = String(value || '').toLowerCase();
  if (!text) return undefined;
  if (/(?:gemini|google|ground)/.test(text)) return 'gemini-grounding';
  if (/(?:perplexity|sonar|native[ -_]?chat)/.test(text)) return 'native-chat';
  if (/(?:openai|response|web[ -_]?search|browser|search[ -_]?parameter)/.test(text)) return 'openai-responses';
  return undefined;
}

function metadataProtocol(value: unknown, depth = 0): NativeSearchProtocol | undefined {
  if (!value || depth > 5 || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const protocol = metadataProtocol(item, depth + 1);
      if (protocol) return protocol;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (['nativesearchprotocol', 'searchprotocol', 'websearchprotocol', 'protocol'].includes(normalizedKey)) {
      const protocol = protocolFromValue(child);
      if (protocol) return protocol;
    }
    const nested = metadataProtocol(child, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

export function inferNativeSearch(rawId: string, platform?: ProviderPlatform, metadata?: unknown): NativeSearchInference {
  const id = String(rawId || '').toLowerCase();
  let text = '';
  try { text = metadata ? JSON.stringify(metadata).toLowerCase() : ''; } catch {}
  const metadataProtocolValue = metadataProtocol(metadata);
  if (metadataProtocolValue) return { detected: true, protocol: metadataProtocolValue, detection: 'metadata' };
  if (/(google[_ -]?search|google[_ -]?search[_ -]?retrieval|grounding|grounded[_ -]?search)/.test(text)) {
    return { detected: true, protocol: 'gemini-grounding', detection: 'metadata' };
  }
  if (/(web[_ -]?search|search[_ -]?preview|search[_ -]?parameters|search[_ -]?enabled|browser(?:[_ -]?search)?|responses[_ -]?tools)/.test(text)) {
    return { detected: true, protocol: 'openai-responses', detection: 'metadata' };
  }
  if (/(?:^|[/:_-])(?:sonar|sonar-[^/]+|perplexity)(?:$|[/:_-])/.test(id) || /perplexity|sonar/.test(id)) {
    return { detected: true, protocol: 'native-chat', detection: 'model-id' };
  }
  if (platform === 'deepseek' && /deepseek[-_ ]?v4.*(?:flash|pro)/.test(id)) {
    return { detected: true, protocol: 'openai-responses', detection: 'provider' };
  }
  if (platform === 'google-gemini' && /gemini[-_ ]?\d/.test(id) && !/(?:embedding|aqa|tts|audio|robotics)/.test(id)) {
    return { detected: true, protocol: 'gemini-grounding', detection: 'provider' };
  }
  if (platform === 'openai' && /(?:^|[/:_-])(?:gpt|o\d)(?:[-/:_]|$)/.test(id) && !/(?:image|audio|embedding|moderation|transcri)/.test(id)) {
    return { detected: true, protocol: 'openai-responses', detection: 'provider' };
  }
  if (/(?:search-preview|web-search|web_search|search-enabled|search_enabled)/.test(id)) {
    return { detected: true, protocol: 'openai-responses', detection: 'model-id' };
  }
  return { detected: false };
}
