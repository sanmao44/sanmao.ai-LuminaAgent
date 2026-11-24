import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const providerListSource = await readFile(new URL('../components/ProviderList.tsx', import.meta.url), 'utf8');
const platformPickerSource = await readFile(new URL('../components/ProviderPlatformPicker.tsx', import.meta.url), 'utf8');
const providerToolbarSource = await readFile(new URL('../components/ProviderListToolbar.tsx', import.meta.url), 'utf8');
const providerPresetSummarySource = await readFile(new URL('../components/ProviderPresetSummary.tsx', import.meta.url), 'utf8');
const providerConnectionFieldsSource = await readFile(new URL('../components/ProviderConnectionFields.tsx', import.meta.url), 'utf8');
const providerListModule = { exports: {} };
const providerListCompiled = ts.transpileModule(providerListSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(providerListCompiled, {
  exports: providerListModule.exports,
  require(id) {
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (id === '@/lib/provider-availability') return { isProviderModelLibraryEnabled: (provider) => provider?.modelLibraryEnabled !== false };
    if (id === '@/lib/provider-presentation') return {
      isManualModelProvider: (provider) => provider?.type === 'openai-compatible' || provider?.type === 'google-gemini',
      providerPlatformLabel: (platform) => platform || '自定义',
      providerTypeLabel: (type) => type === 'google-gemini' ? '谷歌 Gemini' : '通用兼容接口',
    };
    throw new Error(`Unexpected ProviderList dependency: ${id}`);
  },
});
const ProviderList = providerListModule.exports.default;
const platformPickerModule = { exports: {} };
const platformPickerCompiled = ts.transpileModule(platformPickerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(platformPickerCompiled, {
  exports: platformPickerModule.exports,
  require(id) {
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    throw new Error(`Unexpected ProviderPlatformPicker dependency: ${id}`);
  },
});
const ProviderPlatformPicker = platformPickerModule.exports.default;
const providerToolbarModule = { exports: {} };
const providerToolbarCompiled = ts.transpileModule(providerToolbarSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(providerToolbarCompiled, {
  exports: providerToolbarModule.exports,
  require(id) {
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (id === '@/components/ProviderTransferActions') return { default: () => null };
    throw new Error(`Unexpected ProviderListToolbar dependency: ${id}`);
  },
});
const ProviderListToolbar = providerToolbarModule.exports.default;
const providerPresetSummaryModule = { exports: {} };
const providerPresetSummaryCompiled = ts.transpileModule(providerPresetSummarySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(providerPresetSummaryCompiled, {
  exports: providerPresetSummaryModule.exports,
  require(id) {
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    throw new Error(`Unexpected ProviderPresetSummary dependency: ${id}`);
  },
});
const ProviderPresetSummary = providerPresetSummaryModule.exports.default;
const providerConnectionFieldsModule = { exports: {} };
const providerConnectionFieldsCompiled = ts.transpileModule(providerConnectionFieldsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(providerConnectionFieldsCompiled, {
  exports: providerConnectionFieldsModule.exports,
  require(id) {
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (id === '@/components/AgnesConnectionGuide') return ({ baseUrl, testResult }) => createElement('aside', { 'data-base-url': baseUrl, 'data-test-result': testResult });
    throw new Error(`Unexpected ProviderConnectionFields dependency: ${id}`);
  },
});
const ProviderConnectionFields = providerConnectionFieldsModule.exports.default;

const pageTree = ts.createSourceFile('page.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function pageHandlers(names, bindings) {
  const handlers = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) handlers.set(node.name.text, node);
    ts.forEachChild(node, visit);
  }
  visit(pageTree);
  for (const name of names) if (!handlers.has(name)) throw new Error(`Missing page handler: ${name}`);
  const compiled = ts.transpileModule(names.map((name) => handlers.get(name).getText(pageTree)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(`${compiled}\n({ ${names.join(', ')} });`, bindings);
}

function pageHandler(name, bindings) {
  return pageHandlers([name], bindings)[name];
}

function connectionTestHarness({ platform = 'openai', payload = {}, ok = true, status = 200, response } = {}) {
  const state = { busy: false, message: '', succeeded: false };
  const run = pageHandler('testProvider', {
    providerForm: { platform, baseUrl: 'https://example.test/v1', apiKey: 'fixture', videoTransport: '' },
    providerEditId: null,
    providerConnectionRequestRef: { current: 0 },
    notify() {},
    setProviderTestBusy(value) { state.busy = value; },
    setProviderTestResult(value) { state.message = value; },
    setProviderTestSucceeded(value) { state.succeeded = value; },
    fetch: async () => response || { ok, status, json: async () => payload },
  });
  return { state, run };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function providerEditorHarness() {
  const getProviderPreset = (platform) => ({ value: platform, short: platform, type: 'openai-compatible', baseUrl: 'https://example.test/v1', needsBaseUrl: false });
  const emptyProviderForm = pageHandler('emptyProviderForm', { getProviderPreset });
  const state = {
    form: { ...emptyProviderForm(), apiKey: 'fixture-a' }, editId: null, editorOpen: true,
    busy: false, testBusy: false, message: '', succeeded: false, syncingId: null, section: 'providers',
    notifications: [], appliedStates: [],
  };
  const requests = [];
  const providerConnectionRequestRef = { current: 0 };
  const providerSyncRequestRef = { current: 0 };
  function render() {
    return pageHandlers([
      'invalidateProviderConnectionRequest', 'setProviderForm', 'closeProviderEditor', 'openAddProvider', 'openEditProvider',
      'applyProviderPreset', 'testProvider', 'saveProvider', 'syncProvider', 'applyReturnedState',
    ], {
      providerConnectionRequestRef, providerSyncRequestRef,
      providerForm: state.form, providerEditId: state.editId, state: { providers: [], models: [] },
      emptyProviderForm, getProviderPreset, defaultResponsesPath: () => '/responses', normalizeResponsesPath: (_platform, path) => path,
      setProviderFormState(update) { state.form = typeof update === 'function' ? update(state.form) : update; },
      setProviderBusy(value) { state.busy = value; },
      setProviderTestBusy(value) { state.testBusy = value; },
      setProviderTestResult(value) { state.message = value; },
      setProviderTestSucceeded(value) { state.succeeded = value; },
      setProviderEditor(value) { state.editorOpen = value; },
      setProviderEditId(value) { state.editId = value; },
      setProviderSetupDismissed() {}, setJimengLogin() {},
      setSyncingId(value) { state.syncingId = value; },
      setSection(value) { state.section = value; },
      setModelProviderFilter() {}, setModelSearch() {}, setModelKindFilter() {}, setModelQuickFilter() {},
      setExpandedModelProviders() {}, setModelProviderGroupExpansion() {},
      setState(value) { state.appliedStates.push(value); },
      notify(value) { state.notifications.push(value); },
      refreshState: async () => {},
      fetch(url, init) {
        const request = { ...deferred(), url, body: init.body ? JSON.parse(init.body) : undefined };
        requests.push(request);
        return request.promise;
      },
    });
  }
  function respond(index, payload, status = 200) {
    requests[index].resolve(new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }));
  }
  return { state, requests, render, respond };
}

const flushRequests = () => new Promise((resolve) => setImmediate(resolve));
const submitEvent = { preventDefault() {} };

test('connection failures attach Agnes credential guidance only to an upstream Agnes 401', async () => {
  for (const scenario of [
    { platform: 'openai', payload: { error: 'Incorrect API key provided', providerStatus: 401 }, agnesHint: false },
    { platform: 'agnes', payload: { error: '需要管理员登录。' }, agnesHint: false },
    { platform: 'agnes', payload: { error: 'invalid provider key', providerStatus: 401 }, agnesHint: true },
    { platform: 'agnes', payload: { error: 'upstream unavailable', providerStatus: 503 }, agnesHint: false },
  ]) {
    const { state, run } = connectionTestHarness({ ...scenario, ok: false, status: 401 });
    assert.equal(await run(), false);
    assert.equal(state.succeeded, false);
    assert.equal(state.busy, false);
    assert.equal(state.message.includes('Agnes 已拒绝'), scenario.agnesHint, scenario.platform);
    assert.ok(state.message.includes(scenario.payload.error));
  }
});

test('connection feedback retains its pending state and records success independently of server wording', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const { state, run } = connectionTestHarness({ response: pending });
  const operation = run();
  assert.equal(state.busy, true);
  assert.equal(state.message, '');
  assert.equal(state.succeeded, false);
  resolve({ ok: true, status: 200, json: async () => ({ message: '即梦 CLI 已检测：fixture；已登录', count: 0 }) });
  assert.equal(await operation, true);
  assert.equal(state.busy, false);
  assert.equal(state.succeeded, true);
  assert.equal(state.message, '即梦 CLI 已检测：fixture；已登录');
});

test('changing any provider draft field immediately invalidates its pending connection test', async () => {
  const fields = Object.keys(providerEditorHarness().state.form);
  for (const field of fields) {
    const harness = providerEditorHarness();
    const handlers = harness.render();
    const operation = handlers.testProvider();
    handlers.setProviderForm((old) => ({ ...old, [field]: `${old[field]}-changed` }));
    assert.equal(harness.state.testBusy, false, field);
    assert.equal(harness.state.message, '', field);
    assert.equal(harness.state.succeeded, false, field);
    harness.respond(0, { count: 1, message: 'obsolete success' });
    assert.equal(await operation, false, field);
    assert.equal(harness.state.message, '', field);
    assert.equal(harness.state.succeeded, false, field);
  }
});

const draftTransitions = {
  edit: (handlers) => handlers.setProviderForm((old) => ({ ...old, apiKey: 'fixture-b' })),
  close: (handlers) => handlers.closeProviderEditor(),
  add: (handlers) => handlers.openAddProvider(),
  editAnother: (handlers) => handlers.openEditProvider({ id: 'another-provider', name: 'Another', type: 'openai-compatible', baseUrl: 'https://another.test/v1' }),
  preset: (handlers) => handlers.applyProviderPreset('openai'),
};

test('closing, opening or switching provider presets discards pending connection feedback', async () => {
  for (const [name, transition] of Object.entries(draftTransitions)) {
    const harness = providerEditorHarness();
    const handlers = harness.render();
    const operation = handlers.testProvider();
    transition(handlers);
    harness.respond(0, { error: 'obsolete failure' }, 503);
    assert.equal(await operation, false, name);
    assert.equal(harness.state.message, '', name);
    assert.equal(harness.state.succeeded, false, name);
    assert.equal(harness.state.testBusy, false, name);
  }
});

test('out-of-order connection success, HTTP, network and JSON failures cannot overwrite newer feedback or busy state', async () => {
  const outcomes = {
    success: (harness) => harness.respond(0, { message: 'obsolete success' }),
    http: (harness) => harness.respond(0, { error: 'obsolete failure' }, 503),
    network: (harness) => harness.requests[0].reject(new Error('obsolete network failure')),
    json: (harness) => harness.requests[0].resolve({ ok: true, json: async () => { throw new SyntaxError('obsolete JSON failure'); } }),
  };
  for (const [outcome, settle] of Object.entries(outcomes)) {
    for (const newerFinishesFirst of [false, true]) {
      const harness = providerEditorHarness();
      const handlers = harness.render();
      const oldOperation = handlers.testProvider();
      draftTransitions.edit(handlers);
      const newOperation = harness.render().testProvider();
      if (newerFinishesFirst) {
        harness.respond(1, { message: 'current success' });
        assert.equal(await newOperation, true);
      }
      settle(harness);
      assert.equal(await oldOperation, false, outcome);
      assert.equal(harness.state.testBusy, !newerFinishesFirst, outcome);
      assert.equal(harness.state.message, newerFinishesFirst ? 'current success' : '', outcome);
      assert.equal(harness.state.succeeded, newerFinishesFirst, outcome);
      if (!newerFinishesFirst) {
        harness.respond(1, { message: 'current success' });
        assert.equal(await newOperation, true);
      }
    }
  }
});

test('saving submits exactly the tested snapshot for both new and existing providers', async () => {
  for (const editId of [null, 'existing-provider']) {
    const harness = providerEditorHarness();
    harness.state.editId = editId;
    const operation = harness.render().saveProvider(submitEvent);
    harness.respond(0, { count: 1 });
    await flushRequests();
    const { providerId, ...testedForm } = harness.requests[0].body;
    assert.equal(providerId, editId);
    assert.deepEqual(harness.requests[1].body, testedForm);
    assert.equal(harness.requests[1].url, editId ? `/api/providers/${editId}` : '/api/providers');
    harness.respond(1, { id: 'new-provider', state: { providers: [], models: [] } });
    await flushRequests();
    harness.respond(2, { count: 0, state: { providers: [], models: [] } });
    await operation;
    assert.equal(harness.state.editorOpen, false);
    assert.equal(harness.state.busy, false);
    assert.equal(harness.state.section, 'models');
  }
});

test('draft changes and editor transitions during the save test prevent submitting the old configuration', async () => {
  for (const [name, transition] of Object.entries(draftTransitions)) {
    const harness = providerEditorHarness();
    const handlers = harness.render();
    const operation = handlers.saveProvider(submitEvent);
    transition(handlers);
    const editorOpen = harness.state.editorOpen;
    harness.respond(0, { count: 1 });
    await operation;
    assert.equal(harness.requests.length, 1, name);
    assert.equal(harness.state.editorOpen, editorOpen, name);
    assert.equal(harness.state.busy, false, name);
    assert.equal(harness.state.message, '', name);
  }
});

test('an obsolete save test cannot submit or finish a newer save operation', async () => {
  const harness = providerEditorHarness();
  const handlers = harness.render();
  const oldOperation = handlers.saveProvider(submitEvent);
  draftTransitions.edit(handlers);
  const newOperation = harness.render().saveProvider(submitEvent);
  harness.respond(0, { count: 1 });
  await oldOperation;
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.state.busy, true);
  assert.equal(harness.state.testBusy, true);
  harness.respond(1, { error: 'current test failed' }, 503);
  await newOperation;
  assert.equal(harness.state.busy, false);
  assert.equal(harness.requests.length, 2);
});

test('late save responses retain real state but cannot close, notify or finish a newly opened editor', async () => {
  for (const outcome of ['success', 'failure', 'delayed-body']) {
    const harness = providerEditorHarness();
    const handlers = harness.render();
    const oldOperation = handlers.saveProvider(submitEvent);
    harness.respond(0, { count: 1 });
    await flushRequests();
    const responseBody = deferred();
    if (outcome === 'delayed-body') {
      harness.requests[1].resolve({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: () => responseBody.promise });
      await flushRequests();
    }
    handlers.closeProviderEditor();
    handlers.openAddProvider();
    harness.render().setProviderForm((old) => ({ ...old, apiKey: 'fixture-b' }));
    const newOperation = harness.render().saveProvider(submitEvent);
    const returned = { id: 'saved-provider', state: { providers: [{ id: 'saved-provider' }], models: [] } };
    if (outcome === 'delayed-body') responseBody.resolve(JSON.stringify(returned));
    else harness.respond(1, outcome === 'failure' ? { error: 'obsolete save failed' } : returned, outcome === 'failure' ? 500 : 200);
    await oldOperation;
    assert.equal(harness.state.appliedStates.length, outcome === 'failure' ? 0 : 1, outcome);
    assert.equal(harness.state.editorOpen, true, outcome);
    assert.equal(harness.state.busy, true, outcome);
    assert.equal(harness.state.testBusy, true, outcome);
    assert.equal(harness.state.message, '', outcome);
    assert.deepEqual(harness.state.notifications, [], outcome);
    assert.equal(harness.requests.length, 3, outcome);
    harness.respond(2, { error: 'current test failed' }, 503);
    await newOperation;
  }
});

test('late model discovery from saving cannot navigate away from a newly opened editor', async () => {
  const harness = providerEditorHarness();
  const handlers = harness.render();
  const oldOperation = handlers.saveProvider(submitEvent);
  harness.respond(0, { count: 1 });
  await flushRequests();
  harness.respond(1, { id: 'saved-provider', state: { providers: [], models: [] } });
  await flushRequests();
  handlers.openAddProvider();
  harness.render().setProviderForm((old) => ({ ...old, apiKey: 'fixture-b' }));
  const newOperation = harness.render().saveProvider(submitEvent);
  const notificationsBefore = [...harness.state.notifications];
  harness.respond(2, { count: 1, state: { providers: [], models: [{ providerId: 'saved-provider', rawId: 'fixture' }] } });
  await oldOperation;
  assert.equal(harness.state.appliedStates.length, 2);
  assert.equal(harness.state.editorOpen, true);
  assert.equal(harness.state.section, 'providers');
  assert.equal(harness.state.busy, true);
  assert.equal(harness.state.testBusy, true);
  assert.deepEqual(harness.state.notifications, notificationsBefore);
  harness.respond(3, { error: 'current test failed' }, 503);
  await newOperation;
});

test('connection result appearance follows the structured outcome instead of message prefixes', () => {
  const Result = providerConnectionFieldsModule.exports.ProviderConnectionResult;
  const success = renderToStaticMarkup(createElement(Result, { message: '即梦 CLI 已检测', succeeded: true }));
  const failure = renderToStaticMarkup(createElement(Result, { message: '连接成功只是上游错误文本的一部分', succeeded: false }));
  assert.match(success, /class="connection-result success"/);
  assert.match(failure, /class="connection-result error"/);
});

test('successful model discovery opens the new provider with restrictive filters cleared', async () => {
  const selected = { provider: 'old-provider', search: 'old', kind: 'image', quick: 'enabled', section: 'providers' };
  const models = [{ providerId: 'new-provider', rawId: 'fixture-chat', enabled: false, published: false }];
  const run = pageHandler('syncProvider', {
    state: { models: [] },
    providerSyncRequestRef: { current: 0 },
    fetch: async () => ({}),
    applyReturnedState: async () => ({ count: 1, state: { models } }),
    setSyncingId() {}, notify() {}, refreshState() {},
    setModelProviderFilter(value) { selected.provider = value; },
    setModelSearch(value) { selected.search = value; },
    setModelKindFilter(value) { selected.kind = value; },
    setModelQuickFilter(value) { selected.quick = value; },
    setExpandedModelProviders() {}, setModelProviderGroupExpansion() {},
    setSection(value) { selected.section = value; },
  });
  await run('new-provider');
  assert.deepEqual(selected, { provider: 'new-provider', search: '', kind: 'all', quick: 'all', section: 'models' });
});

test('first-run provider setup modal can be dismissed', () => {
  assert.match(pageSource, /const PROVIDER_SETUP_DISMISSED_STORAGE_KEY = 'sanmao-provider-setup-dismissed';/);
  assert.match(pageSource, /const providerModalOpen = providerEditor \|\| !state\.providers\.length && !providerSetupDismissed;/);
  assert.match(pageSource, /providerModalOpen && typeof document !== 'undefined'/);
  assert.match(pageSource, /setProviderSetupDismissed\(localStorage\.getItem\(PROVIDER_SETUP_DISMISSED_STORAGE_KEY\) === '1'\);/);
  assert.match(pageSource, /onClick: closeProviderEditor,/);
  assert.match(pageSource, /onMouseDown: \(event\)=>\{\s*if \(event\.target === event\.currentTarget\) closeProviderEditor\(\);/);
  assert.match(pageSource, /if \(!providerModalOpen\) return;\s*const closeOnEscape = \(event\)=>\{\s*if \(event\.key !== 'Escape'\) return;\s*closeProviderEditor\(\);/);
  assert.match(pageSource, /section === 'providers' && \(!adminRequired \|\| isAdmin\) && providerModalOpen\)\);/);
});

test('closing the first-run modal keeps the setup gate off until a provider exists', () => {
  const start = pageSource.indexOf('function closeProviderEditor() {');
  const end = pageSource.indexOf('function openAddProvider() {', start);
  assert.ok(start > -1 && end > start, 'closeProviderEditor should sit next to openAddProvider');
  const closeHandler = pageSource.slice(start, end);
  assert.match(closeHandler, /setProviderEditor\(false\);/);
  assert.match(closeHandler, /setProviderEditId\(null\);/);
  assert.match(closeHandler, /if \(!state\.providers\.length\) setProviderSetupDismissed\(true\);/);
  assert.doesNotMatch(pageSource, /state\.providers\.length > 0 && \/\*#__PURE__\*\/ _jsx\("button"/);
});

test('dismissed first-run modal leaves a real empty state with a CTA', () => {
  assert.match(pageSource, /!manageableProviders\.length \? \/\*#__PURE__\*\/ _jsxs\("div", \{/);
  assert.match(pageSource, /children: "还没有添加接口服务商"/);
  assert.match(pageSource, /children: "添加并测试连接后，即可读取它提供的模型。"/);
});

test('provider list presents current state and forwards every action through its contract', () => {
  const calls = [];
  const providers = [
    {
      id: 'provider-a', name: 'Example', type: 'openai-compatible', platform: 'custom', modelLibraryEnabled: false,
      baseUrl: 'https://example.test/v1', status: 'healthy', enabledModelCount: 2, maskedKey: 'sk-***',
      lastSyncedAt: '2026-10-07',
    },
  ];
  function Icon({ name }) { return createElement('i', { 'data-icon': name }); }
  const markup = renderToStaticMarkup(createElement(ProviderList, {
    providers,
    editingProviderId: 'provider-a',
    syncingProviderId: 'provider-a',
    Icon,
    onToggleModelLibrary: (provider) => calls.push(['toggle', provider.id]),
    onOpenManualModelDialog: (provider) => calls.push(['manual', provider.id]),
    onOpenEdit: (provider) => calls.push(['edit', provider.id]),
    onSync: (providerId) => calls.push(['sync', providerId]),
    onDelete: (providerId) => calls.push(['delete', providerId]),
  }));

  assert.match(markup, /class="provider-card surface editing"/);
  assert.match(markup, /aria-label="加入 Example 的模型库"/);
  assert.match(markup, /已隐藏/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /读取中…/);

  const tree = ProviderList({
    providers,
    editingProviderId: 'provider-a',
    syncingProviderId: 'provider-a',
    Icon,
    onToggleModelLibrary: (provider) => calls.push(['toggle', provider.id]),
    onOpenManualModelDialog: (provider) => calls.push(['manual', provider.id]),
    onOpenEdit: (provider) => calls.push(['edit', provider.id]),
    onSync: (providerId) => calls.push(['sync', providerId]),
    onDelete: (providerId) => calls.push(['delete', providerId]),
  });
  const article = tree.props.children[0];
  const content = article.props.children[1];
  const info = content.props.children[0];
  const toggle = info.props.children.find((child) => child?.type === 'label');
  toggle.props.children[0].props.onChange();
  const actions = article.props.children[2].props.children;
  actions.forEach((button) => button.props.onClick());
  assert.deepEqual(calls, [
    ['toggle', 'provider-a'],
    ['manual', 'provider-a'],
    ['edit', 'provider-a'],
    ['sync', 'provider-a'],
    ['delete', 'provider-a'],
  ]);
});

test('provider platform picker preserves preset links and forwards selection', () => {
  const selected = [];
  const Icon = ({ name }) => createElement('i', { 'data-icon': name });
  const presets = [
    { value: 'openai', label: 'OpenAI', short: 'OpenAI', description: '官方 API 地址已内置', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsBaseUrl: false, apiKeyUrl: 'https://platform.openai.com/api-keys', recommended: true },
    { value: 'custom', label: '其他兼容平台', short: '其他平台', description: '自建中转', type: 'openai-compatible', baseUrl: '', needsBaseUrl: true },
  ];
  const markup = renderToStaticMarkup(createElement(ProviderPlatformPicker, {
    presets,
    selectedPlatform: 'openai',
    Icon,
    onSelect: (platform) => selected.push(platform),
  }));
  assert.match(markup, /class="platform-option"/);
  assert.match(markup, /href="https:\/\/platform.openai.com\/api-keys"/);
  assert.match(markup, /class="platform-option"/);
  const tree = ProviderPlatformPicker({ presets, selectedPlatform: 'openai', Icon, onSelect: (platform) => selected.push(platform) });
  const options = tree.props.children[1].props.children;
  options[1].props.children[0].props.onClick();
  assert.deepEqual(selected, ['custom']);
});

test('provider list toolbar forwards search edits and clear actions', () => {
  const values = [];
  const Icon = ({ name }) => createElement('i', { 'data-icon': name });
  const props = { search: 'open', visibleCount: 1, totalCount: 3, Icon, onSearchChange: (value) => values.push(value) };
  const markup = renderToStaticMarkup(createElement(ProviderListToolbar, props));
  assert.match(markup, /搜索名称、平台或接口地址/);
  assert.match(markup, /显示 <b>1<\/b> \/ 3 个/);
  const tree = ProviderListToolbar(props);
  const label = tree.props.children[0];
  label.props.children[1].props.onChange({ target: { value: 'agnes' } });
  label.props.children[2].props.onClick();
  assert.deepEqual(values, ['agnes', '']);
});

test('provider preset summary presents the selected preset and key link', () => {
  const Icon = ({ name }) => createElement('i', { 'data-icon': name });
  const preset = {
    value: 'openai', label: 'OpenAI', short: 'OpenAI', description: '官方 API 地址已内置',
    type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsBaseUrl: false,
    apiKeyUrl: 'https://platform.openai.com/api-keys', notice: '推荐', noticeTone: 'success',
  };
  const markup = renderToStaticMarkup(createElement(ProviderPresetSummary, { preset, Icon }));
  assert.match(markup, /class="provider-auto-note"/);
  assert.match(markup, /官方 API 地址已内置/);
  assert.match(markup, /兼容参数已自动配置/);
  assert.match(markup, /href="https:\/\/platform.openai.com\/api-keys"/);
});

test('provider connection fields preserve controlled inputs and Agnes guide data', () => {
  const values = [];
  const props = {
    name: 'Main', baseUrl: 'https://example.test/v1', apiKey: 'sk-test', platform: 'agnes',
    needsBaseUrl: false, presetBaseUrl: 'https://api.agnes-ai.cn/v1', editing: true,
    videoBaseUrl: 'https://api.agnes-ai.cn', savedBaseUrl: 'https://old.test/v1',
    savedVideoBaseUrl: 'https://old.test', savedKeyMasked: 'sk-***', testResult: '连接成功',
    onNameChange: (value) => values.push(['name', value]),
    onBaseUrlChange: (value) => values.push(['base', value]),
    onApiKeyChange: (value) => values.push(['key', value]),
    onUseDomesticEndpoint: () => values.push(['agnes']),
  };
  const tree = ProviderConnectionFields(props);
  const children = tree.props.children;
  const nameField = children[0];
  nameField.props.children[1].props.onChange({ target: { value: 'Backup' } });
  const fixedUrl = children[1];
  assert.equal(fixedUrl.props.className, 'provider-fixed-url wide');
  const keyField = children[2];
  keyField.props.children[1].props.onChange({ target: { value: 'sk-new' } });
  const guide = children[3];
  guide.props.onUseDomesticEndpoint();
  assert.deepEqual(values, [['name', 'Backup'], ['key', 'sk-new'], ['agnes']]);
});
