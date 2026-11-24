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
  assert.match(markup, /本次请求未完成/);
  assert.doesNotMatch(markup, /模型没有返回可用回复/);
  assert.doesNotMatch(markup, /disabled=/);
});

function renderError(message, props = {}) {
  return renderToStaticMarkup(createElement(AgentMessageError, {
    message,
    onRetryAutomatic: () => {},
    onRetryCurrent: () => {},
    ...props,
  }));
}

test('explicit request size errors advise reducing input or attachments before retrying', () => {
  for (const message of [
    '请求失败：请求内容超过服务商限制：body too large（request id: req-size）',
    '请求失败：服务商接口返回 HTTP 413：too large',
    '请求失败：请求内容过大',
    '请求失败：请求体过大',
    '请求失败：Request Entity Too Large',
    '请求失败：Payload Too Large',
  ]) {
    const markup = renderError(message);
    assert.match(markup, /缩短本轮输入或减少附件/, message);
    assert.match(markup, /原样重试可能再次失败/, message);
    assert.doesNotMatch(markup, /上下文更大的模型|模型没有返回可用回复/, message);
    assert.match(markup, /切换自动并重试/, message);
    assert.match(markup, /重试当前模型/, message);
    assert.doesNotMatch(markup, /disabled=/, message);
  }
});

test('context limit errors advise reducing history or choosing a larger context model', () => {
  for (const message of [
    '请求失败：服务商接口返回 HTTP 400：too long（错误码 context_length_exceeded）',
    '请求失败：当前请求的必要内容超过模型请求预算，无法在保留本轮指令、附件及工具结果的前提下继续。',
    '请求失败：AGENT_CONTEXT_BUDGET_EXCEEDED',
    '请求失败：This model has a maximum context length of 32768 tokens.',
    '请求失败：Context length exceeded',
    '请求失败：请求内容超过服务商限制：too long（错误码 context_length_exceeded）',
  ]) {
    const markup = renderError(message);
    assert.match(markup, /缩短对话历史/, message);
    assert.match(markup, /上下文更大的模型/, message);
    assert.match(markup, /原样重试可能再次失败/, message);
    assert.doesNotMatch(markup, /模型没有返回可用回复/, message);
    assert.doesNotMatch(markup, /disabled=/, message);
  }
});

test('413 inside request IDs or unrelated numbers does not imply a request size limit', () => {
  for (const message of [
    '请求失败：模型超时（request id: req-413-ae92）',
    '请求失败：服务商接口返回 HTTP 429：rate limited（request id: 413）',
    '请求失败：网络连接中断（request id: http413）',
    '请求失败：服务商接口返回 HTTP 4130',
    '请求失败：413',
  ]) {
    const markup = renderError(message);
    assert.match(markup, /本次请求未完成/, message);
    assert.doesNotMatch(markup, /原样重试可能再次失败|上下文更大的模型/, message);
  }
});

test('retry progress takes precedence over size and context recovery guidance', () => {
  for (const message of [
    '请求失败：请求内容超过服务商限制',
    '请求失败：context_length_exceeded',
  ]) {
    const markup = renderError(message, { retrying: true });
    assert.match(markup, /正在重试，当前回复会保留/, message);
    assert.match(markup, /role="status"/, message);
    assert.match(markup, /aria-live="polite"/, message);
    assert.doesNotMatch(markup, /原样重试可能再次失败|上下文更大的模型/, message);
    assert.equal((markup.match(/disabled=""/g) || []).length, 2, message);
  }
});

test('a busy conversation disables both retry choices while keeping recovery guidance', () => {
  const markup = renderError('请求失败：请求内容超过服务商限制', { disabled: true });
  assert.match(markup, /缩短本轮输入或减少附件/);
  assert.equal((markup.match(/disabled=""/g) || []).length, 2);
  assert.doesNotMatch(markup, /正在重试/);
});
