import type { GeneratedImage, ModelCapability, ProviderPlatform, ProviderTextProtocol, ProviderType } from './types';
import { inferNativeSearch } from './native-search-detection';
import { inferModelKind } from './model-kind';
import { agnesModelCatalog } from './agnes';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  videoTransport?: 'auto' | 'native-task' | 'openai-videos' | 'jimeng-cli' | 'agnes-videos';
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
};

export type DiscoveredModel = {
  id: string;
  name?: string;
  capabilities?: ModelCapability[];
  nativeSearchProtocol?: 'openai-responses' | 'gemini-grounding' | 'native-chat';
  nativeSearchDetection?: 'metadata' | 'model-id' | 'provider' | 'manual';
  billing?: 'free' | 'paid' | 'temporary-free';
  enabledByDefault?: boolean;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

async function prepareAgnesMediaUrl(value: string, kind: 'image' | 'video' | 'audio') {
  const input = String(value || '').trim();
  if (!input || (/^https?:\/\//i.test(input) && !isLocalAgnesMediaUrl(input))) return input;
  return (await import('./signed-media')).prepareAgnesMediaUrl(input, kind);
}

function isLocalAgnesMediaUrl(value: string) {
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

async function prepareAgnesChatMessages<T extends { content: unknown }>(messages: T[]) {
  return Promise.all(messages.map(async (message) => {
    if (!Array.isArray(message.content)) return message;
    const content = await Promise.all(message.content.map(async (part: any) => {
      if (part?.type === 'image_url' && typeof part?.image_url?.url === 'string') {
        return { ...part, image_url: { ...part.image_url, url: await prepareAgnesMediaUrl(part.image_url.url, 'image') } };
      }
      if (part?.type === 'video_url' && typeof part?.video_url?.url === 'string') {
        return { ...part, video_url: { ...part.video_url, url: await prepareAgnesMediaUrl(part.video_url.url, 'video') } };
      }
      return part;
    }));
    return { ...message, content };
  }));
}

function jimengCommand(explicit?: string) {
  const profile = process.env.USERPROFILE || os.homedir();
  const candidates = [explicit, process.env.JIMENG_CLI_PATH, path.join(profile, 'bin', 'dreamina.exe'), path.join(profile, 'bin', 'dreamina.cmd'), path.join(profile, '.local', 'bin', 'dreamina.exe'), path.join(profile, '.local', 'bin', 'dreamina.cmd'), process.platform === 'win32' ? 'dreamina.exe' : 'dreamina', process.platform === 'win32' ? 'dreamina.cmd' : 'dreamina'].map((value) => String(value || '').trim()).filter(Boolean);
  return candidates.find((value) => path.isAbsolute(value) ? existsSync(value) : value === explicit || value === process.env.JIMENG_CLI_PATH || /^(dreamina)(\.exe|\.cmd)?$/i.test(value)) || candidates[0] || 'dreamina';
}

function discoveredModelCapabilities(item: any, provider?: RuntimeProvider, id = ''): ModelCapability[] {
  const raw = [item?.capabilities, item?.features, item?.supported_tools, item?.tools, item?.tool_support, item?.modalities, item?.metadata, item?.endpoints, item?.endpoint, item?.operations, item?.pricing, item?.pricing_info]
    .filter(Boolean);
  const text = raw.length ? JSON.stringify(raw).toLowerCase() : '';
  const capabilities: ModelCapability[] = [];
  if (/(^|[\[\s,"':])video([_ -]|$)|\/videos?(?:[/?"'\s]|$)|text[-_ ]to[-_ ]video|image[-_ ]to[-_ ]video|video[-_ ]generation|video_generation|frames2video|multimodal2video/.test(text)) {
    capabilities.push('video-generate');
    if (/edit|modify|reference_video/.test(text)) capabilities.push('video-edit');
    if (/extend|continu/.test(text)) capabilities.push('video-extend');
    if (/first[_ -]?frame|image2video|first_frame/.test(text)) capabilities.push('video-first-frame');
    if (/reference|multiframe|images/.test(text)) capabilities.push('video-reference');
    if (/audio|sound/.test(text)) capabilities.push('video-audio');
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
  return capabilities;
}

function trimSlash(value: string) { return value.replace(/\/+$/, ''); }

const providerResponseMeta = Symbol('providerResponseMeta');

type ProviderResponseMeta = {
  contentType: string;
  byteLength: number;
  requestId?: string;
};

type ProviderFailureKind = 'http' | 'transport' | 'timeout';
type ProviderFailure = Error & {
  providerResponse?: boolean;
  providerFailureKind?: ProviderFailureKind;
  status?: number;
  providerStatus?: number;
  providerRequestId?: string;
  providerUrl?: string;
  providerMethod?: string;
  providerPossiblyAccepted?: boolean;
};

function attachProviderResponseMeta(value: any, meta: ProviderResponseMeta) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
  try { Object.defineProperty(value, providerResponseMeta, { value: meta, enumerable: false }); } catch { /* best effort */ }
  return value;
}

function imageMimeFromBytes(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a')) return 'image/gif';
  return '';
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

async function parseResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const requestId = requestIdFrom(null, '', response.headers);
  const imageMime = imageMimeFromContentType(contentType) || imageMimeFromBytes(bytes);
  if (response.ok && imageMime && bytes.length) {
    return attachProviderResponseMeta(`data:${imageMime};base64,${Buffer.from(bytes).toString('base64')}`, { contentType, byteLength: bytes.byteLength, requestId });
  }
  const text = Buffer.from(bytes).toString('utf8');
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  const responseRequestId = requestIdFrom(data, text, response.headers);
  if (!response.ok) {
    throw providerResponseError(response.status, data, text, responseRequestId);
  }
  return attachProviderResponseMeta(data, { contentType, byteLength: bytes.byteLength, requestId: responseRequestId });
}

function providerResponseError(status: number, data: any, text: string, requestId = '') {
  if (status === 413) {
    const error = new Error('请求内容过大：参考图片总大小超过服务商限制，请减少图片数量或重新上传后重试。');
    return decorateProviderFailure(error, { providerResponse: true, providerFailureKind: 'http', status, providerStatus: status, providerRequestId: requestId });
  }
  const detail = data?.error?.message || data?.error || data?.message || text || `HTTP ${status}`;
  const detailText = typeof detail === 'string' ? detail.slice(0, 900) : JSON.stringify(detail).slice(0, 900);
  const prefix = status === 401
    ? 'API Key 无效、已过期或未被服务商接受'
    : status === 403
      ? 'API Key 没有访问该接口的权限'
      : `服务商接口返回 HTTP ${status}`;
  const suffix = requestId ? `（request id: ${requestId}）` : '';
  const error = new Error(`${prefix}：${detailText}${suffix}`);
  return decorateProviderFailure(error, {
    providerResponse: true,
    providerFailureKind: 'http',
    status,
    providerStatus: status,
    providerRequestId: requestId,
    // A 5xx can be emitted after a gateway has already charged its upstream.
    providerPossiblyAccepted: status >= 500,
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

async function fetchJson(url: string, init: RequestInit, timeout = 120000, signal?: AbortSignal) {
  const method = String(init.method || 'GET').toUpperCase();
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: combineSignals(signal || init.signal || undefined, timeout) });
    const data = await parseResponse(response);
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
  return failure?.providerFailureKind === 'http' && [400, 415, 422].includes(Number(failure.providerStatus || (failure as any).status));
}

type ModelEndpointCandidate = { url: string; inferredBaseUrl?: string };

export function modelEndpointCandidates(provider: RuntimeProvider): ModelEndpointCandidate[] {
  const configuredPath = String(provider.modelsPath || '/models').trim() || '/models';
  const primaryUrl = providerEndpoint(provider, configuredPath, '/models');
  const candidates: ModelEndpointCandidate[] = [{ url: primaryUrl }];
  const baseUrl = runtimeBaseUrl(provider);
  const isDefaultModelsPath = /^\/?models\/?$/i.test(configuredPath);
  const hasVersionSuffix = /\/(?:v\d+(?:\.\d+)?|api\/v\d+(?:\.\d+)?)$/i.test(baseUrl);
  if (isDefaultModelsPath && !hasVersionSuffix) {
    candidates.push({ url: `${baseUrl}/v1/models`, inferredBaseUrl: `${baseUrl}/v1` });
  }
  return candidates.filter((candidate, index, all) => all.findIndex((item) => item.url === candidate.url) === index);
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

function authHeaders(provider: RuntimeProvider, video = false) {
  const header = provider.authHeader?.trim() || 'Authorization';
  const prefix = provider.authPrefix ?? 'Bearer ';
  const key = video ? provider.videoApiKey || provider.apiKey : provider.apiKey;
  return { [header]: `${prefix}${key}` };
}

function isApimartProvider(provider: RuntimeProvider) {
  return provider.platform === 'apimart' || /(^|\.)api\.apimart\.ai$/i.test(new URL(runtimeBaseUrl(provider)).hostname);
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
      return id ? { id, name: id, ...(inferred.protocol ? { nativeSearchProtocol: inferred.protocol, nativeSearchDetection: inferred.detection } : {}), ...(inferred.detected ? { capabilities: ['web-search' as const] } : {}) } : null;
    }
    const id = String(item?.id || item?.model || item?.model_id || item?.modelId || item?.name || item?.slug || '').trim();
    if (!id) return null;
    const name = String(item?.name || item?.display_name || item?.displayName || id).trim() || id;
    const raw = [item?.capabilities, item?.features, item?.supported_tools, item?.tools, item?.tool_support, item?.modalities, item?.metadata, item?.endpoints, item?.endpoint, item?.operations, item?.pricing, item?.pricing_info].filter(Boolean);
    const inferred = inferNativeSearch(id, provider?.platform, raw);
    return {
      id,
      name,
      capabilities: discoveredModelCapabilities(item, provider, id),
      ...(inferred.protocol ? { nativeSearchProtocol: inferred.protocol } : {}),
      ...(inferred.detection ? { nativeSearchDetection: inferred.detection } : {}),
    };
  }).filter(Boolean) as DiscoveredModel[];
  return [...new Map(normalized.map((model) => [model.id, model])).values()];
}

export async function discoverModels(provider: RuntimeProvider) {
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
  if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') {
    const command = jimengCommand(provider.jimengCliPath);
    const cli = await new Promise<{ installed: boolean; version: string; loginHint: string }>((resolve) => {
      const child = spawn(command, ['--version'], { windowsHide: true, shell: command.toLowerCase().endsWith('.cmd') });
      let output = '';
      child.stdout.on('data', (chunk) => { output += String(chunk); });
      child.stderr.on('data', (chunk) => { output += String(chunk); });
      child.on('error', () => resolve({ installed: false, version: '', loginHint: '未检测到即梦 CLI，请按官方安装说明安装后重试' }));
      child.on('close', (code) => resolve({ installed: code === 0, version: output.trim().split(/\r?\n/)[0] || '', loginHint: '请完成一次即梦网页授权后即可生成图片和视频' }));
    });
    if (!cli.installed) throw new Error(`${cli.loginHint}。官方安装命令：curl -fsSL https://jimeng.jianying.com/cli | bash`);
    return { mode: 'cli' as const, count: 0, message: `即梦 CLI 已检测：${cli.version || '版本信息不可用'}；${cli.loginHint}` };
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

function imageReferenceFromString(value: string, key: string, parent: any, forceImage: boolean) {
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
    if (isRawBase64(text)) return [`data:${objectMimeType(parent)};base64,${text.replace(/\s/g, '')}`];
  }
  return [];
}

function extractImages(data: any): GeneratedImage[] {
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
      for (const reference of imageReferenceFromString(value, key, parent, forceImage)) add(reference, inheritedPrompt);
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

export function normalizeProviderImages(data: any): GeneratedImage[] {
  const images = extractImages(data);
  if (!images.length) {
    const meta = data && typeof data === 'object' ? (data as any)[providerResponseMeta] as ProviderResponseMeta | undefined : undefined;
    const typeHint = meta?.contentType ? `，响应类型 ${meta.contentType.split(';', 1)[0]}` : '';
    throw new Error(`服务商已返回成功响应，但没有找到可显示的图片${typeHint}。响应结构：${responseShape(data)}。请确认模型支持图片接口，并检查服务商是否返回了 image_url、b64_json、二进制图片或异步任务结果。`);
  }
  return images;
}

function normalizeImages(data: any): GeneratedImage[] {
  return normalizeProviderImages(data);
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
  const media = await Promise.all(references.map((reference) => prepareAgnesMediaUrl(reference, 'image')));
  const payload = buildAgnesImagePayload(rawModelId, input, media);
  if (input.mask) payload.extra_body.mask = await prepareAgnesMediaUrl(input.mask, 'image');
  const data = await fetchJson(providerEndpoint(provider, provider.imageGenerationPath, '/images/generations'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, IMAGE_REQUEST_TIMEOUT, signal);
  const images = extractImages(data);
  if (images.length) return images.slice(0, Math.max(1, Math.min(8, Number(input.count || 1))));
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
  return String(data?.status || data?.state || data?.data?.status || data?.data?.state || data?.task?.status || data?.data?.task?.status || '').toLowerCase();
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
  return '';
}

async function waitForImageTask(provider: RuntimeProvider, initial: any, signal?: AbortSignal) {
  const taskId = taskIdFrom(initial);
  if (!taskId) return normalizeImages(initial);
  const statusUrl = taskStatusEndpoint(provider, taskId, initial);
  if (!statusUrl) {
    throw new Error(`服务商已接受图片任务 ${taskId}，但没有在响应中提供图片或任务查询地址。请让服务商返回 image_url、b64_json、status_url/result_url，或在接口配置中提供任务查询路径。`);
  }
  const deadline = Date.now() + IMAGE_REQUEST_TIMEOUT;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason || new Error('GENERATION_CANCELLED');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1800);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('GENERATION_CANCELLED')); }, { once: true });
    });
    const data = await fetchJson(statusUrl, { method: 'GET', headers: authHeaders(provider) }, 30000, signal);
    const images = extractImages(data);
    if (images.length) return images;
    const status = taskStatusFrom(data);
    if (/(fail|error|cancel|reject|expired)/.test(status)) {
      throw new Error(String(data?.error?.message || data?.error_message || data?.error || data?.message || `图片任务失败：${status}`));
    }
  }
  throw new Error(`图片任务 ${taskId} 等待超时，请稍后到服务商控制台查看任务状态`);
}

async function waitForApimartTask(provider: RuntimeProvider, initial: any, signal?: AbortSignal) {
  const taskId = taskIdFrom(initial);
  if (!taskId) throw new Error('APIMart 没有返回图片任务编号');
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason || new Error('GENERATION_CANCELLED');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1800);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('GENERATION_CANCELLED')); }, { once: true });
    });
    const response = await fetchJson(providerEndpoint(provider, `/tasks/${encodeURIComponent(taskId)}`, `/tasks/${encodeURIComponent(taskId)}`), { method: 'GET', headers: authHeaders(provider) }, 30000, signal);
    const data = unwrapProviderData(provider, response);
    const images = extractImages(data);
    if (images.length) return images;
    const status = taskStatusFrom(data);
    if (/(fail|error|cancel|reject)/.test(status)) throw new Error(String(data?.error?.message || data?.error_message || data?.error || data?.message || `APIMart 图片任务失败：${status}`));
  }
  throw new Error('APIMart 图片任务等待超时，请稍后到服务商后台查看任务状态');
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
    if (images.length) return images;
    const status = taskStatusFrom(data);
    if (/(fail|error|cancel|reject)/.test(status)) throw new Error(String(data?.error_message || data?.error?.message || data?.error || data?.message || `超分任务失败：${status}`));
  }
  throw new Error('图片超分任务等待超时，请稍后到服务商控制台查看任务状态');
}

export async function generateImage(provider: RuntimeProvider, rawModelId: string, input: { prompt: string; aspectRatio?: string; count?: number; width?: number; height?: number; quality?: string; resolution?: string; outputFormat?: 'png' | 'jpeg' | 'webp'; responseFormat?: 'url' | 'b64_json'; background?: 'transparent' | 'opaque' }, signal?: AbortSignal): Promise<GeneratedImage[]> {
  if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') return (await import('./jimeng-image')).runJimengImage(provider, rawModelId, input, [], signal);
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
  if (isAgnesProvider(provider)) return generateAgnesImage(provider, rawModelId, input, [], signal);
  const body: Record<string, unknown> = {
    model: rawModelId,
    prompt: input.prompt,
    n: count,
    size: mapRatioToSize(input.aspectRatio || '自动', input.width, input.height),
  };
  if (input.quality && input.quality !== '自动') body.quality = input.quality;
  if (input.resolution && input.aspectRatio === '自动') body.resolution = input.resolution;
  if (isApimartProvider(provider) && input.resolution && input.resolution !== '自动') body.resolution = String(input.resolution).toLowerCase();
  if (input.outputFormat) body.output_format = input.outputFormat;
  if (input.background) body.background = input.background;
  if (provider.type === 'google-gemini') body.response_format = 'b64_json';
  const endpoint = providerEndpoint(provider, provider.imageGenerationPath, '/images/generations');
  const request = (payload: Record<string, unknown>) => fetchJson(endpoint, {
    method: 'POST', headers: { ...authHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }, IMAGE_REQUEST_TIMEOUT, signal);
  if (isApimartProvider(provider)) {
    const batches = await Promise.all(Array.from({ length: count }, async () => waitForApimartTask(provider, await request({ ...body, n: 1 }), signal)));
    return batches.flat().slice(0, count);
  }
  const requestImages = async (payload: Record<string, unknown>) => {
    try {
      const data = await request(payload);
      const images = extractImages(data);
      if (images.length) return images;
      if (taskIdFrom(data)) {
        try { return await waitForImageTask(provider, data, signal); }
        catch (error) { Object.assign(error as object, { providerAcceptedTask: true }); throw error; }
      }
      return normalizeImages(data);
    }
    catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      if ((error as Error & { providerAcceptedTask?: boolean }).providerAcceptedTask) throw error;
      if (!payload.resolution || !canRetryImageRequest(error)) throw error;
      const fallback = { ...payload };
      delete fallback.resolution;
      const data = await request(fallback);
      const images = extractImages(data);
      if (images.length) return images;
      if (taskIdFrom(data)) return waitForImageTask(provider, data, signal);
      return normalizeImages(data);
    }
  };
  let images: GeneratedImage[];
  try { images = await requestImages(body); }
  catch (error) {
    if (signal?.aborted) throw signal.reason || error;
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
  if (/^https?:\/\//i.test(ref) || ref.startsWith('data:image/')) return ref;
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

export type ImageEditInput = { prompt: string; references: string[]; mask?: string; aspectRatio?: string; count?: number; width?: number; height?: number; quality?: string; resolution?: string; fidelity?: 'high' | 'low'; outputFormat?: 'png' | 'jpeg' | 'webp'; responseFormat?: 'url' | 'b64_json'; background?: 'transparent' | 'opaque' };

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
  if (input.resolution && input.aspectRatio === '自动') jsonBody.resolution = input.resolution;
  if (input.fidelity && shouldSendInputFidelity(provider, rawModelId)) jsonBody.input_fidelity = input.fidelity;
  if (input.mask) jsonBody.mask = input.mask;
  if (input.outputFormat) jsonBody.output_format = input.outputFormat;
  if (input.background) jsonBody.background = input.background;
  return jsonBody;
}

export async function editImage(provider: RuntimeProvider, rawModelId: string, input: ImageEditInput, signal?: AbortSignal): Promise<GeneratedImage[]> {
  // Agnes can consume the local storage URL through the signed-media bridge;
  // other providers keep the historical data-URL normalization path.
  const references = (isAgnesProvider(provider) ? input.references : input.references.map(normalizeReference)).slice(0, 16);
  if (!references.length) throw new Error('修改图片至少需要一张参考图');
  if (provider.videoTransport === 'jimeng-cli' || provider.platform === 'jimeng-cli') return (await import('./jimeng-image')).runJimengImage(provider, rawModelId, input, references, signal);
  if (isAgnesProvider(provider)) return generateAgnesImage(provider, rawModelId, input, references, signal);
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
  const size = mapRatioToSize(input.aspectRatio || '自动', input.width, input.height);
  const sendInputFidelity = input.fidelity && shouldSendInputFidelity(provider, rawModelId);
  const jsonBody = buildImageEditRequestBody(provider, rawModelId, input, references, count, size);

  // 新版 Images API 支持 JSON image_url/data URL；优先使用，兼容远程 URL 和多图。
  try {
    const data = await fetchJson(providerEndpoint(provider, provider.imageEditPath, '/images/edits'), {
      method: 'POST', headers: { ...authHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(jsonBody),
    }, IMAGE_REQUEST_TIMEOUT, signal);
    if (isApimartProvider(provider)) return waitForApimartTask(provider, data, signal);
    return normalizeImages(data);
  } catch (jsonError) {
    if (signal?.aborted) throw signal.reason || jsonError;
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
      for (let i = 0; i < references.length; i++) {
        const { blob, filename } = await refToBlob(references[i], i);
        form.append('image', blob, filename);
      }
      if (input.mask) {
        const { blob } = await refToBlob(input.mask, 0);
        form.append('mask', blob, 'mask.png');
      }
      const response = await fetch(providerEndpoint(provider, provider.imageEditPath, '/images/edits'), {
        method: 'POST', headers: authHeaders(provider), body: form, cache: 'no-store', signal: combineSignals(signal, IMAGE_REQUEST_TIMEOUT),
      });
      const data = await parseResponse(response);
      return normalizeImages(data);
    } catch (multipartError) {
      const a = jsonError instanceof Error ? jsonError.message : 'JSON 编辑接口失败';
      const b = multipartError instanceof Error ? multipartError.message : '表单编辑接口失败';
      throw new Error(`图片修改接口调用失败。JSON：${a}；兼容表单：${b}`);
    }
  }
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
    return images.length ? images : await waitForUpscaleTask(provider, data, signal);
  }

  const jsonBodies: Array<Record<string, unknown>> = [
    { model: rawModelId, prompt, image: reference, ...compactParameters },
    { model: rawModelId, prompt, images: [{ image_url: reference }], n: 1, ...compactParameters },
  ];
  for (const body of jsonBodies) {
    try {
      const data = await fetchJson(endpoint, { method: 'POST', headers: { ...authHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, IMAGE_REQUEST_TIMEOUT, signal);
      const images = extractImages(data);
      return images.length ? images : await waitForUpscaleTask(provider, data, signal);
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
    return images.length ? images : await waitForUpscaleTask(provider, data, signal);
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
};

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
  const messages = await prepareAgnesChatMessages(payload.messages);
  const body: Record<string, unknown> = protocol === 'responses'
      ? { model: rawModelId, input: messages, max_output_tokens: 65536, ...(payload.tools?.length ? { tools: payload.tools } : {}), ...(options.stream ? { stream: true } : {}) }
      : protocol === 'messages'
      ? { model: rawModelId, ...serializeAgnesMessages(messages, protocol), max_tokens: 65536, ...(payload.tools?.length ? { tools: payload.tools } : {}), ...(options.stream ? { stream: true } : {}) }
      : { model: rawModelId, messages, max_tokens: 65536, ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.tool_choice || 'auto' } : {}), ...(options.stream ? { stream: true } : {}) };
  return { protocol, body, endpoint: agnesTextEndpoint(provider, protocol) };
}

export async function chatCompletion(provider: RuntimeProvider, rawModelId: string, payload: { messages: ChatMessage[]; tools?: any[]; tool_choice?: 'auto' | 'none' }, signal?: AbortSignal) {
  if (isAgnesProvider(provider)) {
    const request = await agnesChatRequest(provider, rawModelId, payload);
    const data = await fetchJson(request.endpoint, { method: 'POST', headers: { ...agnesTextHeaders(provider, request.protocol), 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }, 180000, signal);
    return normalizeAgnesResponse(data, request.protocol);
  }
  const data = await fetchJson(providerEndpoint(provider, provider.chatPath, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: rawModelId,
      messages: payload.messages,
      ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.tool_choice || 'auto' } : {}),
    }),
  }, 180000, signal);
  return unwrapProviderData(provider, data);
}

export async function responsesCompletion(provider: RuntimeProvider, rawModelId: string, input: string | ChatMessage[], options: { tools?: any[]; stream?: boolean } = {}) {
  if (isAgnesProvider(provider)) {
    const messages: ChatMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    const request = await agnesChatRequest(provider, rawModelId, { messages, tools: options.tools }, { stream: options.stream });
    return normalizeAgnesResponse(await fetchJson(request.endpoint, { method: 'POST', headers: { ...agnesTextHeaders(provider, request.protocol), 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }, 180000), request.protocol);
  }
  const body: Record<string, unknown> = {
    model: rawModelId,
    input,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.stream ? { stream: true } : {}),
  };
  const endpoint = providerEndpoint(provider, provider.responsesPath, '/responses');
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

export async function chatCompletionStream(provider: RuntimeProvider, rawModelId: string, payload: { messages: ChatMessage[]; tools?: any[]; tool_choice?: 'auto' | 'none' }, signal?: AbortSignal) {
  if (isAgnesProvider(provider) && agnesTextProtocol(provider) !== 'chat-completions') {
    const data = await chatCompletion(provider, rawModelId, payload, signal);
    const encoder = new TextEncoder();
    const chunk = { model: data?.model || rawModelId, choices: [{ delta: { content: data?.choices?.[0]?.message?.content || '' }, index: 0 }] };
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (isAgnesProvider(provider)) {
    const request = await agnesChatRequest(provider, rawModelId, payload, { stream: true });
    return fetch(request.endpoint, { method: 'POST', headers: { ...agnesTextHeaders(provider, request.protocol), 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }, body: JSON.stringify(request.body), cache: 'no-store', signal: combineSignals(signal, 180000) }).then(async (response) => {
      if (!response.ok) throw new Error(`Agnes 流式接口返回 HTTP ${response.status}`);
      return response;
    });
  }
  const response = await fetch(providerEndpoint(provider, provider.chatPath, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
    body: JSON.stringify({
      model: rawModelId,
      messages: payload.messages,
      stream: true,
      ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.tool_choice || 'auto' } : {}),
    }),
    cache: 'no-store',
    signal: combineSignals(signal, 180000),
  });
  if (!response.ok) {
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    const detail = data?.error?.message || data?.error || data?.message || text || `HTTP ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail.slice(0, 900) : JSON.stringify(detail).slice(0, 900));
  }
  return response;
}
