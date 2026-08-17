import type { GeneratedImage, ModelCapability, ProviderPlatform, ProviderType } from './types';

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
  authHeader?: string;
  authPrefix?: string;
};

export type DiscoveredModel = { id: string; name?: string; capabilities?: ModelCapability[] };

function discoveredModelCapabilities(item: any): ModelCapability[] {
  const raw = [item?.capabilities, item?.features, item?.supported_tools, item?.tools, item?.tool_support, item?.modalities, item?.metadata]
    .filter(Boolean);
  const text = JSON.stringify(raw).toLowerCase();
  return /web[\s_-]?search|google[\s_-]?search|browser|grounding|search[\s_-]?parameters|search[\s_-]?enabled/.test(text) ? ['web-search'] : [];
}

function trimSlash(value: string) { return value.replace(/\/+$/, ''); }

export function runtimeBaseUrl(provider: RuntimeProvider) {
  if (provider.type === 'google-gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai';
  return trimSlash(provider.baseUrl);
}

function providerEndpoint(provider: RuntimeProvider, path: string | undefined, fallback: string) {
  const target = String(path || fallback).trim();
  if (/^https?:\/\//i.test(target)) return target.replace(/\/+$/, '');
  return `${runtimeBaseUrl(provider)}${target.startsWith('/') ? target : `/${target}`}`;
}

function is65535Provider(provider: RuntimeProvider) {
  return provider.platform === '65535' || /65535\.space/i.test(provider.baseUrl);
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    throw providerResponseError(response.status, data, text);
  }
  return data;
}

function providerResponseError(status: number, data: any, text: string) {
  if (status === 413) {
    const error = new Error('请求内容过大：参考图片总大小超过服务商限制，请减少图片数量或重新上传后重试。');
    Object.assign(error, { providerResponse: true, status });
    return error;
  }
  const detail = data?.error?.message || data?.error || data?.message || text || `HTTP ${status}`;
  const detailText = typeof detail === 'string' ? detail.slice(0, 900) : JSON.stringify(detail).slice(0, 900);
  const prefix = status === 401
    ? 'API Key 无效、已过期或未被服务商接受'
    : status === 403
      ? 'API Key 没有访问该接口的权限'
      : `服务商接口返回 HTTP ${status}`;
  const error = new Error(`${prefix}：${detailText}`);
  Object.assign(error, { providerResponse: true, status });
  return error;
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

function connectionFailure(url: string, error: unknown) {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const source = error instanceof Error ? error : new Error(String(error));
  const cause = source.cause && typeof source.cause === 'object' ? source.cause as { code?: unknown; message?: unknown } : undefined;
  const code = String(cause?.code || '').toUpperCase();
  const detail = String(cause?.message || source.message || '').trim();

  if (source.name === 'TimeoutError' || /TIMEOUT|TIMEDOUT/.test(code) || /timed out/i.test(detail)) {
    return new Error(`无法连接 ${host}：连接超时。请检查服务商 API 地址是否可访问，或确认当前网络、DNS 和防火墙没有拦截该域名。`);
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(code) || /getaddrinfo|dns/i.test(detail)) {
    return new Error(`无法解析 ${host}：DNS 没有返回可用地址。请检查服务商域名是否已生效，或更换网络/DNS 后重试。`);
  }
  if (/CERT|TLS|SSL/.test(code) || /certificate|tls|ssl/i.test(detail)) {
    return new Error(`无法安全连接 ${host}：TLS/证书校验失败。请确认服务商 HTTPS 证书和系统时间正常。`);
  }
  return new Error(`无法连接 ${host}：服务商没有返回响应。请检查 API 地址、服务商网络状态和本机网络。`);
}

async function fetchJson(url: string, init: RequestInit, timeout = 120000, signal?: AbortSignal) {
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: combineSignals(signal || init.signal || undefined, timeout) });
    return parseResponse(response);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error instanceof Error && (error as Error & { providerResponse?: boolean }).providerResponse) throw error;
    throw connectionFailure(url, error);
  }
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
    if (!response.ok) throw providerResponseError(response.status, data, text);
    return { data, contentType: response.headers.get('content-type') || '', text };
  } catch (error) {
    if (error instanceof Error && (error as Error & { providerResponse?: boolean }).providerResponse) throw error;
    throw connectionFailure(url, error);
  }
}

function authHeaders(provider: RuntimeProvider) {
  const header = provider.authHeader?.trim() || 'Authorization';
  const prefix = provider.authPrefix ?? 'Bearer ';
  return { [header]: `${prefix}${provider.apiKey}` };
}

function isApimartProvider(provider: RuntimeProvider) {
  return provider.platform === 'apimart' || /(^|\.)api\.apimart\.ai$/i.test(new URL(runtimeBaseUrl(provider)).hostname);
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

export function normalizeDiscoveredModels(data: any): DiscoveredModel[] {
  const { items } = modelListFromResponse(data);
  const normalized = items.map((item: any) => {
    if (typeof item === 'string' || typeof item === 'number') {
      const id = String(item).trim();
      return id ? { id, name: id } : null;
    }
    const id = String(item?.id || item?.model || item?.model_id || item?.modelId || item?.name || item?.slug || '').trim();
    if (!id) return null;
    const name = String(item?.name || item?.display_name || item?.displayName || id).trim() || id;
    return { id, name, capabilities: discoveredModelCapabilities(item) };
  }).filter(Boolean) as DiscoveredModel[];
  return [...new Map(normalized.map((model) => [model.id, model])).values()];
}

export async function discoverModels(provider: RuntimeProvider) {
  if (isApimartProvider(provider)) return apimartModelCatalog;
  if (provider.type === 'google-gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(provider.apiKey)}`;
    const data = await fetchJson(url, { method: 'GET' }, 20000);
    return (Array.isArray(data?.models) ? data.models : []).map((item: any) => ({
      id: String(item.name || '').replace(/^models\//, ''),
      name: String(item.displayName || item.name || ''),
      capabilities: discoveredModelCapabilities(item),
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
      return normalizeDiscoveredModels(response.data);
    }
    lastUnrecognizedResponse = { contentType: response.contentType, text: response.text, url: candidate.url };
  }
  if (lastUnrecognizedResponse && (/<\s*!doctype|<\s*html/i.test(lastUnrecognizedResponse.text) || /text\/html/i.test(lastUnrecognizedResponse.contentType))) {
    throw new Error(`模型接口返回了网页而不是 JSON：${lastUnrecognizedResponse.url}。请填写服务商的 API 根地址，不要填写控制台网页地址；兼容平台通常应使用 /v1。`);
  }
  throw new Error('服务商返回了成功响应，但其中没有识别到模型列表。支持 data、models、items、list 及其常见嵌套格式，请检查模型接口路径。');
}

export async function testProviderConnection(provider: RuntimeProvider) {
  if (isApimartProvider(provider)) {
    const data = await fetchJson(providerEndpoint(provider, '/balance', '/balance'), { method: 'GET', headers: authHeaders(provider) }, 20000);
    if (data?.success !== true) throw new Error(String(data?.message || 'APIMart 未确认此 API Key 有效'));
    return { mode: 'credential' as const, count: apimartModelCatalog.length, message: data.unlimited_quota ? '连接成功，密钥验证通过，当前密钥额度不限' : '连接成功，密钥验证通过，可读取并使用预置模型' };
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

function extractImages(data: any): GeneratedImage[] {
  const candidates = [
    data?.data,
    data?.images,
    data?.output,
    data?.result,
    data?.result_urls,
    data?.data?.images,
    data?.data?.output,
    data?.data?.result,
    data?.result?.images,
    data?.data?.result?.images,
    data?.output?.images,
    data?.result?.images,
    data?.result?.data,
  ];
  let list: any[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) { list = candidate; break; }
    if (candidate && (typeof candidate === 'string' || candidate.url || candidate.image_url || candidate.output_url || candidate.b64_json || candidate.base64)) { list = [candidate]; break; }
  }
  if (!list.length && (data?.url || data?.image_url || data?.output_url || data?.b64_json || data?.base64)) list = [data];
  const images = list.map((item: any) => {
    if (typeof item === 'string') {
      if (item.startsWith('data:') || item.startsWith('http')) return { url: item };
      return { url: `data:image/png;base64,${item}` };
    }
    if (item?.b64_json) return { url: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt };
    if (item?.base64) return { url: `data:image/png;base64,${item.base64}`, revisedPrompt: item.revised_prompt };
    const url = item?.url || item?.image_url || item?.output_url;
    if (Array.isArray(url) && url[0]) return { url: String(url[0]), revisedPrompt: item.revised_prompt };
    if (url) return { url: String(url), revisedPrompt: item.revised_prompt };
    return null;
  }).filter(Boolean) as GeneratedImage[];
  return images;
}

function normalizeImages(data: any): GeneratedImage[] {
  const images = extractImages(data);
  if (!images.length) throw new Error('服务商没有返回可识别的图片数据（需要 data[].url、data[].b64_json 或兼容字段）');
  return images;
}

function taskIdFrom(data: any) {
  return String(data?.task_id || data?.taskId || data?.data?.task_id || data?.data?.taskId || data?.data?.[0]?.task_id || data?.data?.[0]?.taskId || data?.id || '').trim();
}

function taskStatusFrom(data: any) {
  return String(data?.status || data?.state || data?.data?.status || data?.data?.state || '').toLowerCase();
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
  const deadline = Date.now() + 240000;
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

export async function generateImage(provider: RuntimeProvider, rawModelId: string, input: { prompt: string; aspectRatio?: string; count?: number; width?: number; height?: number; quality?: string; resolution?: string; outputFormat?: 'png' | 'jpeg' | 'webp'; background?: 'transparent' | 'opaque' }, signal?: AbortSignal): Promise<GeneratedImage[]> {
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
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
  }, 240000, signal);
  if (isApimartProvider(provider)) {
    const batches = await Promise.all(Array.from({ length: count }, async () => waitForApimartTask(provider, await request({ ...body, n: 1 }), signal)));
    return batches.flat().slice(0, count);
  }
  const requestImages = async (payload: Record<string, unknown>) => {
    try { return normalizeImages(await request(payload)); }
    catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      if (!payload.resolution) throw error;
      const fallback = { ...payload };
      delete fallback.resolution;
      return normalizeImages(await request(fallback));
    }
  };
  let images: GeneratedImage[];
  try { images = await requestImages(body); }
  catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (count <= 1) throw error;
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

export async function editImage(provider: RuntimeProvider, rawModelId: string, input: { prompt: string; references: string[]; mask?: string; aspectRatio?: string; count?: number; width?: number; height?: number; quality?: string; resolution?: string; fidelity?: 'high' | 'low'; outputFormat?: 'png' | 'jpeg' | 'webp'; background?: 'transparent' | 'opaque' }, signal?: AbortSignal): Promise<GeneratedImage[]> {
  const references = input.references.map(normalizeReference).slice(0, 16);
  if (!references.length) throw new Error('修改图片至少需要一张参考图');
  const count = Math.max(1, Math.min(8, Number(input.count || 1)));
  const size = mapRatioToSize(input.aspectRatio || '自动', input.width, input.height);
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
  if (input.fidelity) jsonBody.input_fidelity = input.fidelity;
  if (input.mask) jsonBody.mask = input.mask;
  if (input.outputFormat) jsonBody.output_format = input.outputFormat;
  if (input.background) jsonBody.background = input.background;

  // 新版 Images API 支持 JSON image_url/data URL；优先使用，兼容远程 URL 和多图。
  try {
    const data = await fetchJson(providerEndpoint(provider, provider.imageEditPath, '/images/edits'), {
      method: 'POST', headers: { ...authHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(jsonBody),
    }, 240000, signal);
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
      if (input.fidelity) form.append('input_fidelity', input.fidelity);
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
        method: 'POST', headers: authHeaders(provider), body: form, cache: 'no-store', signal: combineSignals(signal, 240000),
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
  const reference = normalizeReference(input.reference);
  if (!/^\d+x\d+$/i.test(input.size)) throw new Error('SeedVR2 必须提供 WIDTHxHEIGHT 格式的目标尺寸，例如 2048x2048');
  const prompt = input.prompt?.trim() || 'Upscale this image';
  const endpoint = providerEndpoint(provider, provider.imageUpscalePath || provider.imageEditPath, '/images/edits');
  const errors: string[] = [];
  const parameters: Record<string, unknown> = {
    size: input.size,
    seed: Number.isFinite(input.seed) ? input.seed : 42,
    color_correction: input.colorCorrection || 'wavelet',
    resize_method: input.resizeMethod === 'bicubic' ? 'bicubic' : 'lanczos',
    response_format: 'b64_json',
  };
  const compactParameters = Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined));

  if (/\/v1\/tasks\/?$/i.test(endpoint)) {
    const data = await fetchJson(endpoint, {
      method: 'POST',
      headers: { ...authHeaders(provider), 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ kind: 'image', model: rawModelId, input: { prompt, image: reference, ...compactParameters } }),
    }, 240000, signal);
    const images = extractImages(data);
    return images.length ? images : await waitForUpscaleTask(provider, data, signal);
  }

  const jsonBodies: Array<Record<string, unknown>> = [
    { model: rawModelId, prompt, image: reference, ...compactParameters },
    { model: rawModelId, prompt, images: [{ image_url: reference }], n: 1, ...compactParameters },
  ];
  for (const body of jsonBodies) {
    try {
      const data = await fetchJson(endpoint, { method: 'POST', headers: { ...authHeaders(provider), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 240000, signal);
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
    const response = await fetch(endpoint, { method: 'POST', headers: authHeaders(provider), body: form, cache: 'no-store', signal: combineSignals(signal, 240000) });
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
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: any[];
};

export async function chatCompletion(provider: RuntimeProvider, rawModelId: string, payload: { messages: ChatMessage[]; tools?: any[]; tool_choice?: 'auto' | 'none' }) {
  const data = await fetchJson(providerEndpoint(provider, provider.chatPath, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: rawModelId,
      messages: payload.messages,
      ...(payload.tools?.length ? { tools: payload.tools, tool_choice: payload.tool_choice || 'auto' } : {}),
    }),
  }, 180000);
  return unwrapProviderData(provider, data);
}

export async function responsesCompletion(provider: RuntimeProvider, rawModelId: string, input: string | ChatMessage[], options: { tools?: any[]; stream?: boolean } = {}) {
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

export async function chatCompletionStream(provider: RuntimeProvider, rawModelId: string, payload: { messages: ChatMessage[]; tools?: any[]; tool_choice?: 'auto' | 'none' }) {
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
    signal: AbortSignal.timeout(180000),
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
