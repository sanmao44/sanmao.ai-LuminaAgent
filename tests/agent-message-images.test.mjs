import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentMessageImages.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, componentModule, componentModule.exports);
const AgentMessageImages = componentModule.exports.default;

test('message image grid preserves page-owned cards and omits empty results', () => {
  const markup = renderToStaticMarkup(createElement(AgentMessageImages, {
    images: [{ id: 'img-1' }, { id: 'img-2' }],
    renderImage: (item) => createElement('span', { key: item.id, 'data-image': item.id }, item.id),
  }));
  assert.equal(markup, '<div class="message-images"><span data-image="img-1">img-1</span><span data-image="img-2">img-2</span></div>');
  assert.equal(renderToStaticMarkup(createElement(AgentMessageImages, { images: [], renderImage: () => null })), '');
});
