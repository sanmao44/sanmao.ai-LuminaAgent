import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWebSearchApiConfig } from '@/lib/store';
import type { WebSearchApiProvider } from '@/lib/types';

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  content?: string;
  publishedAt?: string;
  retrievedAt?: string;
  qualityScore?: number;
};

export type WebSearchProvider = 'anysearch' | 'baidu-qianfan';

export type SearchIntentKind = 'latest_news' | 'fact_check' | 'recommendation' | 'comparison' | 'weather' | 'sports' | 'current_status' | 'general_fact';
export type SearchFreshness = 'hour' | 'day' | 'week' | 'month' | 'year' | 'none';
export type SearchTimeRange = {
  type: 'relative' | 'absolute';
  value: string;
  start: string;
  end: string;
  startAt?: string;
  endAt?: string;
  label: string;
  freshness: SearchFreshness;
};
export type SearchIntent = {
  needsWeb: boolean;
  intent: SearchIntentKind;
  topic: string;
  entities: string[];
  timeSensitive: boolean;
  timeRange: SearchTimeRange | null;
  location: string | null;
  freshness: 'high' | 'medium' | 'low';
};
export type SearchPlan = {
  intent: SearchIntent;
  queries: string[];
  relaxedQueries: string[];
  broadenedQueries: string[];
};
export type SearchStatus = 'SEARCH_SUCCESS' | 'SEARCH_API_ERROR' | 'SEARCH_ZERO_RESULTS' | 'SEARCH_LOW_RELEVANCE' | 'SEARCH_DATE_MISMATCH' | 'SEARCH_TIMEOUT';
export type SearchCoverage = {
  enoughResults: boolean;
  reason: string;
  highQualityResults: number;
  datedResults: number;
  matchedTimeRange: number;
  retry: boolean;
};
export type SearchTrace = {
  round: number;
  queries: string[];
  rawResultCount: number;
  dateMatchedCount: number;
  selectedResultCount: number;
  retryReason?: string;
};

export type SearchResponse = {
  source: 'external';
  provider: WebSearchProvider;
  query: string;
  rawResultCount: number;
  resultCount: number;
  enrichedCount: number;
  searchedAt: string;
  results: WebSearchResult[];
  intent: SearchIntent;
  queries: string[];
  rounds: number;
  status: SearchStatus;
  coverage: SearchCoverage;
  coverageNote?: string;
  warnings: string[];
  retryable: boolean;
  suggestedAction: 'none' | 'rewrite_query' | 'expand_time_range' | 'retry_later';
  trace: SearchTrace[];
};

type SearchAttempt = { provider: WebSearchProvider; results: WebSearchResult[]; rawCount: number; error?: string; status?: SearchStatus };
type CacheEntry = { expiresAt: number; response: SearchResponse };
type ApiConfig = { provider: WebSearchApiProvider; apiKey: string };

const SEARCH_TIMEZONE = process.env.SANMAO_SEARCH_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const MAX_SEARCH_ROUNDS = 3;
const MAX_QUERIES_PER_ROUND = 3;

const NORMAL_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const execFileAsync = promisify(execFile);

function combineSignals(signal: AbortSignal | undefined, timeout: number) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeoutSignal]);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason || new Error('搜索请求已取消'));
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', () => controller.abort(timeoutSignal.reason), { once: true });
  return controller.signal;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new Error('搜索请求已取消');
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x)?[\da-f]+;/gi, (entity) => {
      const raw = entity.slice(2, -1);
      const code = raw[0]?.toLowerCase() === 'x' ? Number.parseInt(raw.slice(1), 16) : Number.parseInt(raw, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    })
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceFromUrl(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '网页来源'; }
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|fbclid|gclid|msclkid)/i.test(key)) parsed.searchParams.delete(key);
    return parsed.href.replace(/\/$/, '');
  } catch { return url; }
}

class SearchApiError extends Error {
  status?: number;
  code?: string;
  requestId?: string;
  data?: any;

  constructor(message: string, options: { status?: number; code?: string; requestId?: string; data?: any } = {}) {
    super(message);
    this.name = 'SearchApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.data = options.data;
  }
}

export function normalizeSearchApiKey(value: unknown) {
  let normalized = String(value ?? '').trim().replace(/^["'`]|["'`]$/g, '');
  for (let index = 0; index < 3; index += 1) {
    const next = normalized
      .replace(/^authorization\s*[:=]\s*/i, '')
      .replace(/^(?:api[\s_-]*key|apikey)\s*[:=]\s*/i, '')
      .replace(/^bearer\s+/i, '')
      .trim();
    if (next === normalized) break;
    normalized = next;
  }
  return normalized;
}

export function isLikelyBaiduQianfanApiKey(value: unknown) {
  return /^bce-v3\/\S{16,}$/i.test(normalizeSearchApiKey(value));
}

function requireBaiduQianfanApiKey(value: unknown) {
  const apiKey = normalizeSearchApiKey(value);
  if (!isLikelyBaiduQianfanApiKey(apiKey)) {
    throw new SearchApiError('百度千帆 API Key 格式不正确，请粘贴控制台生成的完整 Key（通常以 bce-v3/ 开头）');
  }
  return apiKey;
}

function upstreamErrorMessage(data: any) {
  const candidates = [
    data?.message,
    data?.error_msg,
    data?.error?.message,
    data?.error?.msg,
    data?.error?.description,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function upstreamErrorCode(data: any) {
  const candidates = [data?.code, data?.error_code, data?.error?.code, data?.error?.type];
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim());
  return value === undefined ? '' : String(value).trim();
}

function upstreamRequestId(data: any) {
  const candidates = [data?.request_id, data?.requestId, data?.error?.request_id, data?.error?.requestId];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function sanitizeUpstreamErrorMessage(value: string) {
  const sanitized = value
    .replace(/\s*(?:username|password|api[\s_-]*key)\s*[:=]\s*[^,;\s]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || '服务返回了敏感错误信息，已自动隐藏';
}

function friendlySearchErrorMessage(providerLabel: string, status: number, code: string, detail: string) {
  if (providerLabel === '百度千帆搜索' && status === 401 && code === '216003') {
    return '百度千帆 API Key 无效或鉴权格式不正确，请粘贴控制台中的纯 API Key 后重试';
  }
  if (providerLabel === 'AnySearch' && status === 402) {
    return 'AnySearch 当前匿名入口需要 API Key 或可用额度，请配置 ANYSEARCH_API_KEY 后重试';
  }
  return sanitizeUpstreamErrorMessage(detail);
}

function extractAnySearchApiKey(data: any) {
  const directCandidates = [
    data?.api_key,
    data?.apiKey,
    data?.data?.api_key,
    data?.data?.apiKey,
    data?.error?.api_key,
    data?.error?.apiKey,
  ];
  const messageCandidates = [data?.message, data?.error_msg, data?.error?.message, data?.error?.msg];
  const fromMessage = messageCandidates
    .filter((value) => typeof value === 'string')
    .map((value) => value.match(/\bapi[\s_-]*key\s*[:=]\s*([^\s,;]+)/i)?.[1] || '')
    .find(Boolean);
  return normalizeSearchApiKey(directCandidates.find((value) => String(value || '').trim()) || fromMessage || '');
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 12_000, providerLabel = '搜索', signal?: AbortSignal) {
  throwIfAborted(signal);
  const response = await fetch(url, { ...init, cache: 'no-store', signal: combineSignals(signal, timeoutMs) });
  const raw = await response.text();
  throwIfAborted(signal);
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const rawDetail = upstreamErrorMessage(data);
    const code = upstreamErrorCode(data);
    const requestId = upstreamRequestId(data);
    const detail = friendlySearchErrorMessage(providerLabel, response.status, code, rawDetail);
    const suffix = [code && `错误码 ${code}`, detail, requestId && `请求 ID ${requestId}`].filter(Boolean).join('：');
    throw new SearchApiError(`${providerLabel}接口返回 HTTP ${response.status}${suffix ? `（${suffix}）` : ''}`, { status: response.status, code, requestId, data });
  }
  return data;
}

async function fetchWithWindowsProxy(url: string, accept: string, timeoutSec = 8, signal?: AbortSignal) {
  if (process.platform !== 'win32') throw new Error('网页正文连接失败');
  throwIfAborted(signal);
  const command = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); (Invoke-WebRequest -UseBasicParsing -Uri $env:SANMAO_SEARCH_URL -Headers @{ Accept = $env:SANMAO_SEARCH_ACCEPT; 'User-Agent' = 'SANMAO.AI local assistant' } -TimeoutSec $env:SANMAO_SEARCH_TIMEOUT).Content";
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, SANMAO_SEARCH_URL: url, SANMAO_SEARCH_ACCEPT: accept, SANMAO_SEARCH_TIMEOUT: String(timeoutSec) },
    timeout: (timeoutSec + 3) * 1000,
    maxBuffer: 4_000_000,
    windowsHide: true,
    signal,
  });
  return stdout;
}

function normalizeBaiduRows(data: any) {
  const rows = Array.isArray(data?.references)
    ? data.references
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.data?.references)
        ? data.data.references
        : Array.isArray(data?.data?.results)
          ? data.data.results
          : Array.isArray(data?.result)
            ? data.result
            : Array.isArray(data?.data?.result)
              ? data.data.result
          : Array.isArray(data?.search_result)
            ? data.search_result
            : [];

  return rows.map((row: any) => {
    const url = String(row?.url || row?.link || row?.page_url || row?.web_url || '').trim();
    const snippet = String(row?.snippet || row?.summary || row?.content || row?.description || row?.text || '').trim();
    const content = String(row?.content || row?.summary || row?.snippet || '').trim();
    const rawPublishedAt = row?.published_at ?? row?.publishedAt ?? row?.publish_time ?? row?.publishTime ?? row?.date ?? row?.timestamp ?? row?.time;
    const evidenceText = `${row?.title || row?.name || row?.page_title || row?.web_anchor || ''} ${snippet}`;
    const textualDate = evidenceText.match(/(?:20\d{2}[年./-]\s*\d{1,2}[月./-]\s*\d{1,2}(?:日|号)?|20\d{2}-\d{1,2}-\d{1,2}|20\d{2}\/\d{1,2}\/\d{1,2})/i)?.[0] || '';
    const rawDateText = typeof rawPublishedAt === 'number'
      ? new Date(rawPublishedAt < 10_000_000_000 ? rawPublishedAt * 1000 : rawPublishedAt).toISOString()
      : String(rawPublishedAt || '').trim();
    const publishedAt = normalizePublishedAt(rawDateText || textualDate);
    return {
      title: String(row?.title || row?.name || row?.page_title || row?.web_anchor || '').trim(),
      url,
      snippet,
      source: String(row?.website || row?.source || row?.media || row?.site_name || sourceFromUrl(url)).trim(),
      content: content || undefined,
      publishedAt,
    } satisfies WebSearchResult;
  }).filter((row: WebSearchResult) => row.title && /^https?:\/\//i.test(row.url));
}

function normalizePublishedAt(value: string) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const chinese = text.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})(?:日|号)?/);
  const slash = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  const match = chinese || slash;
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 80) : parsed.toISOString();
}

function baiduOfficialBody(query: string, news: boolean) {
  const limitedQuery = Array.from(query.trim()).slice(0, 72).join('');
  return {
    messages: [{ content: limitedQuery, role: 'user' }],
    search_source: 'baidu_search_v2',
    resource_type_filter: [{ type: 'web', top_k: 10 }],
    ...(news ? { sort: { priority: 'auto' } } : {}),
  };
}

async function searchWithBaiduQianfan(query: string, config: ApiConfig, news: boolean, signal?: AbortSignal) {
  const apiKey = requireBaiduQianfanApiKey(config.apiKey);
  const legacyUrl = 'https://qianfan.baidubce.com/v2/ai_search';
  const officialUrl = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
  const legacyBody = JSON.stringify({ query: Array.from(query.trim()).slice(0, 160).join(''), max_results: 10 });
  const body = JSON.stringify(baiduOfficialBody(query, news));
  let lastError: unknown = null;
  let hadSuccessfulEmptyResponse = false;

  // 首选控制台说明中的“智能搜索生成”接口：query + max_results。
  try {
    const data = await fetchJson(legacyUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: legacyBody,
    }, 12_000, '百度千帆搜索', signal);
    const rows = normalizeBaiduRows(data);
    if (rows.length) return rows;
    hadSuccessfulEmptyResponse = true;
  } catch (error) {
    lastError = error;
    throwIfAborted(signal);
    if (!(error instanceof SearchApiError) || ![400, 401, 403, 404].includes(error.status || 0)) throw error;
  }

  // 兼容百度当前文档中的新版百度搜索接口。
  try {
    const data = await fetchJson(officialUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    }, 12_000, '百度千帆搜索', signal);
    const rows = normalizeBaiduRows(data);
    if (rows.length) return rows;
    hadSuccessfulEmptyResponse = true;
  } catch (error) {
    lastError = error;
    throwIfAborted(signal);
  }

  // 部分 AppBuilder 应用只接受该兼容鉴权头，再尝试一次新版接口。
  try {
    const data = await fetchJson(officialUrl, {
      method: 'POST',
      headers: { 'X-Appbuilder-Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    }, 12_000, '百度千帆搜索', signal);
    const rows = normalizeBaiduRows(data);
    if (rows.length) return rows;
    hadSuccessfulEmptyResponse = true;
  } catch (error) {
    lastError = error;
    throwIfAborted(signal);
  }

  if (hadSuccessfulEmptyResponse) return [];
  if (lastError instanceof Error) throw lastError;
  return [];
}

let anonymousAnySearchKey = '';

async function requestAnySearch(endpoint: string, body: string, apiKey: string, signal?: AbortSignal) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const data = await fetchJson(endpoint, { method: 'POST', headers, body }, 12_000, 'AnySearch', signal);
  return normalizeBaiduRows(data);
}

async function searchWithAnySearch(query: string, config: ApiConfig, signal?: AbortSignal) {
  const body = JSON.stringify({ query: Array.from(query.trim()).slice(0, 220).join(''), zone: 'cn', max_results: 8 });
  let workingKey = normalizeSearchApiKey(config.apiKey) || anonymousAnySearchKey;
  let lastError: unknown = null;
  let hadSuccessfulEmptyResponse = false;
  for (const endpoint of ['https://api.anysearch.com/v1/search', 'https://api.anysearch.com/search']) {
    try {
      const rows = await requestAnySearch(endpoint, body, workingKey, signal);
      if (rows.length) return rows;
      hadSuccessfulEmptyResponse = true;
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);
      if (error instanceof SearchApiError && error.status === 402 && !workingKey) {
        const generatedKey = extractAnySearchApiKey(error.data);
        if (generatedKey) {
          anonymousAnySearchKey = generatedKey;
          workingKey = generatedKey;
          try {
            const rows = await requestAnySearch(endpoint, body, workingKey, signal);
            if (rows.length) return rows;
            hadSuccessfulEmptyResponse = true;
          } catch (retryError) {
            lastError = retryError;
          }
        }
      }
      if (error instanceof SearchApiError && ![400, 402, 404].includes(error.status || 0)) throw error;
    }
  }
  if (hadSuccessfulEmptyResponse) return [];
  if (lastError instanceof Error) throw lastError;
  return [];
}

async function searchWithApi(query: string, config: ApiConfig, news: boolean, signal?: AbortSignal) {
  if (config.provider === 'anysearch') return searchWithAnySearch(query, config, signal);
  if (config.provider === 'baidu-qianfan') return searchWithBaiduQianfan(query, config, news, signal);
  return [];
}

/* Kept as a narrow helper for the Windows-local transport used by page enrichment. */
async function fetchText(url: string, accept: string, timeoutMs = 5_000, signal?: AbortSignal) {
  try {
    throwIfAborted(signal);
    const response = await fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'SANMAO.AI local assistant' },
      cache: 'no-store',
      signal: combineSignals(signal, timeoutMs),
    });
    if (!response.ok) throw new Error(`网页请求返回 HTTP ${response.status}`);
    return response.text();
  } catch (error) {
    throwIfAborted(signal);
    try { return await fetchWithWindowsProxy(url, accept, Math.max(5, Math.round(timeoutMs / 1000)), signal); } catch { throw error; }
  }
}

async function searchOne(query: string, preferNews: boolean, plan: SearchPlan, apiConfigs: ApiConfig[], signal?: AbortSignal): Promise<SearchAttempt> {
  if (apiConfigs.length) {
    const errors: string[] = [];
    let hadSuccessfulEmptyResponse = false;
    let hadApiError = false;
    for (const apiConfig of apiConfigs) {
      try {
        const rawResults = await searchWithApi(query, apiConfig, preferNews, signal);
        const ranked = rankResults(rawResults, query, plan);
        if (ranked.length) return { provider: apiConfig.provider, results: ranked, rawCount: rawResults.length, status: 'SEARCH_SUCCESS' };
        hadSuccessfulEmptyResponse = true;
        errors.push(`${apiConfig.provider === 'anysearch' ? 'AnySearch' : '百度千帆'}没有返回相关结果`);
      } catch (error) {
        throwIfAborted(signal);
        hadApiError = true;
        errors.push(error instanceof Error ? error.message : `${apiConfig.provider} 搜索 API 请求失败`);
      }
    }
    const errorText = errors.join('；');
    const timeout = /timeout|timed out|超时|abort/i.test(errorText);
    return { provider: apiConfigs[apiConfigs.length - 1].provider, results: [], rawCount: 0, error: errorText, status: timeout ? 'SEARCH_TIMEOUT' : hadSuccessfulEmptyResponse && !hadApiError ? 'SEARCH_ZERO_RESULTS' : 'SEARCH_API_ERROR' };
  }
  return { provider: 'anysearch', results: [], rawCount: 0, error: 'AnySearch 匿名搜索暂不可用；可稍后重试，或设置 ANYSEARCH_API_KEY / QIANFAN_API_KEY 后继续使用', status: 'SEARCH_API_ERROR' };
}

async function getSearchApiConfigs(): Promise<ApiConfig[]> {
  const configs: ApiConfig[] = [];
  const anySearchKey = normalizeSearchApiKey(process.env.ANYSEARCH_API_KEY);
  const qianfanEnvKey = normalizeSearchApiKey(process.env.QIANFAN_API_KEY);
  const stored = await getWebSearchApiConfig();
  const storedConfig = stored?.apiKey ? { ...stored, apiKey: normalizeSearchApiKey(stored.apiKey) } : null;
  if (anySearchKey) configs.push({ provider: 'anysearch', apiKey: anySearchKey });
  else if (storedConfig?.provider === 'anysearch' && storedConfig.apiKey) configs.push(storedConfig);
  else configs.push({ provider: 'anysearch', apiKey: '' });
  if (qianfanEnvKey) configs.push({ provider: 'baidu-qianfan', apiKey: qianfanEnvKey });
  else if (storedConfig?.provider === 'baidu-qianfan' && storedConfig.apiKey) configs.push(storedConfig);
  return configs;
}

/* The orchestrator owns intent, retries and ranking; providers only fetch rows. */
async function searchWithFallback(query: string, plan: SearchPlan, apiConfigs: ApiConfig[], signal?: AbortSignal) {
  const preferNews = ['latest_news', 'weather', 'sports', 'current_status'].includes(plan.intent.intent);
  return searchOne(query, preferNews, plan, apiConfigs, signal);
}

async function enrichResult(result: WebSearchResult, signal?: AbortSignal) {
  try {
    const html = await fetchText(result.url, 'text/html', 5_000, signal);
    const content = stripHtml(html).slice(0, 3_000);
    return content.length > 120 ? { ...result, content } : result;
  } catch {
    throwIfAborted(signal);
    return result;
  }
}

function dedupeResults(results: WebSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = normalizeUrl(result.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type CalendarParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedCalendarParts(value: Date, timezone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
}

function dateKey(parts: Pick<CalendarParts, 'year' | 'month' | 'day'>) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function monthEnd(year: number, month: number) {
  return dateKey({ year, month, day: new Date(Date.UTC(year, month, 0)).getUTCDate() });
}

function timeRange(value: SearchTimeRange['value'], start: string, end: string, label: string, freshness: SearchFreshness, type: SearchTimeRange['type'] = 'relative', startAt?: string, endAt?: string): SearchTimeRange {
  return { type, value, start, end, ...(startAt ? { startAt } : {}), ...(endAt ? { endAt } : {}), label, freshness };
}

/** Resolve relative and explicit calendar phrases before a provider sees the query. */
export function resolveTimeRange(userQuery: string, currentDateTime: Date | string = new Date(), timezone = SEARCH_TIMEZONE): SearchTimeRange | null {
  const text = String(userQuery || '').replace(/\s+/g, ' ').trim();
  const now = new Date(currentDateTime);
  const parts = zonedCalendarParts(Number.isNaN(now.getTime()) ? new Date() : now, timezone);
  const today = dateKey(parts);
  const normalized = text.replace(/[，。！？]/g, ' ');

  const fullDate = normalized.match(/(?<!\d)(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})(?:日|号)?/i);
  if (fullDate) {
    const [, year, month, day] = fullDate;
    const value = `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
    return timeRange('absolute-date', value, value, value, 'day', 'absolute');
  }
  const yearOnly = normalized.match(/(?<!\d)(20\d{2})年?(?:发生|以来|的|有什么|新闻|消息|更新|发布|情况)?/i);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return timeRange('absolute-year', `${year}-01-01`, `${year}-12-31`, `${year}年`, 'year', 'absolute');
  }
  if (/(过去\s*24\s*小时|最近\s*24\s*小时|last\s*24\s*hours?)/i.test(normalized)) {
    return timeRange('past-24-hours', shiftDate(today, -1), today, '过去24小时', 'hour', 'relative', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), now.toISOString());
  }
  if (/(过去\s*48\s*小时|最近\s*48\s*小时|last\s*48\s*hours?)/i.test(normalized)) {
    return timeRange('past-48-hours', shiftDate(today, -2), today, '过去48小时', 'day', 'relative', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(), now.toISOString());
  }
  if (/(今天|今日|当天|today)/i.test(normalized)) {
    return timeRange('today', today, today, '今天', 'day');
  }
  if (/(昨天|昨日|yesterday)/i.test(normalized)) {
    const value = shiftDate(today, -1);
    return timeRange('yesterday', value, value, '昨天', 'day');
  }
  if (/(前天|the\s*day\s*before\s*yesterday)/i.test(normalized)) {
    const value = shiftDate(today, -2);
    return timeRange('day-before-yesterday', value, value, '前天', 'day');
  }
  if (/(本周|这周|这星期|本星期|this\s+week)/i.test(normalized)) {
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return timeRange('this-week', shiftDate(today, mondayOffset), shiftDate(today, mondayOffset + 6), '本周', 'week');
  }
  if (/(上周|上星期|last\s+week)/i.test(normalized)) {
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    const mondayOffset = (weekday === 0 ? -6 : 1 - weekday) - 7;
    return timeRange('last-week', shiftDate(today, mondayOffset), shiftDate(today, mondayOffset + 6), '上周', 'week');
  }
  if (/(本月|这个月|this\s+month)/i.test(normalized)) {
    return timeRange('this-month', `${parts.year}-${String(parts.month).padStart(2, '0')}-01`, monthEnd(parts.year, parts.month), '本月', 'month');
  }
  if (/(今年|本年度|this\s+year)/i.test(normalized)) {
    return timeRange('this-year', `${parts.year}-01-01`, `${parts.year}-12-31`, '今年', 'year');
  }
  if (/(最近|近期|近来|latest|recent|recently|currently|目前|当前)/i.test(normalized)) {
    const newsLike = /(新闻|消息|更新|进展|快讯|发生|latest|recent)/i.test(normalized);
    const days = newsLike ? 7 : 30;
    return timeRange('recent', shiftDate(today, -(days - 1)), today, `过去${days}天`, days <= 7 ? 'week' : 'month');
  }
  return null;
}

const SEARCH_INTENT_PATTERNS = {
  news: /(新闻|快讯|突发|消息|热点|动态|发布会|news|breaking|headline)/i,
  factCheck: /(真假|真伪|属实|谣言|辟谣|核实|核验|查证|是真的吗|真的假的|是否正确|verify|fact[- ]?check)/i,
  recommendation: /(推荐|建议买|值得买|适合我|帮我选|选择哪|哪个更好|性价比|避坑|排行榜|攻略|路线|行程|住宿|酒店|餐厅|咖啡店|门票|活动|展览|演出|旅游|旅行|购物|购买|recommend|best|nearby|itinerary|hotel|restaurant)/i,
  comparison: /(对比|比较|区别|差异|优缺点|哪个好|哪个更|选哪个|\bvs\.?\b|versus|compare|comparison|difference|pros?\s*(?:and|&)\s*cons?)/i,
  weather: /(天气|温度|气温|降雨|下雨|空气质量|weather|temperature|rainfall|air quality)/i,
  sports: /(比赛|赛程|比分|战绩|球队|球员|联赛|体育|奥运|世界杯|match|score|schedule|standings|sports)/i,
  current: /(今天|今日|刚刚|现在|当前|实时|最新|近期|本周|本月|今年|最近|目前|截至|进展|更新|价格|报价|股价|汇率|版本|更新日志|排名|选举|任命|上映|currently|latest|recent|price|version)/i,
};

const SEARCH_COMMAND_PATTERN = /^(?:请|帮我|麻烦|可以|能否|请问|告诉我|帮忙|please)\s*(?:(?:联网|上网)?\s*)?(?:搜索|查询|查找|查一下|查查|查证|核验|核实|搜一下|search|look\s*up|check|verify)\s*/i;
const SEARCH_TOPIC_STOP_WORDS = /^(?:请问|帮我|告诉我|想知道|是否|是不是|有没有|怎么|如何|为什么|什么|哪个|哪些|哪里|谁|何时|多少|现在|目前|这个|该|消息|新闻|最新|最近|今天|今日|发生|发生了|有什么|有何|发布|发布了|更新|进展|重要|主要|分别|各自|吗|呢|的|是|和|与|关于|一下|请|帮忙|推荐|比较|对比|查询|搜索|查找|核验|核实|来源|官方|资料|latest|current|recent|recently|please|search|look|up|check|verify)$/i;

function normalizedSearchInput(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 320);
}

function extractSearchTopic(input: string) {
  const topic = input
    .replace(SEARCH_COMMAND_PATTERN, '')
    .replace(/(?:今天|今日|昨天|昨日|前天|现在|当前|实时|最新|最近|近期|本周|这周|本月|今年|过去\s*\d+\s*小时|latest|current|recent|recently|last\s+\d+\s+hours?)/gi, ' ')
    .replace(/(?:有什么|有何|有哪些|有哪一些|发生了什么|发布了什么|是什么|是多少|怎么样|如何|吗|呢|吗？|？|\?|please|tell\s+me|can\s+you)/gi, ' ')
    .replace(/(?:帮我|请问|告诉我|想知道|帮忙|推荐|建议买|值得买|对比|比较|查证|核验|核实|找来源|给出处)/gi, ' ')
    .replace(/(?:和|与|以及|及|分别|各自)/gi, ' ')
    .replace(/(?:新闻|消息|动态|热点|快讯|更新|进展|发布|发布了|重要|主要|价格|报价|天气|预报|赛程|比分|结果)/gi, ' ')
    .replace(/[，。！？：:；;、]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chunks = topic.split(' ').filter(Boolean).filter((chunk) => !SEARCH_TOPIC_STOP_WORDS.test(chunk));
  return (chunks.join(' ') || topic || input).slice(0, 140);
}

function extractSearchEntities(topic: string) {
  const values = topic.match(/[A-Z][A-Za-z0-9._-]{1,}|[\u4e00-\u9fff]{2,}/g) || [];
  const generic = /^(?:API|AI|行业|领域|世界|方面|新闻|消息|动态|热点|更新|进展|重要|主要|分别|各自|最新|最近|当前|目前|公司|产品|平台|问题|内容|情况|事情|什么|哪个|哪些)$/i;
  return [...new Set(values.filter((value) => !SEARCH_TOPIC_STOP_WORDS.test(value) && !generic.test(value)))].slice(0, 8);
}

function extractSearchLocation(input: string) {
  const match = input.match(/(?:在|去|到|位于|附近|周边|本地|当地)\s*([\u4e00-\u9fffA-Za-z0-9· -]{2,24})/i);
  return match?.[1]?.replace(/[，。！？?].*$/, '').trim() || null;
}

const SEARCH_TRANSLATIONS: Array<[RegExp, string]> = [
  [/人工智能|AI界|AI行业/gi, 'artificial intelligence'],
  [/英伟达/gi, 'NVIDIA'],
  [/马斯克/gi, 'Elon Musk'],
  [/苹果公司|苹果/gi, 'Apple'],
  [/微软/gi, 'Microsoft'],
  [/谷歌/gi, 'Google'],
  [/亚马逊/gi, 'Amazon'],
  [/新闻|消息|动态/gi, 'news'],
  [/更新|进展/gi, 'updates'],
  [/价格|报价/gi, 'price'],
  [/版本/gi, 'version'],
  [/天气/gi, 'weather'],
  [/比赛|赛程|比分/gi, 'match score schedule'],
];

function englishSearchTopic(topic: string) {
  return SEARCH_TRANSLATIONS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), topic).replace(/\s+/g, ' ').trim();
}

function intentLabel(intent: SearchIntentKind, language: 'zh' | 'en') {
  const labels = language === 'zh'
    ? { latest_news: '新闻 最新消息', fact_check: '事实 核验', recommendation: '推荐 评价', comparison: '对比 评测', weather: '天气 预报', sports: '赛程 比分 结果', current_status: '最新 进展', general_fact: '资料' }
    : { latest_news: 'latest news', fact_check: 'fact check', recommendation: 'recommendations reviews', comparison: 'comparison review', weather: 'weather forecast', sports: 'schedule score results', current_status: 'latest updates', general_fact: 'information' };
  return labels[intent];
}

function rangeQuery(range: SearchTimeRange | null, language: 'zh' | 'en', relaxed = false) {
  if (!range) return '';
  if (relaxed) {
    if (range.value === 'today') return language === 'zh' ? '过去24小时' : 'past 24 hours';
    if (range.value === 'yesterday' || range.value === 'day-before-yesterday') return language === 'zh' ? '过去48小时' : 'past 48 hours';
    if (range.freshness === 'week') return language === 'zh' ? '过去7天' : 'past 7 days';
    if (range.freshness === 'month') return language === 'zh' ? '过去30天' : 'past 30 days';
  }
  if (range.start === range.end) return language === 'zh' ? range.start : range.start;
  return language === 'zh' ? `${range.start} 至 ${range.end}` : `${range.start} to ${range.end}`;
}

/** Infer a structured search intent without sending the full user message to a provider. */
export function analyzeSearchIntent(userQuery: string, currentDateTime: Date | string = new Date(), timezone = SEARCH_TIMEZONE): SearchIntent {
  const input = normalizedSearchInput(userQuery);
  const topic = extractSearchTopic(input);
  const timeRange = resolveTimeRange(input, currentDateTime, timezone);
  const explicit = /(?:联网|上网|搜索|查询|查找|检索|查证|核验|核实|来源|出处|search|look\s*up|check|verify|browse)/i.test(input);
  const news = SEARCH_INTENT_PATTERNS.news.test(input);
  const factCheck = SEARCH_INTENT_PATTERNS.factCheck.test(input);
  const recommendation = SEARCH_INTENT_PATTERNS.recommendation.test(input);
  const comparison = SEARCH_INTENT_PATTERNS.comparison.test(input);
  const weather = SEARCH_INTENT_PATTERNS.weather.test(input);
  const sports = SEARCH_INTENT_PATTERNS.sports.test(input);
  const current = SEARCH_INTENT_PATTERNS.current.test(input);
  const historical = /(?<!\d)20\d{2}年?/i.test(input);
  const question = /(?:[吗呢么][。.!！?？]*$|[?？]|(?:谁|什么|哪个|哪些|哪里|哪家|怎么|如何|多少|几家|怎么样))/i.test(input);
  const stableConcept = /^(?:请问)?(?:什么是|何为|请解释|解释一下|如何理解).{0,80}(?:概念|原理|定义|理论|算法|语法|函数|定理|物理|化学|数学|生物|编程|代码|机制|方法|光合作用|相对论|递归|向量|概率)[。.!！?？]*$/i.test(input);
  const intent: SearchIntentKind = news ? 'latest_news'
    : factCheck ? 'fact_check'
      : recommendation ? 'recommendation'
        : comparison ? 'comparison'
          : weather ? 'weather'
            : sports ? 'sports'
              : current ? 'current_status'
                : 'general_fact';
  const needsWeb = Boolean(input) && !stableConcept && (explicit || factCheck || recommendation || comparison || weather || sports || current || (question && historical));
  const timeSensitive = Boolean(timeRange || current || news || weather || sports || recommendation || comparison);
  return {
    needsWeb,
    intent,
    topic,
    entities: extractSearchEntities(topic),
    timeSensitive,
    timeRange,
    location: extractSearchLocation(input),
    freshness: timeSensitive ? (timeRange?.freshness === 'hour' || timeRange?.freshness === 'day' ? 'high' : 'medium') : 'low',
  };
}

function uniqueQueries(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter((value) => value.length >= 2).map((value) => value.slice(0, 220)))].slice(0, MAX_QUERIES_PER_ROUND);
}

/** Build strict, relaxed, and broadened queries for the retry state machine. */
export function planSearch(userQuery: string, currentDateTime: Date | string = new Date(), timezone = SEARCH_TIMEZONE): SearchPlan {
  const input = normalizedSearchInput(userQuery);
  const intent = analyzeSearchIntent(input, currentDateTime, timezone);
  const topic = intent.topic || input;
  const englishTopic = englishSearchTopic(topic);
  const strictZh = [topic, intentLabel(intent.intent, 'zh'), rangeQuery(intent.timeRange, 'zh')].filter(Boolean).join(' ');
  const strictEn = [englishTopic, intentLabel(intent.intent, 'en'), rangeQuery(intent.timeRange, 'en')].filter(Boolean).join(' ');
  const relaxedZh = [topic, intentLabel(intent.intent, 'zh'), rangeQuery(intent.timeRange, 'zh', true)].filter(Boolean).join(' ');
  const relaxedEn = [englishTopic, intentLabel(intent.intent, 'en'), rangeQuery(intent.timeRange, 'en', true)].filter(Boolean).join(' ');
  const entityQueries = intent.entities.length >= 2
    ? intent.entities.slice(0, 2).map((entity) => [entity, intentLabel(intent.intent, 'zh'), rangeQuery(intent.timeRange, 'zh')].filter(Boolean).join(' '))
    : [];
  const broadened = [
    [topic, intentLabel(intent.intent, 'zh')].filter(Boolean).join(' '),
    [englishTopic, intentLabel(intent.intent, 'en')].filter(Boolean).join(' '),
    [topic, intent.intent === 'general_fact' ? '官方 资料' : '最新'].filter(Boolean).join(' '),
  ];
  const primaryQueries = entityQueries.length
    ? [...entityQueries, strictEn]
    : [strictZh, strictEn, `${topic} ${rangeQuery(intent.timeRange, 'zh', true)}`];
  return {
    intent,
    queries: uniqueQueries(primaryQueries),
    relaxedQueries: uniqueQueries([relaxedZh, relaxedEn, `${topic} ${intentLabel(intent.intent, 'zh')} ${rangeQuery(intent.timeRange, 'zh', true)}`]),
    broadenedQueries: uniqueQueries(broadened),
  };
}

function isNewsQuery(input: string) {
  const intent = analyzeSearchIntent(input);
  return intent.intent === 'latest_news' || intent.intent === 'weather' || intent.intent === 'sports' || intent.timeSensitive;
}

const QUERY_STOP_WORDS = /^(请|帮我|麻烦|可以|能否|请问|告诉我|帮忙|联网|上网|搜索|查询|查找|查一下|查查|查证|核验|核实|今天|今日|现在|当前|最新|消息|新闻|哪位|哪个|什么|是否|一下|这个|该|有|吗|呢|了|的|是|和|与|关于|一下子|please|search|look|up|check|verify|the|web|for|latest|current|information|info)$/i;

function queryTokens(input: string) {
  const tokens = new Set<string>();
  for (const token of input.toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/gi) || []) {
    if (!QUERY_STOP_WORDS.test(token) && !/^\d{4}(?:[-./]\d{1,2})?(?:[-./]\d{1,2})?$/.test(token)) tokens.add(token);
  }
  for (const chunk of input.toLowerCase().match(/[\u4e00-\u9fff]{2,}/g) || []) {
    const cleaned = chunk.replace(/(请|帮我|麻烦|联网|上网|搜索|查询|查找|查一下|查查|查证|核验|核实|今天|今日|现在|当前|最新|消息|新闻|哪位|哪个|什么|是否|这个|该|有|吗|呢|了|的|是|和|与|关于)/g, '');
    for (let index = 0; index < cleaned.length - 1; index += 1) {
      const pair = cleaned.slice(index, index + 2);
      if (!QUERY_STOP_WORDS.test(pair)) tokens.add(pair);
    }
  }
  return [...tokens].slice(0, 24);
}

function isBlockedSource(result: WebSearchResult) {
  return /(baike\.baidu|baidu\.com\/item|tthuangli|huangli|calendar|rili\.com|weather\.com|weather\.cn|wannianli)/i.test(result.url);
}

function isNewsSource(result: WebSearchResult) {
  return /(news|news\.|新闻|快讯|通讯社|日报|电视台|政府|gov|reuters|apnews|bbc|cnn|xinhuanet|people|cctv|news\.cn|thepaper|caixin|yicai|china\.com|rfi|dw\.com|nytimes|theguardian|微信公众平台|微博)/i.test(`${result.title} ${result.url} ${result.source}`);
}

function parsePublishedDate(value: string | undefined) {
  if (!value) return null;
  const chinese = value.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日?/);
  const normalized = chinese ? `${chinese[1]}-${String(Number(chinese[2])).padStart(2, '0')}-${String(Number(chinese[3])).padStart(2, '0')}` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resultDateKey(result: WebSearchResult) {
  const date = parsePublishedDate(result.publishedAt);
  return date ? dateKey(zonedCalendarParts(date, SEARCH_TIMEZONE)) : null;
}

function resultMatchesTimeRange(result: WebSearchResult, range: SearchTimeRange | null) {
  const published = resultDateKey(result);
  return Boolean(published && range && published >= range.start && published <= range.end);
}

function sourceQuality(result: WebSearchResult) {
  if (isBlockedSource(result)) return 0.18;
  if (/(\.gov(?:\.cn)?|\.edu(?:\.cn)?|openai\.com|anthropic\.com|google\.com|microsoft\.com|apple\.com|nvidia\.com|reuters|apnews|bbc|cnn|xinhuanet|people|cctv|news\.cn|thepaper|caixin)/i.test(`${result.url} ${result.source}`)) return 0.95;
  if (isNewsSource(result)) return 0.82;
  return 0.58;
}

function scoreResult(result: WebSearchResult, query: string, plan: SearchPlan) {
  const rankingContext = [query, plan.intent.topic, plan.intent.entities.join(' ')].filter(Boolean).join(' ');
  const tokens = queryTokens(rankingContext);
  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  const url = result.url.toLowerCase();
  const content = (result.content || '').toLowerCase();
  const allText = `${title} ${snippet} ${content}`;
  const hits = tokens.filter((token) => title.includes(token) || snippet.includes(token) || url.includes(token) || content.includes(token));
  const titleHits = tokens.filter((token) => title.includes(token)).length;
  const snippetHits = tokens.filter((token) => snippet.includes(token)).length;
  const semanticRelevance = Math.min(1, (hits.length + titleHits * 0.8 + snippetHits * 0.35) / Math.max(2, tokens.length * 1.5));
  const entityTokens = plan.intent.entities.map((entity) => entity.toLowerCase()).filter((entity) => entity.length >= 2);
  const entityMatch = entityTokens.length ? entityTokens.filter((entity) => allText.includes(entity)).length / entityTokens.length : semanticRelevance;
  const dateMatch = resultMatchesTimeRange(result, plan.intent.timeRange);
  const published = parsePublishedDate(result.publishedAt);
  const freshness = plan.intent.timeSensitive
    ? dateMatch
      ? 1
      : published
        ? Math.max(0.12, 1 - Math.min(1, Math.abs(Date.now() - published.getTime()) / (30 * 24 * 60 * 60 * 1000)))
        : 0.45
    : 0.6;
  const quality = semanticRelevance * 0.40 + freshness * 0.25 + sourceQuality(result) * 0.20 + entityMatch * 0.15;
  return { quality, dateMatch, semanticRelevance, freshness, entityMatch };
}

function rankResults(results: WebSearchResult[], query: string, plan: SearchPlan) {
  return dedupeResults(results)
    .map((result, index) => ({ result, details: scoreResult(result, query, plan), index }))
    .sort((a, b) => b.details.quality - a.details.quality || a.index - b.index)
    .slice(0, 10)
    .map((item) => ({ ...item.result, qualityScore: Number(item.details.quality.toFixed(3)) }));
}

function roundQueries(plan: SearchPlan, round: number) {
  if (round === 0) return plan.queries;
  if (round === 1) return plan.relaxedQueries;
  return plan.broadenedQueries;
}

function evaluateCoverage(results: WebSearchResult[], attempts: SearchAttempt[], plan: SearchPlan): SearchCoverage & { status: SearchStatus } {
  const datedResults = results.filter((result) => Boolean(result.publishedAt)).length;
  const matchedTimeRange = results.filter((result) => resultMatchesTimeRange(result, plan.intent.timeRange)).length;
  const highQualityResults = results.filter((result) => (result.qualityScore || 0) >= 0.32).length;
  const hasApiError = attempts.some((attempt) => attempt.status === 'SEARCH_API_ERROR');
  const hasTimeout = attempts.some((attempt) => attempt.status === 'SEARCH_TIMEOUT');
  if (!results.length && (hasApiError || hasTimeout)) {
    const status = hasTimeout ? 'SEARCH_TIMEOUT' : 'SEARCH_API_ERROR';
    return { enoughResults: false, reason: status === 'SEARCH_TIMEOUT' ? '搜索请求超时' : '所有搜索服务都返回了 API 错误', highQualityResults, datedResults, matchedTimeRange, retry: true, status };
  }
  if (!results.length) return { enoughResults: false, reason: '搜索服务返回零条结果', highQualityResults, datedResults, matchedTimeRange, retry: true, status: 'SEARCH_ZERO_RESULTS' };
  if (plan.intent.timeRange && matchedTimeRange === 0 && datedResults > 0) {
    return { enoughResults: false, reason: '结果有发布时间，但没有落在用户要求的时间范围内', highQualityResults, datedResults, matchedTimeRange, retry: true, status: 'SEARCH_DATE_MISMATCH' };
  }
  const minimumResults = ['latest_news', 'weather', 'sports', 'recommendation', 'comparison'].includes(plan.intent.intent) ? 3 : 2;
  const enoughResults = results.length >= minimumResults && (highQualityResults >= Math.min(3, minimumResults) || results.length >= 5);
  return {
    enoughResults,
    reason: enoughResults ? '结果数量和质量达到覆盖要求' : `候选结果不足或质量偏低（候选 ${results.length} 条，高质量 ${highQualityResults} 条）`,
    highQualityResults,
    datedResults,
    matchedTimeRange,
    retry: !enoughResults,
    status: enoughResults ? 'SEARCH_SUCCESS' : 'SEARCH_LOW_RELEVANCE',
  };
}

function logSearchTrace(input: string, plan: SearchPlan, trace: SearchTrace, coverage: SearchCoverage) {
  console.info('[SearchOrchestrator]', JSON.stringify({
    userQuery: input,
    intent: plan.intent.intent,
    topic: plan.intent.topic,
    resolvedTimeRange: plan.intent.timeRange,
    generatedQueries: plan.queries,
    round: trace.round,
    searchQueries: trace.queries,
    searchParams: { providerMode: 'configured-fallback', dateMode: 'query-encoded' },
    rawResultCount: trace.rawResultCount,
    dateFilterResultCount: trace.dateMatchedCount,
    semanticFilterResultCount: coverage.highQualityResults,
    finalResultCount: trace.selectedResultCount,
    retryReason: trace.retryReason || null,
  }));
}

function buildCoverageNote(plan: SearchPlan, strictMatchCount: number, finalCoverage: SearchCoverage, rounds: number) {
  const range = plan.intent.timeRange;
  if (!range || rounds <= 1 || !['today', 'yesterday', 'day-before-yesterday'].includes(range.value)) return undefined;
  const expandedLabel = range.value === 'today' ? '过去24/48小时' : '过去48小时';
  return `严格按${range.label}（${range.start}）找到 ${strictMatchCount} 条；为避免漏掉相关信息，已补充${expandedLabel}的结果，请结合每条结果的发布时间判断。${finalCoverage.matchedTimeRange ? `其中 ${finalCoverage.matchedTimeRange} 条落在原时间范围内。` : ''}`;
}


export async function searchWeb(query: string, signal?: AbortSignal, timezone = SEARCH_TIMEZONE): Promise<SearchResponse> {
  throwIfAborted(signal);
  const normalized = normalizedSearchInput(query);
  if (!normalized) throw new Error('请输入要搜索的内容');
  const plan = planSearch(normalized, new Date(), timezone);
  const news = isNewsQuery(normalized);
  const cacheKey = `${news ? 'news' : 'web'}:${normalized.toLocaleLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const apiConfigs = await getSearchApiConfigs();
  throwIfAborted(signal);
  if (!apiConfigs.length) throw new Error('AnySearch 匿名搜索暂不可用；可稍后重试，或设置 ANYSEARCH_API_KEY / QIANFAN_API_KEY 后继续使用');
  const allResults: WebSearchResult[] = [];
  const trace: SearchTrace[] = [];
  const attemptedQueries: string[] = [];
  const allAttempts: SearchAttempt[] = [];
  let strictMatchCount = 0;
  let finalCoverage: (SearchCoverage & { status: SearchStatus }) | null = null;
  let rounds = 0;

  for (let round = 0; round < MAX_SEARCH_ROUNDS; round += 1) {
    const queries = roundQueries(plan, round).filter((variant) => !attemptedQueries.includes(variant)).slice(0, MAX_QUERIES_PER_ROUND);
    if (!queries.length) break;
    attemptedQueries.push(...queries);
    const attempts = await Promise.all(queries.map((variant) => searchWithFallback(variant, plan, apiConfigs, signal)));
    throwIfAborted(signal);
    allAttempts.push(...attempts);
    const rawResultCount = attempts.reduce((total, attempt) => total + attempt.rawCount, 0);
    allResults.push(...attempts.flatMap((attempt) => attempt.results));
    const ranked = rankResults(allResults, normalized, plan).slice(0, 10);
    const coverage = evaluateCoverage(ranked, allAttempts, plan);
    if (round === 0) strictMatchCount = ranked.filter((result) => resultMatchesTimeRange(result, plan.intent.timeRange)).length;
    const roundTrace: SearchTrace = {
      round: round + 1,
      queries,
      rawResultCount,
      dateMatchedCount: ranked.filter((result) => resultMatchesTimeRange(result, plan.intent.timeRange)).length,
      selectedResultCount: ranked.length,
      ...(coverage.retry ? { retryReason: coverage.reason } : {}),
    };
    trace.push(roundTrace);
    finalCoverage = coverage;
    logSearchTrace(normalized, plan, roundTrace, coverage);
    rounds = round + 1;
    if (coverage.enoughResults) break;
  }

  const results = rankResults(allResults, normalized, plan).slice(0, 10);
  if (!finalCoverage) {
    finalCoverage = evaluateCoverage(results, allAttempts, plan);
  }
  const preferredProvider = allAttempts.find((attempt) => attempt.results.length)?.provider || apiConfigs[0].provider;
  const retrievedAt = new Date().toISOString();
  const normalizedResults = results.map((result) => ({ ...result, retrievedAt }));
  const enriched = await Promise.all(normalizedResults.slice(0, 3).map((result) => enrichResult(result, signal)));
  const finalResults = [...enriched, ...normalizedResults.slice(3)];
  const rawResultCount = allAttempts.reduce((total, attempt) => total + attempt.rawCount, 0);
  const coverageNote = buildCoverageNote(plan, strictMatchCount, finalCoverage, rounds);
  const warnings = [
    ...(coverageNote ? [coverageNote] : []),
    ...(finalCoverage.status === 'SEARCH_SUCCESS' ? [] : [finalCoverage.reason]),
  ];
  const suggestedAction = finalCoverage.status === 'SEARCH_SUCCESS'
    ? 'none'
    : finalCoverage.status === 'SEARCH_DATE_MISMATCH'
      ? 'expand_time_range'
      : finalCoverage.status === 'SEARCH_API_ERROR' || finalCoverage.status === 'SEARCH_TIMEOUT'
        ? 'retry_later'
        : 'rewrite_query';
  const response: SearchResponse = {
    source: 'external',
    provider: preferredProvider,
    query: normalized,
    rawResultCount,
    resultCount: finalResults.length,
    enrichedCount: enriched.filter((result) => Boolean(result.content)).length,
    searchedAt: new Date().toISOString(),
    results: finalResults,
    intent: plan.intent,
    queries: attemptedQueries,
    rounds,
    status: finalCoverage.status,
    coverage: finalCoverage,
    coverageNote,
    warnings,
    retryable: finalCoverage.status !== 'SEARCH_SUCCESS',
    suggestedAction,
    trace,
  };
  throwIfAborted(signal);
  cache.set(cacheKey, { expiresAt: Date.now() + (news ? NEWS_CACHE_TTL_MS : NORMAL_CACHE_TTL_MS), response });
  if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  return response;
}

export async function testWebSearchApi(config: ApiConfig) {
  const results = await searchWithApi(config.provider === 'anysearch' ? '2026年8月国内AI大模型新闻' : '百度千帆 AI 搜索 API 最新文档', config, false);
  if (!results.length) throw new Error(`${config.provider === 'anysearch' ? 'AnySearch' : '百度千帆'}接口已响应，但没有返回可用搜索结果，请检查搜索权限或免费额度状态。`);
  return { provider: config.provider, resultCount: results.length, sample: results.slice(0, 3) };
}
