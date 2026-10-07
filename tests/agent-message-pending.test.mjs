import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentMessagePending.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, componentModule, componentModule.exports);
const AgentMessagePending = componentModule.exports.default;

test('pending Agent reply presents its text with an accessible spinner and elapsed time', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessagePending, {
    content: '正在搜索相关资料…',
    elapsedSeconds: 12,
  }));
  assert.match(markup, /class="message-pending"/);
  assert.match(markup, /class="mini-loader" aria-hidden="true"/);
  assert.match(markup, /class="pending">正在搜索相关资料…<\/p>/);
  assert.match(markup, /class="message-pending-clock">12s<\/span>/);
});

test('pending Agent reply omits the clock until the page supplies elapsed time', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessagePending, { content: '正在思考…' }));
  assert.match(markup, /正在思考…/);
  assert.doesNotMatch(markup, /message-pending-clock/);
});
