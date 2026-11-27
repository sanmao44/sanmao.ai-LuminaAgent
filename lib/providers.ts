import type { GeneratedImage, ModelCapability, ProviderCreativeTaskProtocol, ProviderPlatform, ProviderTextProtocol, ProviderType, VideoTransport } from './types';
import type { ModelProviderFailure } from '@/packages/contracts/model';
import type { AudioModelClassification } from '@/packages/contracts/model-classification';
import { classifyAudioModelPurpose } from './audio-model-classification';
import { MAX_IMAGE_REFERENCES } from '@/packages/contracts/creative';
import type { ImageModelParameters, ImageOutputFormat } from '@/packages/contracts/creative';
import type { ImageDownloadAuth } from './image-storage';
import { inferNativeSearch } from './native-search-detection';
import { inferModelKind } from './model-kind';
import { agnesModelCatalog } from './agnes';
import { inspectJimengCli } from './jimeng-cli';
import { getCangyuanImageModelProfile } from './cangyuan-image-capabilities';
import type { CangyuanImageAdvancedParameter, CangyuanImageModelProfile } from './cangyuan-image-capabilities';
import { isCangyuanProvider } from './cangyuan-provider';
import { getCangyuanVideoModelCatalogEntry } from './cangyuan-video-model-catalog';
import { isSvgImageBytes } from './svg-image';
import { isPublicImageAddress, providerImageReferenceReader, PROVIDER_IMAGE_REFERENCE_MAX_BYTES } from './provider-image-reference-reader';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export type RuntimeProvider = {
  id: string;
  name: string;
  type: ProviderType;
  platform?: ProviderPlatform;
  baseUrl: string;
  apiKey: string;
  modelsPath?: string;
  chatPath?: string;
  imageGenerationPath?: string;
  imageEditPath?: string;
  imageUpscalePath?: string;
  imageUpscaleStatusPath?: string;
  responsesPath?: string;
  textProtocol?: ProviderTextProtocol;
  creativeTaskProtocol?: ProviderCreativeTaskProtocol;
  videoTransport?: VideoTransport;
  videoBaseUrl?: string;
  videoApiKey?: string;
  videoTaskPath?: string;
  videoTaskStatusPath?: string;
  videoGenerationPath?: string;
  videoQueryPath?: string;
  videoModelsPath?: string;
  videoPricingPath?: string;
  jimengCliPath?: string;
  jimengCliPollSeconds?: number;
  authHeader?: string;
  authPrefix?: string;
  imageStoragePath?: string;
};

export type DiscoveredModel = {
  id: string;
  name?: string;
  capabilities?: ModelCapability[];
  classification?: AudioModelClassification;
  nativeSearchProtocol?: 'openai-responses' | 'deepseek-tools' | 'gemini-grounding' | 'native-chat';
  nativeSearchDetection?: 'metadata' | 'model-id' | 'provider' | 'manual';
  billing?: 'free' | 'paid' | 'temporary-free';
  enabledByDefault?: boolean;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

const CLAUDE_STD_MODELS: DiscoveredModel[] = [
  'claude-haiku-5-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-sonnet-5-5',
].map((id) => ({ id, name: id, capabilities: ['chat', 'vision'] }));

export function is65535ClaudeCodeProvider(provider: Pick<RuntimeProvider, 'platform'>) {
  return provider.platform === '65535-claude-code';
}

export function is65535ClaudeModelProvider(provider: Pick<RuntimeProvider, 'platform' | 'baseUrl'>, rawModelId: string) {
  if (!/^claude-/i.test(rawModelId)) return false;
  if (is65535ClaudeCodeProvider(provider)) return true;
  try {
    const endpoint = new URL(provider.baseUrl);
    const supportedHost = endpoint.hostname === 'api2.65535.space' || endpoint.hostname === 'api2-cn.65535.space';
    return supportedHost && /^\/(?:v1\/?)?$/.test(endpoint.pathname);
  } catch {
    return false;
  }
}

async function preparePublicMediaUrl(value: string, kind: 'image' | 'video' | 'audio') {
  const input = String(value || '').trim();
  if (!input || (/^https?:\/\//i.test(input) && !isLocalProviderMediaUrl(input))) return input;
  return (await import('./signed-media')).preparePublicMediaUrl(input, kind);
}

function isLocalProviderMediaUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.pathname === '/api/storage/file' || parsed.pathname === '/api/storage/video'
      || host === 'localhost' || host === '::1' || host === '0.0.0.0'
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
      || (host.startsWith('172.') && Number(host.split('.')[1]) >= 16 && Number(host.split('.')[1]) <= 31)
      || host.endsWith('.local');
  } catch { return true; }
}

export async function prepareProviderChatMessages<T extends { content: unknown }>(
  messages: T[],
  prepareMedia: (value: string, kind: 'image' | 'video' | 'audio') => Promise<string> | string = preparePublicMediaUrl,
  options: { prepareDataUrls?: boolean } = { prepareDataUrls: true },
) {
  return Promise.all(messages.map(async (message) => {
    const normalizedMessage = normalizeProviderToolCalls(message);
    if (!Array.isArray(normalizedMessage.content)) return normalizedMessage;
    const content = await Promise.all(normalizedMessage.content.map(async (part: any) => {
      if (part?.type === 'image_url' && typeof part?.image_url?.url === 'string') {
        const value = String(part.image_url.url).trim();
        const url = !value || (/^https?:\/\//i.test(value) && !isLocalProviderMediaUrl(value))
          || (/^data:/i.test(value) && !options.prepareDataUrls)
          ? value
          : await prepareMedia(value, 'image');
        return { ...part, image_url: { ...part.image_url, url } };
      }
      if (part?.type === 'video_url' && typeof part?.video_url?.url === 'string') {
        const value = String(part.video_url.url).trim();
        const url = !value || (/^https?:\/\//i.test(value) && !isLocalProviderMediaUrl(value))
          || (/^data:/i.test(value) && !options.prepareDataUrls)
          ? value
          : await prepareMedia(value, 'video');
        return { ...part, video_url: { ...part.video_url, url } };
      }
      return part;
    }));
    return { ...normalizedMessage, content };
  }));
}

/**
 * Keep assistant tool calls provider-valid when an OpenAI-compatible model
 * omits fields that are optional in its response but required in the next
 * request. Several gateways return a function call without `type`; replaying
 * it verbatim makes the follow-up fail with `messages[2]: missing field type`.
 */
function normalizeProviderToolCalls<T extends { content: unknown }>(message: T): T {
  const role = (message as { role?: unknown }).role;
  const rawToolCalls = (message as { tool_calls?: unknown }).tool_calls;
  if (role !== 'assistant' || !Array.isArray(rawToolCalls)) return message;
  const toolCalls = rawToolCalls.map((rawCall) => {
    if (!rawCall || typeof rawCall !== 'object' || Array.isArray(rawCall)) return rawCall;
    const call = rawCall as Record<string, unknown>;
    const rawFunction = call.function;
    if (!rawFunction || typeof rawFunction !== 'object' || Array.isArray(rawFunction)) return rawCall;
    const functionValue = rawFunction as Record<string, unknown>;
    const rawArguments = functionValue.arguments;
    const serializedArguments = typeof rawArguments === 'string'
      ? rawArguments
      : JSON.stringify(rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments) ? rawArguments : {});
    return {
      ...call,
      type: 'function',
      function: {
        ...functionValue,
        arguments: serializedArguments,
      },
    };
  });
  return { ...message, tool_calls: toolCalls } as T;
}

const EXPLICIT_DISCOVERED_CAPABILITIES = new Set<ModelCapability>([
  'chat', 'vision', 'generate', 'edit', 'reference', 'typography', 'transparent', 'upscale', 'fast',
  'speech', 'voice-conversion', 'audio-isolation', 'transcription', 'music-generate', 'sound-effect',
  'audio-conversation', '3d-generate', 'web-search', 'video-generate', 'video-edit', 'video-extend',
  'video-first-frame', 'video-reference', 'video-input', 'video-audio',
]);

function discoveredModelCapabilities(item: any, provider?: RuntimeProvider, id = ''): ModelCapability[] {
  const raw = [item?.capabilities, item?.features, item?.supported_tools, item?.tools, item?.tool_support, item?.modalities, item?.metadata, item?.endpoints, item?.endpoint, item?.operations, item?.pricing, item?.pricing_info]
    .filter(Boolean);
  const text = raw.length ? JSON.stringify(raw).toLowerCase() : '';
  const capabilities: ModelCapability[] = [];
  if (Array.isArray(item?.capabilities)) {
    for (const value of item.capabilities) {
      const capability = String(value).trim().toLowerCase() as ModelCapability;
      if (EXPLICIT_DISCOVERED_CAPABILITIES.has(capability)) capabilities.push(capability);
    }
  }
  if (/(^|[\[\s,"':])video([_ -]|$)|\/videos?(?:[/?"'\s]|$)|text[-_ ]to[-_ ]video|image[-_ ]to[-_ ]video|video[-_ ]generation|video_generation|frames2video|multimodal2video/.test(text)) {
    capabilities.push('video-generate');
    if (/edit|modify|reference_video/.test(text)) capabilities.push('video-edit');
    if (/extend|continu/.test(text)) capabilities.push('video-extend');
    if (/first[_ -]?frame|image2video|first_frame/.test(text)) capabilities.push('video-first-frame');
    if (/reference|multiframe|images/.test(text)) capabilities.push('video-reference');
    if (/audio|sound/.test(text)) capabilities.push('video-audio');
  }
  const cangyuanVideoEntry = getCangyuanVideoModelCatalogEntry(id);
  if (
    isCangyuanProvider(provider)
    && cangyuanVideoEntry?.status === 'current'
    && cangyuanVideoEntry.spec.capabilityRefs?.includes('video')
    && !capabilities.includes('video-generate')
  ) {
    capabilities.push('video-generate');
  }
  if (/audio[-_ ]?transcri|\/audio\/transcriptions|speech[-_ ]?to[-_ ]?text|\basr\b|\bstt\b/i.test(text)) {
    capabilities.push('transcription');
  }
  if (/text[-_ ]?to[-_ ]?speech|speech[-_ ]?(?:synthesis|generation)|\btts\b|\/audio\/speech(?:[/?"'\s]|$)/i.test(text)) {
    capabilities.push('speech');
  }
  if (/text[-_ ]?to[-_ ]?music|music[-_ ]?(?:generation|generate|creation)|\/music\/(?:generations|generate)(?:[/?"'\s]|$)/i.test(text)) {
    capabilities.push('music-generate');
  }
  if (/(?:sound[-_ ]?effects?|\bsfx\b|foley)/i.test(text)) {
    capabilities.push('sound-effect');
  }
  // Some OpenAI-compatible model registries return only an id and omit
  // endpoint metadata. Keep discovery consistent with the shared model-kind
  // classifier so common third-party video families still enter the video
  // model library without a provider-specific hard-coded catalog.
  if (inferModelKind({ rawId: id, displayName: item?.name || item?.display_name || '', capabilities }) === 'video' && !capabilities.includes('video-generate')) {
    capabilities.push('video-generate');
  }
  // A chat model must advertise video understanding separately.  Merely
  // mentioning video generation in provider metadata is not enough: sending
  // a video_url to a text/vision-only model is both misleading and rejected
  // by a number of OpenAI-compatible gateways.
  if (/video[-_ ]?(?:input|understanding|vision)|(?:input|understanding|vision)[^\n]{0,24}video|video[^\n]{0,24}(?:input|understanding|vision)/.test(text)) {
    capabilities.push('video-input');
  }
  const native = inferNativeSearch(id, provider?.platform, raw);
  if (native.detected) capabilities.push('chat', 'web-search');
  return Array.from(new Set(capabilities));
}

function trimSlash(value: string) { return value.replace(/\/+$/, ''); }

const providerResponseMeta = Symbol('providerResponseMeta');

type ProviderResponseMeta = {
  contentType: string;
  byteLength: number;
  status?: number;
  requestId?: string;
};

type ProviderFailure = Error & ModelProviderFailure & {
  code?: string;
  providerErrorCode?: string;
  providerSearchRequestCount?: number;
  providerRequestId?: string;
  providerUsage?: Record<string, unknown>;
  providerUrl?: string;
  providerMethod?: string;
  providerPossiblyAccepted?: boolean;
  providerAcceptedTask?: boolean;
  providerTaskId?: string;
};

/** Convert provider failures into a short message the Agent panel can act on. */
export function describeProviderFailure(error: unknown) {
  const failure = error as ProviderFailure | null;
  const status = Number(failure?.providerStatus || failure?.status || 0);
  if (failure?.providerFailureKind === 'timeout') {
    return '当前模型服务响应超时。请稍后重试，或切换到其他对话模型。';
  }
  if (failure?.providerFailureKind === 'transport') {
    return '当前模型服务暂时无法连接。请检查网络或切换到其他对话模型。';
  }
  if (failure?.providerFailureKind === 'http' && status >= 500) {
    return `当前模型服务暂时不可用（HTTP ${status}）。请稍后重试，或切换到其他对话模型。`;
  }
  return failure?.message || '模型服务请求失败，请稍后重试或切换其他对话模型。';
}

function attachProviderResponseMeta(value: any, meta: ProviderResponseMeta) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
  try { Object.defineProperty(value, providerResponseMeta, { value: meta, enumerable: false }); } catch { /* best effort */ }
  return value;
}

export function imageMimeFromBytes(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return '';
}

function imageOutputMimeFromBytes(bytes: Uint8Array, allowSvgOutput: boolean) {
  return imageMimeFromBytes(bytes) || (allowSvgOutput && isSvgImageBytes(bytes) ? 'image/svg+xml' : '');
}

export class ProviderImageFormatError extends Error {
  readonly providerImageFormat = true;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderImageFormatError';
  }
}

function dataUrlBytes(value: string) {
  const match = value.match(/^data:[^;,]+(?:;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const comma = value.indexOf(',');
  const metadata = value.slice(0, comma).toLowerCase();
  try {
    return metadata.includes(';base64')
      ? Buffer.from(match[1], 'base64')
      : Buffer.from(decodeURIComponent(match[1]), 'utf8');
  } catch {
    return null;
  }
}

function isSupportedImageDataUrl(value: string) {
  const bytes = dataUrlBytes(value);
  return Boolean(bytes && imageMimeFromBytes(bytes));
}

function imageMimeFromContentType(contentType: string) {
  const mime = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  return /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : '';
}

export function runtimeBaseUrl(provider: RuntimeProvider) {
  if (provider.type === 'google-gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai';
  return trimSlash(provider.baseUrl);
}

export function isAgnesProvider(provider: Pick<RuntimeProvider, 'platform' | 'baseUrl' | 'videoBaseUrl'>) {
  const host = (value: string) => { try { return new URL(value).hostname; } catch { return ''; } };
  return provider.platform === 'agnes'
    || /(^|\.)api(?:hub)?\.agnes-ai\.(?:com|cn)$/i.test(host(provider.baseUrl || ''))
    || /(^|\.)api(?:hub)?\.agnes-ai\.(?:com|cn)$/i.test(host(provider.videoBaseUrl || ''));
}

function providerEndpoint(provider: RuntimeProvider, path: string | undefined, fallback: string) {
  const target = String(path || fallback).trim();
  if (/^https?:\/\//i.test(target)) return target.replace(/\/+$/, '');
  return `${runtimeBaseUrl(provider)}${target.startsWith('/') ? target : `/${target}`}`;
}

function videoProviderEndpoint(provider: RuntimeProvider, path: string | undefined, fallback: string) {
  const target = String(path || fallback).trim();
  if (/^https?:\/\//i.test(target)) return target.replace(/\/+$/, '');
  const base = trimSlash(provider.videoBaseUrl || (is65535Provider(provider) ? 'https://task-api-1-cn.65535.space' : runtimeBaseUrl(provider)));
  const normalizedTarget = target.startsWith('/') ? target : `/${target}`;
  const baseHasV1 = /\/v1$/i.test(base);
  const targetHasV1 = /^\/v1(?:\/|$)/i.test(normalizedTarget);
  return `${base}${baseHasV1 && targetHasV1 ? normalizedTarget.slice(3) || '/' : normalizedTarget}`;
}

function is65535Provider(provider: RuntimeProvider) {
  return provider.platform === '65535' || /65535\.space/i.test(provider.baseUrl || '') || /65535\.space/i.test(provider.videoBaseUrl || '');
}

export function inferVideoTransportFromMetadata(data: unknown, provider: RuntimeProvider): RuntimeProvider['videoTransport'] {
  if (isCangyuanProvider(provider) && (!provider.videoTransport || provider.videoTransport === 'auto' || provider.videoTransport === 'openai-videos')) {
    provider.videoTransport = 'cangyuan-videos';
    return provider.videoTransport;
  }
  if (provider.videoTransport && provider.videoTransport !== 'auto') return provider.videoTransport;
  if (is65535Provider(provider)) {
    provider.videoTransport = 'native-task';
    return provider.videoTransport;
  }
  const text = (() => {
    try { return JSON.stringify(data).toLowerCase(); } catch { return ''; }
  })();
  if (/\/v1\/tasks(?:[\\/?:"'}]|$)|task_(?:path|status)|native[-_ ]?task/.test(text)) {
    provider.videoTransport = 'native-task';
  } else if (/\/v1\/videos?(?:[\\/?:"'}]|$)|video_(?:generation|task|status)_path/.test(text)) {
    provider.videoTransport = 'openai-videos';
  }
  return provider.videoTransport || 'auto';
}

function requestIdFrom(data: any, text = '', headers?: Headers) {
  const headerId = headers?.get('x-request-id') || headers?.get('request-id') || headers?.get('x-correlation-id') || '';
  const dataId = data?.request_id || data?.requestId || data?.error?.request_id || data?.error?.requestId || '';
  const textId = text.match(/\brequest\s*id\s*:\s*([A-Za-z0-9._-]+)/i)?.[1] || '';
  return String(headerId || dataId || textId || '').trim();
}

function decorateProviderFailure<T extends Error>(error: T, details: Partial<ProviderFailure>) {
  Object.assign(error, details);
  return error as T & ProviderFailure;
}

async function parseResponse(response: Response, allowSvgOutput = false) {
  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const requestId = requestIdFrom(null, '', response.headers);
  const detectedImageMime = imageOutputMimeFromBytes(bytes, allowSvgOutput);
  if (response.ok && detectedImageMime && bytes.length) {
    return attachProviderResponseMeta(`data:${detectedImageMime};base64,${Buffer.from(bytes).toString('base64')}`, { contentType, byteLength: bytes.byteLength, status: response.status, requestId });
  }
  const text = Buffer.from(bytes).toString('utf8');
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  // A few compatible gateways return the temporary image URL as plain text
  // while incorrectly keeping an image/* content type. Treat that URL as a
  // provider image reference instead of base64-encoding the URL itself.
  if (response.ok && !detectedImageMime && imageMimeFromContentType(contentType) && /^https?:\/\//i.test(text.trim())) {
    data = text.trim();
  }
  // Some compatible gateways label an inline base64 response as image/png
  // without decoding it first. Decode that transport form here so it follows
  // the same validated image path as a real binary response. Invalid bytes
  // remain a provider-format error and never reach local storage.
  if (response.ok && !detectedImageMime && imageMimeFromContentType(contentType)) {
    const compact = text.trim().replace(/\s/g, '');
    const dataUrlMatch = compact.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=_-]+)$/i);
    const encoded = dataUrlMatch ? dataUrlMatch[2] : compact;
    if (encoded && /^[A-Za-z0-9+/=_-]+$/.test(encoded)) {
      try {
        const decoded = Buffer.from(encoded, 'base64');
        const decodedMime = imageOutputMimeFromBytes(decoded, allowSvgOutput);
        if (decodedMime) data = `data:${decodedMime};base64,${decoded.toString('base64')}`;
      } catch { /* normalizeProviderImages will surface a provider-format error. */ }
    }
  }
  const responseRequestId = requestIdFrom(data, text, response.headers);
  if (!response.ok) {
    throw providerResponseError(response.status, data, text, responseRequestId);
  }
  return attachProviderResponseMeta(data, { contentType, byteLength: bytes.byteLength, status: response.status, requestId: responseRequestId });
}

function providerResponseError(status: number, data: any, text: string, requestId = '') {
  const detail = data?.error?.message || data?.error || data?.message || text || `HTTP ${status}`;
  const detailText = typeof detail === 'string' ? detail.slice(0, 900) : JSON.stringify(detail).slice(0, 900);
  const prefix = status === 401
    ? 'API Key 无效、已过期或未被服务商接受'
    : status === 403
      ? '服务商拒绝了请求'
      : status === 402
        ? '服务商账户余额或 API 额度不足'
        : status === 408
          ? '服务商读取请求超时'
          : status === 413
            ? '请求内容超过服务商限制'
            : status === 429
              ? '请求触发服务商限流'
              : `服务商接口返回 HTTP ${status}`;
  const providerErrorCode = String(data?.error?.code || data?.error?.type || data?.code || '').trim();
  const suffix = [providerErrorCode && `错误码 ${providerErrorCode}`, requestId && `request id: ${requestId}`].filter(Boolean).join('；');
  const error = new Error(`${prefix}：${detailText}${suffix ? `（${suffix}）` : ''}`);
  return decorateProviderFailure(error, {
    providerResponse: true,
    providerFailureKind: 'http',
    status,
    providerStatus: status,
    ...(providerErrorCode ? { providerErrorCode, code: providerErrorCode } : {}),
    providerRequestId: requestId,
    ...(status >= 500 ? { providerPossiblyAccepted: true } : {}),
  });
}

function combineSignals(signal: AbortSignal | undefined, timeout: number) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeoutSignal]);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason || new Error('请求已取消'));
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', () => controller.abort(timeoutSignal.reason), { once: true });
  return controller.signal;
}

function combineStreamSignals(signal: AbortSignal, timeoutSignal: AbortSignal) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeoutSignal]);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal.reason || new Error('AGENT_CANCELLED'));
  const abortFromTimeout = () => controller.abort(timeoutSignal.reason || new Error('The operation was aborted due to timeout'));
  if (signal.aborted) abortFromParent();
  else signal.addEventListener('abort', abortFromParent, { once: true });
  if (timeoutSignal.aborted) abortFromTimeout();
  else timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
  return controller.signal;
}

function connectionFailure(url: string, error: unknown, method = 'GET') {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const path = (() => { try { return new URL(url).pathname || '/'; } catch { return url; } })();
  const source = error instanceof Error ? error : new Error(String(error));
  const cause = source.cause && typeof source.cause === 'object' ? source.cause as { code?: unknown; message?: unknown } : undefined;
  const code = String(cause?.code || '').toUpperCase();
  const detail = String(cause?.message || source.message || '').trim();
  const lowLevel = code || source.name || 'FETCH_FAILED';
  const possiblyAccepted = method === 'POST';

  if (source.name === 'TimeoutError' || /TIMEOUT|TIMEDOUT/.test(code) || /timed out/i.test(detail)) {
    return decorateProviderFailure(new Error(`调用 ${method} ${host}${path} 超时。${possiblyAccepted ? '请求可能已被服务商接收并产生费用，请先查服务商任务/用量，再决定是否重试。' : '请检查服务商 API 地址、网络、DNS 和防火墙。'}（${lowLevel}）`), {
      providerFailureKind: 'timeout', providerUrl: url, providerMethod: method, providerPossiblyAccepted: possiblyAccepted,
    });
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(code) || /getaddrinfo|dns/i.test(detail)) {
    return decorateProviderFailure(new Error(`无法解析 ${host}：DNS 没有返回可用地址（${lowLevel}）。请检查服务商域名是否已生效，或更换网络/DNS 后重试。`), {
      providerFailureKind: 'transport', providerUrl: url, providerMethod: method, providerPossiblyAccepted: possiblyAccepted,
    });
  }
  if (/CERT|TLS|SSL/.test(code) || /certificate|tls|ssl/i.test(detail)) {
    return decorateProviderFailure(new Error(`无法安全连接 ${host}：TLS/证书校验失败（${lowLevel}）。请确认服务商 HTTPS 证书和系统时间正常。`), {
      providerFailureKind: 'transport', providerUrl: url, providerMethod: method, providerPossiblyAccepted: possiblyAccepted,
    });
  }
  return decorateProviderFailure(new Error(`调用 ${method} ${host}${path} 时上游连接中断，未收到完整响应（${lowLevel}）。${possiblyAccepted ? '请求可能已经被服务商接收并产生费用，请先查服务商后台，不要立即自动重试。' : '请检查服务商网络状态和本机网络。'}`), {
    providerFailureKind: 'transport', providerUrl: url, providerMethod: method, providerPossiblyAccepted: possiblyAccepted,
  });
}

function providerTimeoutFailure(url: string, timeout: number, method = 'GET') {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const minutes = Math.max(1, Math.round(timeout / 60000));
  return decorateProviderFailure(new Error(`服务商 ${host} 在约 ${minutes} 分钟内没有返回结果。${method === 'POST' ? '生图请求可能仍在处理并已产生费用，请先查看服务商后台，确认任务状态后再决定是否重试。' : '请检查接口地址和网络。'}`), {
    providerFailureKind: 'timeout', providerUrl: url, providerMethod: method, providerPossiblyAccepted: method === 'POST',
  });
}

async function fetchJson(url: string, init: RequestInit, timeout = 120000, signal?: AbortSignal, allowSvgOutput = false) {
  const method = String(init.method || 'GET').toUpperCase();
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: combineSignals(signal || init.signal || undefined, timeout) });
    const data = await parseResponse(response, allowSvgOutput);
    if (signal?.aborted) throw signal.reason || new Error('请求已取消');
    return data;
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error instanceof Error && (error as Error & { providerResponse?: boolean }).providerResponse) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || /timed out/i.test(error.message))) throw providerTimeoutFailure(url, timeout, method);
    throw connectionFailure(url, error, method);
  }
}

export function canRetryImageRequest(error: unknown) {
  const failure = error as ProviderFailure | null;
  // Retry only an explicit validation/compatibility rejection. Transport errors,
  // timeouts, and 5xx responses may mean the provider already accepted the job.
  if (failure?.providerAcceptedTask || failure?.providerPossiblyAccepted) return false;
  return failure?.providerFailureKind === 'http' && [400, 415, 422].includes(Number(failure.providerStatus || (failure as any).status));
}

type ModelEndpointCandidate = { url: string; inferredBaseUrl?: string };

export function modelEndpointCandidates(provider: RuntimeProvider): ModelEndpointCandidate[] {
  const configuredPath = String(provider.modelsPath || '/models').trim() || '/models';
  const primaryUrl = providerEndpoint(provider, configuredPath, '/models');
  const baseUrl = runtimeBaseUrl(provider);
  const isDefaultModelsPath = /^\/?models\/?$/i.test(configuredPath);
  const hasVersionSuffix = /\/(?:v\d+(?:\.\d+)?|api\/v\d+(?:\.\d+)?)$/i.test(baseUrl);
  const candidates: ModelEndpointCandidate[] = [];
  if (isDefaultModelsPath && !hasVersionSuffix) {
    candidates.push({ url: `${baseUrl}/v1/models`, inferredBaseUrl: `${baseUrl}/v1` });
  }
  candidates.push({ url: primaryUrl });
  return candidates.filter((candidate, index, all) => all.findIndex((item) => item.url === candidate.url) === index);
}

/**
 * A missing edit route is different from an unsupported image model. Some
 * OpenAI-compatible gateways expose image generation but do not implement
 * /images/edits at all; callers may choose a safe generation-only fallback
 * for that explicit case.
 */
export function isProviderEndpointNotFound(error: unknown) {
  const failure = error as { providerFailureKind?: string; providerStatus?: number; status?: number; message?: string } | null;
  const status = Number(failure?.providerStatus || failure?.status);
  const message = String(failure?.message || '').toLowerCase();
  if (status !== 404 || failure?.providerFailureKind !== 'http') return false;
  if (/model\s+(?:not found|does not exist)|unknown model|模型不存在|未找到模型/.test(message)) return false;
  return /404\s+page\s+not\s+found|endpoint|route|path|接口|路径/.test(message);
}

async function fetchModelResponse(url: string, init: RequestInit, timeout = 20000) {
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: combineSignals(init.signal || undefined, timeout) });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      const error = providerResponseError(response.status, data, text, requestIdFrom(data, text, response.headers));
      throw decorateProviderFailure(error, { providerUrl: url, providerMethod: 'GET' });
    }
    return { data, contentType: response.headers.get('content-type') || '', text };
  } catch (error) {
    if (error instanceof Error && (error as Error & { providerResponse?: boolean }).providerResponse) throw error;
    throw connectionFailure(url, error);
  }
}

/** 供其它服务端模块（如克隆出片的配音调用）复用同一套鉴权头。 */
export function authHeaders(
  provider: Pick<RuntimeProvider, 'apiKey'> & Partial<Pick<RuntimeProvider, 'authHeader' | 'authPrefix' | 'videoApiKey'>>,
  video = false,
) {
  const header = provider.authHeader?.trim() || 'Authorization';
  const prefix = provider.authPrefix ?? 'Bearer ';
  const key = video ? provider.videoApiKey || provider.apiKey : provider.apiKey;
  return { [header]: `${prefix}${key}` };
}

function urlHost(value: string) {
  try {
    const parsed = new URL(value);
    return /^https?:$/i.test(parsed.protocol) ? parsed.host : '';
  } catch {
    return '';
  }
}

function urlHostname(value: string) {
  try {
    const parsed = new URL(value);
    return /^https?:$/i.test(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** Authentication used only when a provider returns an image URL on its own host. */
export function imageDownloadAuth(provider: RuntimeProvider): ImageDownloadAuth {
  const trustedHosts = [
    provider.baseUrl,
    providerEndpoint(provider, provider.imageGenerationPath, '/images/generations'),
    providerEndpoint(provider, provider.imageEditPath, '/images/edits'),
  ].map((value) => urlHost(String(value || ''))).filter(Boolean);
  const hostnames = [provider.baseUrl, provider.videoBaseUrl].map((value) => urlHostname(String(value || ''))).filter(Boolean);
  const trustedHostSuffixes = is65535Provider(provider) && hostnames.some((hostname) => hostname === '65535.space' || hostname.endsWith('.65535.space'))
    ? ['65535.space']
    : [];
  return {
    headers: authHeaders(provider),
    trustedHosts: Array.from(new Set(trustedHosts)),
    trustedHostSuffixes,
  };
}

function isApimartProvider(provider: RuntimeProvider) {
  return provider.platform === 'apimart' || /(^|\.)api\.apimart\.ai$/i.test(new URL(runtimeBaseUrl(provider)).hostname);
}

const PROVIDER_IMAGE_INPUT_MAX_BYTES = PROVIDER_IMAGE_REFERENCE_MAX_BYTES;

/**
 * 65535/APIMart image_urls inputs are URL transports: the
 * upstream service fetches the reference instead of receiving a multipart
 * file. Keep that contract explicit so a local storage path or an expired
 * provider URL never reaches the upstream image loader unchecked.
 */
function requiresPublicImageInput(provider: RuntimeProvider) {
  return is65535Provider(provider) || isApimartProvider(provider);
}

function isStoredImageReference(value: string) {
  return /^\/?api\/storage\/file\?/i.test(String(value || '').trim());
}

function imageDataUrlBytes(value: string) {
  const match = value.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match || !/^image\//i.test(match[1])) return null;
  try {
    const bytes = match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    const mime = imageMimeFromBytes(bytes);
    return mime ? { bytes, mime } : null;
  } catch {
    return null;
  }
}

function isPrivateImageReferenceUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const family = isIP(host);
    return parsed.username.length > 0 || parsed.password.length > 0
      || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host.endsWith('.internal') || host.endsWith('.home.arpa') || host.endsWith('.lan')
      || Boolean(family && !isPublicImageAddress(host));
  } catch {
    return true;
  }
}

function providerImageInputError(detail: string) {
  const error = new Error(`参考图尚未准备好，图片请求未提交：${detail}`);
  return decorateProviderFailure(error, { providerFailureKind: 'input', providerStatus: 422, providerResponse: false });
}

function providerMediaRelayUnavailableError(detail: string) {
  const error = providerImageInputError(detail);
  error.providerFailureCode = 'MEDIA_MODEL_INPUT_NOT_SUBMITTED';
  return error;
}

async function fetchProviderImageDataUrl(value: string, signal?: AbortSignal) {
  if (isPrivateImageReferenceUrl(value)) throw providerImageInputError('图片地址不是可安全读取的 HTTPS/HTTP 公网地址，请重新上传图片。');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await providerImageReferenceReader.read(value, signal));
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    throw providerImageInputError(error instanceof Error ? error.message : '读取图片地址失败，请重新上传图片或检查地址。');
  }
  if (!bytes.length || bytes.length > PROVIDER_IMAGE_INPUT_MAX_BYTES) throw providerImageInputError('图片超过 25 MiB 或内容为空，请先压缩后重试。');
  const mime = imageMimeFromBytes(bytes);
  if (!mime) throw providerImageInputError('地址返回的内容不是有效的 PNG、JPEG、WebP、GIF 或 BMP 图片。');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function materializeProviderImageInput(provider: RuntimeProvider, value: string, signal?: AbortSignal, depth = 0): Promise<string> {
  if (depth > 2) throw providerImageInputError('图片引用嵌套层级过深，请重新上传图片。');
  const raw = String(value || '').trim();
  if (isStoredImageReference(raw)) {
    try {
      const { resolveStoredImageReference } = await import('./image-storage');
      const storageReference = raw.startsWith('/') ? raw : `/${raw}`;
      const resolved = await resolveStoredImageReference(storageReference, provider.imageStoragePath);
      if (resolved === raw) throw new Error('storage reference was not resolved');
      return materializeProviderImageInput(provider, resolved, signal, depth + 1);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('参考图尚未准备好')) throw error;
      throw providerImageInputError('本地图片文件已不存在，请重新上传图片。');
    }
  }
  const input = normalizeReference(raw);
  if (!input) throw providerImageInputError('图片地址为空，请重新上传图片。');
  if (/^data:/i.test(input)) {
    if (!requiresPublicImageInput(provider)) return input;
    const parsed = imageDataUrlBytes(input);
    if (!parsed || parsed.bytes.length > PROVIDER_IMAGE_INPUT_MAX_BYTES) throw providerImageInputError('内嵌内容不是有效图片或超过 25 MiB，请重新上传图片。');
    return `data:${parsed.mime};base64,${parsed.bytes.toString('base64')}`;
  }
  if (/^https?:\/\//i.test(input)) {
    if (!requiresPublicImageInput(provider)) return input;
    return fetchProviderImageDataUrl(input, signal);
  }
  throw providerImageInputError('无法识别图片引用，请重新上传图片。');
}

async function prepareProviderImageInput(provider: RuntimeProvider, value: string, signal?: AbortSignal) {
  const dataUrl = await materializeProviderImageInput(provider, value, signal);
  if (!requiresPublicImageInput(provider)) return dataUrl;
  const signedMedia = await import('./signed-media');
  try {
    return await signedMedia.preparePublicMediaUrl(dataUrl, 'image');
  } catch (error) {
    if (error instanceof signedMedia.PublicMediaError) {
      if (error.code === signedMedia.MEDIA_RELAY_REQUIRED || error.code === signedMedia.MEDIA_RELAY_UNAVAILABLE) {
        throw providerMediaRelayUnavailableError('当前服务商需要可公开访问的图片地址，但应用的媒体中转尚未可用。请稍后重试或在高级设置中配置公网媒体地址。');
      }
      throw providerImageInputError(error.message);
    }
    if (error instanceof Error && error.message.startsWith('参考图尚未准备好')) throw error;
    throw providerImageInputError(error instanceof Error ? error.message : '图片尚未准备好，无法提交给当前服务商。');
  }
}

async function prepareProviderImageInputs(provider: RuntimeProvider, values: string[], signal?: AbortSignal) {
  return Promise.all(values.map((value) => prepareProviderImageInput(provider, value, signal)));
}

const CANGYUAN_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const CANGYUAN_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type CangyuanImageUpload = { bytes: Buffer; mime: string };

async function prepareCangyuanImageUpload(provider: RuntimeProvider, value: string, signal?: AbortSignal): Promise<CangyuanImageUpload> {
  const materialized = await materializeProviderImageInput(provider, value, signal);
  const dataUrl = /^https?:\/\//i.test(materialized)
    ? await fetchProviderImageDataUrl(materialized, signal)
    : materialized;
  const parsed = imageDataUrlBytes(dataUrl);
  if (!parsed || !CANGYUAN_IMAGE_MIME_TYPES.has(parsed.mime)) {
    throw providerImageInputError('沧元参考图仅支持 PNG、JPEG、WebP，请转换格式后重新上传。');
  }
  if (!parsed.bytes.length || parsed.bytes.length > CANGYUAN_IMAGE_MAX_BYTES) {
    throw providerImageInputError('沧元参考图不能超过 20 MB，请压缩后重新上传。');
  }
  return { bytes: parsed.bytes, mime: parsed.mime };
}

async function uploadCangyuanImage(provider: RuntimeProvider, image: CangyuanImageUpload, signal?: AbortSignal) {
  const uploadResponse = await fetchJson(providerEndpoint(provider, undefined, '/images/uploads'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bytes: image.bytes.length,
      content_type: image.mime,
      content_md5: createHash('md5').update(image.bytes).digest('base64'),
    }),
  }, 30000, signal);
  const uploadData = uploadResponse?.data && typeof uploadResponse.data === 'object'
    ? uploadResponse.data
    : uploadResponse;
  const uploadUrl = String(uploadData?.upload_url || '').trim();
  const imageUrl = String(uploadData?.url || '').trim();
  const headers = uploadData?.headers && typeof uploadData.headers === 'object' && !Array.isArray(uploadData.headers)
    ? uploadData.headers as Record<string, unknown>
    : {};
  let parsedUploadUrl: URL;
  try { parsedUploadUrl = new URL(uploadUrl); }
  catch { throw new Error('沧元图片上传接口没有返回有效的 upload_url。'); }
  if (parsedUploadUrl.protocol !== 'https:' || isPrivateImageReferenceUrl(uploadUrl) || !/^https:\/\//i.test(imageUrl) || isPrivateImageReferenceUrl(imageUrl)) {
    throw new Error('沧元图片上传接口没有返回 HTTPS 上传地址或参考图 URL。');
  }

  const uploadHeaders = new Headers();
  for (const [key, headerValue] of Object.entries(headers)) {
    if (typeof headerValue === 'string' || typeof headerValue === 'number') uploadHeaders.set(key, String(headerValue));
  }
  let putResponse: Response;
  try {
    putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: uploadHeaders,
      body: Uint8Array.from(image.bytes),
      cache: 'no-store',
      redirect: 'error',
      signal: combineSignals(signal, 30000),
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    throw new Error(`沧元参考图上传失败：${error instanceof Error ? error.message : '上传连接中断'}`);
  }
  if (!putResponse.ok) throw new Error(`沧元参考图上传失败：HTTP ${putResponse.status}`);
  return imageUrl;
}

/**
 * Some image-model families expose high-fidelity input handling as a fixed
 * default rather than accepting the legacy input_fidelity request field.
 * Keep this decision at the provider boundary so angle generation and the
 * ordinary edit flow share the same compatibility behavior.
 */
export function shouldSendInputFidelity(provider: Pick<RuntimeProvider, 'name' | 'platform' | 'baseUrl'>, rawModelId: string) {
  const identity = `${rawModelId} ${provider.name || ''}`.toLowerCase();
  if (/gpt[\s_-]*image[\s_-]*2(?:[^a-z0-9]|$)/i.test(identity)) return false;
  return true;
}

function unwrapProviderData(provider: RuntimeProvider, data: any) {
  return isApimartProvider(provider) && data && typeof data === 'object' && 'data' in data ? data.data : data;
}

function isJevModelId(rawId: string) {
  const value = String(rawId || '').trim().toLowerCase();
  return value === 'jev-1.14' || value.endsWith('/jev-1.14');
}

function jevSystemOneEndpoint(provider: RuntimeProvider) {
  // 65535 exposes JEV's System One channel on the international API host.
  // The mainland chat host advertises the model but does not expose this route.
  if (is65535Provider(provider)) return 'https://api2.65535.space/v1/systemone';
  return providerEndpoint(provider, undefined, '/systemone');
}

function intentState(messages: ChatMessage[]) {
  return messages.map((message) => {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '');
    return `${message.role}: ${content}`;
  }).join('\n');
}

function choiceValue(answer: IntentChoiceAnswer | undefined) {
  const value = String(answer?.choice || '').trim().toLowerCase();
  return value;
}

function choiceConfidence(answer: IntentChoiceAnswer | undefined) {
  const value = Number(answer?.confidence);
  if (Number.isFinite(value)) return value >= 0.8 ? 'high' : 'low';
  return String(answer?.confidence || '').trim().toLowerCase() === 'high' ? 'high' : 'low';
}

async function requestJevSystemOne(
  provider: RuntimeProvider,
  rawModelId: string,
  state: string,
  questions: IntentSystemOneQuestions,
  signal?: AbortSignal,
) {
  if (!isJevModelId(rawModelId)) throw new Error('intent classification requires the JEV model');
  return await fetchJson(jevSystemOneEndpoint(provider), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: rawModelId, state, questions }),
  }, 120000, signal) as IntentSystemOneResponse;
}

function normalizeJevIntentResponse(data: IntentSystemOneResponse, rawModelId: string) {
  const mode = choiceValue(data.answers?.mode);
  const deliverable = choiceValue(data.answers?.deliverable);
  const validMode = ['execute', 'ask', 'discuss', 'follow_up', 'unknown'].includes(mode) ? mode : 'unknown';
  const validDeliverable = ['image', 'text', 'both', 'clarify', 'other'].includes(deliverable)
    ? deliverable.toUpperCase()
    : 'OTHER';
  const confidence = choiceConfidence(data.answers?.mode) === 'high' && choiceConfidence(data.answers?.deliverable) === 'high' ? 'high' : 'low';
  const reason = `JEV System One 判定：mode=${validMode}，deliverable=${validDeliverable}`;
  return {
    model: String(data.model || rawModelId),
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ mode: validMode, deliverable: validDeliverable, confidence, reason }) }, finish_reason: 'stop' }],
  };
}

export async function intentClassificationCompletion(provider: RuntimeProvider, rawModelId: string, payload: IntentClassificationPayload, signal?: AbortSignal) {
  const state = intentState(payload.messages);
  const data = await requestJevSystemOne(provider, rawModelId, state, {
    mode: {
      type: 'choice',
      instructions: '当前请求模式是什么？',
      criteria: { execute: '明确要求执行', ask: '提问或需要澄清', discuss: '讨论或咨询', follow_up: '承接上一轮任务', unknown: '无法判断' },
    },
    deliverable: {
      type: 'choice',
      instructions: '当前请求的主要交付物是什么？',
      criteria: { image: '需要生成或编辑图片', text: '需要文字、提示词或文案', both: '同时需要图片和文字', clarify: '需要先澄清交付物', other: '普通问答、分析或工具请求' },
    },
  }, signal);
  return normalizeJevIntentResponse(data, rawModelId);
}

export async function canvasImageIntentCompletion(
  provider: RuntimeProvider,
  rawModelId: string,
  input: { prompt: string; imageReferenceCount: number },
  signal?: AbortSignal,
) {
  const state = JSON.stringify({
    prompt: input.prompt,
    connectedImageReferenceCount: input.imageReferenceCount,
    task: 'Canvas creates a new output node; no input image is mutated in place.',
  });
  const data = await requestJevSystemOne(provider, rawModelId, state, {
    imageOperation: {
      type: 'choice',
      instructions: '用户希望如何使用已连接的图片？只判断操作意图，不改写提示词。',
      criteria: {
        reference_generate: '把已连接图片作为视觉参考，生成一张新的图片；允许重组、替换主旨或借鉴风格。',
        edit: '把已连接图片作为要修改的原图，重点是在原有画面基础上增删、替换或修整内容。',
        unclear: '无法有把握地区分参考生成与基于原图修改。',
      },
    },
  }, signal);
  const value = choiceValue(data.answers?.imageOperation).replace(/[\s_]+/g, '-');
  const operation = value === 'reference-generate' || value === 'reference'
    ? 'reference-generate'
    : value === 'edit' || value === 'modify'
      ? 'edit'
      : undefined;
  return {
    operation,
    confidence: choiceConfidence(data.answers?.imageOperation),
    model: String(data.model || rawModelId),
  } as const;
}

const apimartModelCatalog = [
  'gpt-5', 'gpt-5.1', 'gpt-5-chat-latest', 'gpt-5-mini',
  'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5-20251101',
  'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-pro-preview-thinking', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v3.2', 'deepseek-v3.2-exp', 'deepseek-r1-250528', 'deepseek-v3-0324',
  'gpt-image-2', 'gpt-image-2-ext',
].map((id) => ({ id, name: id }));

function modelListFromResponse(data: any): { found: boolean; items: any[] } {
  const candidates = [
    data,
    data?.data,
    data?.models,
    data?.items,
    data?.list,
    data?.result,
    data?.output,
    data?.data?.models,
    data?.data?.items,
    data?.data?.list,
    data?.data?.result,
    data?.data?.data,
    data?.result?.data,
    data?.result?.models,
    data?.output?.models,
  ];
  const value = candidates.find((candidate) => Array.isArray(candidate));
  return { found: Array.isArray(value), items: Array.isArray(value) ? value : [] };
}

export function normalizeDiscoveredModels(data: any, provider?: RuntimeProvider): DiscoveredModel[] {
  const { items } = modelListFromResponse(data);
  const normalized = items.map((item: any) => {
    if (typeof item === 'string' || typeof item === 'number') {
      const id = String(item).trim();
      const inferred = inferNativeSearch(id, provider?.platform);
      const capabilities = discoveredModelCapabilities({ id }, provider, id);
      if (inferred.detected && !capabilities.includes('web-search')) capabilities.push('web-search');
      const classification = id ? classifyAudioModelPurpose({ modelId: id, providerPlatform: provider?.platform }) : undefined;
      return id ? { id, name: id, ...(capabilities.length ? { capabilities } : {}), ...(classification && (classification.purposes.length || /audio|speech|voice|music|sound|asr|tts|transcri/i.test(id)) ? { classification } : {}), ...(inferred.protocol ? { nativeSearchProtocol: inferred.protocol, nativeSearchDetection: inferred.detection } : {}) } : null;
    }
    const id = String(item?.id || item?.model || item?.model_id || item?.modelId || item?.name || item?.slug || '').trim();
    if (!id) return null;
    const name = String(item?.name || item?.display_name || item?.displayName || id).trim() || id;
    const raw = [item?.capabilities, item?.features, item?.supported_tools, item?.tools, item?.tool_support, item?.modalities, item?.metadata, item?.endpoints, item?.endpoint, item?.operations, item?.pricing, item?.pricing_info].filter(Boolean);
    const inferred = inferNativeSearch(id, provider?.platform, raw);
    const audioClassification = classifyAudioModelPurpose({
      modelId: id,
      displayName: name,
      declaredCapabilities: [item?.capabilities, item?.features, item?.modalities].flatMap((value) => Array.isArray(value) ? value.map(String) : []),
      metadata: item,
      endpoint: String(item?.endpoint || item?.path || item?.url || ''),
      providerPlatform: provider?.platform,
    });
    const classification = audioClassification.purposes.length || /audio|speech|voice|music|sound|asr|tts|transcri/i.test(`${id} ${name}`)
      ? audioClassification
      : undefined;
    return {
      id,
      name,
      capabilities: discoveredModelCapabilities(item, provider, id),
      ...(classification ? { classification } : {}),
      ...(inferred.protocol ? { nativeSearchProtocol: inferred.protocol } : {}),
      ...(inferred.detection ? { nativeSearchDetection: inferred.detection } : {}),
    };
  }).filter(Boolean) as DiscoveredModel[];
  return [...new Map(normalized.map((model) => [model.id, model])).values()];
}

export async function discoverModels(provider: RuntimeProvider) {
  if (is65535ClaudeCodeProvider(provider)) return CLAUDE_STD_MODELS;
  if (isAgnesProvider(provider)) {
    // The Agnes catalog is intentionally curated because the service may not
    // publish every image/video model through /models.  The request itself is
    // still mandatory: without it, an expired or mistyped key looked healthy
    // while every real generation request failed with HTTP 401.
    let lastUnrecognizedResponse: { contentType: string; text: string; url: string } | null = null;
    const candidates = modelEndpointCandidates(provider);
    for (const [index, candidate] of candidates.entries()) {
      let response: { data: any; contentType: string; text: string };
      try {
        response = await fetchModelResponse(candidate.url, { method: 'GET', headers: authHeaders(provider) });
      } catch (error) {
        const status = Number((error as Error & { status?: number }).status || 0);
        if (status === 404 && index < candidates.length - 1) continue;
        throw error;
      }
      if (modelListFromResponse(response.data).found) {
        if (candidate.inferredBaseUrl) provider.baseUrl = candidate.inferredBaseUrl;
        return agnesModelCatalog.map((model) => ({ ...model, capabilities: [...(model.capabilities || [])] }));
      }
      lastUnrecognizedResponse = { contentType: response.contentType, text: response.text, url: candidate.url };
    }
    if (lastUnrecognizedResponse) {
      throw new Error(`Agnes 模型验证接口返回了无法识别的内容：${lastUnrecognizedResponse.url}。国内 Key 请使用 https://api.agnes-ai.cn/v1，国际 Key 请使用 https://apihub.agnes-ai.com/v1。`);
    }
  }
  if (isApimartProvider(provider)) return apimartModelCatalog;
  if (provider.type === 'google-gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(provider.apiKey)}`;
    const data = await fetchJson(url, { method: 'GET' }, 20000);
    return (Array.isArray(data?.models) ? data.models : []).map((item: any) => ({
      id: String(item.name || '').replace(/^models\//, ''),
      name: String(item.displayName || item.name || ''),
      capabilities: discoveredModelCapabilities(item, provider, String(item.name || '').replace(/^models\//, '')),
      ...(() => { const id = String(item.name || '').replace(/^models\//, ''); const inferred = inferNativeSearch(id, provider.platform, item); return { ...(inferred.protocol ? { nativeSearchProtocol: inferred.protocol } : {}), ...(inferred.detection ? { nativeSearchDetection: inferred.detection } : {}) }; })(),
    })).filter((m: { id: string }) => m.id);
  }
  let lastUnrecognizedResponse: { contentType: string; text: string; url: string } | null = null;
  const candidates = modelEndpointCandidates(provider);
  for (const [index, candidate] of candidates.entries()) {
    let response: { data: any; contentType: string; text: string };
    try {
      response = await fetchModelResponse(candidate.url, { method: 'GET', headers: authHeaders(provider) });
    } catch (error) {
      const status = Number((error as Error & { status?: number }).status || 0);
      if (status === 404 && index < candidates.length - 1) continue;
      throw error;
    }
    const modelResponse = modelListFromResponse(response.data);
    if (modelResponse.found) {
      if (candidate.inferredBaseUrl) provider.baseUrl = candidate.inferredBaseUrl;
      inferVideoTransportFromMetadata(response.data, provider);
      const discovered = await mergeVideoDiscoveredModels(provider, normalizeDiscoveredModels(response.data, provider));
      if (provider.videoTransport === 'auto' && discovered.some((item) => item.capabilities?.some((capability) => capability.startsWith('video-')))) provider.videoTransport = 'openai-videos';
      return discovered;
    }
    lastUnrecognizedResponse = { contentType: response.contentType, text: response.text, url: candidate.url };
  }
  if (lastUnrecognizedResponse && (/<\s*!doctype|<\s*html/i.test(lastUnrecognizedResponse.text) || /text\/html/i.test(lastUnrecognizedResponse.contentType))) {
    throw new Error(`模型接口返回了网页而不是 JSON：${lastUnrecognizedResponse.url}。请填写服务商的 API 根地址，不要填写控制台网页地址；兼容平台通常应使用 /v1。`);
  }
  throw new Error('服务商返回了成功响应，但其中没有识别到模型列表。支持 data、models、items、list 及其常见嵌套格式，请检查模型接口路径。');
}

async function mergeVideoDiscoveredModels(provider: RuntimeProvider, models: DiscoveredModel[]) {
  if (provider.videoTransport === 'jimeng-cli' || !provider.videoModelsPath) return models;
  const byId = new Map(models.map((item) => [item.id, item]));
  const merge = (items: DiscoveredModel[]) => {
    for (const model of items) {
      const existing = byId.get(model.id);
      byId.set(model.id, existing ? { ...existing, capabilities: Array.from(new Set([...(existing.capabilities || []), ...(model.capabilities || [])])) } : model);
    }
  };
  const videoHeaders = authHeaders(provider, true);
  try {
    const data = await fetchJson(videoProviderEndpoint(provider, provider.videoModelsPath, '/v1/models'), { method: 'GET', headers: videoHeaders }, 20000);
    inferVideoTransportFromMetadata(data, provider);
    merge(normalizeDiscoveredModels(data, provider).filter((item) => item.capabilities?.some((capability) => capability.startsWith('video-'))));
  } catch { /* Some vendors expose video only through pricing or the main model list. */ }
  if (provider.videoPricingPath) {
    try {
      const data = await fetchJson(videoProviderEndpoint(provider, provider.videoPricingPath, '/v1/pricing'), { method: 'GET', headers: videoHeaders }, 20000);
      inferVideoTransportFromMetadata(data, provider);
      merge(normalizeDiscoveredModels(data, provider).filter((item) => item.capabilities?.some((capability) => capability.startsWith('video-'))));
    } catch { /* Pricing is advisory; model discovery remains usable when it is absent. */ }
  }
  return [...byId.values()];
}

export async function testProviderConnection(provider: RuntimeProvider) {
  if (is65535ClaudeCodeProvider(provider)) {
    return {
      mode: 'models' as const,
      verified: false,
      count: CLAUDE_STD_MODELS.length,
      sample: CLAUDE_STD_MODELS.slice(0, 8),
      message: 'Claude Std 模型清单已载入；尚未发送 API 请求，Key 会在首次聊天时验证。',
    };
  }
  if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') {
    const inspected = await inspectJimengCli(provider);
    if (inspected.installed) {
      return {
        mode: 'cli' as const,
        count: 0,
        message: `即梦 CLI 已检测：${inspected.version || '版本信息不可用'}；${inspected.loginHint}`,
      };
    }
    const installCommand = process.platform === 'win32'
      ? 'irm https://jimeng.jianying.com/canvas-cli/install.ps1 | iex'
      : 'curl -fsSL https://jimeng.jianying.com/canvas-cli/install.sh | bash';
    throw new Error(`${inspected.loginHint}。官方安装命令：${installCommand}`);
  }
  if (isApimartProvider(provider)) {
    const data = await fetchJson(providerEndpoint(provider, '/balance', '/balance'), { method: 'GET', headers: authHeaders(provider) }, 20000);
    if (data?.success !== true) throw new Error(String(data?.message || 'APIMart 未确认此 API Key 有效'));
    return { mode: 'credential' as const, count: apimartModelCatalog.length, message: data.unlimited_quota ? '连接成功，密钥验证通过，当前密钥额度不限' : '连接成功，密钥验证通过，可读取并使用预置模型' };
  }
  if (isAgnesProvider(provider)) {
    const models = await discoverModels(provider);
    return {
      mode: 'credential' as const,
      verified: true,
      count: models.length,
      endpoint: provider.baseUrl,
      message: `连接成功，Agnes API Key 已验证，可使用文本、图片和视频模型（${models.length} 个）`,
    };
  }
  const models = await discoverModels(provider);
  return { mode: 'models' as const, count: models.length, sample: models.slice(0, 8) };
}

function nearest16(value: number) { return Math.max(256, Math.min(3840, Math.round(value / 16) * 16)); }
export function mapRatioToSize(ratio: string, width?: number, height?: number) {
  if (width && height) return `${nearest16(width)}x${nearest16(height)}`;
  if (ratio === '自动') return 'auto';
  const [rawWidth, rawHeight] = ratio.split(':').map(Number);
  if (!rawWidth || !rawHeight) return '1024x1024';
  const longEdge = 1536;
  const targetWidth = rawWidth >= rawHeight ? longEdge : nearest16(longEdge * rawWidth / rawHeight);
  const targetHeight = rawHeight >= rawWidth ? longEdge : nearest16(longEdge * rawHeight / rawWidth);
  return `${targetWidth}x${targetHeight}`;
}

function exactImageSize(width?: number, height?: number) {
  const w = Number(width);
  const h = Number(height);
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 16384 && h <= 16384 ? `${w}x${h}` : undefined;
}

const STARAPI_GPT_IMAGE_NATIVE_SIZES = new Set(['512x512', '1024x1024', '1024x1536', '1536x1024']);

function isStarApiProvider(provider: Pick<RuntimeProvider, 'baseUrl' | 'name'>) {
  let hostname = '';
  try { hostname = new URL(provider.baseUrl || '').hostname.toLowerCase(); } catch { /* malformed custom URLs stay on the generic path */ }
  return /(?:^|\.)starapi\.cc$/i.test(hostname) || /star[\s_-]*api/i.test(String(provider.name || ''));
}

function isStarApiGptImage2(provider: Pick<RuntimeProvider, 'baseUrl' | 'name'>, rawModelId: string) {
  return isStarApiProvider(provider) && String(rawModelId || '').trim().toLowerCase() === 'gpt-image-2';
}

function starApiGptImage2Size(ratio: string, width?: number, height?: number) {
  const exact = exactImageSize(width, height);
  const hasExplicitRatio = Boolean(ratio && ratio !== '自动' && ratio !== '自定义');
  if (!hasExplicitRatio && exact && STARAPI_GPT_IMAGE_NATIVE_SIZES.has(exact)) return exact;

  let value = 0;
  if (ratio && ratio !== '自动' && ratio !== '自定义') {
    const [rawWidth, rawHeight] = ratio.split(':').map(Number);
    if (rawWidth > 0 && rawHeight > 0) value = rawWidth / rawHeight;
  }
  if (!value && width && height) value = Number(width) / Number(height);
  if (!Number.isFinite(value) || value <= 0) return '1024x1024';
  return value > 1.05 ? '1536x1024' : value < 0.95 ? '1024x1536' : '1024x1024';
}

/** Keep the StarAPI gpt-image-2 exception local; all other providers retain the existing mapping. */
export function mapImageRequestSize(
  provider: Pick<RuntimeProvider, 'baseUrl' | 'name'>,
  rawModelId: string,
  ratio: string,
  width?: number,
  height?: number,
) {
  return isStarApiGptImage2(provider, rawModelId)
    ? starApiGptImage2Size(ratio, width, height)
    : mapRatioToSize(ratio, width, height);
}

// Image generation providers can legitimately take much longer than chat APIs.
// Keep the server-side wait long enough for slow-but-successful vendors such as APIQIK.
const IMAGE_REQUEST_TIMEOUT = 30 * 60 * 1000;

const imageFieldPattern = /(?:^|[_-])(image|images|img|picture|photo|base64|b64|inline[_-]?data|attachment|file|result[_-]?url|output[_-]?url|download[_-]?url)(?:$|[_-])/i;
const imageBranchPattern = /^(?:data|images?|output|result|result[_-]?urls?|image[_-]?urls?|choices|message|content|parts|candidates|files|attachments|response|payload|body|raw)$/i;
const imageUrlFieldPattern = /^(?:url|uri|href|image[_-]?url|output[_-]?url|result[_-]?url|download[_-]?url)$/i;

function objectMimeType(value: any) {
  if (!value || typeof value !== 'object') return 'image/png';
  return imageMimeFromContentType(String(value.mime_type || value.mimeType || value.content_type || value.contentType || '')) || 'image/png';
}

function isRawBase64(value: string) {
  const compact = value.replace(/\s/g, '');
  return compact.length >= 16 && compact.length % 4 !== 1 && /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

function embeddedImageReferences(value: string) {
  const references: string[] = [];
  const dataUrlPattern = /data:image\/[a-z0-9.+-]+(?:;[^,]*)?,[A-Za-z0-9+/=_%\s-]+/gi;
  const markdownPattern = /!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)/gi;
  const htmlPattern = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  for (const match of value.matchAll(dataUrlPattern)) references.push(match[0]);
  for (const match of value.matchAll(markdownPattern)) references.push(match[1]);
  for (const match of value.matchAll(htmlPattern)) references.push(match[1]);
  return references;
}

function imageReferenceFromString(value: string, key: string, parent: any, forceImage: boolean, allowSvgOutput: boolean) {
  const text = value.trim();
  if (!text) return [];
  const references = embeddedImageReferences(text);
  if (references.length) return references;
  if (/^data:image\//i.test(text)) return [text];
  if (/^https?:\/\//i.test(text)) {
    return forceImage || imageUrlFieldPattern.test(key) || imageFieldPattern.test(key) ? [text] : [];
  }
  const parentType = String(parent?.type || parent?.object || '').toLowerCase();
  if (forceImage || /image[_-]?(generation|generation_call|data)|inline[_-]?data/.test(parentType)) {
    if (isRawBase64(text)) {
      const compact = text.replace(/\s/g, '');
      const bytes = Buffer.from(compact, 'base64');
      const mime = allowSvgOutput && isSvgImageBytes(bytes) ? 'image/svg+xml' : objectMimeType(parent);
      return [`data:${mime};base64,${compact}`];
    }
  }
  return [];
}

function extractImages(data: any, allowSvgOutput = false): GeneratedImage[] {
  const images: GeneratedImage[] = [];
  const seen = new Set<string>();
  const add = (url: string, revisedPrompt?: unknown) => {
    const normalized = String(url || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    images.push({ url: normalized, ...(typeof revisedPrompt === 'string' && revisedPrompt ? { revisedPrompt } : {}) });
  };
  const walk = (value: any, key = '', parent: any = null, forceImage = false, depth = 0, inheritedPrompt?: unknown): void => {
    if (value === null || value === undefined || depth > 10) return;
    if (typeof value === 'string') {
      for (const reference of imageReferenceFromString(value, key, parent, forceImage, allowSvgOutput)) add(reference, inheritedPrompt);
      return;
    }
    if (typeof value !== 'object') return;
    const revisedPrompt = value.revised_prompt || value.revisedPrompt || inheritedPrompt;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, parent, forceImage, depth + 1, revisedPrompt);
      return;
    }
    const objectType = String(value.type || value.object || '').toLowerCase();
    const objectIsImage = forceImage || imageFieldPattern.test(key) || /image[_-]?(generation|generation_call|data)|inline[_-]?data/.test(objectType);
    for (const [childKey, childValue] of Object.entries(value)) {
      if (/^(?:revised[_-]?prompt|mime[_-]?type|content[_-]?type|type|object|task[_-]?id|request[_-]?id|status|state|created(?:[_-]at)?|model|prompt)$/i.test(childKey)) continue;
      const childIsImage = objectIsImage || imageUrlFieldPattern.test(childKey) || imageFieldPattern.test(childKey) || imageBranchPattern.test(childKey);
      walk(childValue, childKey, value, childIsImage, depth + 1, revisedPrompt);
    }
  };
  walk(data, '', null, typeof data === 'string');
  return images;
}

function responseShape(value: any, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return 'data:image';
    if (/^https?:\/\//i.test(value)) return 'url';
    if (isRawBase64(value)) return `base64(${value.length})`;
    return `string(${value.length})`;
  }
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value !== 'object') return typeof value;
  const keys = Object.keys(value).filter((key) => !key.startsWith('__')).slice(0, 16);
  if (depth >= 2) return `{${keys.join(',')}}`;
  return `{${keys.map((key) => `${key}:${responseShape(value[key], depth + 1)}`).join(', ')}}`;
}

export function normalizeProviderImages(data: any, options: { allowSvgOutput?: boolean } = {}): GeneratedImage[] {
  const allowSvgOutput = options.allowSvgOutput === true;
  const images = extractImages(data, allowSvgOutput);
  const validImages = images.filter((image) => !/^data:image\//i.test(image.url)
    || isSupportedImageDataUrl(image.url)
    || (allowSvgOutput && /^data:image\/svg\+xml(?:;|,)/i.test(image.url) && isSvgImageBytes(dataUrlBytes(image.url) || new Uint8Array())));
  const meta = data && typeof data === 'object' ? (data as any)[providerResponseMeta] as ProviderResponseMeta | undefined : undefined;
  const successfulProviderResponse = Number(meta?.status) >= 200 && Number(meta?.status) < 300;
  if (images.length && !validImages.length) {
    const error = new ProviderImageFormatError(`服务商返回了图片字段，但内容不是有效的 PNG、JPEG、WebP、GIF 或 BMP${allowSvgOutput ? '、SVG' : ''} 图片。请检查服务商的 image_url/b64_json 响应格式；任务可能已经提交，请先核对服务商后台状态后再重试。`);
    throw decorateProviderFailure(error, {
      providerResponse: true,
      providerStatus: meta?.status,
      status: meta?.status,
      providerRequestId: meta?.requestId,
      providerPossiblyAccepted: successfulProviderResponse,
    });
  }
  if (!images.length) {
    const typeHint = meta?.contentType ? `，响应类型 ${meta.contentType.split(';', 1)[0]}` : '';
    if (successfulProviderResponse) {
      const acceptedMessage = meta?.status === 202
        ? `服务商已接受图片任务，但没有返回图片或可查询的任务编号${typeHint}。`
        : `服务商返回了成功响应，但没有找到可显示的图片${typeHint}。`;
      throw decorateProviderFailure(new Error(`${acceptedMessage}请先核对服务商后台状态，确认后再决定是否重试。`), {
        providerResponse: true,
        status: meta?.status,
        providerStatus: meta?.status,
        providerRequestId: meta?.requestId,
        providerPossiblyAccepted: true,
      });
    }
    throw new Error(`服务商已返回成功响应，但没有找到可显示的图片${typeHint}。响应结构：${responseShape(data)}。请确认模型支持图片接口，并检查服务商是否返回了 image_url、b64_json、二进制图片或异步任务结果。`);
  }
  return validImages;
}

function normalizeImages(data: any, allowSvgOutput = false): GeneratedImage[] {
  return normalizeProviderImages(data, { allowSvgOutput });
}

export function buildAgnesImagePayload(rawModelId: string, input: { prompt: string; aspectRatio?: string; count?: number; width?: number; height?: number; quality?: string; resolution?: string; outputFormat?: 'png' | 'jpeg' | 'webp'; responseFormat?: 'url' | 'b64_json'; background?: 'transparent' | 'opaque' }, references: string[] = []) {
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
  const is21 = /agnes-image-2\.1/i.test(rawModelId);
  const ratio = input.aspectRatio && input.aspectRatio !== '自动' && new Set(['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']).has(input.aspectRatio) ? input.aspectRatio : undefined;
  const tier = String(input.resolution || '').toUpperCase();
  const exact = exactImageSize(input.width, input.height);
  const size = is21 && /^(1K|2K|3K|4K)$/.test(tier) ? tier : exact || mapRatioToSize(input.aspectRatio || '自动');
  const extraBody: Record<string, unknown> = {};
  if (references.length) extraBody.image = references.length === 1 ? references[0] : references;
  // Agnes accepts only url/b64_json here; png/jpeg/webp describes the stored
  // asset in SANMAO.AI, not the response transport encoding.
  extraBody.response_format = input.responseFormat || 'url';
  return {
    model: rawModelId,
    prompt: input.prompt,
    n: count,
    size,
    ...(is21 && ratio ? { ratio } : {}),
    ...(input.quality && input.quality !== '自动' ? { quality: input.quality } : {}),
    ...(input.background ? { background: input.background } : {}),
    extra_body: extraBody,
  };
}

async function generateAgnesImage(provider: RuntimeProvider, rawModelId: string, input: { prompt: string; references?: string[]; aspectRatio?: string; count?: number; width?: number; height?: number; quality?: string; resolution?: string; outputFormat?: 'png' | 'jpeg' | 'webp'; responseFormat?: 'url' | 'b64_json'; background?: 'transparent' | 'opaque'; mask?: string }, references: string[] = [], signal?: AbortSignal) {
  const media = await Promise.all(references.map((reference) => preparePublicMediaUrl(reference, 'image')));
  const payload = buildAgnesImagePayload(rawModelId, input, media);
  if (input.mask) payload.extra_body.mask = await preparePublicMediaUrl(input.mask, 'image');
  const data = await fetchJson(providerEndpoint(provider, provider.imageGenerationPath, '/images/generations'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, IMAGE_REQUEST_TIMEOUT, signal);
  const images = extractImages(data);
  if (images.length) return normalizeImages(data).slice(0, Math.max(1, Math.min(8, Number(input.count || 1))));
  if (taskIdFrom(data)) return waitForImageTask(provider, data, signal);
  return normalizeImages(data);
}

function taskIdFrom(data: any) {
  const values = [
    data?.task_id, data?.taskId, data?.request_id, data?.requestId, data?.id,
    data?.data?.task_id, data?.data?.taskId, data?.data?.request_id, data?.data?.requestId, data?.data?.id,
    data?.data?.[0]?.task_id, data?.data?.[0]?.taskId, data?.task?.id, data?.data?.task?.id,
  ];
  return String(values.find((value) => value !== undefined && value !== null && String(value).trim()) || '').trim();
}

function taskStatusFrom(data: any) {
  return String(data?.status || data?.state || data?.task_status || data?.data?.status || data?.data?.state || data?.data?.task_status || data?.task?.status || data?.data?.task?.status || '').toLowerCase();
}

function isModelScopeProvider(provider: Pick<RuntimeProvider, 'platform'>) {
  return provider.platform === 'modelscope';
}

function modelScopeTaskEndpoint(provider: RuntimeProvider, taskId: string) {
  const taskPath = `/v1/tasks/${encodeURIComponent(taskId)}`;
  return videoProviderEndpoint(provider, taskPath, taskPath);
}

function modelScopeImageHeaders(provider: Pick<RuntimeProvider, 'platform'>): Record<string, string> {
  return isModelScopeProvider(provider)
    ? { 'X-ModelScope-Async-Mode': 'true' }
    : {};
}

function modelScopeTaskHeaders(provider: Pick<RuntimeProvider, 'platform'>): Record<string, string> {
  return isModelScopeProvider(provider)
    ? { 'X-ModelScope-Task-Type': 'image_generation' }
    : {};
}

function taskStatusEndpoint(provider: RuntimeProvider, taskId: string, initial: any) {
  const explicit = [
    initial?.status_url, initial?.statusUrl, initial?.polling_url, initial?.pollingUrl,
    initial?.result_url, initial?.resultUrl, initial?.data?.status_url, initial?.data?.statusUrl,
    initial?.data?.polling_url, initial?.data?.pollingUrl, initial?.data?.result_url, initial?.data?.resultUrl,
  ].find((value) => typeof value === 'string' && value.trim());
  if (explicit) {
    const path = String(explicit).trim().replaceAll('{taskId}', encodeURIComponent(taskId)).replaceAll('{task_id}', encodeURIComponent(taskId));
    return providerEndpoint(provider, path, path);
  }
  if (provider.platform === '65535') return providerEndpoint(provider, `/v1/tasks/${encodeURIComponent(taskId)}`, `/v1/tasks/${encodeURIComponent(taskId)}`);
  if (isModelScopeProvider(provider)) return modelScopeTaskEndpoint(provider, taskId);
  return '';
}

function acceptedProviderTaskError(error: unknown, taskId: string): Error & { providerAcceptedTask?: true; providerPossiblyAccepted?: true; providerTaskId?: string; providerTaskTerminalFailure?: true } {
  const failure = error instanceof Error ? error : new Error(String(error || '服务商任务查询失败'));
  if ((failure as Error & { providerTaskTerminalFailure?: boolean }).providerTaskTerminalFailure) return failure;
  Object.assign(failure, { providerAcceptedTask: true, providerPossiblyAccepted: true, providerTaskId: taskId });
  return failure as Error & { providerAcceptedTask: true; providerPossiblyAccepted: true; providerTaskId: string };
}

function terminalProviderTaskError(message: string) {
  const failure = new Error(message) as Error & { providerTaskTerminalFailure: true };
  failure.providerTaskTerminalFailure = true;
  return failure;
}

function isAcceptedProviderTask(error: unknown) {
  const value = error as { providerAcceptedTask?: boolean; providerPossiblyAccepted?: boolean; providerTaskTerminalFailure?: boolean } | null;
  if (value?.providerTaskTerminalFailure) return false;
  return Boolean(value?.providerAcceptedTask || value?.providerPossiblyAccepted);
}

async function waitForImageTask(provider: RuntimeProvider, initial: any, signal?: AbortSignal) {
  const taskId = taskIdFrom(initial);
  if (!taskId) return normalizeImages(initial);
  const statusUrl = taskStatusEndpoint(provider, taskId, initial);
  if (!statusUrl) {
    throw new Error(`服务商已接受图片任务 ${taskId}，但没有在响应中提供图片或任务查询地址。请让服务商返回 image_url、b64_json、status_url/result_url，或在接口配置中提供任务查询路径。`);
  }
  const deadline = Date.now() + IMAGE_REQUEST_TIMEOUT;
  let detachedFromCaller = false;
  while (Date.now() < deadline) {
    detachedFromCaller ||= Boolean(signal?.aborted);
    const pollSignal = detachedFromCaller ? undefined : signal;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1800);
      pollSignal?.addEventListener('abort', () => { clearTimeout(timer); reject(pollSignal.reason || new Error('GENERATION_CANCELLED')); }, { once: true });
    });
    let data: any;
    try {
      data = await fetchJson(statusUrl, { method: 'GET', headers: { ...authHeaders(provider), ...modelScopeTaskHeaders(provider) } }, 30000, pollSignal);
    } catch (error) {
      throw acceptedProviderTaskError(error, taskId);
    }
    const images = extractImages(data);
    if (images.length) return normalizeImages(data);
    const status = taskStatusFrom(data);
    if (/(fail|error|cancel|reject|expired)/.test(status)) {
      throw terminalProviderTaskError(String(data?.error?.message || data?.error_message || data?.error || data?.message || `图片任务失败：${status}`));
    }
  }
  throw acceptedProviderTaskError(new Error(`图片任务 ${taskId} 等待超时，请稍后到服务商控制台查看任务状态`), taskId);
}

async function waitForCangyuanImageTask(provider: RuntimeProvider, initial: any, endpoint: 'generations' | 'edits', signal?: AbortSignal, allowSvgOutput = false) {
  const taskId = taskIdFrom(initial);
  if (!taskId) return normalizeImages(initial, allowSvgOutput);
  const statusUrl = providerEndpoint(provider, `/images/${endpoint}/${encodeURIComponent(taskId)}`, `/images/${endpoint}/${encodeURIComponent(taskId)}`);
  const deadline = Date.now() + IMAGE_REQUEST_TIMEOUT;
  let detachedFromCaller = false;
  while (Date.now() < deadline) {
    detachedFromCaller ||= Boolean(signal?.aborted);
    const pollSignal = detachedFromCaller ? undefined : signal;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 5000);
      pollSignal?.addEventListener('abort', () => { clearTimeout(timer); reject(pollSignal.reason || new Error('GENERATION_CANCELLED')); }, { once: true });
    });
    let data: any;
    try {
      data = await fetchJson(statusUrl, { method: 'GET', headers: authHeaders(provider) }, 30000, pollSignal, allowSvgOutput);
    } catch (error) {
      throw acceptedProviderTaskError(error, taskId);
    }
    const images = extractImages(data, allowSvgOutput);
    if (images.length) return normalizeImages(data, allowSvgOutput);
    const status = taskStatusFrom(data);
    if (/(fail|error|cancel|reject|expired)/.test(status)) {
      throw terminalProviderTaskError(String(data?.error?.message || data?.error_message || data?.error || data?.message || `沧元图片任务失败：${status}`));
    }
    if (/(complete|success|succeed|finished)/.test(status)) {
      throw terminalProviderTaskError(`沧元图片任务 ${taskId} 已完成，但响应中没有可用图片结果。`);
    }
  }
  throw acceptedProviderTaskError(new Error(`沧元图片任务 ${taskId} 等待超时，请稍后到服务商控制台查看任务状态`), taskId);
}

type CangyuanImageRequestInput = ImageModelParameters & {
  prompt: string;
  references: string[];
  mask?: string;
  count?: number;
  aspectRatio?: string;
  width?: number;
  height?: number;
  sizeMode?: 'system' | 'custom';
  quality?: string;
  outputFormat?: ImageOutputFormat;
  responseFormat?: 'url' | 'b64_json';
  background?: 'transparent' | 'opaque' | 'auto';
  fidelity?: 'high' | 'low';
};

function cangyuanParameterError(model: string, parameter: string, value: string) {
  const labels: Record<string, string> = {
    resolution: '输出清晰度', tier: '生成档位', series: '图片系列', variant: '生成模式', seed: '随机种子',
    enable_prompt_expansion: '提示词扩写', quality: '图片质量', output_format: '输出格式',
    background: '背景方式', response_format: '响应格式', input_fidelity: '参考图保真度',
    size: '图片尺寸', aspect_ratio: '图片比例', style: '风格偏好', negative_prompt: '不希望出现的内容',
    no: '排除内容', layer_decomposition: '分层输出', layer_decomposition_options: '分层选项',
    optimize_prompt_options: '提示词优化', watermark: '水印', safety_identifier: '安全追踪标识', markup: '透明标记图',
    output_compression: '图片压缩', moderation: '内容审核', complexity: '构图规划',
    frame_count: '动画帧数', frame_duration_ms: '单帧时长', chaos: '画面变化幅度', exp: '实验风格强度',
    hd: '原生高清档', iw: '参考图影响力', raw: '原始风格', reference: '参考图用途',
    reference_slots: '参考图槽位数', speed: '生成速度', stylize: '风格化强度', sw: '风格权重', weird: '奇异度',
  };
  return new Error(`沧元模型 ${model} 不支持${labels[parameter] || '参数'}“${value}”，请调整为该模型支持的设置。`);
}

function cangyuanAspectRatioMatchesDimensions(width: number, height: number, ratio: string) {
  const match = ratio.match(/^(\d+):(\d+)$/);
  return Boolean(match && width * Number(match[2]) === height * Number(match[1]));
}

function isCangyuanImageSize(value: string, profile: CangyuanImageModelProfile) {
  if (profile.sizeEnum.length) return profile.sizeEnum.includes(value);
  return /^(?:auto|\d+(?:\.\d+)?k(?:-max)?|\d+:\d+(?:-max)?|\d{2,5}x\d{2,5})$/i.test(value);
}

function isCangyuanAspectRatio(value: string, profile: CangyuanImageModelProfile) {
  if (profile.aspectRatioEnum.length) return profile.aspectRatioEnum.includes(value);
  return /^\d+:\d+$/.test(value);
}

function buildCangyuanImageParameters(rawModelId: string, input: CangyuanImageRequestInput, endpoint: 'generations' | 'edits') {
  const requestedCount = Number(input.count ?? 1);
  if (!Number.isInteger(requestedCount) || requestedCount < 1) {
    throw new Error('沧元图片生成数量必须是正整数。');
  }
  const count = requestedCount;
  const profile = getCangyuanImageModelProfile(rawModelId);
  if (!profile) {
    if (input.references.length) throw new Error(`沧元图片模型 ${rawModelId} 未在公开模型文档中登记，无法确认参考图支持；请改用已登记模型。`);
    if (input.mask) throw new Error(`沧元图片模型 ${rawModelId} 未在公开模型文档中登记，无法确认蒙版支持；请改用已登记模型。`);
    if (count > 1) throw new Error('沧元图片模型的可用参数由具体模型文档决定；当前未确认该模型支持批量 n 参数，请将生成数量设为 1。');
    if (input.sizeMode === 'custom') throw cangyuanParameterError(rawModelId, 'size', 'custom');
    if (input.aspectRatio && !['1:1', 'auto', '自动'].includes(input.aspectRatio)) throw cangyuanParameterError(rawModelId, 'aspect_ratio/size', input.aspectRatio);
    if (input.resolution && !['1K', 'auto', '自动'].includes(input.resolution)) throw cangyuanParameterError(rawModelId, 'size', input.resolution);
    if (input.tier) throw cangyuanParameterError(rawModelId, 'tier', input.tier);
    if (input.series) throw cangyuanParameterError(rawModelId, 'series', input.series);
    if (input.seed) throw cangyuanParameterError(rawModelId, 'seed', input.seed);
    if (input.enablePromptExpansion !== undefined) throw cangyuanParameterError(rawModelId, 'enable_prompt_expansion', String(input.enablePromptExpansion));
    const unverifiedParameters: ReadonlyArray<[unknown, string]> = [
      [input.style, 'style'], [input.negativePrompt, 'negative_prompt'], [input.layerDecomposition, 'layer_decomposition'],
      [input.layerMaxImages, 'layer_decomposition_options'], [input.layerTextRecognition, 'layer_decomposition_options'],
      [input.optimizePrompt, 'optimize_prompt_options'], [input.watermark, 'watermark'], [input.safetyIdentifier, 'safety_identifier'],
      [input.markupImage, 'markup'], [input.outputCompression, 'output_compression'], [input.moderation, 'moderation'],
      [input.complexity, 'complexity'], [input.frameCount, 'frame_count'], [input.frameDurationMs, 'frame_duration_ms'],
      [input.chaos, 'chaos'], [input.experimentalStyle, 'exp'], [input.hd, 'hd'], [input.referenceImageWeight, 'iw'],
      [input.rawStyle, 'raw'], [input.referenceMode, 'reference'], [input.referenceSlots, 'reference_slots'],
      [input.speed, 'speed'], [input.stylize, 'stylize'], [input.styleWeight, 'sw'], [input.weird, 'weird'], [input.variant, 'variant'],
      [input.svgAuthorModel, 'svg.model'], [input.svgReasoningEffort, 'svg.reasoning.effort'],
    ];
    for (const [value, name] of unverifiedParameters) {
      if (value !== undefined) throw cangyuanParameterError(rawModelId, name, String(value));
    }
    if (input.quality && !['自动', 'auto'].includes(input.quality)) throw cangyuanParameterError(rawModelId, 'quality', input.quality);
    if (input.outputFormat && input.outputFormat !== 'png') throw cangyuanParameterError(rawModelId, 'output_format', input.outputFormat);
    if (input.background && input.background !== 'auto') throw cangyuanParameterError(rawModelId, 'background', input.background);
    if (input.responseFormat && input.responseFormat !== 'url') throw cangyuanParameterError(rawModelId, 'response_format', input.responseFormat);
    if (input.fidelity && input.fidelity !== 'high') throw cangyuanParameterError(rawModelId, 'input_fidelity', input.fidelity);
    return { count, parameters: {} as Record<string, unknown> };
  }

  if (profile.promptMaxLength !== undefined && input.prompt.length > profile.promptMaxLength) {
    throw new Error(`沧元模型 ${rawModelId} 的提示词最多 ${profile.promptMaxLength} 个字符。`);
  }

  if (count > (profile.nMax ?? 1)) {
    throw new Error(`沧元模型 ${rawModelId} 文档中的 n 最大值为 ${profile.nMax ?? 1}，请将生成数量调低。`);
  }
  if (input.outputFormat === 'svg') {
    if (!profile.outputFormatEnum.includes('svg') || !profile.supportsSvgOptions) {
      throw cangyuanParameterError(rawModelId, 'output_format', 'svg');
    }
    if (count !== 1) throw new Error('SVG 生成每次只能输出 1 张，请将生成数量设为 1。');
    if (endpoint === 'edits' || input.mask || input.markupImage) {
      throw new Error('SVG 仅支持文生图，不支持改图、蒙版或透明标记图；请移除参考编辑素材或切换为 PNG。');
    }
    if (input.outputCompression !== undefined) throw cangyuanParameterError(rawModelId, 'output_compression', String(input.outputCompression));
  } else if (input.svgAuthorModel !== undefined || input.svgReasoningEffort !== undefined) {
    throw cangyuanParameterError(rawModelId, 'svg', '仅支持 SVG 输出');
  }
  if ((input.svgAuthorModel !== undefined || input.svgReasoningEffort !== undefined) && !profile.supportsSvgOptions) {
    throw cangyuanParameterError(rawModelId, 'svg', '该模型未声明矢量绘图选项');
  }
  if (input.references.length > (profile.imagesMaxItems ?? 0)) {
    throw new Error(profile.imagesMaxItems
      ? `沧元模型 ${rawModelId} 的参考图最多 ${profile.imagesMaxItems} 张。`
      : `沧元模型 ${rawModelId} 的文档没有确认参考图输入，请移除参考图。`);
  }
  if (input.mask && !profile.supportsMask) throw new Error(`沧元模型 ${rawModelId} 的文档未声明支持蒙版，请移除蒙版或更换支持蒙版的模型。`);
  if (profile.requiresReference && !input.references.length) throw new Error(`沧元模型 ${rawModelId} 至少需要一张参考图，请先添加图片。`);
  if (input.markupImage && !profile.supportsMarkupImage) throw cangyuanParameterError(rawModelId, 'markup', '已上传');
  if (input.style && !profile.supportsStyle) throw cangyuanParameterError(rawModelId, 'style', input.style);
  if (input.negativePrompt && !profile.supportsNegativePrompt && !profile.supportsNoParameter) {
    throw cangyuanParameterError(rawModelId, 'negative_prompt', input.negativePrompt);
  }

  const parameters: Record<string, unknown> = {};
  const resolutionOptions = profile.resolutionEnum || [];
  if (resolutionOptions.length) {
    const requestedResolution = input.resolution || profile.resolutionDefault;
    if (requestedResolution && !['auto', '自动'].includes(requestedResolution.toLowerCase())) {
      const resolution = resolutionOptions.find((candidate) => candidate.toLowerCase() === requestedResolution.toLowerCase());
      if (!resolution) throw cangyuanParameterError(rawModelId, 'resolution', requestedResolution);
      parameters.resolution = resolution;
    }
  } else if (
    input.resolution
    && !['1K', 'auto', '自动'].includes(input.resolution.toUpperCase())
    && !isCangyuanImageSize(input.resolution, profile)
  ) {
    throw cangyuanParameterError(rawModelId, 'resolution', input.resolution);
  }

  const tierOptions = profile.tierEnum || [];
  if (input.tier) {
    const tier = tierOptions.find((candidate) => candidate.toLowerCase() === input.tier!.toLowerCase());
    if (!tier) throw cangyuanParameterError(rawModelId, 'tier', input.tier);
    parameters.tier = tier;
  }

  const seriesOptions = profile.seriesEnum || [];
  const requestedSeries = input.series || profile.seriesDefault;
  if (requestedSeries) {
    const series = seriesOptions.find((candidate) => candidate.toLowerCase() === requestedSeries.toLowerCase());
    if (!series) throw cangyuanParameterError(rawModelId, 'series', requestedSeries);
    parameters.series = series;
  } else if (profile.seriesRequired) {
    throw new Error(`沧元模型 ${rawModelId} 必须选择系列；可选值：${seriesOptions.join('、')}。`);
  }

  if (input.variant !== undefined) {
    const variant = profile.variantEnum?.find((candidate) => candidate === input.variant);
    if (!variant) throw cangyuanParameterError(rawModelId, 'variant', input.variant);
    parameters.variant = variant;
  }

  if (input.seed) {
    if (!profile.supportsSeed) throw cangyuanParameterError(rawModelId, 'seed', input.seed);
    if (profile.seedInteger || profile.seedWireType === 'integer') {
      const seed = Number(input.seed);
      if (!/^-?\d+$/.test(input.seed) || !Number.isSafeInteger(seed)
        || (profile.seedMinimum !== undefined && seed < profile.seedMinimum)
        || (profile.seedMaximum !== undefined && seed > profile.seedMaximum)) {
        throw cangyuanParameterError(rawModelId, 'seed', input.seed);
      }
      parameters.seed = profile.seedWireType === 'integer' ? seed : input.seed;
    } else {
      parameters.seed = input.seed;
    }
  }
  if (input.enablePromptExpansion !== undefined) {
    if (!profile.supportsPromptExpansion) throw cangyuanParameterError(rawModelId, 'enable_prompt_expansion', String(input.enablePromptExpansion));
    parameters.enable_prompt_expansion = input.enablePromptExpansion;
  }
  if (input.style) parameters.style = input.style;
  if (input.negativePrompt) {
    parameters[profile.supportsNoParameter ? 'no' : 'negative_prompt'] = input.negativePrompt;
  }
  if (input.layerDecomposition !== undefined) {
    if (!profile.supportsLayerDecomposition) throw cangyuanParameterError(rawModelId, 'layer_decomposition', String(input.layerDecomposition));
    if (input.layerDecomposition) {
      if (input.references.length !== 1) throw new Error('图片分层需要恰好一张参考图，请上传一张需要拆层的图片。');
      if (input.outputFormat && input.outputFormat !== 'png') throw new Error('图片分层仅支持 PNG 输出，请切换图片格式。');
      if (input.background === 'transparent') throw new Error('图片分层不能同时使用透明背景，请切换背景方式。');
    }
    parameters.layer_decomposition = input.layerDecomposition;
  }
  if (input.layerMaxImages !== undefined || input.layerTextRecognition !== undefined) {
    if (!profile.supportsLayerDecomposition || input.layerDecomposition !== true) {
      throw cangyuanParameterError(rawModelId, 'layer_decomposition_options', '普通图片模式');
    }
    if (input.layerMaxImages !== undefined && (!Number.isInteger(input.layerMaxImages) || input.layerMaxImages < 2 || input.layerMaxImages > 100)) {
      throw cangyuanParameterError(rawModelId, 'layer_decomposition_options', String(input.layerMaxImages));
    }
    parameters.layer_decomposition_options = {
      ...(input.layerMaxImages !== undefined ? { max_images: input.layerMaxImages } : {}),
      ...(input.layerTextRecognition !== undefined ? { text_recognition: input.layerTextRecognition } : {}),
    };
  }
  if (input.optimizePrompt !== undefined) {
    if (!profile.supportsPromptOptimization) throw cangyuanParameterError(rawModelId, 'optimize_prompt_options', String(input.optimizePrompt));
    if (input.optimizePrompt) parameters.optimize_prompt_options = { mode: 'standard' };
  }
  if (input.watermark !== undefined) {
    if (!profile.supportsWatermarkSetting) throw cangyuanParameterError(rawModelId, 'watermark', String(input.watermark));
    parameters.watermark = input.watermark;
  }
  if (input.safetyIdentifier) {
    if (!profile.supportsSafetyIdentifier) throw cangyuanParameterError(rawModelId, 'safety_identifier', input.safetyIdentifier);
    const maximumLength = profile.safetyIdentifierMaxLength ?? 128;
    if (input.safetyIdentifier.length > maximumLength) throw cangyuanParameterError(rawModelId, 'safety_identifier', `最多 ${maximumLength} 个字符`);
    parameters.safety_identifier = input.safetyIdentifier;
  }

  const supportsAdvanced = (name: CangyuanImageAdvancedParameter) => profile.advancedParameters?.includes(name) === true;
  const addAdvancedNumber = (
    name: CangyuanImageAdvancedParameter,
    wireName: string,
    label: string,
    value: number | undefined,
    minimum: number,
    maximum: number,
    step = 1,
  ) => {
    if (value === undefined) return;
    if (!supportsAdvanced(name)) throw cangyuanParameterError(rawModelId, label, String(value));
    const units = (value - minimum) / step;
    if (!Number.isFinite(value) || value < minimum || value > maximum
      || (step === 1 && !Number.isInteger(value))
      || Math.abs(units - Math.round(units)) > 0.000001) {
      throw cangyuanParameterError(rawModelId, label, String(value));
    }
    parameters[wireName] = value;
  };
  addAdvancedNumber('output_compression', 'output_compression', 'output_compression', input.outputCompression, 0, 100);
  if (input.outputCompression !== undefined && input.outputFormat !== 'jpeg' && input.outputFormat !== 'webp') {
    throw cangyuanParameterError(rawModelId, 'output_compression', String(input.outputCompression));
  }
  if (input.moderation !== undefined) {
    if (!supportsAdvanced('moderation')) throw cangyuanParameterError(rawModelId, 'moderation', input.moderation);
    parameters.moderation = input.moderation;
  }
  if (input.complexity !== undefined) {
    if (!supportsAdvanced('complexity')) throw cangyuanParameterError(rawModelId, 'complexity', input.complexity);
    parameters.complexity = input.complexity;
  }
  if (input.svgAuthorModel !== undefined || input.svgReasoningEffort !== undefined) {
    parameters.svg = {
      ...(input.svgAuthorModel?.trim() ? { model: input.svgAuthorModel.trim() } : {}),
      ...(input.svgReasoningEffort ? { reasoning: { effort: input.svgReasoningEffort } } : {}),
    };
  }
  if (input.frameCount !== undefined && input.outputFormat !== 'gif') throw cangyuanParameterError(rawModelId, 'frame_count', String(input.frameCount));
  if (input.frameDurationMs !== undefined && input.outputFormat !== 'gif') throw cangyuanParameterError(rawModelId, 'frame_duration_ms', String(input.frameDurationMs));
  addAdvancedNumber('frame_count', 'frame_count', 'frame_count', input.frameCount, 2, 16);
  addAdvancedNumber('frame_duration_ms', 'frame_duration_ms', 'frame_duration_ms', input.frameDurationMs, 20, profile.frameDurationMaximum ?? 2000, 10);
  addAdvancedNumber('chaos', 'chaos', 'chaos', input.chaos, 0, 100);
  addAdvancedNumber('exp', 'exp', 'exp', input.experimentalStyle, 0, 100);
  if (input.hd !== undefined) {
    if (!supportsAdvanced('hd')) throw cangyuanParameterError(rawModelId, 'hd', String(input.hd));
    parameters.hd = input.hd;
  }
  addAdvancedNumber('iw', 'iw', 'iw', input.referenceImageWeight, 0, 3, 0.1);
  if (input.rawStyle !== undefined) {
    if (!supportsAdvanced('raw')) throw cangyuanParameterError(rawModelId, 'raw', String(input.rawStyle));
    parameters.raw = input.rawStyle;
  }
  if (input.referenceMode !== undefined) {
    if (!supportsAdvanced('reference')) throw cangyuanParameterError(rawModelId, 'reference', input.referenceMode);
    parameters.reference = input.referenceMode;
  }
  addAdvancedNumber('reference_slots', 'reference_slots', 'reference_slots', input.referenceSlots, 1, 8);
  if (input.speed !== undefined) {
    if (!supportsAdvanced('speed')) throw cangyuanParameterError(rawModelId, 'speed', input.speed);
    parameters.speed = input.speed;
  }
  addAdvancedNumber('stylize', 'stylize', 'stylize', input.stylize, 0, 1000, 10);
  addAdvancedNumber('sw', 'sw', 'sw', input.styleWeight, 0, 1000, 10);
  addAdvancedNumber('weird', 'weird', 'weird', input.weird, 0, 3000, 50);

  const requestedRatio = !input.aspectRatio
    ? '1:1'
    : ['auto', '自动'].includes(input.aspectRatio)
      ? undefined
      : input.aspectRatio;
  const customSize = input.sizeMode === 'custom';

  if (customSize) {
    if (!profile.supportsSize) throw cangyuanParameterError(rawModelId, 'size', 'custom');
    if (profile.supportsCustomDimensions === false) throw cangyuanParameterError(rawModelId, 'size', '宽 × 高');
    if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || Number(input.width) < 1 || Number(input.height) < 1) {
      throw new Error(`沧元模型 ${rawModelId} 的自定义尺寸无效，请提供正整数宽高。`);
    }
    const size = `${input.width}x${input.height}`;
    if (!isCangyuanImageSize(size, profile)) throw cangyuanParameterError(rawModelId, 'size', size);
    parameters.size = size;
    if (profile.supportsAspectRatio && requestedRatio && !['1:1', '自定义'].includes(requestedRatio)) {
      if (!isCangyuanAspectRatio(requestedRatio, profile)) throw cangyuanParameterError(rawModelId, 'aspect_ratio', requestedRatio);
      if (!cangyuanAspectRatioMatchesDimensions(Number(input.width), Number(input.height), requestedRatio)) {
        throw new Error(`沧元模型 ${rawModelId} 的 aspect_ratio 与自定义尺寸不一致。`);
      }
      parameters.aspect_ratio = requestedRatio;
    }
  } else if (profile.supportsSize) {
    const requestedValue = input.aspectRatio && !['auto', '自动', '自定义'].includes(input.aspectRatio)
      ? input.aspectRatio.trim()
      : undefined;
    if (requestedValue && !profile.supportsAspectRatio && !isCangyuanImageSize(requestedValue, profile)) {
      throw cangyuanParameterError(rawModelId, 'size', requestedValue);
    }
    const requestedSize = requestedValue && !profile.supportsAspectRatio && isCangyuanImageSize(requestedValue, profile)
      ? requestedValue
      : undefined;
    const hasNonDefaultRatio = Boolean(requestedSize && /^\d+:\d+$/.test(requestedSize) && requestedSize !== '1:1');
    const hasExplicitSize = Boolean(requestedSize && !/^\d+:\d+$/.test(requestedSize));
    const resolution = input.resolution || '1K';
    const hasSeparateResolution = resolutionOptions.length > 0;
    const hasNonDefaultResolution = !['1K', '自动'].includes(resolution);
    if (profile.supportsAspectRatio && requestedValue && requestedValue !== '1:1') {
      if (!isCangyuanAspectRatio(requestedValue, profile)) throw cangyuanParameterError(rawModelId, 'aspect_ratio', requestedValue);
      parameters.aspect_ratio = requestedValue;
    }
    if (input.aspectRatio && ['auto', '自动'].includes(input.aspectRatio) && isCangyuanImageSize('auto', profile)) {
      parameters.size = 'auto';
    } else if (hasNonDefaultRatio && requestedSize) {
      parameters.size = requestedSize;
    } else if (hasExplicitSize && requestedSize) {
      parameters.size = requestedSize;
    } else if (!hasSeparateResolution && hasNonDefaultResolution) {
      if (!isCangyuanImageSize(resolution, profile)) throw cangyuanParameterError(rawModelId, 'size', resolution);
      parameters.size = resolution;
    } else if (!input.aspectRatio && isCangyuanImageSize('1:1', profile) && !profile.supportsAspectRatio) {
      parameters.size = '1:1';
    } else if (input.aspectRatio === '1:1' && isCangyuanImageSize('1:1', profile) && !profile.supportsAspectRatio) {
      parameters.size = '1:1';
    } else if (!hasSeparateResolution && isCangyuanImageSize(resolution, profile)) {
      const defaultSize = profile.sizeRecommendations.find((value) => value.toLowerCase() === '1k')
        || profile.sizeEnum.find((value) => value.toLowerCase() === '1k');
      if (defaultSize) parameters.size = defaultSize;
      else if (profile.sizeRecommendations.some((value) => /^\d+:\d+$/.test(value))) parameters.size = '1:1';
    }
  } else {
    if (requestedRatio && requestedRatio !== '1:1') throw cangyuanParameterError(rawModelId, 'aspect_ratio/size', requestedRatio);
    if (input.resolution && !['1K', 'auto', '自动'].includes(input.resolution.toUpperCase())) throw cangyuanParameterError(rawModelId, 'resolution', input.resolution);
  }

  if (input.quality && input.quality !== '自动') {
    if (!profile.qualityEnum.includes(input.quality)) throw cangyuanParameterError(rawModelId, 'quality', input.quality);
    parameters.quality = input.quality;
  }
  if (input.outputFormat) {
    if (profile.outputFormatEnum.includes(input.outputFormat)) parameters.output_format = input.outputFormat;
    else if (input.outputFormat !== 'png') throw cangyuanParameterError(rawModelId, 'output_format', input.outputFormat);
  }
  if (input.background) {
    if (profile.backgroundEnum.includes(input.background)) parameters.background = input.background;
    else if (input.background !== 'auto') throw cangyuanParameterError(rawModelId, 'background', input.background);
  }
  if (input.responseFormat && input.responseFormat !== 'url') throw cangyuanParameterError(rawModelId, 'response_format', input.responseFormat);
  if (input.fidelity && input.fidelity !== 'high') throw cangyuanParameterError(rawModelId, 'input_fidelity', input.fidelity);
  if (count > 1) parameters.n = count;
  return { count, parameters };
}

async function generateCangyuanImage(
  provider: RuntimeProvider,
  rawModelId: string,
  input: CangyuanImageRequestInput,
  endpoint: 'generations' | 'edits',
  signal?: AbortSignal,
) {
  const { count, parameters } = buildCangyuanImageParameters(rawModelId, input, endpoint);
  const allowSvgOutput = endpoint === 'generations' && input.outputFormat === 'svg';
  if (input.markupImage && endpoint !== 'edits') throw cangyuanParameterError(rawModelId, 'markup', '仅支持改图');
  if (input.markupImage && input.mask) throw cangyuanParameterError(rawModelId, 'markup', '不能与蒙版同时使用');
  if (input.markupImage && !input.references.length) throw cangyuanParameterError(rawModelId, 'markup', '需要首张参考图');

  let referenceUploads: Promise<string>[];
  let markupUpload: Promise<string> | undefined;
  if (input.markupImage) {
    const [firstReference, markup] = await Promise.all([
      prepareCangyuanImageUpload(provider, input.references[0], signal),
      prepareCangyuanImageUpload(provider, input.markupImage, signal),
    ]);
    if (markup.mime !== 'image/png') throw providerImageInputError('透明标记图必须是 PNG 格式。');
    let referenceMetadata: sharp.Metadata;
    let markupMetadata: sharp.Metadata;
    let markupStats: sharp.Stats;
    try {
      [referenceMetadata, markupMetadata, markupStats] = await Promise.all([
        sharp(firstReference.bytes).metadata(),
        sharp(markup.bytes).metadata(),
        sharp(markup.bytes).stats(),
      ]);
    } catch {
      throw providerImageInputError('透明标记图或第一张参考图无法解码，请重新上传有效图片。');
    }
    if (!markupMetadata.hasAlpha || markupStats.isOpaque) {
      throw providerImageInputError('透明标记图必须包含实际透明像素。');
    }
    if (!referenceMetadata.width || !referenceMetadata.height || !markupMetadata.width || !markupMetadata.height
      || referenceMetadata.width !== markupMetadata.width || referenceMetadata.height !== markupMetadata.height) {
      throw providerImageInputError('透明标记图必须与第一张参考图的宽高完全一致。');
    }
    referenceUploads = [
      uploadCangyuanImage(provider, firstReference, signal),
      ...input.references.slice(1).map((reference) => prepareCangyuanImageUpload(provider, reference, signal)
        .then((prepared) => uploadCangyuanImage(provider, prepared, signal))),
    ];
    markupUpload = uploadCangyuanImage(provider, markup, signal);
  } else {
    referenceUploads = input.references.map((reference) => prepareCangyuanImageUpload(provider, reference, signal)
      .then((prepared) => uploadCangyuanImage(provider, prepared, signal)));
  }
  const [references, mask, markup] = await Promise.all([
    Promise.all(referenceUploads),
    input.mask
      ? prepareCangyuanImageUpload(provider, input.mask, signal).then((prepared) => uploadCangyuanImage(provider, prepared, signal))
      : Promise.resolve(undefined),
    markupUpload || Promise.resolve(undefined),
  ]);
  if (markup) parameters.markup = markup;
  const body: Record<string, unknown> = {
    model: rawModelId,
    prompt: input.prompt,
    async: true,
    ...(count > 1 ? { n: count } : {}),
    ...parameters,
    ...(references.length ? { images: references } : {}),
    ...(mask ? { mask } : {}),
  };
  const data = await fetchJson(providerEndpoint(provider, `/images/${endpoint}`, `/images/${endpoint}`), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, IMAGE_REQUEST_TIMEOUT, signal, allowSvgOutput);
  if (extractImages(data, allowSvgOutput).length) return normalizeImages(data, allowSvgOutput);
  if (taskIdFrom(data)) return waitForCangyuanImageTask(provider, data, endpoint, signal, allowSvgOutput);
  return normalizeImages(data, allowSvgOutput);
}

async function waitForApimartTask(provider: RuntimeProvider, initial: any, signal?: AbortSignal) {
  const taskId = taskIdFrom(initial);
  if (!taskId) throw new Error('APIMart 没有返回图片任务编号');
  const deadline = Date.now() + 300000;
  let detachedFromCaller = false;
  while (Date.now() < deadline) {
    detachedFromCaller ||= Boolean(signal?.aborted);
    const pollSignal = detachedFromCaller ? undefined : signal;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1800);
      pollSignal?.addEventListener('abort', () => { clearTimeout(timer); reject(pollSignal.reason || new Error('GENERATION_CANCELLED')); }, { once: true });
    });
    let response: any;
    try {
      response = await fetchJson(providerEndpoint(provider, `/tasks/${encodeURIComponent(taskId)}`, `/tasks/${encodeURIComponent(taskId)}`), { method: 'GET', headers: authHeaders(provider) }, 30000, pollSignal);
    } catch (error) {
      throw acceptedProviderTaskError(error, taskId);
    }
    const data = unwrapProviderData(provider, response);
    const images = extractImages(data);
    if (images.length) return normalizeImages(data);
    const status = taskStatusFrom(data);
    if (/(fail|error|cancel|reject)/.test(status)) throw terminalProviderTaskError(String(data?.error?.message || data?.error_message || data?.error || data?.message || `APIMart 图片任务失败：${status}`));
  }
  throw acceptedProviderTaskError(new Error('APIMart 图片任务等待超时，请稍后到服务商后台查看任务状态'), taskId);
}

function upscaleStatusEndpoint(provider: RuntimeProvider, taskId: string, initial?: any) {
  const configured = String(provider.imageUpscaleStatusPath || initial?.status_url || (provider.platform === '65535' ? '/v1/tasks/{taskId}' : '')).trim();
  if (!configured) return '';
  const path = configured.includes('{taskId}') ? configured.replaceAll('{taskId}', encodeURIComponent(taskId)) : `${configured.replace(/\/+$/, '')}/${encodeURIComponent(taskId)}`;
  return providerEndpoint(provider, path, path);
}

async function waitForUpscaleTask(provider: RuntimeProvider, initial: any, signal?: AbortSignal) {
  const taskId = taskIdFrom(initial);
  if (!taskId) return normalizeImages(initial);
  const statusUrl = upscaleStatusEndpoint(provider, taskId, initial);
  if (!statusUrl) throw new Error(`服务商返回了异步任务 ${taskId}，请在“接口服务 → 高级兼容设置”填写图片超分任务查询路径，例如 /tasks/{taskId}`);
  const deadline = Date.now() + IMAGE_REQUEST_TIMEOUT;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason || new Error('GENERATION_CANCELLED');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1800);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('GENERATION_CANCELLED')); }, { once: true });
    });
    const data = await fetchJson(statusUrl, { method: 'GET', headers: authHeaders(provider) }, 30000, signal);
    const images = extractImages(data);
    if (images.length) return normalizeImages(data);
    const status = taskStatusFrom(data);
    if (/(fail|error|cancel|reject)/.test(status)) throw new Error(String(data?.error_message || data?.error?.message || data?.error || data?.message || `超分任务失败：${status}`));
  }
  throw new Error('图片超分任务等待超时，请稍后到服务商控制台查看任务状态');
}

export async function generateImage(provider: RuntimeProvider, rawModelId: string, input: ImageModelParameters & { prompt: string; aspectRatio?: string; count?: number; width?: number; height?: number; sizeMode?: 'system' | 'custom'; quality?: string; outputFormat?: ImageOutputFormat; responseFormat?: 'url' | 'b64_json'; background?: 'transparent' | 'opaque' | 'auto'; references?: string[] }, signal?: AbortSignal): Promise<GeneratedImage[]> {
  const rawReferences = input.references || [];
  if (rawReferences.some((reference) => typeof reference !== 'string' || !reference.trim())) throw new Error('参考图数据格式无效，请重新添加参考图后再提交。');
  const references = rawReferences.map(normalizeReference);
  if (references.length > MAX_IMAGE_REFERENCES) throw new Error(`图片参考最多 ${MAX_IMAGE_REFERENCES} 张，请移除多余参考后再提交。`);
  if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') return (await import('./jimeng-image')).runJimengImage(provider, rawModelId, input, references, signal);
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
  if (isCangyuanProvider(provider)) return generateCangyuanImage(provider, rawModelId, {
    ...input,
    references,
  }, 'generations', signal);
  if (isAgnesProvider(provider)) {
    const outputFormat = input.outputFormat;
    if (outputFormat === 'gif' || outputFormat === 'svg') throw new Error(`Agnes 图片模型不支持 ${outputFormat} 输出格式。`);
    const background = input.background === 'auto' ? undefined : input.background;
    return generateAgnesImage(provider, rawModelId, { ...input, count, outputFormat, background }, references, signal);
  }
  const providerReferences = references.length ? await prepareProviderImageInputs(provider, references, signal) : [];
  const body: Record<string, unknown> = {
    model: rawModelId,
    prompt: input.prompt,
    n: count,
    size: mapImageRequestSize(provider, rawModelId, input.aspectRatio || '自动', input.width, input.height),
  };
  if (input.quality && input.quality !== '自动') body.quality = input.quality;
  if (input.resolution && input.aspectRatio === '自动' && input.sizeMode !== 'custom') body.resolution = input.resolution;
  if (isApimartProvider(provider) && input.resolution && input.resolution !== '自动' && input.sizeMode !== 'custom') body.resolution = String(input.resolution).toLowerCase();
  if (input.outputFormat) body.output_format = input.outputFormat;
  if (input.background) body.background = input.background;
  if (provider.type === 'google-gemini') body.response_format = 'b64_json';
  else if (input.responseFormat) body.response_format = input.responseFormat;
  else if (/^gpt-image-2\.5(?:$|[-_.])/i.test(rawModelId.trim())) body.response_format = 'b64_json';
  if (providerReferences.length) {
    if (isModelScopeProvider(provider)) body.image_url = providerReferences.length === 1 ? providerReferences[0] : providerReferences;
    else if (is65535Provider(provider) || isApimartProvider(provider)) body.image_urls = providerReferences;
    else body.images = providerReferences.map((image_url) => ({ image_url }));
  }
  const endpoint = providerEndpoint(provider, provider.imageGenerationPath, '/images/generations');
  const request = (payload: Record<string, unknown>) => fetchJson(endpoint, {
    method: 'POST', headers: { ...authHeaders(provider), ...modelScopeImageHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }, IMAGE_REQUEST_TIMEOUT, signal);
  if (isApimartProvider(provider)) {
    const batches = await Promise.all(Array.from({ length: count }, async () => waitForApimartTask(provider, await request({ ...body, n: 1 }), signal)));
    return batches.flat().slice(0, count);
  }
  const requestImages = async (payload: Record<string, unknown>) => {
    try {
      const data = await request(payload);
      const images = extractImages(data);
      if (images.length) return normalizeImages(data);
      if (taskIdFrom(data)) {
        try { return await waitForImageTask(provider, data, signal); }
        catch (error) { throw acceptedProviderTaskError(error, taskIdFrom(data)); }
      }
      return normalizeImages(data);
    }
    catch (error) {
      if (signal?.aborted && !isAcceptedProviderTask(error)) throw signal.reason || error;
      if ((error as Error & { providerAcceptedTask?: boolean }).providerAcceptedTask) throw error;
      if (!payload.resolution || !canRetryImageRequest(error)) throw error;
      const fallback = { ...payload };
      delete fallback.resolution;
      const data = await request(fallback);
      const images = extractImages(data);
      if (images.length) return normalizeImages(data);
      if (taskIdFrom(data)) return waitForImageTask(provider, data, signal);
      return normalizeImages(data);
    }
  };
  let images: GeneratedImage[];
  try { images = await requestImages(body); }
  catch (error) {
    if (signal?.aborted && !isAcceptedProviderTask(error)) throw signal.reason || error;
    // Never repeat an image POST after a transport error or timeout: a gateway
    // may have accepted and charged the original job even if its response was
    // lost. Only explicit 4xx validation failures are safe to retry with n=1.
    if (count <= 1 || !canRetryImageRequest(error)) throw error;
    images = await requestImages({ ...body, n: 1 });
  }
  while (images.length < count) {
    if (signal?.aborted) throw signal.reason || new Error('GENERATION_CANCELLED');
    const more = await requestImages({ ...body, n: 1 });
    images.push(...more);
  }
  return images.slice(0, count);
}

function normalizeReference(ref: string) {
  if (/^https?:\/\//i.test(ref) || isStoredImageReference(ref) || ref.startsWith('data:image/')) return ref;
  return `data:image/png;base64,${ref}`;
}

async function refToBlob(ref: string, index: number) {
  if (ref.startsWith('data:')) {
    const match = ref.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error(`第 ${index + 1} 张参考图格式无效`);
    const mime = match[1] || 'image/png';
    const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    return { blob: new Blob([bytes], { type: mime }), filename: `reference-${index + 1}.${mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'}` };
  }
  if (/^https?:\/\//i.test(ref)) {
    // 公网部署时不由 SANMAO.AI 服务端主动抓取任意用户 URL，避免形成 SSRF 入口。
    // JSON 编辑接口可以直接把远程 URL 交给上游；若上游只支持 multipart，请用户下载后重新上传。
    throw new Error(`第 ${index + 1} 张参考图是网络地址，而当前上游仅接受文件上传。请下载该图后重新上传为参考图`);
  }
  throw new Error(`第 ${index + 1} 张参考图格式无效`);
}

export type ImageEditInput = ImageModelParameters & { prompt: string; references: string[]; mask?: string; aspectRatio?: string; count?: number; width?: number; height?: number; sizeMode?: 'system' | 'custom'; quality?: string; fidelity?: 'high' | 'low'; outputFormat?: ImageOutputFormat; responseFormat?: 'url' | 'b64_json'; background?: 'transparent' | 'opaque' | 'auto' };

export function buildImageEditRequestBody(provider: RuntimeProvider, rawModelId: string, input: ImageEditInput, references: string[], count: number, size: string) {
  const jsonBody: Record<string, unknown> = {
    model: rawModelId,
    prompt: input.prompt,
    n: count,
    size,
  };
  if (is65535Provider(provider) || isApimartProvider(provider)) jsonBody.image_urls = references;
  else jsonBody.images = references.map((image_url) => ({ image_url }));
  if (input.quality && input.quality !== '自动') jsonBody.quality = input.quality;
  if (input.resolution && input.aspectRatio === '自动' && input.sizeMode !== 'custom') jsonBody.resolution = input.resolution;
  if (input.fidelity && shouldSendInputFidelity(provider, rawModelId)) jsonBody.input_fidelity = input.fidelity;
  if (input.mask) jsonBody.mask = input.mask;
  if (input.outputFormat) jsonBody.output_format = input.outputFormat;
  if (input.background) jsonBody.background = input.background;
  return jsonBody;
}

async function editImageFromProvider(provider: RuntimeProvider, rawModelId: string, input: ImageEditInput, signal?: AbortSignal): Promise<GeneratedImage[]> {
  // Agnes can consume the local storage URL through the signed-media bridge;
  // other providers keep the historical data-URL normalization path.
  if (input.references.some((reference) => typeof reference !== 'string' || !reference.trim())) throw new Error('参考图数据格式无效，请重新添加参考图后再提交。');
  const references = (isAgnesProvider(provider) ? input.references : input.references.map(normalizeReference));
  if (references.length > MAX_IMAGE_REFERENCES) throw new Error(`图片参考最多 ${MAX_IMAGE_REFERENCES} 张，请移除多余参考后再提交。`);
  if (!references.length) throw new Error('修改图片至少需要一张参考图');
  if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') return (await import('./jimeng-image')).runJimengImage(provider, rawModelId, input, references, signal);
  if (isCangyuanProvider(provider)) return generateCangyuanImage(provider, rawModelId, {
    ...input,
    references,
  }, 'edits', signal);
  if (isAgnesProvider(provider)) {
    const outputFormat = input.outputFormat;
    if (outputFormat === 'gif' || outputFormat === 'svg') throw new Error(`Agnes 图片模型不支持 ${outputFormat} 输出格式。`);
    const background = input.background === 'auto' ? undefined : input.background;
    return generateAgnesImage(provider, rawModelId, { ...input, outputFormat, background }, references, signal);
  }
  const providerReferences = await prepareProviderImageInputs(provider, references, signal);
  const providerMask = input.mask ? await prepareProviderImageInput(provider, input.mask, signal) : undefined;
  const providerInput = providerMask ? { ...input, mask: providerMask } : input;
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
  // Gateways occasionally ignore `n` and return more images than requested.
  // Keep the application contract authoritative: one requested output must
  // never fan out into multiple Canvas nodes.
  const limitImages = (images: GeneratedImage[]) => images.slice(0, count);
  const size = mapImageRequestSize(provider, rawModelId, input.aspectRatio || '自动', input.width, input.height);
  const sendInputFidelity = input.fidelity && shouldSendInputFidelity(provider, rawModelId);
  const jsonBody = buildImageEditRequestBody(provider, rawModelId, providerInput, providerReferences, count, size);

  // ModelScope's Qwen-Image-Edit is exposed as an asynchronous image
  // generation task, not through the OpenAI-compatible /images/edits route.
  // Keep the reference image in image_url for this provider and reuse the
  // existing task polling/normalization path.
  if (isModelScopeProvider(provider)) {
    const data = await fetchJson(providerEndpoint(provider, provider.imageGenerationPath, '/images/generations'), {
      method: 'POST',
      headers: { ...authHeaders(provider), ...modelScopeImageHeaders(provider), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: rawModelId,
        prompt: input.prompt,
        image_url: providerReferences.length === 1 ? providerReferences[0] : providerReferences,
        ...(size !== 'auto' ? { size } : {}),
        ...(count > 1 ? { n: count } : {}),
      }),
    }, IMAGE_REQUEST_TIMEOUT, signal);
    const images = extractImages(data);
    if (images.length) return limitImages(normalizeImages(data));
    if (taskIdFrom(data)) {
      try { return limitImages(await waitForImageTask(provider, data, signal)); }
      catch (error) { throw acceptedProviderTaskError(error, taskIdFrom(data)); }
    }
    return limitImages(normalizeImages(data));
  }

  // 新版 Images API 支持 JSON image_url/data URL；优先使用，兼容远程 URL 和多图。
  try {
    const data = await fetchJson(providerEndpoint(provider, provider.imageEditPath, '/images/edits'), {
      method: 'POST', headers: { ...authHeaders(provider), ...modelScopeImageHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(jsonBody),
    }, IMAGE_REQUEST_TIMEOUT, signal);
    if (isApimartProvider(provider)) return limitImages(await waitForApimartTask(provider, data, signal));
    const images = extractImages(data);
    if (images.length) return limitImages(normalizeImages(data));
    if (taskIdFrom(data)) {
      try { return limitImages(await waitForImageTask(provider, data, signal)); }
      catch (error) { throw acceptedProviderTaskError(error, taskIdFrom(data)); }
    }
    return limitImages(normalizeImages(data));
  } catch (jsonError) {
    if (signal?.aborted && !isAcceptedProviderTask(jsonError)) throw signal.reason || jsonError;
    // A successful JSON response with malformed image data is not a request
    // compatibility failure. Falling back to multipart here would submit a
    // second paid job after the provider has already accepted the first one.
    if (jsonError instanceof ProviderImageFormatError) throw jsonError;
    if (!canRetryImageRequest(jsonError)) throw jsonError;
    // 65535/APIMart expose image_urls as their input contract. Multipart is
    // not a compatible fallback and would only hide the actionable JSON error.
    if (requiresPublicImageInput(provider)) throw jsonError;
    // 一些 OpenAI 兼容中转仍只接受 multipart/form-data，自动回退。
    try {
      const form = new FormData();
      form.append('model', rawModelId);
      form.append('prompt', input.prompt);
      form.append('n', String(count));
      if (size !== 'auto') form.append('size', size);
      if (input.quality && input.quality !== '自动') form.append('quality', input.quality);
      if (sendInputFidelity) form.append('input_fidelity', input.fidelity!);
      if (input.outputFormat) form.append('output_format', input.outputFormat);
      if (input.background) form.append('background', input.background);
      for (let i = 0; i < providerReferences.length; i++) {
        const { blob, filename } = await refToBlob(providerReferences[i], i);
        form.append('image', blob, filename);
      }
      if (providerInput.mask) {
        const { blob } = await refToBlob(providerInput.mask, 0);
        form.append('mask', blob, 'mask.png');
      }
      const response = await fetch(providerEndpoint(provider, provider.imageEditPath, '/images/edits'), {
        method: 'POST', headers: { ...authHeaders(provider), ...modelScopeImageHeaders(provider) }, body: form, cache: 'no-store', signal: combineSignals(signal, IMAGE_REQUEST_TIMEOUT),
      });
      const data = await parseResponse(response);
      const images = extractImages(data);
      if (!images.length && taskIdFrom(data)) {
        try { return limitImages(await waitForImageTask(provider, data, signal)); }
        catch (error) { throw acceptedProviderTaskError(error, taskIdFrom(data)); }
      }
      return limitImages(normalizeImages(data));
    } catch (multipartError) {
      const a = jsonError instanceof Error ? jsonError.message : 'JSON 编辑接口失败';
      const b = multipartError instanceof Error ? multipartError.message : '表单编辑接口失败';
      const status = Number(
        (jsonError as ProviderFailure | null)?.providerStatus
        || (jsonError as ProviderFailure | null)?.status
        || (multipartError as ProviderFailure | null)?.providerStatus
        || (multipartError as ProviderFailure | null)?.status
        || 0,
      );
      const error = new Error(`图片修改接口调用失败。JSON：${a}；兼容表单：${b}`);
      if (status) {
        decorateProviderFailure(error, {
          providerResponse: true,
          providerFailureKind: 'http',
          status,
          providerStatus: status,
          providerUrl: (jsonError as ProviderFailure | null)?.providerUrl || (multipartError as ProviderFailure | null)?.providerUrl,
          providerMethod: 'POST',
        });
      }
      throw error;
    }
  }
}

export async function editImage(provider: RuntimeProvider, rawModelId: string, input: ImageEditInput, signal?: AbortSignal): Promise<GeneratedImage[]> {
  const images = await editImageFromProvider(provider, rawModelId, input, signal);
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
  return images.slice(0, count);
}

export async function upscaleImage(provider: RuntimeProvider, rawModelId: string, input: { reference: string; size: string; prompt?: string; seed?: number; colorCorrection?: string; resizeMethod?: string }, signal?: AbortSignal): Promise<GeneratedImage[]> {
  if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') return (await import('./jimeng-image')).runJimengImageUpscale(provider, input, signal);
  const reference = normalizeReference(input.reference);
  if (!/^\d+x\d+$/i.test(input.size)) throw new Error('SeedVR2 必须提供 WIDTHxHEIGHT 格式的目标尺寸，例如 2048x2048');
  const prompt = input.prompt?.trim() || 'Upscale this image';
  const endpoint = providerEndpoint(provider, provider.imageUpscalePath || provider.imageEditPath, '/images/edits');
  const errors: string[] = [];
  const parameters: Record<string, unknown> = {
    size: input.size,
    seed: Number.isFinite(input.seed) ? input.seed : 42,
    color_correction: input.colorCorrection || 'wavelet',
    resize_method: input.resizeMethod === 'bicubic' ? 'bicubic' : input.resizeMethod === 'nearest' ? 'nearest' : 'lanczos',
    response_format: 'b64_json',
  };
  const compactParameters = Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined));

  if (/\/v1\/tasks\/?$/i.test(endpoint)) {
    const data = await fetchJson(endpoint, {
      method: 'POST',
      headers: { ...authHeaders(provider), 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ kind: 'image', model: rawModelId, input: { prompt, image: reference, ...compactParameters } }),
    }, IMAGE_REQUEST_TIMEOUT, signal);
    const images = extractImages(data);
    return images.length ? normalizeImages(data) : await waitForUpscaleTask(provider, data, signal);
  }

  const jsonBodies: Array<Record<string, unknown>> = [
    { model: rawModelId, prompt, image: reference, ...compactParameters },
    { model: rawModelId, prompt, images: [{ image_url: reference }], n: 1, ...compactParameters },
  ];
  for (const body of jsonBodies) {
    try {
      const data = await fetchJson(endpoint, { method: 'POST', headers: { ...authHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, IMAGE_REQUEST_TIMEOUT, signal);
      const images = extractImages(data);
      return images.length ? normalizeImages(data) : await waitForUpscaleTask(provider, data, signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      errors.push(error instanceof Error ? error.message : 'JSON 超分请求失败');
    }
  }

  try {
    const form = new FormData();
    const { blob, filename } = await refToBlob(reference, 0);
    form.append('model', rawModelId);
    form.append('prompt', prompt);
    for (const [key, value] of Object.entries(compactParameters)) form.append(key, String(value));
    form.append('image', blob, filename);
    const response = await fetch(endpoint, { method: 'POST', headers: authHeaders(provider), body: form, cache: 'no-store', signal: combineSignals(signal, IMAGE_REQUEST_TIMEOUT) });
    const data = await parseResponse(response);
    const images = extractImages(data);
    return images.length ? normalizeImages(data) : await waitForUpscaleTask(provider, data, signal);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : '表单超分请求失败');
  }
  throw new Error(`图片超分接口调用失败：${errors.slice(-3).join('；')}`);
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: any[];
  server_tool_calls?: unknown[];
  reasoning_content?: string;
};

export type DeepSeekSafetyCheck = { level: 'low' | 'high' };
export type DeepSeekResponseTitle = { enabled: boolean };

type DeepSeekInputImagePart = {
  type: 'input_image';
  image_url?: string;
  file_id?: string;
  detail?: 'low' | 'high' | 'original' | 'auto';
};

type DeepSeekInputFilePart = {
  type: 'input_file';
  file_id: string;
};

type DeepSeekResponsesMessage = Omit<ChatMessage, 'role' | 'content'> & {
  role: ChatMessage['role'] | 'developer';
  content: string | Array<ChatContentPart | DeepSeekInputImagePart | DeepSeekInputFilePart> | null;
};

type DeepSeekResponsesInput = string | readonly (DeepSeekResponsesMessage | Record<string, unknown>)[];

export type DeepSeekResponsesOptions = {
  tools?: readonly unknown[];
  tool_choice?: unknown;
  stream?: boolean;
  instructions?: string;
  reasoningEffort?: DeepSeekReasoningEffort;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topLogprobs?: number;
  text?: Record<string, unknown>;
  safetyCheck?: DeepSeekSafetyCheck;
  title?: DeepSeekResponseTitle;
  user?: string;
};

export type IntentClassificationPayload = {
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: 'auto' | 'none';
};

type IntentChoiceAnswer = {
  choice?: unknown;
  confidence?: unknown;
  probabilities?: Record<string, unknown>;
};

type IntentSystemOneResponse = {
  model?: unknown;
  answers?: {
    mode?: IntentChoiceAnswer;
    deliverable?: IntentChoiceAnswer;
    imageOperation?: IntentChoiceAnswer;
  };
};

type IntentSystemOneQuestions = Record<string, {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}>;

type DeepSeekApiProvider = Pick<RuntimeProvider, 'baseUrl' | 'apiKey'>
  & Partial<Pick<RuntimeProvider, 'platform' | 'responsesPath' | 'authHeader' | 'authPrefix'>>;

export type DeepSeekToolSearchInput = {
  query: string;
  count?: number;
  ori_question?: string | null;
  localization?: string;
  need_content?: boolean;
};

export type DeepSeekToolSearchResult = {
  rerank_score: number;
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  site_name: string | null;
  site_icon: string | null;
  date: string | null;
  authority: number;
};

export type DeepSeekToolSearchResponse = {
  results: DeepSeekToolSearchResult[];
  /** HTTP 200 with a non-empty upstream results array is billable. */
  searchRequestCount: 0 | 1;
};

export type DeepSeekToolFetchResult = { title: string; content: string };

function deepSeekApiRoot(provider: Pick<DeepSeekApiProvider, 'baseUrl'>) {
  let url: URL;
  try { url = new URL(provider.baseUrl); }
  catch { throw new Error('DeepSeek API 地址无效'); }
  if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error('DeepSeek API 地址必须使用 HTTP 或 HTTPS');
  url.pathname = url.pathname.replace(/\/(?:v1|beta)\/?$/i, '').replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}

function deepSeekResponsesEndpoint(provider: DeepSeekApiProvider) {
  const configured = String(provider.responsesPath || '/responses').trim();
  if (/^https?:\/\//i.test(configured)) {
    const url = new URL(configured);
    if (url.hostname === 'api.deepseek.com' && /^\/(?:beta\/responses|v1\/responses)\/?$/i.test(url.pathname)) {
      url.pathname = '/responses';
      url.search = '';
      url.hash = '';
    }
    return url.toString().replace(/\/$/, '');
  }
  const path = /^\/?(?:beta\/responses|v1\/responses)\/?$/i.test(configured) ? '/responses' : configured;
  return `${deepSeekApiRoot(provider)}${path.startsWith('/') ? path : `/${path}`}`;
}

function deepSeekToolEndpoint(provider: DeepSeekApiProvider, tool: 'search' | 'fetch') {
  return `${deepSeekApiRoot(provider)}/v1/tools/${tool}`;
}

function deepSeekField(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function deepSeekSearchResult(value: unknown, index: number): DeepSeekToolSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`第 ${index + 1} 条结果不是对象`);
  }
  const row = value as Record<string, unknown>;
  const title = deepSeekField(row.title).trim();
  const url = deepSeekField(row.url).trim();
  const score = row.rerank_score;
  const authority = row.authority;
  const date = row.date === null ? null : typeof row.date === 'string' ? row.date : undefined;
  const isRfc3339Date = date === null || (
    typeof date === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(date)
    && Number.isFinite(Date.parse(date))
  );
  if (!title || !/^https?:\/\//i.test(url)) throw new Error(`第 ${index + 1} 条结果的 title 或 url 无效`);
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 3) {
    throw new Error(`第 ${index + 1} 条结果的 rerank_score 必须为 0 至 3 的数字`);
  }
  if (typeof row.snippet !== 'string' || typeof row.summary !== 'string' || typeof row.content !== 'string') {
    throw new Error(`第 ${index + 1} 条结果缺少 snippet、summary 或 content`);
  }
  if ((typeof row.site_name !== 'string' && row.site_name !== null)
    || (typeof row.site_icon !== 'string' && row.site_icon !== null)
    || !isRfc3339Date) {
    throw new Error(`第 ${index + 1} 条结果的 site_name、site_icon 或 date 无效`);
  }
  if (typeof authority !== 'number' || !Number.isInteger(authority) || authority < -1 || authority > 4) {
    throw new Error(`第 ${index + 1} 条结果的 authority 必须为 -1 至 4 的整数`);
  }
  return {
    title,
    url,
    rerank_score: score,
    snippet: row.snippet,
    summary: row.summary,
    content: row.content,
    site_name: row.site_name,
    site_icon: row.site_icon,
    date: date ?? null,
    authority,
  };
}

function requireDeepSeekToolProvider(provider: DeepSeekApiProvider) {
  if (provider.platform !== 'deepseek') throw new Error('DeepSeek Search/Fetch 端点仅适用于 DeepSeek 官方服务商配置');
}

const DEEPSEEK_TOOL_MAX_RETRIES = 2;

function deepSeekToolRetryable(error: unknown) {
  const failure = error as ProviderFailure | null;
  const status = Number(failure?.providerStatus || failure?.status || 0);
  return failure?.providerFailureKind === 'http'
    && (status === 408 || status === 429 || status >= 500);
}

function waitForDeepSeekToolRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('请求已取消'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason || new Error('请求已取消'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function deepSeekToolRequest(url: string, init: RequestInit, timeout: number, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchJson(url, init, timeout, signal);
    } catch (error) {
      if (!deepSeekToolRetryable(error) || attempt >= DEEPSEEK_TOOL_MAX_RETRIES) throw error;
      // Search and Fetch are read-only and are explicitly retryable for 408,
      // 429 and 5xx responses. Keep the backoff short and abort-aware because
      // the surrounding Agent request owns the user-visible deadline.
      await waitForDeepSeekToolRetry(Math.min(2_000, 100 * (2 ** attempt)), signal);
    }
  }
}

export async function deepSeekToolSearch(provider: DeepSeekApiProvider, input: DeepSeekToolSearchInput, signal?: AbortSignal) {
  requireDeepSeekToolProvider(provider);
  if (!input || typeof input !== 'object') throw new Error('DeepSeek 搜索参数必须为对象');
  if (typeof input.query !== 'string') throw new Error('DeepSeek 搜索 query 必须为字符串');
  const query = input.query.trim();
  const queryLength = Array.from(query).length;
  if (!queryLength || queryLength > 128) throw new Error('DeepSeek 搜索 query 必须为 1 至 128 个字符');
  const count = input.count ?? 10;
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('DeepSeek 搜索 count 必须为 1 至 50');
  if (input.ori_question !== undefined && input.ori_question !== null) {
    if (typeof input.ori_question !== 'string') throw new Error('DeepSeek 搜索 ori_question 必须为字符串或 null');
    const originalQuestionLength = Array.from(input.ori_question).length;
    if (!originalQuestionLength || originalQuestionLength > 128) throw new Error('DeepSeek 搜索 ori_question 必须为 1 至 128 个字符或 null');
  }
  if (input.localization !== undefined && typeof input.localization !== 'string') throw new Error('DeepSeek 搜索 localization 必须为字符串');
  if (input.need_content !== undefined && typeof input.need_content !== 'boolean') throw new Error('DeepSeek 搜索 need_content 必须为布尔值');
  const body: DeepSeekToolSearchInput = {
    query,
    count,
    ...(input.ori_question !== undefined ? { ori_question: input.ori_question } : {}),
    ...(input.localization !== undefined ? { localization: input.localization } : {}),
    ...(input.need_content !== undefined ? { need_content: input.need_content } : {}),
  };
  const data = await deepSeekToolRequest(deepSeekToolEndpoint(provider, 'search'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }, 30000, signal);
  const rawResults: unknown[] | null = Array.isArray(data?.results) ? data.results as unknown[] : null;
  if (!rawResults) throw providerResponseError(502, { error: { message: 'DeepSeek Search 响应缺少 results 数组' } }, 'Invalid Search response');
  let results: DeepSeekToolSearchResult[];
  try {
    results = rawResults.map((value, index) => deepSeekSearchResult(value, index));
  } catch (error) {
    const message = error instanceof Error ? error.message : '搜索结果 schema 无效';
    const metadata = data && typeof data === 'object' ? (data as Record<PropertyKey, unknown>)[providerResponseMeta] as ProviderResponseMeta | undefined : undefined;
    const failure = providerResponseError(502, { error: { code: 'invalid_response', message: `DeepSeek Search 响应无效：${message}` } }, 'Invalid Search response', metadata?.requestId);
    Object.assign(failure, { providerSearchRequestCount: rawResults.length > 0 ? 1 : 0 });
    throw failure;
  }
  return { results, searchRequestCount: rawResults.length > 0 ? 1 : 0 } satisfies DeepSeekToolSearchResponse;
}

export async function deepSeekToolFetch(provider: DeepSeekApiProvider, value: string, signal?: AbortSignal): Promise<DeepSeekToolFetchResult> {
  requireDeepSeekToolProvider(provider);
  if (typeof value !== 'string') throw new Error('DeepSeek Fetch URL 必须为字符串');
  const urlValue = value.trim();
  if (!urlValue || Array.from(urlValue).length > 8192) throw new Error('DeepSeek Fetch URL 必须为 1 至 8192 个字符');
  let url: URL;
  try { url = new URL(urlValue); }
  catch { throw new Error('DeepSeek Fetch 只接受有效的 HTTP 或 HTTPS 网页地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('DeepSeek Fetch 只接受不含用户信息的 HTTP 或 HTTPS 网页地址');
  }
  const data = await deepSeekToolRequest(deepSeekToolEndpoint(provider, 'fetch'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url: urlValue }),
  }, 45000, signal);
  if (typeof data?.title !== 'string' || typeof data?.content !== 'string') {
    throw providerResponseError(502, { error: { message: 'DeepSeek Fetch 响应缺少 title 或 content 字段' } }, 'Invalid Fetch response');
  }
  return { title: data.title, content: data.content };
}

export type DeepSeekReasoningEffort = 'none' | 'low' | 'high' | 'max' | 'minimal' | 'medium' | 'xhigh';

export function normalizeDeepSeekReasoningEffort(value: DeepSeekReasoningEffort | undefined) {
  if (value === undefined) return undefined;
  if (value === 'minimal') return 'low';
  if (value === 'medium' || value === 'xhigh') return 'high';
  if (value === 'none' || value === 'low' || value === 'high' || value === 'max') return value;
  throw new Error('DeepSeek reasoning.effort 仅支持 none、low、high 或 max');
}

function deepSeekResponsesModel(rawModelId: string) {
  const id = String(rawModelId || '').trim().toLowerCase().split('/').pop();
  if (id === 'deepseek-flash' || id === 'deepseek-v4-flash' || id === 'deepseek-v4.1-flash') return 'deepseek-flash';
  if (id === 'deepseek-v4-pro') return 'deepseek-v4-pro';
  return null;
}

function deepSeekImageUrl(value: string) {
  const urlValue = value.trim();
  if (!urlValue || Array.from(urlValue).length > 8192) {
    throw new Error('DeepSeek Responses API 的 image_url 必须为 1 至 8192 个字符');
  }
  if (/^data:[^,]+,/i.test(urlValue)) return urlValue;
  let url: URL;
  try { url = new URL(urlValue); }
  catch { throw new Error('DeepSeek Responses API 的 image_url 只接受 HTTP、HTTPS 或 data URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('DeepSeek Responses API 的 image_url 只接受 HTTP、HTTPS 或 data URL');
  }
  return urlValue;
}

function responseMessageContent(
  content: DeepSeekResponsesMessage['content'],
  role: 'user' | 'system' | 'developer' | 'assistant' = 'user',
  allowImages = true,
) {
  if (content == null) return [];
  const textType = role === 'assistant' ? 'output_text' : 'input_text';
  if (typeof content === 'string') return [{ type: textType, text: content }];
  const parts: Array<Record<string, unknown>> = [];
  for (const rawPart of content) {
    if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) throw new Error('DeepSeek Responses API 输入内容块格式无效');
    const part = rawPart as Record<string, unknown>;
    if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
      const text = typeof part.text === 'string' ? part.text : '';
      parts.push({ type: textType, text });
      continue;
    }
    if (part.type === 'input_file') {
      if (role !== 'user') throw new Error('DeepSeek Responses API 仅支持 user 消息中的 input_file');
      const fileId = deepSeekField(part.file_id).trim();
      if (!fileId) throw new Error('DeepSeek Responses API 的 input_file 必须提供 file_id');
      parts.push({ type: 'input_file', file_id: fileId });
      continue;
    }
    if (part.type === 'input_image' || part.type === 'image_url') {
      if (role === 'assistant') throw new Error('DeepSeek Responses API 不支持 assistant 消息中的 input_image；请不要把图片放回 assistant 历史消息');
      if (!allowImages) throw new Error('DeepSeek Responses API 的 deepseek-v4-pro 不支持 input_image；图生文请使用 deepseek-flash');
      const image = part.type === 'image_url' && part.image_url && typeof part.image_url === 'object'
        ? part.image_url as Record<string, unknown>
        : part;
      const rawImageUrl = deepSeekField(image.image_url || image.url).trim();
      const imageUrl = rawImageUrl ? deepSeekImageUrl(rawImageUrl) : '';
      const fileId = deepSeekField(image.file_id).trim();
      if (imageUrl && fileId) throw new Error('DeepSeek Responses API 的 input_image 不能同时提供 image_url 与 file_id');
      if (!imageUrl && !fileId) throw new Error('DeepSeek Responses API 的 input_image 必须提供 image_url 或 file_id');
      const detail = image.detail === undefined ? undefined : String(image.detail);
      if (detail !== undefined && !['low', 'high', 'original', 'auto'].includes(detail)) {
        throw new Error('DeepSeek Responses API 的 input_image detail 无效');
      }
      parts.push({
        type: 'input_image',
        ...(imageUrl ? { image_url: imageUrl } : { file_id: fileId }),
        ...(imageUrl && detail ? { detail } : {}),
      });
      continue;
    }
    throw new Error('DeepSeek Responses API 不支持 video_url 输入；请使用支持视频输入的 Chat Completions 模型');
  }
  return parts;
}

function responseReasoningContent(value: string) {
  return [{ type: 'reasoning_text', text: value }];
}

function responseToolOutput(content: DeepSeekResponsesMessage['content'], allowImages = true) {
  if (typeof content === 'string' || content == null) return typeof content === 'string' ? content : '';
  return content.map((rawPart) => {
    if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) throw new Error('DeepSeek Responses API 工具输出内容块格式无效');
    const part = rawPart as Record<string, unknown>;
    if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') return { type: 'input_text', text: typeof part.text === 'string' ? part.text : '' };
    if (part.type === 'input_file') {
      throw new Error('DeepSeek Responses API 的工具输出不支持 input_file');
    }
    if (part.type === 'input_image' || part.type === 'image_url') {
      if (!allowImages) throw new Error('DeepSeek Responses API 的 deepseek-v4-pro 不支持工具输出中的 input_image；图生文请使用 deepseek-flash');
      const image = part.type === 'image_url' && part.image_url && typeof part.image_url === 'object'
        ? part.image_url as Record<string, unknown>
        : part;
      const rawImageUrl = deepSeekField(image.image_url || image.url).trim();
      const imageUrl = rawImageUrl ? deepSeekImageUrl(rawImageUrl) : '';
      const fileId = deepSeekField(image.file_id).trim();
      if (imageUrl && fileId) throw new Error('DeepSeek Responses API 的 input_image 不能同时提供 image_url 与 file_id');
      if (!imageUrl && !fileId) throw new Error('DeepSeek Responses API 的 input_image 必须提供 image_url 或 file_id');
      const detail = image.detail === undefined ? undefined : String(image.detail);
      if (detail !== undefined && !['low', 'high', 'original', 'auto'].includes(detail)) {
        throw new Error('DeepSeek Responses API 的 input_image detail 无效');
      }
      return { type: 'input_image', ...(imageUrl ? { image_url: imageUrl } : { file_id: fileId }), ...(imageUrl && detail ? { detail } : {}) };
    }
    throw new Error('DeepSeek Responses API 不支持 video_url 工具输出');
  });
}

function responseToolArguments(value: unknown) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
}

function isDeepSeekUrlReadKind(value: unknown) {
  return ['read_link', 'open_page', 'find_in_page', 'fetch'].includes(deepSeekField(value));
}

function deepSeekServerToolDeclaredType(item: Record<string, unknown>, rawModelId = '') {
  const declared = deepSeekField(item.name || item.tool_name || item.type).trim();
  if (declared === 'deepseek_read_url' || isDeepSeekUrlReadKind(item.kind)) return 'deepseek_read_url';
  if (declared === 'web_search') return 'web_search';
  return deepSeekResponsesModel(rawModelId) === 'deepseek-v4-pro' ? 'web_search' : 'deepseek_web_search';
}

function deepSeekServerToolCall(item: Record<string, unknown>, index: number, rawModelId = '') {
  const call: Record<string, unknown> = {
    index,
    ...(deepSeekField(item.id || item.call_id) ? { id: deepSeekField(item.id || item.call_id) } : {}),
    type: deepSeekServerToolDeclaredType(item, rawModelId),
    ...(item.kind !== undefined ? { kind: item.kind } : {}),
    ...(item.action && typeof item.action === 'object' && !Array.isArray(item.action) ? { action: item.action } : {}),
    ...(item.status !== undefined ? { status: item.status } : {}),
    ...(item.sources !== undefined ? { sources: item.sources } : {}),
    ...(item.page !== undefined ? { page: item.page } : {}),
    ...(item.signature !== undefined ? { signature: item.signature } : {}),
    ...(item.error !== undefined && item.error !== null ? { error: item.error } : {}),
  };
  return call;
}

function deepSeekServerToolSteps(output: readonly unknown[], rawModelId = '') {
  const steps: Array<{ index: number; reasoning_content?: string; calls: Array<Record<string, unknown>> }> = [];
  let stepIndex = 0;
  let stepReasoning = '';
  let stepHasCall = false;
  const ensureStep = () => {
    const existing = steps.find((step) => step.index === stepIndex);
    if (existing) return existing;
    const created: { index: number; reasoning_content?: string; calls: Array<Record<string, unknown>> } = { index: stepIndex, calls: [] };
    steps.push(created);
    return created;
  };
  for (const rawItem of output) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const item = rawItem as Record<string, unknown>;
    if (item.type === 'reasoning') {
      if (stepHasCall) {
        stepIndex += 1;
        stepReasoning = '';
        stepHasCall = false;
      }
      if (Array.isArray(item.content)) {
        for (const rawPart of item.content) {
          if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) continue;
          const part = rawPart as Record<string, unknown>;
          if (part.type === 'reasoning_text' && typeof part.text === 'string') stepReasoning += part.text;
        }
      }
      continue;
    }
    // `tool_search_call` is an output-only discovery item. It is not a
    // server-side web operation and must not be exposed as a billable search
    // lifecycle event in the Chat compatibility contract.
    if (item.type !== 'web_search_call') continue;
    const step = ensureStep();
    if (stepReasoning && step.reasoning_content === undefined) step.reasoning_content = stepReasoning;
    step.calls.push(deepSeekServerToolCall(item, step.calls.length, rawModelId));
    stepHasCall = true;
  }
  return steps.filter((step) => step.calls.length > 0);
}

function deepSeekResponsesServerToolItems(values: readonly unknown[]) {
  const items: Array<Record<string, unknown>> = [];
  for (const rawValue of values) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const value = rawValue as Record<string, unknown>;
    if (value.type === 'web_search_call') {
      items.push(value);
      continue;
    }
    if (!Array.isArray(value.calls)) continue;
    for (const rawCall of value.calls) {
      if (!rawCall || typeof rawCall !== 'object' || Array.isArray(rawCall)) continue;
      const call = rawCall as Record<string, unknown>;
      const item: Record<string, unknown> = {
        type: 'web_search_call',
        ...(deepSeekField(call.id || call.call_id) ? { id: deepSeekField(call.id || call.call_id) } : {}),
        ...(call.status !== undefined ? { status: call.status } : {}),
        ...(call.kind !== undefined ? { kind: call.kind } : {}),
        ...(call.action !== undefined ? { action: call.action } : {}),
        ...(call.sources !== undefined ? { sources: call.sources } : {}),
        ...(call.page !== undefined ? { page: call.page } : {}),
        ...(call.signature !== undefined ? { signature: call.signature } : {}),
        ...(call.error !== undefined ? { error: call.error } : {}),
      };
      items.push(item);
    }
  }
  return items;
}

function responseToolChoice(value: unknown, toolNames: ReadonlySet<string>, hasServerWebTools: boolean) {
  if (value === 'required' && hasServerWebTools) return 'auto';
  if (value === 'auto' || value === 'none' || value === 'required') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const choice = value as Record<string, unknown>;
    const nested = choice.function && typeof choice.function === 'object' ? choice.function as Record<string, unknown> : null;
    if (choice.type !== undefined && choice.type !== 'function') throw new Error('DeepSeek Responses tool_choice 仅支持 function 类型');
    const name = deepSeekField(choice.name || nested?.name).trim();
    if (name && toolNames.has(name)) return { type: 'function', name };
  }
  throw new Error('DeepSeek Responses tool_choice 格式无效');
}

function responseTools(values: readonly unknown[] | undefined, model: string) {
  if (!values?.length) return undefined;
  const functionNames = new Set<string>();
  const normalized = values.map<Record<string, unknown> | null>((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DeepSeek Responses tools 必须是工具对象数组');
    const tool = value as Record<string, unknown>;
    const fn = tool.function && typeof tool.function === 'object' ? tool.function as Record<string, unknown> : null;
    if (tool.type === 'function') {
      const definition = fn || tool;
      const name = deepSeekField(definition.name).trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) throw new Error('DeepSeek Responses function 工具名称必须为 1 至 128 位字母、数字、下划线或连字符');
      if (functionNames.has(name)) throw new Error(`DeepSeek Responses function 工具名称重复：${name}`);
      functionNames.add(name);
      if (definition.parameters !== undefined && (!definition.parameters || typeof definition.parameters !== 'object' || Array.isArray(definition.parameters))) {
        throw new Error(`DeepSeek Responses function ${name} 的 parameters 必须是 JSON Schema 对象`);
      }
      if (definition.strict !== undefined && typeof definition.strict !== 'boolean') throw new Error(`DeepSeek Responses function ${name} 的 strict 必须为布尔值`);
      return {
        type: 'function',
        name,
        ...(typeof definition.description === 'string' ? { description: definition.description } : {}),
        ...(definition.parameters !== undefined ? { parameters: definition.parameters } : {}),
        ...(definition.strict !== undefined ? { strict: definition.strict } : {}),
      };
    }
    if (tool.type === 'custom') {
      if (tool.name !== 'apply_patch') throw new Error('DeepSeek Responses 仅支持名称为 apply_patch 的 custom 工具');
      return { type: 'custom', name: 'apply_patch', ...(typeof tool.description === 'string' ? { description: tool.description } : {}), ...(tool.input_format && typeof tool.input_format === 'object' && !Array.isArray(tool.input_format) ? { input_format: tool.input_format } : {}) };
    }
    if (tool.type === 'web_search') {
      // The legacy web_search declaration is ignored by deepseek-flash; the
      // model's documented server tools are deepseek_web_search/read_url.
      return model === 'deepseek-flash' ? null : { type: 'web_search' };
    }
    if (tool.type === 'deepseek_web_search' || tool.type === 'deepseek_read_url') return { type: tool.type };
    // DeepSeek ignores unsupported built-in tool types unless they are sent
    // alongside the dedicated Web Tools, where the upstream API returns 400.
    if (tool.type === 'namespace' || tool.type === 'tool_search') return { type: tool.type };
    // DeepSeek ignores unknown tool types. Preserve only the documented tool
    // objects so an unrelated provider extension cannot leak upstream.
    return null;
  }).filter((tool): tool is Record<string, unknown> => Boolean(tool));
  const types = normalized.map((tool) => String((tool as Record<string, unknown>).type));
  const serverWebToolTypes = new Set(['web_search', 'deepseek_web_search', 'deepseek_read_url']);
  const hasDeepSeekWebTools = types.some((type) => type === 'deepseek_web_search' || type === 'deepseek_read_url');
  const hasServerWebTools = types.some((type) => serverWebToolTypes.has(type));
  for (const type of serverWebToolTypes) {
    if (types.filter((candidate) => candidate === type).length > 1) {
      throw new Error(`DeepSeek Responses ${type} 工具只能声明一次`);
    }
  }
  const incompatibleWithWebTools = new Set(['web_search', 'custom', 'namespace', 'tool_search']);
  if (hasDeepSeekWebTools && types.some((type) => incompatibleWithWebTools.has(type))) {
    throw new Error('DeepSeek Responses Web Tools 不能与 web_search、custom、namespace 或 tool_search 组合');
  }
  if (hasDeepSeekWebTools && model !== 'deepseek-flash') throw new Error('DeepSeek Responses 的 deepseek_web_search/deepseek_read_url 仅支持 deepseek-flash');
  if (types.includes('web_search') && model !== 'deepseek-v4-pro') throw new Error('DeepSeek Responses 的 web_search 仅支持 deepseek-v4-pro');
  const supported = normalized.filter((tool) => !['namespace', 'tool_search'].includes(String((tool as Record<string, unknown>).type)));
  return supported.length ? supported : undefined;
}

export function serializeDeepSeekResponsesInput(messages: readonly unknown[], rawModelId = 'deepseek-flash') {
  const model = deepSeekResponsesModel(rawModelId) || rawModelId;
  const allowImages = model === 'deepseek-flash';
  const input: Array<Record<string, unknown>> = [];
  const customCallIds = new Set<string>();
  const seenCallIds = new Set<string>();
  for (const rawMessage of messages) {
    if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) throw new Error('DeepSeek Responses API 输入 item 格式无效');
    const message = rawMessage as Record<string, unknown>;
    const rawRole = deepSeekField(message.role);
    if (!rawRole) {
      const itemType = deepSeekField(message.type);
      // DeepSeek documents `tool_search_call` as output-only. If an older
      // history snapshot contains one, omit it rather than sending an item
      // type the Responses input contract does not accept.
      if (itemType === 'tool_search_call') continue;
      if (['function_call', 'function_call_output', 'reasoning', 'custom_tool_call', 'custom_tool_call_output', 'web_search_call'].includes(itemType)) {
        const callId = deepSeekField(message.call_id || message.id).trim();
        if (callId && (itemType === 'function_call' || itemType === 'custom_tool_call')) {
          if (seenCallIds.has(callId)) throw new Error(`DeepSeek Responses 工具调用 call_id 重复：${callId}`);
          seenCallIds.add(callId);
        }
        if (itemType === 'custom_tool_call' && callId) customCallIds.add(callId);
        if (itemType === 'custom_tool_call_output' && (!callId || !customCallIds.has(callId))) {
          throw new Error(`DeepSeek Responses custom_tool_call_output 缺少对应的 custom_tool_call：${callId || '未知 call_id'}`);
        }
        input.push(message);
        continue;
      }
      throw new Error(`DeepSeek Responses API 不支持输入 item 类型：${itemType || '未知'}`);
    }
    if (rawRole === 'tool') {
      const callId = deepSeekField(message.tool_call_id).trim();
      if (callId) {
        const output = responseToolOutput(message.content as DeepSeekResponsesMessage['content'], allowImages);
        input.push(customCallIds.has(callId)
          ? { type: 'custom_tool_call_output', call_id: callId, output }
          : { type: 'function_call_output', call_id: callId, output });
      }
      continue;
    }
    if (rawRole === 'assistant' && Array.isArray(message.tool_calls)) {
      const reasoning = deepSeekField(message.reasoning_content);
      if (reasoning) input.push({ type: 'reasoning', content: responseReasoningContent(reasoning) });
      if (message.content) input.push({ role: 'assistant', content: responseMessageContent(message.content as DeepSeekResponsesMessage['content'], 'assistant', allowImages) });
      if (Array.isArray(message.server_tool_calls)) {
        input.push(...deepSeekResponsesServerToolItems(message.server_tool_calls));
      }
      for (const rawCall of message.tool_calls) {
        const call = rawCall && typeof rawCall === 'object' && !Array.isArray(rawCall) ? rawCall as Record<string, unknown> : {};
        const fn = call.function && typeof call.function === 'object' && !Array.isArray(call.function) ? call.function as Record<string, unknown> : undefined;
        const callId = deepSeekField(call.id || call.call_id);
        const name = deepSeekField(fn?.name);
        if (!callId || !name) continue;
        const isCustomCall = call.type === 'custom' || name === 'apply_patch';
        if (isCustomCall) {
          if (seenCallIds.has(callId)) throw new Error(`DeepSeek Responses 工具调用 call_id 重复：${callId}`);
          seenCallIds.add(callId);
          customCallIds.add(callId);
          input.push({ type: 'custom_tool_call', call_id: callId, name, input: responseToolArguments(fn?.arguments) });
        } else {
          if (seenCallIds.has(callId)) throw new Error(`DeepSeek Responses 工具调用 call_id 重复：${callId}`);
          seenCallIds.add(callId);
          input.push({ type: 'function_call', call_id: callId, name, arguments: responseToolArguments(fn?.arguments) });
        }
      }
      continue;
    }
    if (!['system', 'developer', 'user', 'assistant'].includes(rawRole)) throw new Error(`DeepSeek Responses API 不支持消息 role：${rawRole}`);
    const reasoning = deepSeekField(message.reasoning_content);
    if (rawRole === 'assistant' && reasoning) input.push({ type: 'reasoning', content: responseReasoningContent(reasoning) });
    input.push({ role: rawRole, content: responseMessageContent(message.content as DeepSeekResponsesMessage['content'], rawRole as 'user' | 'system' | 'developer' | 'assistant', allowImages) });
    if (rawRole === 'assistant' && Array.isArray(message.server_tool_calls)) {
      input.push(...deepSeekResponsesServerToolItems(message.server_tool_calls));
    }
  }
  const lastItem = input.at(-1);
  if (lastItem?.type === 'reasoning' || (lastItem?.role === 'assistant' && (lastItem.type === undefined || lastItem.type === 'message'))) {
    throw new Error('DeepSeek Responses API 不支持以 assistant 消息或 reasoning item 结尾的 input');
  }
  return input;
}

function deepSeekResponsesRequest(
  rawModelId: string,
  input: DeepSeekResponsesInput,
  options: DeepSeekResponsesOptions,
) {
  const model = deepSeekResponsesModel(rawModelId);
  if (!model) throw new Error(`DeepSeek Responses API 不支持模型 ${rawModelId}；当前只支持 deepseek-flash 与 deepseek-v4-pro`);
  if (options.maxOutputTokens !== undefined && (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 || options.maxOutputTokens > 393216)) {
    throw new Error('DeepSeek max_output_tokens 必须为 1 至 393216 的整数');
  }
  if (options.temperature !== undefined && (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) {
    throw new Error('DeepSeek temperature 必须为 0 至 2 的数字');
  }
  if (options.topP !== undefined && (!Number.isFinite(options.topP) || options.topP < 0 || options.topP > 1)) {
    throw new Error('DeepSeek top_p 必须为 0 至 1 的数字');
  }
  if (options.topLogprobs !== undefined && (!Number.isInteger(options.topLogprobs) || options.topLogprobs < 0 || options.topLogprobs > 20)) {
    throw new Error('DeepSeek top_logprobs 必须为 0 至 20 的整数');
  }
  const effort = normalizeDeepSeekReasoningEffort(options.reasoningEffort);
  if ((typeof input === 'string' ? !input.trim() : input.length === 0) && !options.instructions?.trim()) {
    throw new Error('DeepSeek Responses API 必须提供非空 input 或 instructions');
  }
  if (options.safetyCheck !== undefined) {
    if (!options.safetyCheck || typeof options.safetyCheck !== 'object' || Array.isArray(options.safetyCheck) || !['low', 'high'].includes(options.safetyCheck.level)) {
      throw new Error('DeepSeek safety_check 必须为 { level: "low" | "high" }');
    }
  }
  if (options.title !== undefined) {
    if (!options.title || typeof options.title !== 'object' || Array.isArray(options.title) || typeof options.title.enabled !== 'boolean') {
      throw new Error('DeepSeek title 必须为 { enabled: boolean }');
    }
  }
  if (options.text !== undefined && (!options.text || typeof options.text !== 'object' || Array.isArray(options.text))) {
    throw new Error('DeepSeek Responses text 必须为对象');
  }
  const format = options.text?.format;
  if (format !== undefined) {
    if (!format || typeof format !== 'object' || Array.isArray(format)) throw new Error('DeepSeek Responses text.format 必须为对象');
    const formatType = deepSeekField((format as Record<string, unknown>).type);
    if (!['text', 'json_object', 'json_schema'].includes(formatType)) throw new Error('DeepSeek Responses text.format.type 不受支持');
    if (formatType === 'json_schema') {
      if (typeof (format as Record<string, unknown>).name !== 'string' || !(format as Record<string, unknown>).name) throw new Error('DeepSeek Responses json_schema 必须提供 name');
      if (!(format as Record<string, unknown>).schema || typeof (format as Record<string, unknown>).schema !== 'object' || Array.isArray((format as Record<string, unknown>).schema)) throw new Error('DeepSeek Responses json_schema 必须提供 schema 对象');
    }
  }
  const tools = responseTools(options.tools, model);
  const toolNames = new Set((tools || []).filter((tool) => (tool as Record<string, unknown>).type === 'function').map((tool) => deepSeekField((tool as Record<string, unknown>).name)));
  const hasServerWebTools = Boolean(tools?.some((tool) => ['web_search', 'deepseek_web_search', 'deepseek_read_url'].includes(String((tool as Record<string, unknown>).type))));
  const hasDeepSeekWebTools = Boolean(tools?.some((tool) => ['deepseek_web_search', 'deepseek_read_url'].includes(String((tool as Record<string, unknown>).type))));
  if (hasDeepSeekWebTools && format && deepSeekField((format as Record<string, unknown>).type) !== 'text') {
    throw new Error('DeepSeek Responses 联网工具只支持 text 输出格式');
  }
  if (hasDeepSeekWebTools && options.topLogprobs !== undefined) {
    throw new Error('DeepSeek Responses Web Tools 不支持 top_logprobs');
  }
  if (options.user !== undefined && (typeof options.user !== 'string' || new TextEncoder().encode(options.user).byteLength > 512)) {
    throw new Error('DeepSeek Responses user 必须为不超过 512 UTF-8 字节的字符串');
  }
  const toolChoice = options.tool_choice === undefined ? undefined : responseToolChoice(options.tool_choice, toolNames, hasServerWebTools);
  const serializedInput = typeof input === 'string' ? input : serializeDeepSeekResponsesInput(input, model);
  const body: Record<string, unknown> = {
    model,
    input: serializedInput,
    max_output_tokens: options.maxOutputTokens ?? 65536,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.topLogprobs !== undefined ? { top_logprobs: options.topLogprobs } : {}),
    ...(options.instructions ? { instructions: options.instructions } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(tools ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    ...(options.text ? { text: options.text } : {}),
    ...(options.safetyCheck !== undefined ? { safety_check: options.safetyCheck } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.user !== undefined ? { user: options.user } : {}),
    ...(options.stream ? { stream: true } : {}),
  };
  return body;
}

function responsesUsage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const input = Number(usage.input_tokens);
  const output = Number(usage.output_tokens);
  const total = Number(usage.total_tokens);
  const hasInput = Number.isFinite(input) && input >= 0;
  const hasOutput = Number.isFinite(output) && output >= 0;
  return {
    ...usage,
    ...(hasInput ? { prompt_tokens: input, input_tokens: input } : {}),
    ...(hasOutput ? { completion_tokens: output, output_tokens: output } : {}),
    ...(Number.isFinite(total) && total >= 0 ? { total_tokens: total } : hasInput && hasOutput ? { total_tokens: input + output } : {}),
  };
}

function deepSeekResponseMetadata(output: readonly unknown[], response: Record<string, unknown> = {}) {
  const serverToolCalls: Array<Record<string, unknown>> = [];
  const serverToolCallKeys = new Set<string>();
  const annotations: unknown[] = [];
  const annotationKeys = new Set<string>();
  const addServerToolCall = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    if (item.type !== 'web_search_call') return;
    const key = deepSeekField(item.id || item.call_id) || `${item.type}:${serverToolCalls.length}`;
    if (serverToolCallKeys.has(key)) return;
    serverToolCallKeys.add(key);
    serverToolCalls.push(item);
  };
  const addAnnotation = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    let key = '';
    try { key = JSON.stringify(value); } catch { key = `${annotations.length}`; }
    if (annotationKeys.has(key)) return;
    annotationKeys.add(key);
    annotations.push(value);
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    addServerToolCall(item);
    if (Array.isArray(item.annotations)) item.annotations.forEach(addAnnotation);
    if (Array.isArray(item.content)) item.content.forEach(visit);
  };
  output.forEach(visit);
  if (Array.isArray(response.annotations)) response.annotations.forEach(addAnnotation);
  return {
    ...(serverToolCalls.length ? { server_tool_calls: serverToolCalls } : {}),
    ...(annotations.length ? { annotations } : {}),
  };
}

export function normalizeDeepSeekResponsesResponse(data: unknown, rawModelId: string) {
  const response = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const status = String(response.status || '').toLowerCase();
  const responseError = response.error && typeof response.error === 'object' && !Array.isArray(response.error)
    ? response.error as Record<string, unknown>
    : null;
  if (status === 'failed' || status === 'cancelled' || response.type === 'error') {
    const failure = responseError || { message: response.error || response.message || `Response ${status || 'failed'}` };
    const metadata = (data && typeof data === 'object' ? (data as Record<PropertyKey, unknown>)[providerResponseMeta] : undefined) as ProviderResponseMeta | undefined;
    const requestId = deepSeekField(failure.request_id || response.request_id || metadata?.requestId);
    const error = providerResponseError(status === 'cancelled' ? 499 : 502, { error: failure }, JSON.stringify(failure), requestId);
    const usage = responsesUsage(response.usage);
    if (usage) Object.assign(error, { providerUsage: usage });
    throw error;
  }
  const incompleteDetails = response.incomplete_details && typeof response.incomplete_details === 'object'
    ? response.incomplete_details as Record<string, unknown>
    : {};
  const contentFiltered = status === 'incomplete' && incompleteDetails.reason === 'content_filter';
  const output = Array.isArray(response.output) ? response.output : [];
  const text: string[] = [];
  const reasoning: string[] = [];
  let trailingReasoning = '';
  let sawServerToolCall = false;
  const toolCalls: Array<Record<string, unknown>> = [];
  for (const rawItem of output) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const item = rawItem as Record<string, unknown>;
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      if (contentFiltered) continue;
      const callId = deepSeekField(item.call_id || item.id);
      const name = deepSeekField(item.name);
      const argumentsValue = item.type === 'custom_tool_call' ? item.input : item.arguments;
      if (callId && name) toolCalls.push({ id: callId, type: 'function', function: { name, arguments: responseToolArguments(argumentsValue) } });
      continue;
    }
    if (item.type === 'reasoning' && Array.isArray(item.content)) {
      if (contentFiltered) continue;
      for (const rawPart of item.content) {
        if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) continue;
        const part = rawPart as Record<string, unknown>;
        if (part.type === 'reasoning_text' && typeof part.text === 'string') {
          reasoning.push(part.text);
          if (sawServerToolCall) trailingReasoning += part.text;
        }
      }
      continue;
    }
    if (item.type === 'web_search_call') {
      sawServerToolCall = true;
      trailingReasoning = '';
      continue;
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    if (contentFiltered) continue;
    for (const rawPart of item.content) {
      if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) continue;
      const part = rawPart as Record<string, unknown>;
      if ((part.type === 'output_text' || part.type === 'refusal') && typeof part.text === 'string') text.push(part.text);
    }
  }
  if (!contentFiltered && !text.length && typeof response.output_text === 'string') text.push(response.output_text);
  const usage = responsesUsage(response.usage);
  const metadata = deepSeekResponseMetadata(output, response);
  const serverToolCalls = metadata.server_tool_calls
    ? deepSeekServerToolSteps(output, rawModelId).map((step) => contentFiltered
      ? { index: step.index, calls: step.calls }
      : step)
    : undefined;
  const messageReasoning = serverToolCalls && sawServerToolCall ? trailingReasoning : reasoning.join('');
  const annotations = contentFiltered ? undefined : metadata.annotations;
  const normalizedStatus = status === 'incomplete'
    ? contentFiltered ? 'content_filter' : 'length'
    : toolCalls.length ? 'tool_calls' : 'stop';
  const normalizedResponse = { ...response };
  if (contentFiltered) {
    delete normalizedResponse.annotations;
    delete normalizedResponse.output_text;
    normalizedResponse.output = output.filter((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).type === 'web_search_call');
  }
  return {
    ...normalizedResponse,
    model: deepSeekField(response.model) || rawModelId,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text.join('') || null,
        ...(messageReasoning ? { reasoning_content: messageReasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        ...(serverToolCalls ? { server_tool_calls: serverToolCalls } : {}),
        ...(annotations ? { annotations } : {}),
        ...(response.title !== undefined ? { title: response.title } : {}),
      },
      finish_reason: normalizedStatus,
    }],
    ...(usage ? { usage } : {}),
    ...(serverToolCalls ? { server_tool_calls: serverToolCalls } : {}),
    ...(annotations ? { annotations } : {}),
  };
}

function normalizeDeepSeekChatStream(response: Response, rawModelId: string) {
  if (!response.body) throw new Error('DeepSeek Responses 流没有响应正文');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const toolIndices = new Map<number, number>();
  const toolItemIds = new Map<string, number>();
  const toolArgumentBuffers = new Map<number, string>();
  const emittedCalls = new Set<string>();
  const serverToolOutputItems = new Map<number, Record<string, unknown>>();
  const serverToolItemIds = new Map<string, number>();
  const startedServerToolCalls = new Set<number>();
  const completedServerToolCalls = new Set<number>();
  const serverToolCallIndices = new Map<number, number>();
  let serverToolStep = 0;
  let serverToolStepCallIndex = 0;
  let serverToolStepClosed = false;
  let emittedServerToolStepReasoning = false;
  const serverToolCalls: Array<Record<string, unknown>> = [];
  const serverToolCallKeys = new Set<string>();
  const annotations: unknown[] = [];
  const annotationKeys = new Set<string>();
  let streamTitle: unknown;
  let emittedText = false;
  let emittedReasoning = false;
  let toolCount = 0;
  let model = rawModelId;
  let terminal = false;
  let buffer = '';
  const responseRequestId = requestIdFrom(null, '', response.headers);
  const mergeMetadata = (metadata: { server_tool_calls?: unknown[]; annotations?: unknown[] }) => {
    for (const rawCall of metadata.server_tool_calls || []) {
      if (!rawCall || typeof rawCall !== 'object' || Array.isArray(rawCall)) continue;
      const call = rawCall as Record<string, unknown>;
      const key = deepSeekField(call.id || call.call_id) || `${call.type}:${serverToolCalls.length}`;
      if (serverToolCallKeys.has(key)) {
        const index = serverToolCalls.findIndex((existing) => (deepSeekField(existing.id || existing.call_id) || '') === key);
        if (index >= 0) serverToolCalls[index] = { ...serverToolCalls[index], ...call };
        continue;
      }
      serverToolCallKeys.add(key);
      serverToolCalls.push(call);
    }
    for (const annotation of metadata.annotations || []) {
      if (!annotation || typeof annotation !== 'object') continue;
      let key = '';
      try { key = JSON.stringify(annotation); } catch { key = `${annotations.length}`; }
      if (annotationKeys.has(key)) continue;
      annotationKeys.add(key);
      annotations.push(annotation);
    }
  };
  const collectMetadata = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as Record<string, unknown>;
      if (item.title !== undefined && streamTitle === undefined) streamTitle = item.title;
    }
    mergeMetadata(deepSeekResponseMetadata([value]));
  };
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, unknown>, metadata?: Record<string, unknown>, serverToolEvent?: Record<string, unknown>) => ({
    model,
    choices: [{ index: 0, delta, ...(serverToolEvent ? { server_tool_event: serverToolEvent } : {}), finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
    ...(metadata || {}),
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${value === '[DONE]' ? '[DONE]' : JSON.stringify(value)}\n\n`));
      const serverToolCallType = (item: Record<string, unknown>) => isDeepSeekUrlReadKind(item.kind)
        ? 'deepseek_read_url'
        : deepSeekResponsesModel(model) === 'deepseek-v4-pro' ? 'web_search' : 'deepseek_web_search';
      const emitServerToolStarted = (outputIndex: number, item: Record<string, unknown>) => {
        if (serverToolStepClosed) {
          serverToolStep += 1;
          serverToolStepCallIndex = 0;
          serverToolStepClosed = false;
          emittedServerToolStepReasoning = false;
        }
        serverToolOutputItems.set(outputIndex, { ...(serverToolOutputItems.get(outputIndex) || {}), ...item });
        const itemId = deepSeekField(item.id || item.call_id);
        if (itemId) serverToolItemIds.set(itemId, outputIndex);
        if (!emittedServerToolStepReasoning) {
          send(chunk({}, null, undefined, undefined, { type: 'step_reasoning_done', step: serverToolStep }));
          emittedServerToolStepReasoning = true;
        }
        if (startedServerToolCalls.has(outputIndex)) return;
        startedServerToolCalls.add(outputIndex);
        const callIndex = serverToolStepCallIndex++;
        serverToolCallIndices.set(outputIndex, callIndex);
        send(chunk({}, null, undefined, undefined, {
          type: 'call_started',
          step: serverToolStep,
          call: { ...item, index: callIndex, type: serverToolCallType(item) },
        }));
      };
      const emitServerToolCompleted = (outputIndex: number, item: Record<string, unknown>) => {
        const finalItem = { ...(serverToolOutputItems.get(outputIndex) || {}), ...item };
        serverToolOutputItems.set(outputIndex, finalItem);
        const itemId = deepSeekField(finalItem.id || finalItem.call_id);
        if (itemId) serverToolItemIds.set(itemId, outputIndex);
        if (completedServerToolCalls.has(outputIndex)) return;
        completedServerToolCalls.add(outputIndex);
        serverToolStepClosed = true;
        const { signature: _signature, ...callWithoutSignature } = finalItem;
        send(chunk({}, null, undefined, undefined, {
          type: 'call_completed',
          step: serverToolStep,
          call: { ...callWithoutSignature, index: serverToolCallIndices.get(outputIndex) || 0, type: serverToolCallType(finalItem) },
        }));
      };
      const consumeFrame = (frame: string) => {
        const lines = frame.split(/\r?\n/);
        const eventType = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') return;
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(data) as Record<string, unknown>; }
        catch { throw new Error('DeepSeek Responses 流返回了无效 JSON 事件'); }
        const type = deepSeekField(payload.type) || eventType || '';
        const rawResponse = payload.response && typeof payload.response === 'object' ? payload.response as Record<string, unknown> : {};
        model = deepSeekField(rawResponse.model) || model;
        if (type === 'response.output_text.delta' && typeof payload.delta === 'string') {
          if (payload.delta) {
            emittedText = true;
            send(chunk({ content: payload.delta }));
          }
          return;
        }
        if (type === 'response.reasoning_text.delta' && typeof payload.delta === 'string') {
          if (payload.delta) {
            emittedReasoning = true;
            send(chunk({ reasoning_content: payload.delta }));
          }
          return;
        }
        if (type === 'response.output_item.added') {
          const outputIndex = Number(payload.output_index);
          const item = payload.item && typeof payload.item === 'object' ? payload.item as Record<string, unknown> : {};
          collectMetadata(item);
          if (item.type === 'web_search_call' && Number.isInteger(outputIndex)) {
            emitServerToolStarted(outputIndex, item);
            return;
          }
          if (!['function_call', 'custom_tool_call'].includes(String(item.type)) || !Number.isInteger(outputIndex)) return;
          if (toolIndices.has(outputIndex)) return;
          const index = toolCount++;
          toolIndices.set(outputIndex, index);
          const itemId = deepSeekField(item.id);
          if (itemId) toolItemIds.set(itemId, index);
          const callId = deepSeekField(item.call_id || item.id);
          if (callId) emittedCalls.add(callId);
          toolArgumentBuffers.set(index, '');
          send(chunk({ tool_calls: [{ index, ...(callId ? { id: callId, type: 'function' } : {}), function: { name: deepSeekField(item.name), arguments: '' } }] }));
          return;
        }
        if (type === 'response.output_text.annotation.added') {
          mergeMetadata({ annotations: payload.annotation ? [payload.annotation] : [] });
          return;
        }
        const webSearchEvent = /^response\.web_search_call\.(in_progress|searching|completed)$/.exec(type);
        if (webSearchEvent) {
          const rawItem = payload.item && typeof payload.item === 'object' && !Array.isArray(payload.item)
            ? payload.item as Record<string, unknown>
            : {};
          const eventId = deepSeekField(payload.item_id || rawItem.id || payload.id);
          const explicitIndex = Number(payload.output_index);
          const mappedIndex = eventId ? serverToolItemIds.get(eventId) : undefined;
          const outputIndex = Number.isInteger(explicitIndex) && explicitIndex >= 0
            ? explicitIndex
            : mappedIndex ?? serverToolOutputItems.size;
          const item: Record<string, unknown> = {
            type: 'web_search_call',
            ...(eventId ? { id: eventId } : {}),
            ...rawItem,
            ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
            ...(typeof payload.kind === 'string' ? { kind: payload.kind } : {}),
            ...(payload.action !== undefined ? { action: payload.action } : {}),
            ...(payload.page !== undefined ? { page: payload.page } : {}),
            ...(payload.signature !== undefined ? { signature: payload.signature } : {}),
            ...(payload.error !== undefined ? { error: payload.error } : {}),
          };
          collectMetadata(item);
          if (webSearchEvent[1] === 'completed') emitServerToolCompleted(outputIndex, item);
          else emitServerToolStarted(outputIndex, item);
          return;
        }
        if (type === 'response.output_item.done') {
          const item = payload.item && typeof payload.item === 'object' ? payload.item as Record<string, unknown> : {};
          collectMetadata(item);
          const outputIndex = Number(payload.output_index);
          if (item.type === 'web_search_call' && Number.isInteger(outputIndex)) {
            emitServerToolCompleted(outputIndex, item);
          }
          return;
        }
        if (type === 'response.function_call_arguments.delta' && typeof payload.delta === 'string') {
          const outputIndex = Number(payload.output_index);
          const index = toolIndices.get(outputIndex) ?? toolItemIds.get(deepSeekField(payload.item_id));
          if (index !== undefined && payload.delta) {
            toolArgumentBuffers.set(index, `${toolArgumentBuffers.get(index) || ''}${payload.delta}`);
            send(chunk({ tool_calls: [{ index, function: { arguments: payload.delta } }] }));
          }
          return;
        }
        if (type === 'response.function_call_arguments.done' && typeof payload.arguments === 'string') {
          const outputIndex = Number(payload.output_index);
          const index = toolIndices.get(outputIndex) ?? toolItemIds.get(deepSeekField(payload.item_id));
          if (index !== undefined && payload.arguments) {
            const emitted = toolArgumentBuffers.get(index) || '';
            // The `done` event repeats the complete argument string after the
            // delta events. Emit it only when no delta was delivered, avoiding
            // duplicated JSON in the downstream Chat Completions accumulator.
            if (!emitted) {
              toolArgumentBuffers.set(index, payload.arguments);
              send(chunk({ tool_calls: [{ index, function: { arguments: payload.arguments } }] }));
            }
          }
          return;
        }
        if (type === 'response.custom_tool_call_input.delta' && typeof payload.delta === 'string') {
          const outputIndex = Number(payload.output_index);
          const index = toolIndices.get(outputIndex) ?? toolItemIds.get(deepSeekField(payload.item_id));
          if (index !== undefined && payload.delta) {
            toolArgumentBuffers.set(index, `${toolArgumentBuffers.get(index) || ''}${payload.delta}`);
            send(chunk({ tool_calls: [{ index, function: { arguments: payload.delta } }] }));
          }
          return;
        }
        if (type === 'response.custom_tool_call_input.done' && typeof payload.input === 'string') {
          const outputIndex = Number(payload.output_index);
          const index = toolIndices.get(outputIndex) ?? toolItemIds.get(deepSeekField(payload.item_id));
          if (index !== undefined && payload.input) {
            const emitted = toolArgumentBuffers.get(index) || '';
            if (!emitted) {
              toolArgumentBuffers.set(index, payload.input);
              send(chunk({ tool_calls: [{ index, function: { arguments: payload.input } }] }));
            }
          }
          return;
        }
        if (type === 'response.failed') {
          const rawError = rawResponse.error || payload.error;
          const failure = rawError && typeof rawError === 'object' && !Array.isArray(rawError) ? rawError as Record<string, unknown> : { message: rawError };
          const requestId = deepSeekField(failure.request_id || rawResponse.request_id || responseRequestId);
          const error = providerResponseError(502, { error: failure }, JSON.stringify(failure), requestId);
          const usage = responsesUsage(rawResponse.usage || payload.usage);
          if (usage) {
            Object.assign(error, { providerUsage: usage });
            send(chunk({}, null, usage));
          }
          throw error;
        }
        if (type !== 'response.completed' && type !== 'response.incomplete') return;
        const output = Array.isArray(rawResponse.output) ? rawResponse.output : [];
        const incompleteDetails = rawResponse.incomplete_details && typeof rawResponse.incomplete_details === 'object'
          ? rawResponse.incomplete_details as Record<string, unknown>
          : {};
        const contentFiltered = type === 'response.incomplete' && incompleteDetails.reason === 'content_filter';
        const terminalMetadata = deepSeekResponseMetadata(output, rawResponse);
        mergeMetadata(terminalMetadata);
        const terminalServerToolCalls = terminalMetadata.server_tool_calls
          ? deepSeekServerToolSteps(output, rawModelId).map((step) => contentFiltered
            ? { index: step.index, calls: step.calls }
            : step)
          : [];
        if (rawResponse.title !== undefined) streamTitle = rawResponse.title;
        if (!contentFiltered && !emittedText) {
          const fallbackText = output.flatMap((rawItem) => {
            if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return [];
            const item = rawItem as Record<string, unknown>;
            if (item.type !== 'message' || !Array.isArray(item.content)) return [];
            return item.content.flatMap((rawPart) => {
              if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) return [];
              const part = rawPart as Record<string, unknown>;
              return (part.type === 'output_text' || part.type === 'refusal') && typeof part.text === 'string' ? [part.text] : [];
            });
          }).join('');
          if (fallbackText) send(chunk({ content: fallbackText }));
        }
        if (!contentFiltered && !emittedReasoning) {
          const fallbackReasoning = output.flatMap((rawItem) => {
            if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return [];
            const item = rawItem as Record<string, unknown>;
            if (item.type !== 'reasoning' || !Array.isArray(item.content)) return [];
            return item.content.flatMap((rawPart) => {
              if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) return [];
              const part = rawPart as Record<string, unknown>;
              return part.type === 'reasoning_text' && typeof part.text === 'string' ? [part.text] : [];
            });
          }).join('');
          if (fallbackReasoning) send(chunk({ reasoning_content: fallbackReasoning }));
        }
        if (!contentFiltered) for (const [rawIndex, rawItem] of output.entries()) {
          if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
          const item = rawItem as Record<string, unknown>;
          if (item.type !== 'function_call' && item.type !== 'custom_tool_call') continue;
          const outputIndex = Number(item.output_index ?? rawIndex);
          const itemId = deepSeekField(item.id);
          const callId = deepSeekField(item.call_id || item.id);
          const knownIndex = (Number.isInteger(outputIndex) ? toolIndices.get(outputIndex) : undefined) ?? (itemId ? toolItemIds.get(itemId) : undefined);
          const argumentsValue = item.type === 'custom_tool_call' ? item.input : item.arguments;
          const finalArguments = responseToolArguments(argumentsValue);
          if (knownIndex !== undefined) {
            if (!toolArgumentBuffers.get(knownIndex) && finalArguments) {
              toolArgumentBuffers.set(knownIndex, finalArguments);
              send(chunk({ tool_calls: [{ index: knownIndex, function: { arguments: finalArguments } }] }));
            }
            continue;
          }
          if (callId && emittedCalls.has(callId)) continue;
          const index = toolCount++;
          if (callId) emittedCalls.add(callId);
          send(chunk({ tool_calls: [{ index, ...(callId ? { id: callId, type: 'function' } : {}), function: { name: deepSeekField(item.name), arguments: finalArguments } }] }));
        }
        const finishReason = type === 'response.incomplete'
          ? contentFiltered ? 'content_filter' : 'length'
          : toolCount ? 'tool_calls' : 'stop';
        send(chunk({
          ...(terminalServerToolCalls.length ? { server_tool_calls: terminalServerToolCalls } : {}),
          ...(!contentFiltered && annotations.length ? { annotations } : {}),
          ...(streamTitle !== undefined ? { title: streamTitle } : {}),
        }, finishReason, responsesUsage(rawResponse.usage)));
        send('[DONE]');
        terminal = true;
        controller.close();
      };
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || '';
          for (const frame of frames) {
            consumeFrame(frame);
            if (terminal) return;
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) consumeFrame(buffer);
        if (!terminal) throw new Error('DeepSeek Responses 流在终止事件前意外结束');
      } catch (error) {
        try { await reader.cancel(error); } catch { /* stream is already closed */ }
        controller.error(error);
      }
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
}

function agnesUsage(usage: any) {
  if (!usage || typeof usage !== 'object') return undefined;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens);
  const output = Number(usage.output_tokens ?? usage.completion_tokens);
  return {
    ...(Number.isFinite(input) ? { prompt_tokens: input, input_tokens: input } : {}),
    ...(Number.isFinite(output) ? { completion_tokens: output, output_tokens: output } : {}),
    ...(Number.isFinite(input) && Number.isFinite(output) ? { total_tokens: input + output } : {}),
  };
}

export function extractAgnesText(data: any) {
  const output: string[] = [];
  const visit = (value: any, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') { output.push(value); return; }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof value !== 'object') return;
    if ((value.type === 'text' || value.type === 'output_text' || typeof value.text === 'string') && typeof value.text === 'string') { output.push(value.text); return; }
    if (typeof value.output_text === 'string') output.push(value.output_text);
    if (Array.isArray(value.output)) value.output.forEach((item: any) => visit(item?.content ?? item, depth + 1));
    if (Array.isArray(value.content)) value.content.forEach((item: any) => visit(item, depth + 1));
  };
  if (Array.isArray(data?.output)) data.output.forEach((item: any) => visit(item?.content ?? item));
  if (Array.isArray(data?.content)) data.content.forEach((item: any) => visit(item));
  if (!output.length && typeof data?.output_text === 'string') output.push(data.output_text);
  if (!output.length && typeof data?.text === 'string') output.push(data.text);
  return Array.from(new Set(output.map((item) => item.trim()).filter(Boolean))).join('\n').trim();
}

export function normalizeAgnesResponse(data: any, protocol: ProviderTextProtocol = 'chat-completions') {
  if (protocol === 'chat-completions') return data;
  const text = extractAgnesText(data);
  const usage = agnesUsage(data?.usage);
  return {
    ...data,
    model: data?.model || data?.model_id,
    choices: [{ index: 0, message: { role: 'assistant', content: text || null }, finish_reason: data?.stop_reason || data?.status || 'stop' }],
    ...(usage ? { usage } : {}),
  };
}

export function serializeAgnesMessages(messages: ChatMessage[], protocol: ProviderTextProtocol) {
  if (protocol === 'messages') {
    const system = messages.filter((message) => message.role === 'system').map((message) => typeof message.content === 'string' ? message.content : '').filter(Boolean).join('\n');
    const content = messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role === 'tool' ? 'user' : message.role, content: message.content }));
    return { ...(system ? { system } : {}), messages: content };
  }
  return messages;
}

function agnesTextProtocol(provider: RuntimeProvider) { return provider.textProtocol || 'chat-completions'; }

function agnesTextHeaders(provider: RuntimeProvider, protocol: ProviderTextProtocol) {
  if (protocol === 'messages') {
    return {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return authHeaders(provider);
}

function agnesTextEndpoint(provider: RuntimeProvider, protocol: ProviderTextProtocol) {
  if (protocol === 'responses') return providerEndpoint(provider, provider.responsesPath, '/responses');
  if (protocol === 'messages') return providerEndpoint(provider, '/messages', '/messages');
  return providerEndpoint(provider, provider.chatPath, '/chat/completions');
}

async function agnesChatRequest(provider: RuntimeProvider, rawModelId: string, payload: { messages: ChatMessage[]; tools?: any[]; tool_choice?: 'auto' | 'none' }, options: { stream?: boolean } = {}) {
  const protocol = agnesTextProtocol(provider);
  // Agnes requires a publicly reachable media URL.
  const messages = await prepareProviderChatMessages(payload.messages, preparePublicMediaUrl, { prepareDataUrls: true });
  const body: Record<string, unknown> = protocol === 'responses'
      ? { model: rawModelId, input: messages, max_output_tokens: 65536, ...(payload.tools?.length ? { tools: payload.tools } : {}), ...(options.stream ? { stream: true } : {}) }
      : protocol === 'messages'
      ? { model: rawModelId, ...serializeAgnesMessages(messages, protocol), max_tokens: 65536, ...(payload.tools?.length ? { tools: payload.tools } : {}), ...(options.stream ? { stream: true } : {}) }
      : { model: rawModelId, messages, max_tokens: 65536, ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.tool_choice || 'auto' } : {}), ...(options.stream ? { stream: true } : {}) };
  return { protocol, body, endpoint: agnesTextEndpoint(provider, protocol) };
}

function supportsDeepSeekResponsesInput(provider: RuntimeProvider, rawModelId: string, messages: ChatMessage[]) {
  return provider.platform === 'deepseek'
    && Boolean(deepSeekResponsesModel(rawModelId))
    && !messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'video_url'));
}

function deepSeekMessagesContainImage(messages: readonly DeepSeekResponsesMessage[]) {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url' || part.type === 'input_image'));
}

async function requestDeepSeekResponses(
  provider: RuntimeProvider,
  rawModelId: string,
  input: DeepSeekResponsesInput,
  options: DeepSeekResponsesOptions,
  signal?: AbortSignal,
) {
  const body = deepSeekResponsesRequest(rawModelId, input, options);
  const request = {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json', Accept: options.stream ? 'text/event-stream, application/json' : 'application/json' },
    body: JSON.stringify(body),
  } satisfies RequestInit;
  const endpoint = deepSeekResponsesEndpoint(provider);
  if (options.stream) return fetchStreamingResponse(endpoint, request, 180000, signal);
  const data = await fetchJson(endpoint, request, 180000, signal);
  normalizeDeepSeekResponsesResponse(data, rawModelId);
  return data;
}

async function prepareDeepSeekResponsesInput(input: DeepSeekResponsesInput): Promise<DeepSeekResponsesInput> {
  if (typeof input === 'string') return input;
  const prepared = await Promise.all(input.map(async (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.role !== 'string') return item;
    const [message] = await prepareProviderChatMessages([item as ChatMessage], preparePublicMediaUrl, { prepareDataUrls: false });
    return message as DeepSeekResponsesMessage;
  }));
  return prepared;
}

export async function chatCompletion(provider: RuntimeProvider, rawModelId: string, payload: { messages: ChatMessage[]; tools?: any[]; tool_choice?: 'auto' | 'none'; reasoningEffort?: DeepSeekReasoningEffort; maxOutputTokens?: number; temperature?: number; topP?: number; topLogprobs?: number; text?: Record<string, unknown>; safetyCheck?: DeepSeekSafetyCheck; title?: DeepSeekResponseTitle; user?: string }, signal?: AbortSignal) {
  if (is65535ClaudeModelProvider(provider, rawModelId)) {
    const { invokeClaudeCodeProvider } = await import('./claude-code-provider');
    const messages = await prepareProviderChatMessages(payload.messages, preparePublicMediaUrl, { prepareDataUrls: false });
    return invokeClaudeCodeProvider(provider, rawModelId, { ...payload, messages }, signal);
  }
  if (isAgnesProvider(provider)) {
    const request = await agnesChatRequest(provider, rawModelId, payload);
    const data = await fetchJson(request.endpoint, { method: 'POST', headers: { ...agnesTextHeaders(provider, request.protocol), 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }, 180000, signal);
    return normalizeAgnesResponse(data, request.protocol);
  }
  if (provider.platform === 'deepseek' && deepSeekResponsesModel(rawModelId) === 'deepseek-v4-pro' && deepSeekMessagesContainImage(payload.messages)) {
    throw new Error('DeepSeek deepseek-v4-pro 不支持图像输入；图生文请切换到 deepseek-flash');
  }
  if (supportsDeepSeekResponsesInput(provider, rawModelId, payload.messages)) {
    const messages = await prepareProviderChatMessages(payload.messages, preparePublicMediaUrl, { prepareDataUrls: false });
    const data = await requestDeepSeekResponses(provider, rawModelId, messages, {
      tools: payload.tools,
      tool_choice: payload.tool_choice,
      reasoningEffort: payload.reasoningEffort,
      maxOutputTokens: payload.maxOutputTokens,
      temperature: payload.temperature,
      topP: payload.topP,
      topLogprobs: payload.topLogprobs,
      text: payload.text,
      safetyCheck: payload.safetyCheck,
      title: payload.title,
      user: payload.user,
    }, signal);
    return normalizeDeepSeekResponsesResponse(data, rawModelId);
  }
  // OpenAI-compatible providers accept inline image data URLs. Keep them
  // inline; only local paths are promoted to a public relay URL.
  const messages = await prepareProviderChatMessages(payload.messages, preparePublicMediaUrl, { prepareDataUrls: false });
  const data = await fetchJson(providerEndpoint(provider, provider.chatPath, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: rawModelId,
      messages,
      ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.tool_choice || 'auto' } : {}),
    }),
  }, 180000, signal);
  return unwrapProviderData(provider, data);
}

export async function responsesCompletion(
  provider: RuntimeProvider,
  rawModelId: string,
  input: DeepSeekResponsesInput,
  options: DeepSeekResponsesOptions & { signal?: AbortSignal } = {},
) {
  if (isAgnesProvider(provider)) {
    const messages: ChatMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : Array.from(input as readonly ChatMessage[]);
    const request = await agnesChatRequest(provider, rawModelId, { messages, tools: options.tools ? [...options.tools] : undefined }, { stream: options.stream });
    if (options.stream) return fetchStreamingResponse(request.endpoint, { method: 'POST', headers: { ...agnesTextHeaders(provider, request.protocol), 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }, body: JSON.stringify(request.body) }, 180000, options.signal);
    return normalizeAgnesResponse(await fetchJson(request.endpoint, { method: 'POST', headers: { ...agnesTextHeaders(provider, request.protocol), 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }, 180000, options.signal), request.protocol);
  }
  const preparedInput = provider.platform === 'deepseek'
    ? await prepareDeepSeekResponsesInput(input)
    : typeof input === 'string'
      ? input
      : await prepareProviderChatMessages(input as ChatMessage[], preparePublicMediaUrl, { prepareDataUrls: false });
  if (provider.platform === 'deepseek') {
    return requestDeepSeekResponses(provider, rawModelId, preparedInput, options, options.signal);
  }
  const body: Record<string, unknown> = {
    model: rawModelId,
    input: preparedInput,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.stream ? { stream: true } : {}),
  };
  const endpoint = providerEndpoint(provider, provider.responsesPath, '/responses');
  if (options.stream) {
    return fetchStreamingResponse(endpoint, {
      method: 'POST',
      headers: { ...authHeaders(provider), 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      body: JSON.stringify(body),
    }, 180000, options.signal);
  }
  try {
    return await fetchJson(endpoint, {
      method: 'POST',
      headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 180000);
  } catch (error) {
    const fallback = endpoint.replace(/\/v1\/responses\/?$/i, '/responses');
    if (fallback === endpoint) throw error;
    return fetchJson(fallback, {
      method: 'POST',
      headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 180000);
  }
}

async function fetchStreamingResponse(url: string, init: RequestInit, timeout: number, signal?: AbortSignal) {
  // The transport deadline only covers waiting for response headers. Once the
  // headers arrive, the response body is governed by the caller's signal and
  // the Agent stream lifecycle, not by the header timer.
  const method = String(init.method || 'GET').toUpperCase();
  const parentSignal = signal || init.signal || undefined;
  const timeoutController = new AbortController();
  const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const timeoutId = setTimeout(() => timeoutController.abort(timeoutError), timeout);
  const requestSignal = parentSignal
    ? combineStreamSignals(parentSignal, timeoutController.signal)
    : timeoutController.signal;
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: requestSignal,
    });
    if (!response.ok) {
      const text = await response.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      throw providerResponseError(response.status, data, text, requestIdFrom(data, text, response.headers));
    }
    return response;
  } catch (error) {
    if (parentSignal?.aborted) throw parentSignal.reason || error;
    if (timeoutController.signal.aborted) throw providerTimeoutFailure(url, timeout, method);
    if (error instanceof Error && (error as ProviderFailure).providerResponse) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || /timed out/i.test(error.message))) {
      throw providerTimeoutFailure(url, timeout, method);
    }
    throw connectionFailure(url, error, method);
  } finally {
    clearTimeout(timeoutId);
  }
}

export { fetchStreamingResponse };

export async function chatCompletionStream(provider: RuntimeProvider, rawModelId: string, payload: { messages: ChatMessage[]; tools?: any[]; tool_choice?: 'auto' | 'none'; reasoningEffort?: DeepSeekReasoningEffort; maxOutputTokens?: number; temperature?: number; topP?: number; topLogprobs?: number; text?: Record<string, unknown>; safetyCheck?: DeepSeekSafetyCheck; title?: DeepSeekResponseTitle; user?: string }, signal?: AbortSignal) {
  if (is65535ClaudeModelProvider(provider, rawModelId)) {
    const data = await chatCompletion(provider, rawModelId, payload, signal);
    const encoder = new TextEncoder();
    const message = data?.choices?.[0]?.message;
    const chunks: unknown[] = [];
    if (typeof message?.content === 'string' && message.content) {
      chunks.push({ model: data?.model || rawModelId, choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }] });
    }
    for (const [index, call] of (Array.isArray(message?.tool_calls) ? message.tool_calls : []).entries()) {
      chunks.push({ model: data?.model || rawModelId, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } }] }, finish_reason: null }] });
    }
    chunks.push({ model: data?.model || rawModelId, choices: [{ index: 0, delta: {}, finish_reason: message?.tool_calls?.length ? 'tool_calls' : 'stop' }] });
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (provider.platform === 'deepseek' && deepSeekResponsesModel(rawModelId) === 'deepseek-v4-pro' && deepSeekMessagesContainImage(payload.messages)) {
    throw new Error('DeepSeek deepseek-v4-pro 不支持图像输入；图生文请切换到 deepseek-flash');
  }
  if (supportsDeepSeekResponsesInput(provider, rawModelId, payload.messages)) {
    const messages = await prepareProviderChatMessages(payload.messages, preparePublicMediaUrl, { prepareDataUrls: false });
    const response = await requestDeepSeekResponses(provider, rawModelId, messages, {
      tools: payload.tools,
      tool_choice: payload.tool_choice,
      stream: true,
      reasoningEffort: payload.reasoningEffort,
      maxOutputTokens: payload.maxOutputTokens,
      temperature: payload.temperature,
      topP: payload.topP,
      topLogprobs: payload.topLogprobs,
      text: payload.text,
      safetyCheck: payload.safetyCheck,
      title: payload.title,
      user: payload.user,
    }, signal);
    return normalizeDeepSeekChatStream(response as Response, rawModelId);
  }
  if (isAgnesProvider(provider) && agnesTextProtocol(provider) !== 'chat-completions') {
    const data = await chatCompletion(provider, rawModelId, payload, signal);
    const encoder = new TextEncoder();
    const chunk = { model: data?.model || rawModelId, choices: [{ delta: { content: data?.choices?.[0]?.message?.content || '' }, index: 0 }] };
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (isAgnesProvider(provider)) {
    const request = await agnesChatRequest(provider, rawModelId, payload, { stream: true });
    return fetchStreamingResponse(request.endpoint, { method: 'POST', headers: { ...agnesTextHeaders(provider, request.protocol), 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }, body: JSON.stringify(request.body) }, 180000, signal);
  }
  const messages = await prepareProviderChatMessages(payload.messages, preparePublicMediaUrl, { prepareDataUrls: false });
  return fetchStreamingResponse(providerEndpoint(provider, provider.chatPath, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
    body: JSON.stringify({
      model: rawModelId,
      messages,
      stream: true,
      ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.tool_choice || 'auto' } : {}),
    }),
  }, 180000, signal);
}
