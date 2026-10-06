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
    throw new Error(`Unexpected ProviderListToolbar dependency: ${id}`);
  },
});
const ProviderListToolbar = providerToolbarModule.exports.default;

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
