import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const AgentMessageError = createTsRequire(new URL('..', import.meta.url).pathname)('./components/AgentMessageError').default;

test('retrying error state announces progress and disables both retry choices', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessageError, {
    message: '请求失败：模型超时',
    retrying: true,
    disabled: true,
    onRetryAutomatic: () => {},
    onRetryCurrent: () => {},
  }));

  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /正在重试/);
  assert.equal((markup.match(/disabled=""/g) || []).length, 2);
});

test('idle error state keeps both recovery choices available', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessageError, {
    message: '请求失败：模型超时',
    onRetryAutomatic: () => {},
    onRetryCurrent: () => {},
  }));

  assert.match(markup, /切换自动并重试/);
  assert.match(markup, /重试当前模型/);
  assert.doesNotMatch(markup, /disabled=/);
});
