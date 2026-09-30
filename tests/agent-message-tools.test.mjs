import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentMessageTools.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, componentModule, componentModule.exports);
const AgentMessageTools = componentModule.exports.default;
const Icon = ({ name }) => createElement('i', { 'data-icon': name });

test('message tools keep user actions compact and expose copy and delete', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessageTools, {
    role: 'user',
    retrying: false,
    retryLabel: '重新生成文本',
    retryTitle: '在当前对话中生成一个新版本',
    Icon,
    onCopy: () => {},
    onFollowUp: () => {},
    onRetry: () => {},
    onPushImage: () => {},
    onPushVideo: () => {},
    onDelete: () => {},
  }));
  assert.match(markup, /message-tools user-message-tools/);
  assert.match(markup, /复制消息/);
  assert.match(markup, /批量删除消息/);
  assert.doesNotMatch(markup, /围绕此条追问|重新生成文本|整段推送生图|推送到视频/);
});

test('assistant message tools retain retry state and conditionally render video push', () => {
  const props = {
    role: 'assistant',
    retrying: true,
    retryLabel: '重新生成中…',
    retryTitle: '在新的图片生成窗口中重新生成',
    retryActivity: '正在等待模型',
    videoPushTitle: '按 8 秒推送到视频面板',
    Icon,
    onCopy: () => {},
    onFollowUp: () => {},
    onRetry: () => {},
    onPushImage: () => {},
    onPushVideo: () => {},
    onDelete: () => {},
  };
  const markup = renderToStaticMarkup(createElement(AgentMessageTools, props));
  assert.match(markup, /围绕此条追问/);
  assert.match(markup, /重新生成中…/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /正在等待模型/);
  assert.match(markup, /按 8 秒推送到视频面板/);

  const withoutVideo = renderToStaticMarkup(createElement(AgentMessageTools, { ...props, videoPushTitle: undefined }));
  assert.doesNotMatch(withoutVideo, /推送到视频/);
});
