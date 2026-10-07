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

const selectionPushSource = await readFile(new URL('../components/AgentSelectionPush.tsx', import.meta.url), 'utf8');
const selectionPushCompiled = ts.transpileModule(selectionPushSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const selectionPushModule = { exports: {} };
new Function('require', 'module', 'exports', selectionPushCompiled)(require, selectionPushModule, selectionPushModule.exports);
const AgentSelectionPush = selectionPushModule.exports.default;
const selectionStyles = await readFile(new URL('../app/agent-selection-push.css', import.meta.url), 'utf8');

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

test('AgentSelectionPush renders image and video handoff actions', () => {
  const markup = renderToStaticMarkup(createElement(AgentSelectionPush, {
    selection: { text: 'a cinematic city', x: 240, y: 180, placement: 'above' },
    availableVideoModelCount: 1,
    Icon: ({ name }) => createElement('i', { 'data-icon': name }),
    onPushImage: () => {},
    onPushVideo: () => {},
  }));
  assert.match(markup, /selection-push above/);
  assert.match(markup, /selection-push-group image/);
  assert.match(markup, /selection-push-group video/);
  assert.match(markup, /送入并跳转/);
  assert.match(markup, /继续选择/);
  assert.doesNotMatch(markup, /disabled/);
});

test('AgentSelectionPush disables video handoff when no video model is available', () => {
  const markup = renderToStaticMarkup(createElement(AgentSelectionPush, {
    selection: { text: 'a cinematic city', x: 240, y: 180, placement: 'below' },
    availableVideoModelCount: 0,
    Icon: ({ name }) => createElement('i', { 'data-icon': name }),
    onPushImage: () => {},
    onPushVideo: () => {},
  }));
  assert.match(markup, /selection-push below/);
  assert.match(markup, /请先启用模型/);
  assert.equal((markup.match(/disabled=""/g) || []).length, 2);
});

test('AgentSelectionPush keeps its responsive and reduced-motion styles in the feature sheet', () => {
  assert.match(selectionStyles, /\.selection-push\{position:fixed/);
  assert.match(selectionStyles, /\.selection-push\.above\{/);
  assert.match(selectionStyles, /\.selection-push\.below\{/);
  assert.match(selectionStyles, /@media\(max-width:520px\)/);
  assert.match(selectionStyles, /@media\(prefers-reduced-motion:reduce\)/);
});
