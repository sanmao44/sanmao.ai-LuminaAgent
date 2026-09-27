import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

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
