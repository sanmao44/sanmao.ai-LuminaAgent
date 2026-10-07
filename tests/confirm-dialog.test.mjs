import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const ConfirmDialog = createTsRequire(new URL('../components', import.meta.url).pathname)('./ConfirmDialog').default;
const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });

test('confirm dialog keeps the supplied action state and danger presentation', () => {
  const markup = renderToStaticMarkup(createElement(ConfirmDialog, {
    state: { title: '删除模型', text: '确定要删除吗？', danger: true, confirmText: '删除', action: () => {} },
    Icon,
    onClose: () => {},
    onConfirm: () => {},
  }));
  assert.match(markup, /class="dialog-backdrop"/);
  assert.match(markup, /class="confirm-dialog"/);
  assert.match(markup, /class="dialog-icon danger"/);
  assert.match(markup, /data-icon="trash"/);
  assert.match(markup, /删除模型/);
  assert.match(markup, />删除<\/button>/);
});

test('confirm dialog uses the neutral defaults when danger is absent', () => {
  const markup = renderToStaticMarkup(createElement(ConfirmDialog, {
    state: { title: '退出', text: '确定退出吗？', action: () => {} },
    Icon,
    onClose: () => {},
    onConfirm: () => {},
  }));
  assert.match(markup, /class="dialog-icon "|class="dialog-icon"/);
  assert.match(markup, /data-icon="agent"/);
  assert.match(markup, />确认<\/button>/);
});
