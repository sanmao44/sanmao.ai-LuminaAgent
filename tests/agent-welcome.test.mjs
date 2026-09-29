import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentWelcome.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const module = { exports: {} };
const stubRequire = (specifier) => specifier === '@/components/AgentOrb'
  ? ({ label, className, state }) => createElement('i', { 'data-label': label, className, 'data-state': state })
  : require(specifier);
new Function('require', 'module', 'exports', compiled)(stubRequire, module, module.exports);
const AgentWelcome = module.exports.default;

test('AgentWelcome renders the empty conversation prompt and examples', () => {
  const markup = renderToStaticMarkup(createElement(AgentWelcome, {
    orbState: 'idle',
    examples: ['例子一', '例子二'],
    onSelectExample: () => {},
  }));
  assert.match(markup, /agent-welcome/);
  assert.match(markup, /把想法交给 SANMAO\.AI/);
  assert.match(markup, /例子一/);
  assert.match(markup, /例子二/);
  assert.match(markup, /agent-welcome-orb/);
});
