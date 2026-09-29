import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/SidebarFooterActions.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const SidebarFooterActions = module.exports.default;

const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });

test('SidebarFooterActions renders model status and support entry points', () => {
  const openMarkup = renderToStaticMarkup(createElement(SidebarFooterActions, {
    sidebarOpen: true,
    imageModelCount: 2,
    chatModelCount: 3,
    videoModelCount: 1,
    Icon,
    onOpenModels: () => {},
    onOpenSupport: () => {},
  }));
  assert.match(openMarkup, /class="sidebar-model-status"/);
  assert.match(openMarkup, /6 个模型/);
  assert.match(openMarkup, /class="sidebar-support-button"/);
  assert.match(openMarkup, /class="support-rail-button"/);

  const compactMarkup = renderToStaticMarkup(createElement(SidebarFooterActions, {
    sidebarOpen: false,
    imageModelCount: 0,
    chatModelCount: 0,
    videoModelCount: 0,
    Icon,
    onOpenModels: () => {},
    onOpenSupport: () => {},
  }));
  assert.doesNotMatch(compactMarkup, /class="sidebar-model-status"/);
  assert.match(compactMarkup, /class="support-rail-button"/);
});
