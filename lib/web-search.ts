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
};

export type WebSearchProvider = 'anysearch' | 'baidu-qianfan';

export type SearchResponse = {
  source: 'external';
  provider: WebSearchProvider;
  query: string;
  resultCount: number;
  enrichedCount: number;
  searchedAt: string;
  results: WebSearchResult[];
};

type SearchAttempt = { provider: WebSearchProvider; results: WebSearchResult[]; error?: string };
type CacheEntry = { expiresAt: number; response: SearchResponse };
type ApiConfig = { provider: WebSearchApiProvider; apiKey: string };

const NORMAL_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const execFileAsync = promisify(execFile);

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

  constructor(message: string, options: { status?: number; code?: string; requestId?: string } = {}) {
    super(message);
    this.name = 'SearchApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
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

async function fetchJson(url: string, init: RequestInit, timeoutMs = 12_000, providerLabel = '搜索') {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const detail = upstreamErrorMessage(data);
    const code = upstreamErrorCode(data);
    const requestId = upstreamRequestId(data);
    const suffix = [code && `错误码 ${code}`, detail, requestId && `请求 ID ${requestId}`].filter(Boolean).join('：');
    throw new SearchApiError(`${providerLabel}接口返回 HTTP ${response.status}${suffix ? `（${suffix}）` : ''}`, { status: response.status, code, requestId });
  }
  return data;
}

async function fetchWithWindowsProxy(url: string, accept: string, timeoutSec = 8) {
  if (process.platform !== 'win32') throw new Error('网页正文连接失败');
  const command = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); (Invoke-WebRequest -UseBasicParsing -Uri $env:SANMAO_SEARCH_URL -Headers @{ Accept = $env:SANMAO_SEARCH_ACCEPT; 'User-Agent' = 'SANMAO.AI local assistant' } -TimeoutSec $env:SANMAO_SEARCH_TIMEOUT).Content";
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, SANMAO_SEARCH_URL: url, SANMAO_SEARCH_ACCEPT: accept, SANMAO_SEARCH_TIMEOUT: String(timeoutSec) },
    timeout: (timeoutSec + 3) * 1000,
    maxBuffer: 4_000_000,
    windowsHide: true,
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
    return {
      title: String(row?.title || row?.name || row?.page_title || row?.web_anchor || '').trim(),
      url,
      snippet,
      source: String(row?.website || row?.source || row?.media || row?.site_name || sourceFromUrl(url)).trim(),
      content: content || undefined,
    } satisfies WebSearchResult;
  }).filter((row: WebSearchResult) => row.title && /^https?:\/\//i.test(row.url));
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

async function searchWithBaiduQianfan(query: string, config: ApiConfig, news: boolean) {
  const legacyUrl = 'https://qianfan.baidubce.com/v2/ai_search';
  const officialUrl = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
  const legacyBody = JSON.stringify({ query: Array.from(query.trim()).slice(0, 160).join(''), max_results: 10 });
  const body = JSON.stringify(baiduOfficialBody(query, news));
  let lastError: unknown = null;

  // 首选控制台说明中的“智能搜索生成”接口：query + max_results。
  try {
    const data = await fetchJson(legacyUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: legacyBody,
    }, 12_000, '百度千帆搜索');
    const rows = normalizeBaiduRows(data);
    if (rows.length) return rows;
  } catch (error) {
    lastError = error;
    if (!(error instanceof SearchApiError) || ![400, 401, 403, 404].includes(error.status || 0)) throw error;
  }

  // 兼容百度当前文档中的新版百度搜索接口。
  try {
    const data = await fetchJson(officialUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    }, 12_000, '百度千帆搜索');
    const rows = normalizeBaiduRows(data);
    if (rows.length) return rows;
  } catch (error) {
    lastError = error;
  }

  // 部分 AppBuilder 应用只接受该兼容鉴权头，再尝试一次新版接口。
  try {
    const data = await fetchJson(officialUrl, {
      method: 'POST',
      headers: { 'X-Appbuilder-Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    }, 12_000, '百度千帆搜索');
    const rows = normalizeBaiduRows(data);
    if (rows.length) return rows;
  } catch (error) {
    lastError = error;
  }

  if (lastError instanceof Error) throw lastError;
  return [];
}

async function searchWithAnySearch(query: string, config: ApiConfig) {
  const body = JSON.stringify({ query: Array.from(query.trim()).slice(0, 220).join(''), zone: 'cn', max_results: 8 });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let lastError: unknown = null;
  for (const endpoint of ['https://api.anysearch.com/v1/search', 'https://api.anysearch.com/search']) {
    try {
      const data = await fetchJson(endpoint, { method: 'POST', headers, body }, 12_000, 'AnySearch');
      const rows = normalizeBaiduRows(data);
      if (rows.length) return rows;
      lastError = new SearchApiError('AnySearch 接口没有返回可用搜索结果');
    } catch (error) {
      lastError = error;
      if (error instanceof SearchApiError && ![400, 404].includes(error.status || 0)) throw error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  return [];
}

async function searchWithApi(query: string, config: ApiConfig, news: boolean) {
  if (config.provider === 'anysearch') return searchWithAnySearch(query, config);
  if (config.provider === 'baidu-qianfan') return searchWithBaiduQianfan(query, config, news);
  return [];
}

/* Kept as a narrow helper for the Windows-local transport used by page enrichment. */
async function fetchText(url: string, accept: string, timeoutMs = 5_000) {
  try {
    const response = await fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'SANMAO.AI local assistant' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`网页请求返回 HTTP ${response.status}`);
    return response.text();
  } catch (error) {
    try { return await fetchWithWindowsProxy(url, accept, Math.max(5, Math.round(timeoutMs / 1000))); } catch { throw error; }
  }
}

async function searchOne(query: string, preferNews: boolean, apiConfigs: ApiConfig[]): Promise<SearchAttempt> {
  if (apiConfigs.length) {
    const errors: string[] = [];
    for (const apiConfig of apiConfigs) {
      try {
        const ranked = rankResults(await searchWithApi(query, apiConfig, preferNews), query, preferNews);
        if (ranked.length) return { provider: apiConfig.provider, results: ranked };
        errors.push(`${apiConfig.provider === 'anysearch' ? 'AnySearch' : '百度千帆'}没有返回相关结果`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${apiConfig.provider} 搜索 API 请求失败`);
      }
    }
    return { provider: apiConfigs[apiConfigs.length - 1].provider, results: [], error: errors.join('；') };
  }
  return { provider: 'anysearch', results: [], error: 'AnySearch 匿名搜索暂不可用；可稍后重试，或设置 ANYSEARCH_API_KEY / QIANFAN_API_KEY 后继续使用' };
}

async function getSearchApiConfigs(): Promise<ApiConfig[]> {
  const configs: ApiConfig[] = [];
  const anySearchKey = process.env.ANYSEARCH_API_KEY?.trim();
  const qianfanEnvKey = process.env.QIANFAN_API_KEY?.trim();
  const stored = await getWebSearchApiConfig();
  if (anySearchKey) configs.push({ provider: 'anysearch', apiKey: anySearchKey });
  else if (stored?.provider === 'anysearch' && stored.apiKey) configs.push(stored);
  else configs.push({ provider: 'anysearch', apiKey: '' });
  if (qianfanEnvKey) configs.push({ provider: 'baidu-qianfan', apiKey: qianfanEnvKey });
  else if (stored?.provider === 'baidu-qianfan' && stored.apiKey) configs.push(stored);
  return configs;
}

/*
 * Search is deliberately provider-agnostic here: the model decides whether
 * it needs this tool, while the server owns credentials, caching and fallback.
 */
async function searchWithFallback(query: string, preferNews: boolean, apiConfigs: ApiConfig[]) {
  return searchOne(query, preferNews, apiConfigs);
}

async function enrichResult(result: WebSearchResult) {
  try {
    const html = await fetchText(result.url, 'text/html', 5_000);
    const content = stripHtml(html).slice(0, 3_000);
    return content.length > 120 ? { ...result, content } : result;
  } catch {
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

function buildQueries(input: string) {
  const normalized = input.trim().replace(/\s+/g, ' ').slice(0, 320);
  const withoutCommand = normalized
    .replace(/^(请|帮我|麻烦|可以|能否|请问|告诉我|帮忙)\s*/i, '')
    .replace(/^(?:联网|上网)?\s*(?:搜索|查询|查找|查一下|查查|查证|核验|核实)(?:一下)?\s*/i, '')
    .replace(/^(?:please\s+)?(?:search|look\s+up|check|verify)\s+(?:the\s+)?(?:web\s+for\s+)?/i, '')
    .replace(/^(?:这个|该)\s*/i, '')
    .trim();
  const compact = withoutCommand.replace(/^(今天|今日|现在|当前|最新)\s*/i, '').trim();
  const currentYear = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date());
  const dateExpanded = compact
    .replace(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?!\d)/g, `${currentYear}年$1月$2日`)
    .replace(/(?<!\d)(\d{1,2})月(\d{1,2})(?:日|号)?/g, `${currentYear}年$1月$2日`);
  const leadershipDeathQuery = /(国家领导人|领导人|总统|总理|国家元首).*(去世|逝世|死亡)|(去世|逝世|死亡).*(国家领导人|领导人|总统|总理|国家元首)/i.test(dateExpanded)
    ? `${dateExpanded} 总统 总理 国家元首 去世 逝世 病逝 新闻 央视 新华社`
    : '';
  const queries = leadershipDeathQuery
    ? [leadershipDeathQuery, dateExpanded, compact, withoutCommand, normalized]
    : [dateExpanded, withoutCommand, compact, normalized];
  if (compact && !/(官方|官网|来源|新闻|最新|时间|价格|版本)/i.test(compact)) queries.push(`${compact} 官方 最新`);
  return [...new Set(queries.filter((query) => query.length >= 2).map((query) => query.slice(0, 220)))].slice(0, 3);
}

function isNewsQuery(input: string) {
  return /(新闻|快讯|突发|去世|逝世|死亡|辞职|遇袭|选举|任命|地震|战争|冲突|事故|价格|报价|股价|费用|汇率|今天|今日|刚刚|最新消息|breaking|news|died|dead|resign|election)/i.test(input);
}

const QUERY_STOP_WORDS = /^(请|帮我|麻烦|可以|能否|请问|告诉我|帮忙|联网|上网|搜索|查询|查找|查一下|查查|查证|核验|核实|今天|今日|现在|当前|最新|消息|新闻|哪位|哪个|什么|是否|一下|这个|该|有|吗|呢|了|的|是|和|与|关于|一下子|please|search|look|up|check|verify|the|web|for|latest|current|information|info)$/i;

function queryTokens(input: string) {
  const tokens = new Set<string>();
  for (const token of input.toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/gi) || []) if (!QUERY_STOP_WORDS.test(token)) tokens.add(token);
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

function scoreResult(result: WebSearchResult, query: string, news: boolean) {
  if (isBlockedSource(result)) return -100;
  const tokens = queryTokens(query);
  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  const url = result.url.toLowerCase();
  const content = (result.content || '').toLowerCase();
  const allText = `${title} ${snippet} ${content}`;
  const leadershipDeathQuery = /(国家领导人|领导人|总统|总理|国家元首).*(去世|逝世|死亡|病逝)|(去世|逝世|死亡|病逝).*(国家领导人|领导人|总统|总理|国家元首)/i.test(query);
  if (leadershipDeathQuery && !/(去世|逝世|死亡|病逝|遇难)/i.test(allText)) return -100;
  if (leadershipDeathQuery && !/(领导人|总统|总理|国家元首|首相|国王|女王|总统府)/i.test(allText)) return -100;
  const hits = tokens.filter((token) => title.includes(token) || snippet.includes(token) || url.includes(token) || content.includes(token));
  const titleHits = tokens.filter((token) => title.includes(token)).length;
  const snippetHits = tokens.filter((token) => snippet.includes(token)).length;
  const score = titleHits * 4 + snippetHits * 2 + hits.length + (news && isNewsSource(result) ? 3 : 0);
  const minimum = tokens.length ? Math.max(2, Math.ceil(Math.min(tokens.length, 5) * 0.35)) : 0;
  if (news && !isNewsSource(result) && hits.length < Math.max(2, minimum)) return -100;
  if (tokens.length && hits.length < minimum) return -100;
  return score;
}

function rankResults(results: WebSearchResult[], query: string, news: boolean) {
  return dedupeResults(results)
    .map((result, index) => ({ result, score: scoreResult(result, query, news), index }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.result);
}


export async function searchWeb(query: string): Promise<SearchResponse> {
  const normalized = query.trim().replace(/\s+/g, ' ').slice(0, 320);
  if (!normalized) throw new Error('请输入要搜索的内容');
  const news = isNewsQuery(normalized);
  const cacheKey = `${news ? 'news' : 'web'}:${normalized.toLocaleLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const queryVariants = buildQueries(normalized);
  const apiConfigs = await getSearchApiConfigs();
  if (!apiConfigs.length) throw new Error('AnySearch 匿名搜索暂不可用；可稍后重试，或设置 ANYSEARCH_API_KEY / QIANFAN_API_KEY 后继续使用');
  const attempts = await Promise.all(queryVariants.map((variant) => searchWithFallback(variant, news, apiConfigs)));
  const preferredProvider = attempts.find((attempt) => attempt.results.length)?.provider || apiConfigs[0].provider;
  const results = dedupeResults(attempts.flatMap((attempt) => attempt.results)).slice(0, 10);
  if (!results.length) {
    const errors = attempts.map((attempt) => attempt.error).filter(Boolean);
    if (errors.length === attempts.length && errors[0]) throw new Error(errors[0]);
  }
  const enriched = await Promise.all(results.slice(0, 3).map(enrichResult));
  const response: SearchResponse = {
    source: 'external',
    provider: preferredProvider,
    query: normalized,
    resultCount: results.length,
    enrichedCount: enriched.filter((result) => Boolean(result.content)).length,
    searchedAt: new Date().toISOString(),
    results: [...enriched, ...results.slice(3)],
  };
  cache.set(cacheKey, { expiresAt: Date.now() + (news ? NEWS_CACHE_TTL_MS : NORMAL_CACHE_TTL_MS), response });
  if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  return response;
}

export async function testWebSearchApi(config: ApiConfig) {
  const results = await searchWithApi(config.provider === 'anysearch' ? '2026年8月国内AI大模型新闻' : '百度千帆 AI 搜索 API 最新文档', config, false);
  if (!results.length) throw new Error(`${config.provider === 'anysearch' ? 'AnySearch' : '百度千帆'}接口已响应，但没有返回可用搜索结果，请检查搜索权限或免费额度状态。`);
  return { provider: config.provider, resultCount: results.length, sample: results.slice(0, 3) };
}
