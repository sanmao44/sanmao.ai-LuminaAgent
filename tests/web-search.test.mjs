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

test('falls back from AnySearch failure to Baidu Qianfan', async () => {
  process.env.ANYSEARCH_API_KEY = 'test-anysearch-key';
  process.env.QIANFAN_API_KEY = 'test-qianfan-key';
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
  assert.equal(qianfanCall.init.headers.Authorization, 'Bearer test-qianfan-key');
  assert.equal(JSON.parse(qianfanCall.init.body).max_results, 10);
});
