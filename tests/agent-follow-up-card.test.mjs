import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentFollowUpCard.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const AgentFollowUpCard = module.exports.default;

test('AgentFollowUpCard labels the quoted role and normalizes its preview', () => {
  const markup = renderToStaticMarkup(createElement(AgentFollowUpCard, {
    role: 'assistant',
    content: '  第一行\n第二行  ',
    Icon: ({ name }) => createElement('i', { 'data-icon': name }),
    onClear: () => {},
  }));
  assert.match(markup, /agent-followup-card/);
  assert.match(markup, /正在追问 助手回复/);
  assert.match(markup, /第一行 第二行/);
  assert.match(markup, /取消引用/);
});
