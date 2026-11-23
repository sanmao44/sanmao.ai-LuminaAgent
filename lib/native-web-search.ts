import type { ChatMessage } from './providers';
import { deepSeekToolFetch, deepSeekToolSearch, type DeepSeekToolSearchResult } from './providers';
import type { NativeSearchOverride, NativeSearchProtocol, ProviderPlatform, RegistryModel } from './types';
import { inferNativeSearch } from './native-search-detection';

type NativeSearchProvider = {
  type?: string;
  platform?: ProviderPlatform;
  baseUrl: string;
  apiKey: string;
  chatPath?: string;
  responsesPath?: string;
  authHeader?: string;
  authPrefix?: string;
};

type NativeSearchModel = Pick<RegistryModel, 'rawId' | 'displayName' | 'capabilities' | 'nativeSearchProtocol'>;

export type NativeSearchCitation = { title: string; url: string; snippet?: string };

export type NativeSearchResult = {
  source: 'native';
  protocol: NativeSearchProtocol;
  modelId: string;
  provider: string;
  query: string;
  text: string;
  citations: NativeSearchCitation[];
  resultCount: number;
  searchRequestCount?: number;
  fetchedCount?: number;
  warnings?: string[];
  searchedAt: string;
};

const NATIVE_PROTOCOLS = new Set<NativeSearchProtocol>(['openai-responses', 'deepseek-tools', 'gemini-grounding', 'native-chat']);

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => textFromValue(item)).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (Array.isArray(item.content)) return textFromValue(item.content);
  if (Array.isArray(item.parts)) return textFromValue(item.parts);
  return '';
}

function normalizeUrl(value: unknown) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function uniqueCitations(items: NativeSearchCitation[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 24);
}

function citationsFromValue(value: unknown, output: NativeSearchCitation[] = [], depth = 0): NativeSearchCitation[] {
  if (!value || depth > 8) return output;
  if (typeof value === 'string') {
    const url = normalizeUrl(value);
    if (url) output.push({ title: url, url });
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) citationsFromValue(item, output, depth + 1);
    return output;
  }
  if (typeof value !== 'object') return output;
  const item = value as Record<string, unknown>;
  const url = normalizeUrl(item.url || item.uri || item.href || item.source_url || item.sourceUrl);
  const title = String(item.title || item.name || item.text || url).trim();
  if (url) output.push({ title: title.slice(0, 240) || url, url, ...(typeof item.snippet === 'string' ? { snippet: item.snippet.slice(0, 700) } : {}) });
  for (const [key, child] of Object.entries(item)) {
    if (/^(?:id|type|message|model|query|created|status)$/i.test(key)) continue;
    citationsFromValue(child, output, depth + 1);
  }
  return output;
}

function citationsFromText(text: string) {
  return [...text.matchAll(/https?:\/\/[^\s)\]}>"']+/gi)].map((match) => ({ title: match[0], url: match[0].replace(/[.,;:!?]+$/, '') }));
}

function cleanCitations(value: unknown, text = '') {
  return uniqueCitations([...citationsFromValue(value), ...citationsFromText(text)]);
}

export function resolveNativeSearchProtocol(provider: NativeSearchProvider, model: NativeSearchModel): NativeSearchProtocol | null {
  if (!model.capabilities.includes('web-search')) return null;
  if (provider.platform === 'deepseek') return 'deepseek-tools';
  if (model.nativeSearchProtocol && NATIVE_PROTOCOLS.has(model.nativeSearchProtocol)) return model.nativeSearchProtocol;
  const inferred = inferNativeSearch(model.rawId, provider.platform);
  if (inferred.protocol) return inferred.protocol;
  return model.capabilities.includes('web-search')
    ? provider.platform === 'google-gemini' ? 'gemini-grounding' : 'openai-responses'
    : null;
}

export function nativeSearchIsEnabled(model: NativeSearchModel) {
  return model.capabilities.includes('web-search');
}

function endpoint(provider: NativeSearchProvider, configured: string | undefined, fallback: string) {
  const target = String(configured || fallback).trim();
  if (/^https?:\/\//i.test(target)) return target.replace(/\/+$/, '');
  return `${String(provider.baseUrl || '').replace(/\/+$/, '')}${target.startsWith('/') ? target : `/${target}`}`;
}

function authHeaders(provider: NativeSearchProvider) {
  const header = provider.authHeader?.trim() || 'Authorization';
  const prefix = provider.authPrefix ?? 'Bearer ';
  return { [header]: `${prefix}${provider.apiKey}` };
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

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new Error('请求已取消');
}

async function requestJson(url: string, init: RequestInit, signal?: AbortSignal) {
  throwIfAborted(signal);
  const response = await fetch(url, { ...init, cache: 'no-store', signal: combineSignals(signal, 180000) });
  const raw = await response.text();
  throwIfAborted(signal);
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) {
    const error = new Error(String(data?.error?.message || data?.error || data?.message || raw || `HTTP ${response.status}`));
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

function messagesToText(messages: ChatMessage[]) {
  return messages.map((message) => {
    const content = textFromValue(message.content);
    return `${message.role.toUpperCase()}: ${content}`;
  }).filter((value) => !/^\w+:\s*$/.test(value)).join('\n\n');
}

function messagesToGemini(messages: ChatMessage[]) {
  const system = messages.filter((message) => message.role === 'system').map((message) => textFromValue(message.content)).filter(Boolean).join('\n\n');
  const contents = messages.filter((message) => message.role !== 'system' && message.role !== 'tool').map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: textFromValue(message.content) }],
  })).filter((item) => item.parts[0].text);
  return { system, contents };
}

const INTERNAL_PROCESS_LINE = /^\s*(?:the user is asking|according to my instructions|current date is|i(?:'|’)ve got|i have (?:a |good |search )|let me (?:call|open|search|compile|also)|i should (?:organize|present|note)|i need to|i(?:'|’)ll|we need to|searching for|search results|key items verified|reasoning|analysis|plan)\b/i;

/**
 * Native search providers sometimes put the planner/reasoning transcript in
 * the same field as the answer. That transcript is useful neither as a user
 * answer nor as grounding context for the final response.
 */
export function stripNativeSearchProcess(value: unknown) {
  let text = textFromValue(value)
    .replace(/<(?:(?:think|analysis|reasoning|scratchpad)>)[\s\S]*?<\/(?:think|analysis|reasoning|scratchpad)>/gi, '')
    .replace(/```(?:thinking|analysis|reasoning)[\s\S]*?```/gi, '')
    .trim();
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (INTERNAL_PROCESS_LINE.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function outputMessageText(data: any) {
  if (!Array.isArray(data?.output)) return '';
  return data.output
    .filter((item: any) => {
      const type = String(item?.type || '').toLowerCase();
      return !/(reasoning|analysis|scratchpad|tool|function_call|web_search_call)/i.test(type);
    })
    .map((item: any) => textFromValue(item?.content || item?.text || item))
    .filter(Boolean)
    .join('\n');
}

function openAiText(data: any) {
  const outputText = outputMessageText(data);
  const raw = outputText || data?.output_text || data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  return stripNativeSearchProcess(raw);
}

async function openAiResponsesSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[], signal?: AbortSignal) {
  const url = endpoint(provider, provider.responsesPath, '/responses');
  const headers = { ...authHeaders(provider), 'Content-Type': 'application/json' };
  const base = { model: model.rawId, input: messages.map((message) => ({ role: message.role, content: textFromValue(message.content) })), stream: false };
  let data: any;
  try {
    data = await requestJson(url, { method: 'POST', headers, body: JSON.stringify({ ...base, tools: [{ type: 'web_search' }] }) }, signal);
  } catch (error) {
    throwIfAborted(signal);
    const status = Number((error as Error & { status?: number }).status || 0);
    if (![400, 404, 422].includes(status)) throw error;
    data = await requestJson(url, { method: 'POST', headers, body: JSON.stringify({ ...base, tools: [{ type: 'web_search_preview' }] }) }, signal);
  }
  const text = openAiText(data);
  const citations = cleanCitations(data, text);
  if (!citations.length) throw new Error('原生 Responses 搜索没有返回可核验的来源');
  return { text, citations };
}

function latestUserText(messages: ChatMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  return latest ? textFromValue(latest.content).trim() : '';
}

function directUserUrl(value: string) {
  const candidate = value.match(/https?:\/\/[^\s<>"'\])}]+/i)?.[0]?.replace(/[),.;!?，。！？、；：]+$/u, '') || '';
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password ? candidate : '';
  } catch { return ''; }
}

function deepSeekSearchQuery(query: string) {
  const value = Array.from(query.trim()).slice(0, 128).join('');
  return value || '网页搜索';
}

function searchRowsText(rows: Array<{ result: DeepSeekToolSearchResult; page?: string }>) {
  return rows.map(({ result, page }, index) => [
    `${index + 1}. ${result.title}`,
    result.summary || result.snippet ? `摘要：${result.summary || result.snippet}` : '',
    page ? `网页正文：${page.slice(0, 12000)}` : result.content ? `正文片段：${result.content.slice(0, 12000)}` : '',
    `来源：${result.url}`,
  ].filter(Boolean).join('\n')).join('\n\n');
}

async function deepSeekToolsSearch(provider: NativeSearchProvider, messages: ChatMessage[], query: string, signal?: AbortSignal) {
  const userText = latestUserText(messages);
  const url = directUserUrl(userText) || directUserUrl(query);
  if (url) {
    const page = await deepSeekToolFetch(provider, url, signal);
    const hasContent = Boolean(page.content.trim());
    if (!hasContent) {
      return {
        text: '',
        citations: [],
        resultCount: 0,
        searchRequestCount: 0,
        fetchedCount: 0,
        warnings: ['网页抓取未返回正文，未计入成功 Fetch。'],
      };
    }
    return {
      text: `${page.title || url}\n${hasContent ? `网页正文：${page.content.slice(0, 24000)}` : '网页抓取未返回正文。'}\n来源：${url}`,
      citations: [{ title: page.title || url, url }],
      resultCount: 1,
      searchRequestCount: 0,
      fetchedCount: hasContent ? 1 : 0,
      warnings: hasContent ? [] : ['网页抓取未返回正文，未计入成功 Fetch。'],
    };
  }

  const searchQuery = deepSeekSearchQuery(query || userText);
  const originalQuestion = Array.from(userText || query).slice(0, 128).join('') || null;
  const response = await deepSeekToolSearch(provider, {
    query: searchQuery,
    count: 10,
    ori_question: originalQuestion,
    need_content: true,
  }, signal);
  const rows = response.results.slice(0, 10);
  // Search billing is based on the upstream HTTP response: a successful
  // response with a non-empty raw `results` array is billable even when every
  // row is later discarded by adapter validation. Preserve that signal rather
  // than deriving it from the normalized/citation rows.
  if (!rows.length) return {
    text: '',
    citations: [],
    resultCount: 0,
    searchRequestCount: response.searchRequestCount || 0,
    fetchedCount: 0,
    warnings: [] as string[],
  };

  const fetchRows = rows
    .slice(0, 3)
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => !String(result.content || '').trim());
  let emptyFetchCount = 0;
  const fetchedPages = await Promise.all(fetchRows.map(async ({ result, index }) => {
    try {
      const fetched = await deepSeekToolFetch(provider, result.url, signal);
      if (!fetched.content.trim()) {
        emptyFetchCount += 1;
        return null;
      }
      return { index, page: { title: fetched.title, content: fetched.content } };
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      return null;
    }
  }));
  const fetchedByIndex = new Map(fetchedPages.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).map((entry) => [entry.index, entry.page]));
  const warnings = fetchedPages.some((page) => !page)
    ? [emptyFetchCount ? '部分搜索结果网页抓取失败或未返回正文，已保留搜索摘要。' : '部分搜索结果网页抓取失败，已保留搜索摘要。']
    : [];
  const normalized = rows.map((result, index) => ({
    result,
    ...(fetchedByIndex.get(index) ? { page: fetchedByIndex.get(index)!.content } : {}),
  }));
  const citations = uniqueCitations(rows.map((result) => ({
    title: result.title,
    url: result.url,
    ...(result.summary || result.snippet ? { snippet: String(result.summary || result.snippet).slice(0, 700) } : {}),
  })));
  return {
    text: searchRowsText(normalized),
    citations,
    resultCount: citations.length,
    searchRequestCount: response.searchRequestCount || 0,
    fetchedCount: fetchedPages.filter(Boolean).length,
    warnings,
  };
}

async function geminiSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[], signal?: AbortSignal) {
  const { system, contents } = messagesToGemini(messages);
  const root = String(provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai')
    .replace(/\/openai\/?$/i, '')
    .replace(/\/+$/, '');
  const url = `${root}/models/${encodeURIComponent(model.rawId)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
  const base = { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents };
  let data: any;
  try {
    data = await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, tools: [{ google_search: {} }] }) }, signal);
  } catch (error) {
    throwIfAborted(signal);
    const status = Number((error as Error & { status?: number }).status || 0);
    if (![400, 404, 422].includes(status)) throw error;
    data = await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, tools: [{ google_search_retrieval: {} }] }) }, signal);
  }
  const candidate = data?.candidates?.[0];
  const text = stripNativeSearchProcess(candidate?.content?.parts || candidate?.content || data?.text);
  const citations = cleanCitations(candidate?.groundingMetadata || data?.groundingMetadata || data, text);
  if (!citations.length) throw new Error('Gemini 原生搜索没有返回可核验的来源');
  return { text, citations };
}

async function nativeChatSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[], signal?: AbortSignal) {
  const data = await requestJson(endpoint(provider, provider.chatPath, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.rawId, messages }),
  }, signal);
  const text = openAiText(data);
  const citations = cleanCitations(data?.citations || data, text);
  if (!citations.length) throw new Error('原生搜索模型没有返回可核验的来源');
  return { text, citations };
}

export async function runNativeWebSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[], query: string, signal?: AbortSignal): Promise<NativeSearchResult> {
  throwIfAborted(signal);
  const protocol = resolveNativeSearchProtocol(provider, model);
  if (!protocol) throw new Error('当前模型没有可用的原生搜索协议');
  const result = protocol === 'deepseek-tools'
    ? await deepSeekToolsSearch(provider, messages, query, signal)
    : protocol === 'gemini-grounding'
      ? await geminiSearch(provider, model, messages, signal)
      : protocol === 'native-chat'
        ? await nativeChatSearch(provider, model, messages, signal)
        : await openAiResponsesSearch(provider, model, messages, signal);
  const fetchedCount = 'fetchedCount' in result && typeof result.fetchedCount === 'number' ? result.fetchedCount : undefined;
  const searchRequestCount = 'searchRequestCount' in result && typeof result.searchRequestCount === 'number' ? result.searchRequestCount : undefined;
  const warnings = 'warnings' in result && Array.isArray(result.warnings)
    ? result.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
  return {
    source: 'native',
    protocol,
    modelId: model.rawId,
    provider: String(provider.platform || provider.type || 'native'),
    query: query.trim().slice(0, 320),
    text: result.text,
    citations: result.citations,
    resultCount: result.citations.length,
    ...(searchRequestCount !== undefined ? { searchRequestCount } : {}),
    ...(fetchedCount !== undefined ? { fetchedCount } : {}),
    ...(warnings.length ? { warnings } : {}),
    searchedAt: new Date().toISOString(),
  };
}
