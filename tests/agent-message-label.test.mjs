import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentMessageLabel.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, componentModule, componentModule.exports);
const AgentMessageLabel = componentModule.exports.default;

test('message label provides the shared rounded header container for page-owned content', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessageLabel, {
    children: createElement('span', { className: 'message-web-badge' }, '外部搜索 API'),
  }));
  assert.match(markup, /^<div class="message-label"><span class="message-web-badge">外部搜索 API<\/span><\/div>$/);
});
