import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/web-search.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText.replace(
  "import { getWebSearchApiConfig } from '@/lib/store';",
  'const getWebSearchApiConfig = async () => null;',
);
const webSearch = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const originalFetch = globalThis.fetch;
const originalAnySearchKey = process.env.ANYSEARCH_API_KEY;
const originalQianfanKey = process.env.QIANFAN_API_KEY;

after(() => {
  globalThis.fetch = originalFetch;
  if (originalAnySearchKey === undefined) delete process.env.ANYSEARCH_API_KEY;
  else process.env.ANYSEARCH_API_KEY = originalAnySearchKey;
  if (originalQianfanKey === undefined) delete process.env.QIANFAN_API_KEY;
  else process.env.QIANFAN_API_KEY = originalQianfanKey;
});

function resultPayload(title = 'OpenAI API latest news') {
  return {
    results: [{
      title,
      url: 'https://example.com/openai-latest',
      snippet: 'OpenAI API latest news and official updates',
    }],
  };
}

test('sends the documented AnySearch POST payload', async () => {
  process.env.ANYSEARCH_API_KEY = 'test-anysearch-key';
  delete process.env.QIANFAN_API_KEY;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(resultPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const response = await webSearch.testWebSearchApi({ provider: 'anysearch', apiKey: 'test-anysearch-key' });
  assert.equal(response.provider, 'anysearch');
  assert.equal(response.resultCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anysearch.com/v1/search');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-anysearch-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    query: '2026年8月国内AI大模型新闻',
    zone: 'cn',
    max_results: 8,
  });
});

test('supports anonymous AnySearch access without an Authorization header', async () => {
  delete process.env.ANYSEARCH_API_KEY;
  delete process.env.QIANFAN_API_KEY;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(resultPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const response = await webSearch.testWebSearchApi({ provider: 'anysearch', apiKey: '' });
  assert.equal(response.provider, 'anysearch');
  assert.equal(calls[0].url, 'https://api.anysearch.com/v1/search');
  assert.equal('Authorization' in calls[0].init.headers, false);
});

test('retries anonymous AnySearch with the generated key without exposing credentials', async () => {
  delete process.env.ANYSEARCH_API_KEY;
  delete process.env.QIANFAN_API_KEY;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ message: 'Use the API key below. username=alice password=secret api_key=generated-anysearch-key' }), { status: 402 });
    }
    return new Response(JSON.stringify(resultPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const response = await webSearch.testWebSearchApi({ provider: 'anysearch', apiKey: '' });
  assert.equal(response.resultCount, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer generated-anysearch-key');
});

test('normalizes copied authorization prefixes before calling Baidu Qianfan', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(resultPayload('Baidu Qianfan search docs')), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const response = await webSearch.testWebSearchApi({ provider: 'baidu-qianfan', apiKey: ' Authorization: Bearer bce-v3/ALTAK-test/abcdef0123456789 ' });
  assert.equal(response.provider, 'baidu-qianfan');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bce-v3/ALTAK-test/abcdef0123456789');
});

test('turns Qianfan invalid authorization into an actionable error without leaking the key', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 216003, message: 'Fail to parse apikey authorization' }), { status: 401 });
  await assert.rejects(
    webSearch.testWebSearchApi({ provider: 'baidu-qianfan', apiKey: 'bce-v3/ALTAK-test/abcdef0123456789' }),
    /百度千帆 API Key 无效或鉴权格式不正确/,
  );
});

test('recognizes the current Qianfan API Key shape and rejects short saved values', () => {
  assert.equal(webSearch.isLikelyBaiduQianfanApiKey('Bearer bce-v3/ALTAK-test/abcdef0123456789'), true);
  assert.equal(webSearch.isLikelyBaiduQianfanApiKey('87654321'), false);
});

test('expands relative-date news queries with the current local date', async () => {
  process.env.ANYSEARCH_API_KEY = 'test-anysearch-key';
  delete process.env.QIANFAN_API_KEY;
  const calls = [];
  const currentDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeZone: 'Asia/Shanghai' }).format(new Date());
  const currentIsoDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date());
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    calls.push({ endpoint, init });
    if (endpoint === 'https://api.anysearch.com/v1/search') {
      return new Response(JSON.stringify({ results: [{ title: `${currentDate} AI 行业新闻`, url: 'https://example.com/ai-news', snippet: `${currentDate} AI 行业最新新闻` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (endpoint === 'https://example.com/ai-news') return new Response('<html><body>AI 行业新闻</body></html>', { status: 200 });
    return new Response('', { status: 404 });
  };

  const response = await webSearch.searchWeb('今天AI界有什么新闻？');
  assert.equal(response.resultCount, 1);
  assert.match(JSON.parse(calls[0].init.body).query, /AI界/);
  assert.match(JSON.parse(calls[0].init.body).query, /新闻/);
  assert.match(JSON.parse(calls[0].init.body).query, new RegExp(currentIsoDate));
  assert.equal(response.intent.intent, 'latest_news');
  assert.equal(response.intent.timeRange.value, 'today');
  assert.ok(response.status);
  assert.ok(response.trace.length >= 1);
});

test('does not claim date coverage when sources have no parseable timestamps', async () => {
  process.env.ANYSEARCH_API_KEY = 'test-anysearch-key';
  delete process.env.QIANFAN_API_KEY;
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    if (endpoint === 'https://api.anysearch.com/v1/search') {
      return new Response(JSON.stringify({ results: [
        { title: 'AI 行业资讯', url: 'https://example.com/undated-ai-a', snippet: '人工智能行业动态与模型进展' },
        { title: 'AI 公司动态', url: 'https://example.com/undated-ai-b', snippet: 'AI 公司与产品更新' },
        { title: 'AI 技术进展', url: 'https://example.com/undated-ai-c', snippet: '人工智能技术研究进展' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/undated-ai-[abc]$/.test(new URL(endpoint).pathname)) return new Response('<html><body>AI 候选来源正文。</body></html>', { status: 200 });
    return new Response('', { status: 404 });
  };

  const response = await webSearch.searchWeb('今天没有日期的 AI 行业资讯');
  assert.equal(response.status, 'SEARCH_DATE_MISMATCH');
  assert.equal(response.coverage.datedResults, 0);
  assert.equal(response.coverage.matchedTimeRange, 0);
  assert.equal(response.rounds, 3);
  assert.equal(response.resultCount, 3);
  assert.equal(response.retryable, true);
  assert.match(response.coverageNote, /没有解析到可核验的发布时间/);
});

test('resolves calendar language and plans intent-specific query variants', () => {
  const fixedNow = new Date('2026-09-05T10:30:00+08:00');
  const today = webSearch.resolveTimeRange('今天 AI 有什么新闻？', fixedNow, 'Asia/Shanghai');
  const yesterday = webSearch.resolveTimeRange('昨天 OpenAI 发生了什么？', fixedNow, 'Asia/Shanghai');
  const pastDay = webSearch.resolveTimeRange('过去24小时 AI 新闻', fixedNow, 'Asia/Shanghai');
  const week = webSearch.resolveTimeRange('这周 AI 有什么进展？', fixedNow, 'Asia/Shanghai');
  assert.deepEqual({ start: today.start, end: today.end, value: today.value }, { start: '2026-09-05', end: '2026-09-05', value: 'today' });
  assert.deepEqual({ start: yesterday.start, end: yesterday.end, value: yesterday.value }, { start: '2026-09-04', end: '2026-09-04', value: 'yesterday' });
  assert.equal(new Date(pastDay.endAt).getTime() - new Date(pastDay.startAt).getTime(), 24 * 60 * 60 * 1000);
  assert.deepEqual({ start: week.start, end: week.end, value: week.value }, { start: '2026-08-31', end: '2026-09-06', value: 'this-week' });

  const plan = webSearch.planSearch('今天AI界有什么新闻？', fixedNow, 'Asia/Shanghai');
  assert.equal(plan.intent.intent, 'latest_news');
  assert.equal(plan.intent.topic, 'AI界');
  assert.match(plan.queries[0], /2026-09-05/);
  assert.match(plan.queries[1], /artificial intelligence/i);
  assert.ok(plan.relaxedQueries.some((query) => /过去24小时|past 24 hours/i.test(query)));
  assert.equal(webSearch.analyzeSearchIntent('牛顿是谁？').needsWeb, false);
  assert.equal(webSearch.analyzeSearchIntent('给我推荐北京适合周末去的咖啡店').needsWeb, true);
  assert.equal(webSearch.analyzeSearchIntent('苹果最新发布了什么？').intent, 'current_status');
  assert.equal(webSearch.planSearch('2024年OpenAI发生了什么？').intent.timeRange.start, '2024-01-01');
  const multiEntityPlan = webSearch.planSearch('今天英伟达和 AMD 分别有什么新闻？');
  assert.ok(multiEntityPlan.queries.some((query) => /英伟达/.test(query)));
  assert.ok(multiEntityPlan.queries.some((query) => /AMD/i.test(query)));
});

test('returns machine-readable coverage and retries with a rewritten query', async () => {
  process.env.ANYSEARCH_API_KEY = 'test-anysearch-key';
  delete process.env.QIANFAN_API_KEY;
  const calls = [];
  const currentIsoDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date());
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    calls.push({ endpoint, init });
    const query = JSON.parse(init.body).query;
    if (endpoint === 'https://api.anysearch.com/v1/search' && /最新消息 过去24小时|past 24 hours/i.test(query)) {
      return new Response(JSON.stringify({ results: [
        { title: 'AI 新闻 A', url: 'https://example.com/retry-a', snippet: 'AI 最新消息', published_at: `${currentIsoDate}T08:00:00+08:00` },
        { title: 'AI 新闻 B', url: 'https://example.com/retry-b', snippet: '人工智能 行业进展', published_at: `${currentIsoDate}T07:00:00+08:00` },
        { title: 'AI 新闻 C', url: 'https://example.com/retry-c', snippet: 'AI 公司动态', published_at: `${currentIsoDate}T06:00:00+08:00` },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (endpoint === 'https://api.anysearch.com/v1/search') return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/retry-[abc]$/.test(new URL(endpoint).pathname)) return new Response('<html><body>AI 新闻正文内容足够长，可以作为来源片段展示给最终回答。</body></html>', { status: 200 });
    return new Response('', { status: 404 });
  };

  const response = await webSearch.searchWeb('今天AI行业有哪些重要新闻？');
  assert.equal(response.status, 'SEARCH_SUCCESS');
  assert.equal(response.rawResultCount, 6);
  assert.equal(response.resultCount, 3);
  assert.equal(response.rounds, 2);
  assert.equal(response.coverage.enoughResults, true);
  assert.equal(response.coverage.matchedTimeRange, 3);
  assert.equal(response.results.filter((result) => result.publishedAt?.startsWith(currentIsoDate)).length, 3);
  assert.equal(response.retryable, false);
  assert.equal(response.suggestedAction, 'none');
  assert.ok(response.trace[0].retryReason);
  assert.ok(response.queries.some((query) => /过去24小时/.test(query)));
  assert.ok(calls.length >= 4);
});

test('falls back from AnySearch failure to Baidu Qianfan', async () => {
  process.env.ANYSEARCH_API_KEY = 'test-anysearch-key';
  process.env.QIANFAN_API_KEY = 'bce-v3/ALTAK-test/abcdef0123456789';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    calls.push({ endpoint, init });
    if (endpoint === 'https://api.anysearch.com/v1/search') {
      return new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 });
    }
    if (endpoint === 'https://qianfan.baidubce.com/v2/ai_search') {
      return new Response(JSON.stringify(resultPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (endpoint === 'https://example.com/openai-latest') {
      return new Response('<html><body>OpenAI API latest news</body></html>', { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  const response = await webSearch.searchWeb('OpenAI API latest');
  assert.equal(response.provider, 'baidu-qianfan');
  assert.equal(response.resultCount, 1);
  assert.ok(calls.some((call) => call.endpoint === 'https://api.anysearch.com/v1/search'));
  const qianfanCall = calls.find((call) => call.endpoint === 'https://qianfan.baidubce.com/v2/ai_search');
  assert.ok(qianfanCall);
  assert.equal(qianfanCall.init.headers.Authorization, 'Bearer bce-v3/ALTAK-test/abcdef0123456789');
  assert.equal(JSON.parse(qianfanCall.init.body).max_results, 10);
});

test('distinguishes a successful empty search from an API error', async () => {
  process.env.ANYSEARCH_API_KEY = 'test-anysearch-key';
  delete process.env.QIANFAN_API_KEY;
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const response = await webSearch.searchWeb('一个不存在的冷门主题的最新消息');
  assert.equal(response.status, 'SEARCH_ZERO_RESULTS');
  assert.equal(response.rawResultCount, 0);
  assert.equal(response.resultCount, 0);
  assert.equal(response.suggestedAction, 'rewrite_query');
  assert.equal(response.retryable, true);
});
