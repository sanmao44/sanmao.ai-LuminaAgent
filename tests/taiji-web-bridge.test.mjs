import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { createBridgeServer, formatMessages } from '../scripts/taiji-web-bridge/server.mjs';

const SITE_ORIGIN = 'https://ai.zhuangxiuyunying.xyz';
const TEST_MODELS = [
  { id: 'kimi::kimi-k3', label: 'kimi-k3', price: '1积分', providerKey: 'kimi', providerName: 'kimi月之暗面' },
  { id: 'openai::gpt-6.2-sol', label: 'GPT-6.2-sol', price: '1积分', providerKey: 'openai', providerName: 'OpenAI' },
];
const DRAW_MODELS = [
  {
    kind: 'draw',
    id: 'taiji-draw::openai-draw::gpt-image-2',
    label: 'GPT Image 2',
    price: '',
    providerKey: 'openai-draw',
    providerName: 'OpenAI',
    drawModel: 'openai-draw',
    version: 'gpt-image-2',
    qualityOptions: ['low', 'high'],
  },
  {
    kind: 'draw',
    id: 'taiji-draw::google-draw::nano-banana-2',
    label: 'Nano Banana 2',
    price: '',
    providerKey: 'google-draw',
    providerName: 'Google',
    drawModel: 'google-draw',
    version: 'nano-banana-2',
  },
  {
    kind: 'draw',
    id: 'taiji-draw::mj::8.2',
    label: 'Midjourney 8.2',
    price: '',
    providerKey: 'mj',
    providerName: 'Midjourney',
    drawModel: 'mj',
    version: '8.2',
  },
];

test('web worker handles legacy chat jobs that omit their kind', async () => {
  const source = await readFile(new URL('../scripts/taiji-web-bridge/taiji-web-bridge.user.js', import.meta.url), 'utf8');
  let nextPollCount = 0;
  let resultBody;
  const resultObserved = new Promise((resolve) => {
    resultBody = { wait: resolve };
  });
  const statusNode = { dataset: {}, style: {}, textContent: '' };
  const document = {
    documentElement: { append() {} },
    getElementById() { return null; },
    createElement() { return statusNode; },
    querySelector(selector) { return selector === '.chat-create-float' ? null : null; },
    querySelectorAll(selector) { return selector === 'button.aa-sidebar-toolbar__btn' ? [] : []; },
  };
  const unsafeWindow = {
    fetch: async (url) => ({
      ok: true,
      async json() {
        if (String(url).endsWith('/api/chat/tmpl')) {
          return { code: 0, data: { models: [{ value: 'kimi::kimi-k3', label: 'kimi-k3', attr: { modelType: 'chat', integral: '1积分', providerKey: 'kimi', providerName: 'Kimi' } }] } };
        }
        return { code: 0, data: { state: {} } };
      },
    }),
  };
  const context = {
    document,
    location: { pathname: '/chat' },
    unsafeWindow,
    URL,
    Date,
    Promise,
    JSON,
    String,
    Object,
    Array,
    Error,
    setTimeout,
    clearTimeout,
    GM_getValue: async () => 'paired-token',
    GM_setValue: async () => {},
    GM_deleteValue: async () => {},
    GM_xmlhttpRequest(options) {
      const pathname = new URL(options.url).pathname;
      if (pathname === '/bridge/jobs/next') {
        nextPollCount += 1;
        if (nextPollCount > 1) return;
        options.onload({ status: 200, response: { job: { id: 'legacy-chat-job', prompt: '<user>\\nhello' } } });
        return;
      }
      if (pathname.endsWith('/result')) {
        resultBody.body = JSON.parse(options.data);
        resultBody.wait(resultBody.body);
        options.onload({ status: 202, response: { accepted: true } });
        return;
      }
      options.onload({ status: 200, response: { accepted: true, count: 1 } });
    },
  };
  vm.runInNewContext(source, context);
  const body = await Promise.race([
    resultObserved,
    new Promise((_, reject) => setTimeout(() => reject(new Error('legacy job was not handled')), 1000)),
  ]);
  assert.equal(body.error.startsWith('阶段 create_session 失败，未提交生成请求：'), true);
  assert.equal(body.error.includes('worker kind mismatch'), false);
});

async function createHarness(options = {}) {
  const pollCounts = { chat: 0, draw: 0 };
  const pollWaiters = { chat: [], draw: [] };
  const bridge = createBridgeServer({
    token: 'bridge-token-for-tests', pairCode: '12345678', modelCatalog: TEST_MODELS, ...options,
    onWorkerPoll(kind) {
      pollCounts[kind] += 1;
      for (const resolve of pollWaiters[kind].splice(0)) resolve();
      options.onWorkerPoll?.(kind);
    },
  });
  const address = await bridge.listen(0);
  return {
    bridge,
    baseUrl: `http://127.0.0.1:${address.port}`,
    waitForWorkerPoll(kind = 'chat') {
      const targetCount = pollCounts[kind] + 1;
      if (pollCounts[kind] >= targetCount) return Promise.resolve();
      return new Promise((resolve) => pollWaiters[kind].push(resolve));
    },
    async close() { await bridge.close(); },
  };
}

function localHeaders() {
  return { Authorization: 'Bearer local-bridge' };
}

function browserHeaders() {
  return { Authorization: 'Bearer bridge-token-for-tests', Origin: SITE_ORIGIN };
}

async function pair(baseUrl) {
  const response = await fetch(`${baseUrl}/bridge/pair`, {
    method: 'POST',
    headers: { Origin: SITE_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '12345678' }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function submitBrowserResult(baseUrl, job, content) {
  return fetch(`${baseUrl}/bridge/jobs/${job.id}/result`, {
    method: 'POST',
    headers: { ...browserHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

async function submitBrowserDrawResult(baseUrl, job, status) {
  return fetch(`${baseUrl}/bridge/jobs/${job.id}/result`, {
    method: 'POST',
    headers: { ...browserHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

test('recovers a completed Taiji reply from the current conversation when SSE parsing fails', async () => {
  const harness = await createHarness({ pollWaitMs: 5_000, jobTimeoutMs: 10_000 });
  const pairing = await pair(harness.baseUrl);
  assert.equal(pairing.token, 'bridge-token-for-tests');
  const label = 'kimi-k3';
  const expectedPrompt = '<user>\nbridge-dom-fallback-check';
  const reply = 'Taiji DOM fallback reply';
  let currentStatusNode;
  let resultPosted = false;
  let resolveWorkerPoll;
  const workerPollStarted = new Promise((resolve) => { resolveWorkerPoll = resolve; });
  const chatItems = [];
  const bridgeRequests = [];
  const bridgeResponses = [];
  const contextTimers = new Set();
  const testSetTimeout = (callback, milliseconds) => {
    const timer = setTimeout(() => {
      contextTimers.delete(timer);
      callback();
    }, milliseconds);
    contextTimers.add(timer);
    return timer;
  };
  const testClearTimeout = (timer) => {
    contextTimers.delete(timer);
    clearTimeout(timer);
  };
  const makeMessage = (role, text, renderer = null, messageId = '') => ({
    classList: { contains: (name) => role === name },
    innerText: text,
    getAttribute(name) { return name === 'data-message-id' ? messageId : null; },
    querySelector: (selector) => selector === '.markdown-renderer, .chat-text .aa-markdown, .chat-text' ? renderer : null,
  });
  const oldRenderer = { className: 'aa-markdown', innerText: 'Stale conversation reply' };
  chatItems.push(
    makeMessage('user', '<user>\nold prompt', null, 'old-user-id'),
    makeMessage('ai', 'Stale conversation reply', oldRenderer, 'old-assistant-id'),
  );

  const location = { pathname: '/chat', href: `${SITE_ORIGIN}/chat#new-session` };
  let panelOpen = false;
  let drawerOpen = false;
  let conversationReady = false;
  const body = { innerText: '' };
  const button = (text, click = () => {}) => ({ textContent: text, disabled: false, click });
  let textareaValue = '';
  class TestTextarea {
    constructor() { this.isConnected = true; }
    dispatchEvent() {}
    closest() { return chatInput; }
  }
  Object.defineProperty(TestTextarea.prototype, 'value', {
    get() { return textareaValue; },
    set(value) { textareaValue = String(value); },
  });
  const textarea = new TestTextarea();
  const modelButton = button('模型', () => { drawerOpen = true; });
  const switchButton = button('切换', () => {
    modelButton.textContent = label;
    drawerOpen = false;
  });
  const modelOption = {
    innerText: `${label}\n⚡1积分\n切换`,
    querySelector(selector) { return selector === '.model-select-list' ? { innerText: label } : null; },
    querySelectorAll(selector) { return selector === 'button' ? [switchButton] : []; },
    click() {},
  };
  const createButton = button('创建新对话', () => { conversationReady = true; });
  const plusButton = button('', () => { panelOpen = true; });
  plusButton.querySelector = (selector) => selector === '.fa-plus' ? {} : null;
  const sendButton = button('发送', () => {
    sendButton.textContent = '停止';
    location.href = `${SITE_ORIGIN}/chat#new-user-id`;
    const renderer = { className: 'aa-markdown', innerText: '' };
    chatItems.splice(0, chatItems.length);
    chatItems.push(
      makeMessage('user', textareaValue, null, 'new-user-id'),
      makeMessage('ai', '', renderer, 'new-assistant-id'),
    );
    void unsafeWindow.fetch('/api/chat/completions', { method: 'POST' }).catch(() => {});
    setTimeout(() => {
      renderer.innerText = reply;
      setTimeout(() => { sendButton.textContent = '发送'; }, 250);
    }, 25);
  });
  const chatInput = {
    querySelectorAll(selector) { return selector === 'button' ? [sendButton] : []; },
  };
  const createPanel = {
    querySelectorAll(selector) { return selector === 'button' ? [modelButton, createButton] : []; },
  };
  const panelButtons = [plusButton, modelButton, switchButton, createButton, sendButton];
  const document = {
    body,
    documentElement: { append(node) { currentStatusNode = node; } },
    getElementById() { return currentStatusNode || null; },
    createElement() { return { dataset: {}, style: {}, textContent: '' }; },
    querySelector(selector) {
      if (selector === '.chat-create-float') return panelOpen ? createPanel : null;
      if (selector === '.aa-chat-input') return chatInput;
      if (selector.startsWith('.chat-create-float textarea') || selector.startsWith('textarea[')) return conversationReady ? textarea : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'button.aa-sidebar-toolbar__btn') return [plusButton];
      if (selector === '.n-base-select-option') return drawerOpen ? [modelOption] : [];
      if (selector === 'button') return panelButtons;
      if (selector === '.chat-items .chat-item, #chat-content .chat-item') return chatItems;
      return [];
    },
  };
  const unsafeWindow = {
    location,
    async fetch(url) {
      const pathname = new URL(url, location.href).pathname;
      if (pathname === '/api/chat/tmpl') {
        return { ok: true, async json() { return { code: 0, data: { models: [{ value: 'kimi::kimi-k3', label, attr: { modelType: 'chat', integral: '1积分', providerKey: 'kimi', providerName: 'Kimi' } }] } }; } };
      }
      if (pathname === '/api/draw/template') return { ok: true, async json() { return { code: 0, data: { state: {} } }; } };
      if (pathname === '/api/chat/completions') {
        return {
          ok: true,
          clone: () => ({ body: { getReader: () => ({
            async read() { throw new Error('Taiji stream could not be parsed'); },
            releaseLock() {},
          }) } }),
        };
      }
      throw new Error(`Unexpected Taiji request: ${pathname}`);
    },
  };
  const context = {
    document,
    location,
    unsafeWindow,
    URL,
    Date,
    Promise,
    JSON,
    String,
    Object,
    Array,
    Error,
    AbortController,
    TextDecoder,
    HTMLTextAreaElement: TestTextarea,
    Event: class TestEvent {},
    setTimeout: testSetTimeout,
    clearTimeout: testClearTimeout,
    GM_getValue: async () => pairing.token,
    GM_setValue: async () => {},
    GM_deleteValue: async () => {},
    GM_xmlhttpRequest(options) {
      const url = new URL(options.url);
      bridgeRequests.push(`${options.method} ${url.pathname} auth=${options.headers?.Authorization === 'Bearer bridge-token-for-tests'}`);
      if (url.pathname === '/bridge/jobs/next' && resultPosted) return;
      if (url.pathname === '/bridge/jobs/next') resolveWorkerPoll();
      if (url.pathname.endsWith('/result')) resultPosted = true;
      const headers = { ...options.headers, Origin: SITE_ORIGIN };
      void fetch(options.url, {
        method: options.method,
        headers,
        ...(options.data === undefined ? {} : { body: options.data }),
      }).then(async (response) => {
        const responseText = await response.text();
        let data = responseText;
        try { data = responseText ? JSON.parse(responseText) : null; } catch { /* Keep plain text responses. */ }
        bridgeResponses.push({ path: url.pathname, status: response.status, data });
        options.onload({ status: response.status, response: data, responseText });
      }).catch(() => options.onerror?.());
    },
  };

  try {
    const source = await readFile(new URL('../scripts/taiji-web-bridge/taiji-web-bridge.user.js', import.meta.url), 'utf8');
    const testSource = source.replace(
      "const BRIDGE_ORIGIN = 'http://127.0.0.1:8787';",
      `const BRIDGE_ORIGIN = ${JSON.stringify(harness.baseUrl)};`,
    );
    assert.notEqual(testSource, source, 'the test bridge URL should point to the isolated harness');
    vm.runInNewContext(testSource, context);
    let pollTimeout;
    try {
      await Promise.race([
        workerPollStarted,
        new Promise((_, reject) => { pollTimeout = setTimeout(() => reject(new Error(`worker did not start polling; requests: ${bridgeRequests.join(', ')}; responses: ${JSON.stringify(bridgeResponses)}; status: ${currentStatusNode?.textContent}`)), 3_000); }),
      ]);
    } finally {
      clearTimeout(pollTimeout);
    }
    const completion = fetch(`${harness.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'kimi::kimi-k3', messages: [{ role: 'user', content: 'bridge-dom-fallback-check' }] }),
    });
    let responseTimeout;
    let response;
    try {
      response = await Promise.race([
        completion,
        new Promise((_, reject) => { responseTimeout = setTimeout(() => reject(new Error(`completion did not settle; requests: ${bridgeRequests.join(', ')}; status: ${currentStatusNode?.textContent}`)), 8_000); }),
      ]);
    } finally {
      clearTimeout(responseTimeout);
    }
    assert.equal(response.status, 200, JSON.stringify({
      body: await response.clone().text(),
      requests: bridgeRequests,
      responses: bridgeResponses,
      status: currentStatusNode?.textContent,
    }));
    const body = await response.json();
    assert.equal(body.choices[0].message.content, reply);
    assert.equal(textareaValue, expectedPrompt);
    assert.equal(resultPosted, true);
    assert.equal(location.href.endsWith('#new-user-id'), true);
    assert.equal(currentStatusNode.dataset.bridgeVersion, '1.1.3');
  } finally {
    for (const timer of contextTimers) clearTimeout(timer);
    contextTimers.clear();
    await harness.close();
  }
});

test('formats only text system, user, and assistant messages', () => {
  assert.equal(formatMessages([
    { role: 'system', content: '回答要简洁' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好。' },
    { role: 'user', content: '继续' },
  ]), '<system>\n回答要简洁\n\n<user>\n你好\n\n<assistant>\n你好。\n\n<user>\n继续');
  assert.throws(() => formatMessages([{ role: 'tool', content: 'x' }]), /Only system, user, and assistant/);
  assert.throws(() => formatMessages([{ role: 'user', content: [{ type: 'text', text: 'x' }] }]), /text messages only/);
});

test('exposes the synchronized Taiji catalog with prices and refuses cross-origin browser API access', async () => {
  const harness = await createHarness();
  try {
    const response = await fetch(`${harness.baseUrl}/v1/models`, { headers: localHeaders() });
    assert.equal(response.status, 200);
    const models = (await response.json()).data;
    assert.deepEqual(models.map((model) => model.id), TEST_MODELS.map((model) => model.id));
    assert.equal(models[0].name, 'kimi-k3 [1积分]');
    assert.equal(models[0].name.includes('/'), false);
    assert.equal(models[1].owned_by, 'openai');

    const crossOrigin = await fetch(`${harness.baseUrl}/v1/models`, {
      headers: { ...localHeaders(), Origin: 'https://example.test' },
    });
    assert.equal(crossOrigin.status, 403);

    const unauthorized = await fetch(`${harness.baseUrl}/v1/models`);
    assert.equal(unauthorized.status, 401);
  } finally {
    await harness.close();
  }
});

test('accepts a browser catalog refresh and rejects incomplete prices', async () => {
  const harness = await createHarness({ modelCatalog: [] });
  try {
    const unavailable = await fetch(`${harness.baseUrl}/v1/models`, { headers: localHeaders() });
    assert.equal(unavailable.status, 503);
    await pair(harness.baseUrl);
    const refreshed = await fetch(`${harness.baseUrl}/bridge/models/catalog`, {
      method: 'POST',
      headers: { ...browserHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: TEST_MODELS }),
    });
    assert.equal(refreshed.status, 200);
    assert.deepEqual(await refreshed.json(), { accepted: true, count: 2 });
    const invalid = await fetch(`${harness.baseUrl}/bridge/models/catalog`, {
      method: 'POST',
      headers: { ...browserHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: [{ ...TEST_MODELS[0], price: '未知' }] }),
    });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, 'invalid_model_catalog');
  } finally {
    await harness.close();
  }
});

test('accepts and clears a browser draw catalog refresh', async () => {
  const harness = await createHarness();
  try {
    await pair(harness.baseUrl);
    const refreshed = await fetch(`${harness.baseUrl}/bridge/models/catalog`, {
      method: 'POST',
      headers: { ...browserHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'draw', models: DRAW_MODELS }),
    });
    assert.equal(refreshed.status, 200);
    assert.deepEqual(await refreshed.json(), { accepted: true, count: DRAW_MODELS.length });

    const models = await fetch(`${harness.baseUrl}/v1/models`, { headers: localHeaders() });
    assert.deepEqual(
      (await models.json()).data.map((model) => model.id),
      [...TEST_MODELS, ...DRAW_MODELS].map((model) => model.id),
    );

    const cleared = await fetch(`${harness.baseUrl}/bridge/models/catalog`, {
      method: 'POST',
      headers: { ...browserHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'draw', models: [] }),
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await cleared.json(), { accepted: true, count: 0 });
  } finally {
    await harness.close();
  }
});

test('pairs once, relays one request, and returns an OpenAI-compatible completion', async () => {
  const harness = await createHarness();
  try {
    await pair(harness.baseUrl);
    const reusedCode = await fetch(`${harness.baseUrl}/bridge/pair`, {
      method: 'POST',
      headers: { Origin: SITE_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '12345678' }),
    });
    assert.equal(reusedCode.status, 410);

    const pollReady = harness.waitForWorkerPoll();
    const pollPromise = fetch(`${harness.baseUrl}/bridge/jobs/next`, { headers: browserHeaders() });
    await pollReady;
    const completionPromise = fetch(`${harness.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kimi::kimi-k3',
        messages: [{ role: 'user', content: '把这句话改得更清楚。' }],
      }),
    });

    const poll = await pollPromise;
    assert.equal(poll.status, 200);
    const { job } = await poll.json();
    assert.equal(job.model, 'kimi::kimi-k3');
    assert.equal(job.label, 'kimi-k3');
    assert.equal(job.price, '1积分');
    assert.equal(job.prompt, '<user>\n把这句话改得更清楚。');

    const accepted = await submitBrowserResult(harness.baseUrl, job, '把这句话表达得更清晰。');
    assert.equal(accepted.status, 202);
    const completion = await completionPromise;
    assert.equal(completion.status, 200);
    const body = await completion.json();
    assert.equal(body.model, 'kimi::kimi-k3');
    assert.equal(body.choices[0].message.content, '把这句话表达得更清晰。');
    assert.equal(body.choices[0].finish_reason, 'stop');

    const duplicate = await submitBrowserResult(harness.baseUrl, job, '重复结果');
    assert.equal(duplicate.status, 410);
  } finally {
    await harness.close();
  }
});

test('accepts Agent tool metadata as text-only chat and emits valid OpenAI SSE', async () => {
  const harness = await createHarness();
  try {
    await pair(harness.baseUrl);
    const pollReady = harness.waitForWorkerPoll();
    const pollPromise = fetch(`${harness.baseUrl}/bridge/jobs/next`, { headers: browserHeaders() });
    await pollReady;
    const completionPromise = fetch(`${harness.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kimi::kimi-k3',
        stream: true,
        messages: [{ role: 'user', content: 'say hello' }],
        tools: [{ type: 'function', function: { name: 'fixture', parameters: {} } }],
        tool_choice: 'auto',
      }),
    });
    const poll = await pollPromise;
    assert.equal(poll.status, 200);
    const { job } = await poll.json();
    assert.equal(job.prompt, '<user>\nsay hello');
    await submitBrowserResult(harness.baseUrl, job, '你好');
    const completion = await completionPromise;
    assert.equal(completion.status, 200);
    assert.match(completion.headers.get('content-type'), /text\/event-stream/);
    const stream = await completion.text();
    assert.match(stream, /"content":"你好"/);
    assert.match(stream, /"finish_reason":"stop"/);
    assert.match(stream, /data: \[DONE\]/);
  } finally {
    await harness.close();
  }
});

test('does not retry a request when the browser worker is offline', async () => {
  const isolated = await createHarness({ workerFreshMs: 10, pollWaitMs: 5 });
  try {
    await pair(isolated.baseUrl);
    const response = await fetch(`${isolated.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'kimi::kimi-k3', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'browser_worker_offline');
  } finally {
    await isolated.close();
  }
});

test('merges chat and draw catalogs by kind and exposes generate capability', async () => {
  const harness = await createHarness({ modelCatalog: [...TEST_MODELS, ...DRAW_MODELS] });
  try {
    const before = await fetch(`${harness.baseUrl}/v1/models`, { headers: localHeaders() });
    assert.equal(before.status, 200);
    const initial = (await before.json()).data;
    assert.deepEqual(initial.map((model) => model.id), [...TEST_MODELS, ...DRAW_MODELS].map((model) => model.id));
    assert.deepEqual(initial.find((model) => model.id === DRAW_MODELS[0].id).capabilities, ['generate']);

    await pair(harness.baseUrl);
    const refreshed = await fetch(`${harness.baseUrl}/bridge/models/catalog`, {
      method: 'POST',
      headers: { ...browserHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'chat', models: [TEST_MODELS[0]] }),
    });
    assert.equal(refreshed.status, 200);
    const after = await fetch(`${harness.baseUrl}/v1/models`, { headers: localHeaders() });
    assert.deepEqual((await after.json()).data.map((model) => model.id), [TEST_MODELS[0].id, ...DRAW_MODELS.map((model) => model.id)]);
  } finally {
    await harness.close();
  }
});

test('keeps draw jobs on draw workers and maps a completed Taiji task to b64_json', async () => {
  const imageBytes = Buffer.from('taiji-fixture-png');
  const harness = await createHarness({
    modelCatalog: [...TEST_MODELS, ...DRAW_MODELS],
    fetchImage: async (url) => {
      assert.equal(url, 'https://s3.taiyangai.cn/f/fixture.png');
      return { mimeType: 'image/png', bytes: imageBytes };
    },
    pollWaitMs: 5_000,
  });
  try {
    await pair(harness.baseUrl);
    const drawPollReady = harness.waitForWorkerPoll('draw');
    const chatPollReady = harness.waitForWorkerPoll('chat');
    const drawPoll = fetch(`${harness.baseUrl}/bridge/jobs/next?kind=draw`, { headers: browserHeaders() });
    const chatPoll = fetch(`${harness.baseUrl}/bridge/jobs/next?kind=chat`, { headers: browserHeaders() });
    await Promise.all([drawPollReady, chatPollReady]);
    const imageRequest = fetch(`${harness.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DRAW_MODELS[0].id,
        prompt: 'a red kite above a quiet lake',
        n: 1,
        size: '1536x1024',
        quality: 'high',
        response_format: 'b64_json',
      }),
    });
    const drawResponse = await drawPoll;
    assert.equal(drawResponse.status, 200);
    const { job } = await drawResponse.json();
    assert.equal(job.kind, 'draw');
    assert.deepEqual(job.request, {
      model: 'openai-draw',
      action: 'IMAGINE',
      public: false,
      fast: false,
      prompt: 'a red kite above a quiet lake',
      no: '',
      args: {
        version: 'gpt-image-2',
        area: '1536x1024',
        output_max: 1,
        quality: 'high',
        moderation: 'auto',
        background: 'auto',
      },
    });
    const chatResponse = await chatPoll;
    assert.equal(chatResponse.status, 204);

    const resultPromise = submitBrowserDrawResult(harness.baseUrl, job, {
      taskId: 'task-fixture',
      status: 'COMPLETE',
      end: true,
      outImages: [{ url: 'https://s3.taiyangai.cn/f/fixture.png' }],
    });
    const accepted = await resultPromise;
    assert.equal(accepted.status, 202);
    const response = await imageRequest;
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data[0].b64_json, imageBytes.toString('base64'));
  } finally {
    await harness.close();
  }
});

test('rejects unsupported image inputs before enqueueing a Taiji draw job', async () => {
  const harness = await createHarness({ modelCatalog: DRAW_MODELS });
  try {
    await pair(harness.baseUrl);
    const response = await fetch(`${harness.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DRAW_MODELS[0].id, prompt: 'fixture', images: ['data:image/png;base64,AA=='] }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'reference_images_unsupported');

    const unknown = await fetch(`${harness.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DRAW_MODELS[0].id, prompt: 'fixture', seed: 1 }),
    });
    assert.equal(unknown.status, 422);
    assert.equal((await unknown.json()).error.code, 'unsupported_image_parameter');

    const edit = await fetch(`${harness.baseUrl}/v1/images/edits`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DRAW_MODELS[0].id, prompt: 'fixture', image: 'data:image/png;base64,AA==' }),
    });
    assert.equal(edit.status, 422);
    assert.equal((await edit.json()).error.code, 'reference_images_unsupported');
  } finally {
    await harness.close();
  }
});

test('rejects incomplete Taiji status and image URLs outside the confirmed CDN list', async () => {
  let fetchCount = 0;
  const harness = await createHarness({
    modelCatalog: DRAW_MODELS,
    pollWaitMs: 5_000,
    fetchImage: async () => { fetchCount += 1; return { mimeType: 'image/png', bytes: Buffer.from('fixture') }; },
  });
  try {
    await pair(harness.baseUrl);
    const pollReady = harness.waitForWorkerPoll('draw');
    const poll = fetch(`${harness.baseUrl}/bridge/jobs/next?kind=draw`, { headers: browserHeaders() });
    await pollReady;
    const request = fetch(`${harness.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DRAW_MODELS[0].id, prompt: 'fixture' }),
    });
    const pollResponse = await poll;
    const { job } = await pollResponse.json();
    const accepted = await submitBrowserDrawResult(harness.baseUrl, job, {
      taskId: 'untrusted-fixture', status: 'COMPLETE', end: true,
      outImages: [{ url: 'https://attacker.example/pixel.png' }],
    });
    assert.equal(accepted.status, 202);
    await accepted.arrayBuffer();
    const response = await request;
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'image_url_denied');
    assert.equal(fetchCount, 0);
  } finally {
    await harness.close();
  }
});

test('uses distinct Google args and Midjourney prompt flags', async () => {
  const harness = await createHarness({
    modelCatalog: DRAW_MODELS,
    pollWaitMs: 5_000,
    fetchImage: async () => ({ mimeType: 'image/png', bytes: Buffer.from('fixture') }),
  });
  try {
    await pair(harness.baseUrl);
    const googlePollReady = harness.waitForWorkerPoll('draw');
    const googlePoll = fetch(`${harness.baseUrl}/bridge/jobs/next?kind=draw`, { headers: browserHeaders() });
    await googlePollReady;
    const googleRequest = fetch(`${harness.baseUrl}/v1/images/generations`, {
      method: 'POST', headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DRAW_MODELS[1].id, prompt: 'a paper boat', size: '1024x1024', resolution: '1K' }),
    });
    const googlePollResponse = await googlePoll;
    const googleJob = (await googlePollResponse.json()).job;
    assert.deepEqual(googleJob.request.args, { version: 'nano-banana-2', resolution: '1K', area: '1:1' });
    const googleAccepted = await submitBrowserDrawResult(harness.baseUrl, googleJob, {
      taskId: 'google-fixture', status: 'COMPLETE', end: true,
      outImages: [{ url: 'https://s3.taiyangai.cn/f/google.png' }],
    });
    assert.equal(googleAccepted.status, 202);
    await googleAccepted.arrayBuffer();
    assert.equal((await googleRequest).status, 200);

    const mjPollReady = harness.waitForWorkerPoll('draw');
    const mjPoll = fetch(`${harness.baseUrl}/bridge/jobs/next?kind=draw`, { headers: browserHeaders() });
    await mjPollReady;
    const mjRequest = fetch(`${harness.baseUrl}/v1/images/generations`, {
      method: 'POST', headers: { ...localHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DRAW_MODELS[2].id, prompt: 'a paper boat', size: '1024x1024' }),
    });
    const mjPollResponse = await mjPoll;
    const mjJob = (await mjPollResponse.json()).job;
    assert.equal(mjJob.request.prompt, 'a paper boat --ar 1:1 --v 8.2');
    const mjAccepted = await submitBrowserDrawResult(harness.baseUrl, mjJob, {
      taskId: 'mj-fixture', status: 'COMPLETE', end: true,
      outImages: [{ url: 'https://s3.taiyangai.cn/f/mj.png' }],
    });
    assert.equal(mjAccepted.status, 202);
    await mjAccepted.arrayBuffer();
    assert.equal((await mjRequest).status, 200);
  } finally {
    await harness.close();
  }
});
