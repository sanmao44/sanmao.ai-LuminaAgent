import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentChatFileList.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, componentModule, componentModule.exports);
const AgentChatFileList = componentModule.exports.default;
const Icon = ({ name }) => createElement('i', { 'data-icon': name });
const file = { id: 'f1', name: 'report.html', mimeType: 'text/html; charset=utf-8', content: '<h1>Report</h1>', size: 2048 };

test('chat file list renders preview and download actions from page-owned callbacks', () => {
  const markup = renderToStaticMarkup(createElement(AgentChatFileList, {
    files: [file],
    Icon,
    onDownload: () => {},
    onPreview: () => {},
    isPreviewable: () => true,
    fileTypeLabel: () => 'HTML · ',
    formatSize: () => '2.0 KB',
  }));
  assert.match(markup, /message-files/);
  assert.match(markup, /report\.html/);
  assert.match(markup, /message-file-preview/);
  assert.match(markup, /预览/);
  assert.match(markup, /message-file-download/);
  assert.match(markup, /下载/);
});

test('chat file list omits preview and download when page says they are unavailable', () => {
  const markup = renderToStaticMarkup(createElement(AgentChatFileList, {
    files: [{ ...file, sourceSize: 64 }],
    Icon,
    onDownload: () => {},
    isPreviewable: () => false,
    fileTypeLabel: () => '',
    formatSize: () => '64 B',
  }));
  assert.match(markup, /report\.html/);
  assert.doesNotMatch(markup, /message-file-preview|message-file-download|预览|下载/);
});
