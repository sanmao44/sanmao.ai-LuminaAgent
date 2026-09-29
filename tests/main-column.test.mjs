import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/MainColumn.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => specifier === './main-column-model'
    ? { mainColumnClassName: () => 'main-column' }
    : require(specifier),
  module,
  module.exports,
);
const MainColumn = module.exports.default;

test('MainColumn renders the stable content column around its children', () => {
  const markup = renderToStaticMarkup(createElement(MainColumn, { children: createElement('p', null, 'content') }));
  assert.equal(markup, '<section class="main-column"><p>content</p></section>');
});
