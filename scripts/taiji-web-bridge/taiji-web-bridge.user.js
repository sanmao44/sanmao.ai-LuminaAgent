// ==UserScript==
// @name         SANMAO Taiji Web Chat Bridge
// @namespace    sanmao.local
// @version      1.1.2
// @description  Relays SANMAO chat and image requests through logged-in Taiji pages.
// @match        https://ai.zhuangxiuyunying.xyz/chat*
// @match        https://ai.zhuangxiuyunying.xyz/draw*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @updateURL    http://127.0.0.1:8787/taiji-web-bridge.user.js
// @downloadURL  http://127.0.0.1:8787/taiji-web-bridge.user.js
// ==/UserScript==

(() => {
  'use strict';

  const BRIDGE_ORIGIN = 'http://127.0.0.1:8787';
  const TOKEN_KEY = 'sanmao-taiji-web-bridge-token-v1';
  const REQUEST_TIMEOUT_MS = 25_000;
  const GENERATION_TIMEOUT_MS = 180_000;
  const DRAW_TIMEOUT_MS = 30 * 60 * 1000;
  const DRAW_POLL_INTERVAL_MS = 1_800;
  const CATALOG_REFRESH_MS = 60_000;
  const CHAT_ITEMS_SELECTOR = '#chat-content .chat-item';
  // Taiji switches chat/draw views through client-side routing. The userscript
  // can survive that navigation, so resolve the queue kind at each poll/job
  // boundary instead of freezing the kind from the initial document URL.
  function currentWorkerKind() {
    return location.pathname.startsWith('/draw') ? 'draw' : 'chat';
  }
  const DRAW_MODEL_GROUPS = [
    { stateKey: 'openai-draw', drawModel: 'openai-draw', providerKey: 'openai-draw', providerName: 'OpenAI', label: 'GPT Image', versions: ['gpt-image-2', 'gpt-image-2-5-flare', 'gpt-image-2-5-sunburst', 'gpt-image-2-6-flare', 'gpt-image-2-6-sunburst'] },
    { stateKey: 'google-draw', drawModel: 'google-draw', providerKey: 'google-draw', providerName: 'Google', label: 'Nano Banana', versions: ['nano-banana-2', 'nano-banana-pro'] },
    { stateKey: 'mj', drawModel: 'mj', providerKey: 'mj', providerName: 'Midjourney', label: 'Midjourney', enabledKey: 'enabled', versions: ['8.2', '8.1', '7', '6.1', '6', '5.2', '5.1', '5'] },
    { stateKey: 'niji', drawModel: 'niji', providerKey: 'niji', providerName: 'Niji', label: 'Niji', enabledKey: 'enabled', versions: ['7', '6', '5'] },
  ];
  let working = false;
  let lastCatalogSyncAt = 0;

  function setStatus(message, isError = false) {
    let status = document.getElementById('sanmao-taiji-web-bridge-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'sanmao-taiji-web-bridge-status';
      Object.assign(status.style, {
        position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
        maxWidth: 'min(360px, calc(100vw - 24px))', padding: '7px 10px',
        borderRadius: '6px', border: '1px solid #b9c8cc', background: '#fff',
        color: '#20323a', font: '12px/1.4 system-ui, sans-serif', boxShadow: '0 2px 8px #0002',
      });
      document.documentElement.append(status);
    }
    status.dataset.bridgeVersion = '1.1.2';
    status.textContent = `SANMAO 桥接 v1.1.2：${message}`;
    status.style.borderColor = isError ? '#c65b50' : '#b9c8cc';
    status.style.color = isError ? '#9d2f27' : '#20323a';
  }

  function request(path, { method = 'GET', body, token = '', timeout = REQUEST_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      GM_xmlhttpRequest({
        method,
        url: `${BRIDGE_ORIGIN}${path}`,
        headers,
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout,
        onload: (response) => {
          let data = response.response;
          if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch { /* Keep non-JSON response text for diagnostics. */ }
          }
          if (!data && response.responseText) {
            try { data = JSON.parse(response.responseText); } catch { data = null; }
          }
          resolve({ status: response.status, data });
        },
        onerror: () => reject(new Error('本机桥接服务无法连接')),
        ontimeout: () => reject(new Error('本机桥接请求超时')),
      });
    });
  }

  async function getToken() {
    let token = await GM_getValue(TOKEN_KEY, '');
    if (token) return token;
    const code = prompt('输入本机桥接页面 http://127.0.0.1:8787/setup 显示的一次性配对码');
    if (!code) throw new Error('尚未配对本机桥接服务');
    const response = await request('/bridge/pair', { method: 'POST', body: { code: code.trim() } });
    if (response.status !== 200 || typeof response.data?.token !== 'string') {
      throw new Error('配对失败，请检查本机页面上的配对码');
    }
    token = response.data.token;
    await GM_setValue(TOKEN_KEY, token);
    return token;
  }

  async function postModelCatalog(token, kind, models) {
    const result = await request('/bridge/models/catalog', { method: 'POST', token, body: { kind, models } });
    if (result.status !== 200 || result.data?.accepted !== true) throw new Error(`本机桥接拒绝了太极 ${kind} 模型目录`);
  }

  function buildDrawCatalog(template) {
    const state = template?.state;
    if (!state || typeof state !== 'object') throw new Error('太极绘图模板缺少可用状态');
    const catalog = [];
    for (const group of DRAW_MODEL_GROUPS) {
      const providerState = state[group.stateKey];
      if (!providerState || typeof providerState !== 'object') continue;
      if (group.enabledKey && providerState[group.enabledKey] !== true) continue;
      for (const version of group.versions) {
        if (group.enabledKey ? !providerState[group.enabledKey] : providerState.versions?.[version] !== true) continue;
        const label = group.stateKey === 'openai-draw'
          ? `${group.label} ${version.replace(/^gpt-image-/, '').replace(/^(\d+)-(\d+)(?=-|$)/, '$1.$2').replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase())}`
          : group.stateKey === 'google-draw'
            ? `${group.label} ${version === 'nano-banana-pro' ? 'Pro' : version.replace(/^nano-banana-/, '')}`
            : `${group.label} ${version}`;
        const qualityOptions = group.drawModel === 'openai-draw'
          ? Object.keys(template.billing?.[version]?.fallbackByQuality || {})
          : [];
        catalog.push({
          kind: 'draw',
          id: `taiji-draw::${group.drawModel}::${version}`,
          label,
          price: '',
          providerKey: group.providerKey,
          providerName: group.providerName,
          drawModel: group.drawModel,
          version,
          qualityOptions,
        });
      }
    }
    return catalog;
  }

  async function syncChatCatalog(token) {
    const page = unsafeWindow;
    const response = await page.fetch('/api/chat/tmpl', { credentials: 'include' });
    if (!response.ok) throw new Error(`太极模型目录读取失败（HTTP ${response.status}）`);
    const payload = await response.json();
    if (payload?.code !== 0) throw new Error('太极聊天模型目录返回错误');
    const models = Array.isArray(payload?.data?.models) ? payload.data.models : [];
    const catalog = models
      .filter((model) => model?.attr?.modelType === 'chat')
      .map((model) => ({
        kind: 'chat',
        id: typeof model.value === 'string' ? model.value.trim() : '',
        label: typeof model.label === 'string' ? model.label.trim() : '',
        price: typeof model.attr?.integral === 'string' ? model.attr.integral.trim() : '',
        providerKey: typeof model.attr?.providerKey === 'string' ? model.attr.providerKey.trim() : '',
        providerName: typeof model.attr?.providerName === 'string' ? model.attr.providerName.trim() : '',
      }))
      .filter((model) => model.id && model.label && model.price && model.providerKey && model.providerName);
    if (!catalog.length) throw new Error('太极页面没有可用的聊天模型目录');
    await postModelCatalog(token, 'chat', catalog);
    return catalog;
  }

  async function syncDrawCatalog(token) {
    const response = await unsafeWindow.fetch('/api/draw/template', { credentials: 'include' });
    if (!response.ok) throw new Error(`太极绘图目录读取失败（HTTP ${response.status}）`);
    const payload = await response.json();
    if (payload?.code !== 0 || !payload.data) throw new Error('太极绘图目录返回错误');
    const catalog = buildDrawCatalog(payload.data);
    await postModelCatalog(token, 'draw', catalog);
    return catalog;
  }

  async function syncModelCatalog(token) {
    const chatCatalog = await syncChatCatalog(token);
    let drawCatalog = [];
    let drawError = '';
    try {
      drawCatalog = await syncDrawCatalog(token);
    } catch (error) {
      drawError = error instanceof Error ? error.message : '太极绘图目录同步失败';
    }
    lastCatalogSyncAt = Date.now();
    if (drawError) setStatus(`聊天 ${chatCatalog.length} 个已同步；绘图目录同步失败：${drawError}`, true);
    else setStatus(`已同步太极目录：聊天 ${chatCatalog.length} 个，绘图 ${drawCatalog.length} 个`);
    return { chat: chatCatalog, draw: drawCatalog };
  }

  function waitUntil(getValue, timeoutMs = 8_000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        let value;
        try { value = getValue(); } catch { value = null; }
        if (value) return resolve(value);
        if (Date.now() - startedAt >= timeoutMs) return reject(new Error('太极聊天页面控件未就绪'));
        setTimeout(check, 150);
      };
      check();
    });
  }

  function exactButton(container, text) {
    return [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
  }

  function modelSelectionReady(modelLabel) {
    const pageText = document.body?.innerText || '';
    const expected = `\u5f53\u524d\u5c06\u4f7f\u7528 ${modelLabel} \u6a21\u578b\u8fdb\u884c\u521b\u5efa\u5bf9\u8bdd`;
    return pageText.includes(expected);
  }

  function closeModelDrawer(modelButton) {
    const close = document.querySelector('.n-drawer button[aria-label="close"]');
    if (close) {
      close.click();
      return;
    }
    // The Taiji model drawer has no close button. Toggling the trigger is
    // the stable close path across the current page versions.
    if (modelButton?.isConnected) modelButton.click();
    if (document.querySelector('.n-drawer')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  }

  async function createTaijiSession(job) {
    let createPanel = document.querySelector('.chat-create-float');
    if (!createPanel) {
      const plus = [...document.querySelectorAll('button.aa-sidebar-toolbar__btn')]
        .find((button) => button.querySelector('.fa-plus'));
      if (!plus) throw new Error('找不到太极新对话按钮');
      plus.click();
      createPanel = await waitUntil(() => document.querySelector('.chat-create-float'));
    }
    const modelButton = await waitUntil(() => exactButton(createPanel, '模型'));
    modelButton.click();

    const modelLabel = String(job.label || job.model || '').trim();
    if (!modelLabel) throw new Error('SANMAO 请求没有提供太极模型名称');
    const modelTarget = await waitUntil(() => {
      const options = [...document.querySelectorAll('.n-base-select-option')];
      const option = options.find((candidate) => {
        const modelList = candidate.querySelector('.model-select-list');
        const optionText = (modelList?.innerText || candidate.innerText || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        return optionText[0] === modelLabel || optionText.includes(modelLabel);
      });
      if (option) return option;

      const drawer = document.querySelector('.n-drawer') || document;
      const modelName = [...drawer.querySelectorAll('span')]
        .find((node) => node.textContent.trim() === modelLabel);
      const gridCard = modelName?.closest('div[style*="grid-column"]');
      return gridCard || null;
    });
    const priceLines = (modelTarget.innerText || '').split(/\r?\n/).map((line) => line.trim());
    const expectedPrice = String(job.price || '').trim();
    if (!/^\d+(?:\.\d+)?\s*积分$/u.test(expectedPrice) || !priceLines.some((line) => line === `⚡${expectedPrice}` || line === expectedPrice)) {
      throw new Error(`${modelLabel} 当前标价与同步目录不一致，已停止提交`);
    }
    const switchButton = exactButton(modelTarget, '切换');
    if (switchButton) switchButton.click();
    else modelTarget.click();

    await waitUntil(() => modelButton.textContent.includes(modelLabel) || modelSelectionReady(modelLabel));
    const createButton = await waitUntil(() => exactButton(document, '创建新对话'));
    createButton.click();

    const textarea = await waitUntil(() => document.querySelector('.chat-create-float textarea, textarea[placeholder="输入消息内容"], textarea[placeholder="请输入内容"]'), 15_000);
    await waitUntil(() => textarea.isConnected);
    return textarea;
  }

  function setTextareaValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('无法写入太极聊天输入框');
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function appendSseContent(event, parts) {
    const choices = Array.isArray(event?.choices) ? event.choices : [];
    for (const choice of choices) {
      const delta = choice?.delta;
      if (typeof delta?.content === 'string') parts.push(delta.content);
      else if (typeof choice?.text === 'string') parts.push(choice.text);
      else if (typeof choice?.message?.content === 'string') parts.push(choice.message.content);
    }
    if (!choices.length && typeof event?.content === 'string') parts.push(event.content);
  }

  async function readCompletionResponse(body) {
    if (!body) throw new Error('太极聊天没有返回流式响应');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneMarker = false;
    const parts = [];
    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        doneMarker = true;
        return;
      }
      try { appendSseContent(JSON.parse(data), parts); } catch { /* Ignore non-JSON SSE comments. */ }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          consumeLine(line);
          if (doneMarker) break;
        }
        if (doneMarker) {
          await reader.cancel();
          break;
        }
      }
      if (buffer) consumeLine(buffer);
    } finally {
      reader.releaseLock();
    }
    if (!doneMarker) throw new Error('太极聊天流没有发送完成标记');
    return parts.join('');
  }

  function observeNextCompletion() {
    const page = unsafeWindow;
    const originalFetch = page.fetch;
    if (typeof originalFetch !== 'function') throw new Error('无法观察太极网页的聊天完成状态');
    let matched = false;
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const wrappedFetch = async function (input, init) {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      let isChatRequest = false;
      try { isChatRequest = new URL(rawUrl, page.location.href).pathname === '/api/chat/completions'; } catch { /* Not a URL request. */ }
      try {
        const response = await Reflect.apply(originalFetch, this, [input, init]);
        if (isChatRequest && !matched) {
          matched = true;
          if (page.fetch === wrappedFetch) page.fetch = originalFetch;
          if (!response.ok) rejectCompletion(new Error('太极聊天请求未成功'));
          else void readCompletionResponse(response.clone().body).then(resolveCompletion, rejectCompletion);
        }
        return response;
      } catch (error) {
        if (isChatRequest && !matched) {
          matched = true;
          if (page.fetch === wrappedFetch) page.fetch = originalFetch;
          rejectCompletion(error);
        }
        throw error;
      }
    };
    page.fetch = wrappedFetch;
    return {
      completion,
      restore() {
        if (page.fetch === wrappedFetch) page.fetch = originalFetch;
      },
    };
  }

  function normalizeChatText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function waitForTaijiReply({ expectedPrompt, baselineMessageNodes, baselineMessageIds, sessionUrl, signal }) {
    const expected = normalizeChatText(expectedPrompt);
    if (!expected) return Promise.reject(new Error('SANMAO 请求没有可用于匹配的聊天内容'));
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + GENERATION_TIMEOUT_MS;
      let timer;
      let previous = '';
      let stableSamples = 0;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };
      const finish = (error, content = '') => {
        cleanup();
        if (error) reject(error);
        else resolve(content);
      };
      const onAbort = () => finish(null);
      const check = () => {
        if (signal.aborted) return finish(null);
        if (location.href !== sessionUrl) return finish(new Error('太极当前会话已切换'));

        const items = [...document.querySelectorAll(CHAT_ITEMS_SELECTOR)];
        let userIndex = -1;
        for (let index = items.length - 1; index >= 0; index -= 1) {
          const item = items[index];
          const messageId = item.getAttribute?.('data-message-id');
          const isNew = messageId
            ? !baselineMessageIds.has(messageId)
            : !baselineMessageNodes.has(item);
          if (isNew && item.classList?.contains('user') && normalizeChatText(item.innerText).includes(expected)) {
            userIndex = index;
            break;
          }
        }
        const assistantItems = userIndex >= 0
          ? items.slice(userIndex + 1).filter((item) => item.classList?.contains('ai'))
          : [];
        const latestAssistant = assistantItems.find((item) => {
          const messageId = item.getAttribute?.('data-message-id');
          return messageId
            ? !baselineMessageIds.has(messageId)
            : !baselineMessageNodes.has(item);
        });
        const renderer = latestAssistant?.querySelector('.markdown-renderer');
        const input = document.querySelector('.aa-chat-input');
        const stillGenerating = [...(input?.querySelectorAll('button') || [])]
          .some((button) => button.textContent.includes('停止'));
        const content = (renderer?.innerText || '').trim();

        if (stillGenerating || !renderer || !content) {
          previous = '';
          stableSamples = 0;
        } else {
          stableSamples = content === previous ? stableSamples + 1 : 0;
          previous = content;
          if (stableSamples >= 3) return finish(null, content);
        }

        if (Date.now() >= deadline) return finish(new Error('太极页面未显示稳定的本次回复'));
        timer = setTimeout(check, 150);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      check();
    });
  }

  async function waitForObservedCompletion(observer, request) {
    const controller = new AbortController();
    const domCompletion = waitForTaijiReply({ ...request, signal: controller.signal });
    const observedOrDom = observer.completion.then((content) => {
      const normalized = typeof content === 'string' ? content.trim() : '';
      return normalized || domCompletion;
    }, () => domCompletion);
    try {
      return await Promise.race([observedOrDom, domCompletion]);
    } finally {
      controller.abort();
      observer.restore();
    }
  }

  async function sendResult(token, jobId, body) {
    const response = await request(`/bridge/jobs/${encodeURIComponent(jobId)}/result`, {
      method: 'POST', token, body,
    });
    if (response.status !== 202) throw new Error('本机桥接已不再等待该结果');
  }

  async function taijiApiData(path, init = {}) {
    const response = await unsafeWindow.fetch(path, {
      credentials: 'include',
      ...init,
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('太极绘图接口没有返回 JSON'); }
    if (!response.ok) throw new Error(`太极绘图接口返回 HTTP ${response.status}`);
    if (payload?.code !== 0) throw new Error(String(payload?.msg || '太极绘图接口返回错误').slice(0, 180));
    return payload.data;
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForDrawCompletion(taskId) {
    const deadline = Date.now() + DRAW_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await taijiApiData(`/api/draw/status/${encodeURIComponent(taskId)}`);
      if (status?.end) {
        if (status.status === 'ERROR') throw new Error(String(status.errorMessage || status.message || '太极绘图任务失败').slice(0, 180));
        if (status.status !== 'COMPLETE') throw new Error(`太极绘图任务结束，但状态是 ${String(status.status || 'unknown')}`);
        return status;
      }
      await sleep(DRAW_POLL_INTERVAL_MS);
    }
    throw new Error('太极绘图任务等待超时；任务可能仍在太极记录中运行');
  }

  async function processChatJob(token, job) {
    setStatus(`正在为 SANMAO 创建独立 ${job.label || job.model} 会话`);
    let submitted = false;
    try {
      const textarea = await createTaijiSession(job);
      setTextareaValue(textarea, job.prompt);
      const sendButton = await waitUntil(() => {
        const input = document.querySelector('.aa-chat-input') || textarea.closest('.aa-chat-input');
        return [...(input?.querySelectorAll('button') || document.querySelectorAll('button'))]
          .find((button) => button.textContent.includes('发送') && !button.disabled);
      });
      const baselineMessageNodes = new Set(document.querySelectorAll(CHAT_ITEMS_SELECTOR));
      const baselineMessageIds = new Set([...baselineMessageNodes]
        .map((item) => item.getAttribute?.('data-message-id'))
        .filter((messageId) => typeof messageId === 'string' && messageId));
      const sessionUrl = location.href;
      const observer = observeNextCompletion();
      sendButton.click();
      submitted = true;
      setStatus('太极正在生成；本次不会自动重发');
      const content = await waitForObservedCompletion(observer, {
        expectedPrompt: job.prompt,
        baselineMessageNodes,
        baselineMessageIds,
        sessionUrl,
      });
      await sendResult(token, job.id, { content });
      setStatus('回复已交给 SANMAO');
    } catch (error) {
      const message = submitted
        ? '请求可能已提交；请检查太极会话，本机桥不会自动重发'
        : `会话或模型选择失败，未提交生成请求：${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}`;
      try { await sendResult(token, job.id, { error: message }); } catch { /* The local request may already have timed out. */ }
      setStatus(message, true);
    }
  }

  async function processDrawJob(token, job) {
    setStatus(`正在太极绘图页提交 ${job.label || job.model}`);
    let submitted = false;
    try {
      if (!job.request || job.request.action !== 'IMAGINE') throw new Error('本机桥接没有提供受支持的绘图请求');
      submitted = true;
      const created = await taijiApiData('/api/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job.request),
      });
      const taskId = typeof created?.taskId === 'string' ? created.taskId.trim() : '';
      if (!taskId) throw new Error('太极绘图接口未返回 taskId；请检查太极绘图记录后再决定是否重试');
      setStatus(`太极绘图任务 ${taskId} 已提交，等待结果`);
      const status = await waitForDrawCompletion(taskId);
      const drawStatus = {
        taskId: status.taskId || taskId,
        status: status.status,
        end: status.end,
        ...(Array.isArray(status.outImages) ? {
          outImages: status.outImages.map((image) => ({
            ...(typeof image?.url === 'string' ? { url: image.url } : {}),
            ...(typeof image?.imgUrl === 'string' ? { imgUrl: image.imgUrl } : {}),
            ...(typeof image?.smallImgUrl === 'string' ? { smallImgUrl: image.smallImgUrl } : {}),
          })),
        } : {}),
        ...(typeof status.imgUrl === 'string' ? { imgUrl: status.imgUrl } : {}),
        ...(typeof status.smallImgUrl === 'string' ? { smallImgUrl: status.smallImgUrl } : {}),
      };
      await sendResult(token, job.id, { status: drawStatus });
      setStatus('绘图结果已交给 SANMAO；太极任务保留在账号记录中');
    } catch (error) {
      const message = submitted
        ? `太极绘图任务可能已提交；请检查太极记录，本机桥不会自动重发：${error instanceof Error ? error.message.slice(0, 140) : String(error).slice(0, 140)}`
        : `绘图请求未提交：${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}`;
      try { await sendResult(token, job.id, { error: message }); } catch { /* The local request may already have timed out. */ }
      setStatus(message, true);
    }
  }

  async function processJob(token, job) {
    if (working) return;
    working = true;
    try {
      if (job.kind === 'draw') await processDrawJob(token, job);
      else await processChatJob(token, job);
    } finally {
      working = false;
    }
  }

  async function pollLoop() {
    let token;
    try {
      token = await getToken();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '配对失败', true);
      return;
    }
    try {
      await syncModelCatalog(token);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '太极模型目录同步失败', true);
      return;
    }
    setStatus('已配对，等待 SANMAO 请求');
    while (true) {
      try {
        const workerKind = currentWorkerKind();
        if (Date.now() - lastCatalogSyncAt >= CATALOG_REFRESH_MS) await syncModelCatalog(token);
        const response = await request(`/bridge/jobs/next?kind=${workerKind}`, { token, timeout: 26_000 });
        const receivedJob = response.data?.job;
        const job = receivedJob && typeof receivedJob === 'object'
          ? {
            ...receivedJob,
            // Older local bridge processes do not include kind in the job.
            // The queue used for this long poll is authoritative in that case.
            kind: receivedJob.kind === 'chat' || receivedJob.kind === 'draw' ? receivedJob.kind : workerKind,
          }
          : receivedJob;
        const hasJobPayload = job?.kind === 'draw'
          ? Boolean(job.request && typeof job.request === 'object')
          : typeof job?.prompt === 'string';
        if (response.status === 200 && job?.id && hasJobPayload) {
          if (!working) await processJob(token, job);
        } else if (response.status === 401) {
          await GM_deleteValue(TOKEN_KEY);
          setStatus('配对已失效，请刷新页面重新配对', true);
          return;
        } else if (response.status !== 204) {
          setStatus('桥接暂不可用，稍后重试', true);
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      } catch {
        setStatus('本机桥接服务不可用，等待重连', true);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    }
  }

  setStatus('初始化中');
  void pollLoop();
})();
