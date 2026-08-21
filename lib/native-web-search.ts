import type { ChatMessage } from './providers';
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

type NativeSearchModel = Pick<RegistryModel, 'rawId' | 'displayName' | 'capabilities' | 'nativeSearchProtocol' | 'nativeSearchOverride'>;

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
  searchedAt: string;
};

const NATIVE_PROTOCOLS = new Set<NativeSearchProtocol>(['openai-responses', 'gemini-grounding', 'native-chat']);

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
  if (model.nativeSearchOverride === 'disabled') return null;
  if (model.nativeSearchProtocol && NATIVE_PROTOCOLS.has(model.nativeSearchProtocol)) return model.nativeSearchProtocol;
  const inferred = inferNativeSearch(model.rawId, provider.platform);
  if (inferred.protocol) return inferred.protocol;
  if (model.nativeSearchOverride === 'enabled') {
    if (provider.platform === 'google-gemini' || provider.type === 'google-gemini') return 'gemini-grounding';
    if (/(?:sonar|perplexity)/i.test(model.rawId)) return 'native-chat';
    return 'openai-responses';
  }
  return model.capabilities.includes('web-search') ? (provider.platform === 'google-gemini' ? 'gemini-grounding' : 'openai-responses') : null;
}

export function nativeSearchIsEnabled(model: NativeSearchModel) {
  return model.nativeSearchOverride === 'enabled' || (model.nativeSearchOverride !== 'disabled' && model.capabilities.includes('web-search'));
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

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(180000) });
  const raw = await response.text();
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

async function openAiResponsesSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[]) {
  const url = endpoint(provider, provider.responsesPath, provider.platform === 'deepseek' ? 'https://api.deepseek.com/beta/responses' : '/responses');
  const headers = { ...authHeaders(provider), 'Content-Type': 'application/json' };
  const base = { model: model.rawId, input: messages.map((message) => ({ role: message.role, content: textFromValue(message.content) })), stream: false };
  let data: any;
  try {
    data = await requestJson(url, { method: 'POST', headers, body: JSON.stringify({ ...base, tools: [{ type: 'web_search' }] }) });
  } catch (error) {
    const status = Number((error as Error & { status?: number }).status || 0);
    if (![400, 404, 422].includes(status)) throw error;
    data = await requestJson(url, { method: 'POST', headers, body: JSON.stringify({ ...base, tools: [{ type: 'web_search_preview' }] }) });
  }
  const text = openAiText(data);
  const citations = cleanCitations(data, text);
  if (!citations.length) throw new Error('原生 Responses 搜索没有返回可核验的来源');
  return { text, citations };
}

async function geminiSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[]) {
  const { system, contents } = messagesToGemini(messages);
  const root = String(provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai')
    .replace(/\/openai\/?$/i, '')
    .replace(/\/+$/, '');
  const url = `${root}/models/${encodeURIComponent(model.rawId)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
  const base = { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents };
  let data: any;
  try {
    data = await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, tools: [{ google_search: {} }] }) });
  } catch (error) {
    const status = Number((error as Error & { status?: number }).status || 0);
    if (![400, 404, 422].includes(status)) throw error;
    data = await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, tools: [{ google_search_retrieval: {} }] }) });
  }
  const candidate = data?.candidates?.[0];
  const text = stripNativeSearchProcess(candidate?.content?.parts || candidate?.content || data?.text);
  const citations = cleanCitations(candidate?.groundingMetadata || data?.groundingMetadata || data, text);
  if (!citations.length) throw new Error('Gemini 原生搜索没有返回可核验的来源');
  return { text, citations };
}

async function nativeChatSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[]) {
  const data = await requestJson(endpoint(provider, provider.chatPath, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.rawId, messages }),
  });
  const text = openAiText(data);
  const citations = cleanCitations(data?.citations || data, text);
  if (!citations.length) throw new Error('原生搜索模型没有返回可核验的来源');
  return { text, citations };
}

export async function runNativeWebSearch(provider: NativeSearchProvider, model: NativeSearchModel, messages: ChatMessage[], query: string): Promise<NativeSearchResult> {
  const protocol = resolveNativeSearchProtocol(provider, model);
  if (!protocol) throw new Error('当前模型没有可用的原生搜索协议');
  const result = protocol === 'gemini-grounding'
    ? await geminiSearch(provider, model, messages)
    : protocol === 'native-chat'
      ? await nativeChatSearch(provider, model, messages)
      : await openAiResponsesSearch(provider, model, messages);
  return {
    source: 'native',
    protocol,
    modelId: model.rawId,
    provider: String(provider.platform || provider.type || 'native'),
    query: query.trim().slice(0, 320),
    text: result.text,
    citations: result.citations,
    resultCount: result.citations.length,
    searchedAt: new Date().toISOString(),
  };
}
