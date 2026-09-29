import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentMessageSelectionBar.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const AgentMessageSelectionBar = module.exports.default;

test('AgentMessageSelectionBar exposes count, cancel and guarded delete actions', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessageSelectionBar, {
    selectedCount: 2,
    Icon: ({ name }) => createElement('i', { 'data-icon': name }),
    onCancel: () => {},
    onDeleteSelected: () => {},
  }));
  assert.match(markup, /agent-message-selection-bar/);
  assert.match(markup, /已选择 <b>2<\/b> 条对话内容/);
  assert.match(markup, /删除所选/);
  assert.doesNotMatch(markup, /disabled=""/);
});

test('AgentMessageSelectionBar disables delete when empty', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessageSelectionBar, {
    selectedCount: 0,
    Icon: ({ name }) => createElement('i', { 'data-icon': name }),
    onCancel: () => {},
    onDeleteSelected: () => {},
  }));
  assert.match(markup, /disabled/);
});
