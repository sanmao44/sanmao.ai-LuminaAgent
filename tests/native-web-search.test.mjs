import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const sourceUrl = new URL('../lib/native-web-search.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const detectionSourceUrl = new URL('../lib/native-search-detection.ts', import.meta.url);
const detectionSource = await readFile(detectionSourceUrl, 'utf8');
const providerStubs = `
const deepSeekToolSearch = (...args) => globalThis.__nativeDeepSeekToolSearch(...args);
const deepSeekToolFetch = (...args) => globalThis.__nativeDeepSeekToolFetch(...args);
`;
const bundledSource = `${providerStubs}\n${detectionSource.replace('export function inferNativeSearch', 'function inferNativeSearch')}\n${source
  .replace("import { inferNativeSearch } from './native-search-detection';", '')
  .replace("import { deepSeekToolFetch, deepSeekToolSearch, type DeepSeekToolSearchResult } from './providers';", '')}\nexport { inferNativeSearch, deepSeekToolSearch, deepSeekToolFetch };`;
const compiled = ts.transpileModule(bundledSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const nativeSearch = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const provider = {
  id: 'provider-1',
  name: '测试服务',
  type: 'openai-compatible',
  platform: 'openai',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'test-key',
  responsesPath: '/responses',
  chatPath: '/chat/completions',
};

const model = {
  rawId: 'gpt-5-search-preview',
  displayName: 'GPT Search',
  capabilities: ['chat', 'web-search'],
};

const messages = [
  { role: 'system', content: '只使用可靠来源回答。' },
  { role: 'user', content: '今天的最新消息是什么？' },
];

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__nativeDeepSeekToolSearch;
  delete globalThis.__nativeDeepSeekToolFetch;
});

test('detects native protocols from metadata and model ids', async () => {
  assert.deepEqual(nativeSearch.inferNativeSearch('gemini-2.5-pro', 'google-gemini', { tools: ['google_search'] }), {
    detected: true,
    protocol: 'gemini-grounding',
    detection: 'metadata',
  });
  assert.equal(nativeSearch.inferNativeSearch('sonar-pro', 'custom').protocol, 'native-chat');
  assert.equal(nativeSearch.inferNativeSearch('deepseek-v4-pro', 'deepseek').protocol, 'deepseek-tools');
});

test('uses native search only when the normalized model exposes the capability', () => {
  assert.equal(nativeSearch.nativeSearchIsEnabled({ capabilities: ['chat', 'web-search'], nativeSearchOverride: 'disabled' }), true);
  assert.equal(nativeSearch.nativeSearchIsEnabled({ capabilities: ['chat'], nativeSearchOverride: 'enabled' }), false);
  assert.equal(nativeSearch.resolveNativeSearchProtocol(provider, {
    rawId: 'gpt-5',
    capabilities: ['chat'],
    nativeSearchOverride: 'enabled',
  }), null);
});

test('uses OpenAI Responses web_search and extracts citations', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      model: 'gpt-5-search-preview',
      output_text: '最新消息来自官方公告。',
      output: [{ content: [{ annotations: [{ type: 'url_citation', title: '官方公告', url: 'https://example.test/news' }] }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await nativeSearch.runNativeWebSearch(provider, model, messages, '今天的最新消息');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/v1/responses');
  assert.deepEqual(calls[0].body.tools, [{ type: 'web_search' }]);
  assert.equal(result.source, 'native');
  assert.equal(result.protocol, 'openai-responses');
  assert.equal(result.resultCount, 1);
  assert.equal(result.citations[0].url, 'https://example.test/news');
});

test('does not expose native search planning or reasoning as the answer', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: "I've got a good set of results. Let me open a few key pages." }] },
      { type: 'web_search_call', status: 'completed' },
      { type: 'message', content: [{ type: 'output_text', text: '已根据可靠来源整理出今日热点。' }] },
    ],
    citations: [{ title: '官方来源', url: 'https://example.test/verified' }],
  }), { status: 200 });
  const result = await nativeSearch.runNativeWebSearch(provider, model, messages, '今日热点');
  assert.equal(result.text, '已根据可靠来源整理出今日热点。');
  assert.doesNotMatch(result.text, /I['’]ve got|Let me open|reasoning/i);
});

test('falls back to web_search_preview for Responses protocol rejection', async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (bodies.length === 1) return new Response(JSON.stringify({ error: { message: 'unsupported tool' } }), { status: 400 });
    return new Response(JSON.stringify({ output_text: '搜索完成。', citations: [{ title: '来源', url: 'https://example.test/source' }] }), { status: 200 });
  };
  const result = await nativeSearch.runNativeWebSearch(provider, model, messages, '搜索问题');
  assert.deepEqual(bodies.map((body) => body.tools), [[{ type: 'web_search' }], [{ type: 'web_search_preview' }]]);
  assert.equal(result.resultCount, 1);
});

test('uses Gemini google_search grounding and parses grounding chunks', async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'Gemini 搜索结果。' }] },
        groundingMetadata: { groundingChunks: [{ web: { title: 'Gemini 来源', uri: 'https://example.test/gemini' } }] },
      }],
    }), { status: 200 });
  };
  const result = await nativeSearch.runNativeWebSearch({ ...provider, type: 'google-gemini', platform: 'google-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }, { ...model, rawId: 'gemini-2.5-pro', nativeSearchProtocol: 'gemini-grounding' }, messages, '搜索问题');
  assert.match(call.url, /models\/gemini-2\.5-pro:generateContent\?key=test-key/);
  assert.deepEqual(call.body.tools, [{ google_search: {} }]);
  assert.equal(result.protocol, 'gemini-grounding');
  assert.equal(result.citations[0].url, 'https://example.test/gemini');
});

test('uses native chat models and parses citation arrays', async () => {
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Sonar 的回答。' } }], citations: ['https://example.test/sonar'] }), { status: 200 });
  };
  const result = await nativeSearch.runNativeWebSearch({ ...provider, platform: 'custom' }, { ...model, rawId: 'sonar-pro', nativeSearchProtocol: 'native-chat' }, messages, '搜索问题');
  assert.equal(body.model, 'sonar-pro');
  assert.equal(result.protocol, 'native-chat');
  assert.equal(result.citations[0].url, 'https://example.test/sonar');
});

test('rejects a native answer without verifiable sources so the route can fall back', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: '只有回答，没有来源。' }), { status: 200 });
  await assert.rejects(
    nativeSearch.runNativeWebSearch(provider, model, messages, '需要核验的问题'),
    /没有返回可核验的来源/,
  );
});

test('uses DeepSeek Search then fetches at most three pages', async () => {
  const searchInputs = [];
  const fetchUrls = [];
  globalThis.__nativeDeepSeekToolSearch = async (_provider, input) => {
    searchInputs.push(input);
    return { results: Array.from({ length: 5 }, (_, index) => ({ title: `结果 ${index + 1}`, url: `https://example.test/${index + 1}`, summary: `摘要 ${index + 1}` })) };
  };
  globalThis.__nativeDeepSeekToolFetch = async (_provider, url) => {
    fetchUrls.push(url);
    return { title: `页面 ${url.split('/').pop()}`, content: `正文 ${url}` };
  };
  const result = await nativeSearch.runNativeWebSearch(
    { ...provider, platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
    { ...model, rawId: 'deepseek-v4-pro' },
    messages,
    'DeepSeek V4 最新发布',
  );
  assert.equal(searchInputs[0].query, 'DeepSeek V4 最新发布');
  assert.equal(searchInputs[0].count, 10);
  assert.equal(searchInputs[0].need_content, true);
  assert.deepEqual(fetchUrls, ['https://example.test/1', 'https://example.test/2', 'https://example.test/3']);
  assert.equal(result.fetchedCount, 3);
  assert.equal(result.resultCount, 5);
  assert.match(result.text, /网页正文：正文 https:\/\/example\.test\/1/);
});

test('uses Search content before issuing billable Fetch requests', async () => {
  const fetchUrls = [];
  globalThis.__nativeDeepSeekToolSearch = async () => ({ results: [
    { title: '已有正文', url: 'https://example.test/with-content', summary: '摘要', content: 'Search 已返回正文' },
    { title: '缺正文', url: 'https://example.test/missing-content', summary: '摘要' },
    { title: '已有正文二', url: 'https://example.test/with-content-2', content: 'Search 正文二' },
  ] });
  globalThis.__nativeDeepSeekToolFetch = async (_provider, url) => {
    fetchUrls.push(url);
    return { title: '补抓页面', content: `Fetch 正文 ${url}` };
  };
  const result = await nativeSearch.runNativeWebSearch(
    { ...provider, platform: 'deepseek' },
    { ...model, rawId: 'deepseek-flash' },
    messages,
    '需要正文的搜索',
  );
  assert.deepEqual(fetchUrls, ['https://example.test/missing-content']);
  assert.equal(result.fetchedCount, 1);
  assert.match(result.text, /Search 已返回正文/);
  assert.match(result.text, /Fetch 正文 https:\/\/example\.test\/missing-content/);
  assert.doesNotMatch(result.text, /Fetch 正文 https:\/\/example\.test\/with-content/);
});

test('reports partial Fetch failures without discarding Search results', async () => {
  globalThis.__nativeDeepSeekToolSearch = async () => ({ results: [
    { title: '缺正文', url: 'https://example.test/missing-content', summary: '摘要' },
  ] });
  globalThis.__nativeDeepSeekToolFetch = async () => { throw new Error('抓取失败'); };
  const result = await nativeSearch.runNativeWebSearch(
    { ...provider, platform: 'deepseek' },
    { ...model, rawId: 'deepseek-flash' },
    messages,
    '需要容错的搜索',
  );
  assert.equal(result.fetchedCount, 0);
  assert.deepEqual(result.warnings, ['部分搜索结果网页抓取失败，已保留搜索摘要。']);
  assert.match(result.text, /摘要/);
});

test('does not count empty Fetch bodies as successful billable requests', async () => {
  globalThis.__nativeDeepSeekToolSearch = async () => ({ results: [
    { title: '空正文', url: 'https://example.test/empty-content', summary: '保留摘要' },
  ] });
  globalThis.__nativeDeepSeekToolFetch = async () => ({ title: '空页面', content: '   ' });
  const result = await nativeSearch.runNativeWebSearch(
    { ...provider, platform: 'deepseek' },
    { ...model, rawId: 'deepseek-flash' },
    messages,
    '空正文计费边界',
  );
  assert.equal(result.fetchedCount, 0);
  assert.deepEqual(result.warnings, ['部分搜索结果网页抓取失败或未返回正文，已保留搜索摘要。']);
  assert.match(result.text, /保留摘要/);
});

test('preserves a billable Search response when normalized rows are empty', async () => {
  globalThis.__nativeDeepSeekToolSearch = async () => ({ results: [], searchRequestCount: 1 });
  globalThis.__nativeDeepSeekToolFetch = async () => { throw new Error('不应调用 Fetch'); };
  const result = await nativeSearch.runNativeWebSearch(
    { ...provider, platform: 'deepseek' },
    { ...model, rawId: 'deepseek-flash' },
    messages,
    '原始 Search 有返回但结果无效',
  );
  assert.equal(result.resultCount, 0);
  assert.equal(result.searchRequestCount, 1);
  assert.equal(result.fetchedCount, 0);
});

test('fetches a direct user URL without Search', async () => {
  let searchCalls = 0;
  const fetchUrls = [];
  globalThis.__nativeDeepSeekToolSearch = async () => { searchCalls += 1; return { results: [] }; };
  globalThis.__nativeDeepSeekToolFetch = async (_provider, url) => { fetchUrls.push(url); return { title: '直达页面', content: '直达正文' }; };
  const result = await nativeSearch.runNativeWebSearch(
    { ...provider, platform: 'deepseek' },
    { ...model, rawId: 'deepseek-flash' },
    [{ role: 'user', content: '请读取 https://example.test/article。' }],
    '请读取网页',
  );
  assert.equal(searchCalls, 0);
  assert.deepEqual(fetchUrls, ['https://example.test/article']);
  assert.equal(result.searchRequestCount, 0);
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.citations[0].url, 'https://example.test/article');
});

test('does not count a direct URL Fetch with an empty body as successful', async () => {
  globalThis.__nativeDeepSeekToolSearch = async () => { throw new Error('不应调用 Search'); };
  globalThis.__nativeDeepSeekToolFetch = async () => ({ title: '空页面', content: '' });
  const result = await nativeSearch.runNativeWebSearch(
    { ...provider, platform: 'deepseek' },
    { ...model, rawId: 'deepseek-flash' },
    [{ role: 'user', content: '请读取 https://example.test/empty。' }],
    '请读取网页',
  );
  assert.equal(result.text, '');
  assert.deepEqual(result.citations, []);
  assert.equal(result.resultCount, 0);
  assert.equal(result.fetchedCount, 0);
  assert.deepEqual(result.warnings, ['网页抓取未返回正文，未计入成功 Fetch。']);
});
