import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const SupportModal = createTsRequire(new URL('../components', import.meta.url).pathname)('./SupportModal').default;
const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });

const props = {
  tab: 'community',
  Icon,
  onTabChange: () => {},
  onClose: () => {},
  onCopyGroup: () => {},
  onCopyWechat: () => {},
};

test('support modal keeps the community tab and copy affordance presentation', () => {
  const markup = renderToStaticMarkup(createElement(SupportModal, props));
  assert.match(markup, /class="support-modal-backdrop"/);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-selected="true"/);
  assert.match(markup, /1104660815/);
  assert.match(markup, /class="support-copy-button"/);
  assert.match(markup, /data-icon="copy"/);
  assert.match(markup, /打开 QQ → 搜索群号 → 申请加入/);
});

test('support modal switches to the reward panel without changing the shell', () => {
  const markup = renderToStaticMarkup(createElement(SupportModal, { ...props, tab: 'reward' }));
  assert.match(markup, /class="support-modal"/);
  assert.match(markup, /自愿赞赏/);
  assert.match(markup, /mm-reward-qrcode\.png/);
  assert.match(markup, /SANMAO\.AI 赞赏码/);
  assert.doesNotMatch(markup, /class="support-copy-button"/);
});
