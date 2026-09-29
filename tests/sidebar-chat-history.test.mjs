import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/SidebarChatHistory.tsx', import.meta.url), 'utf8');
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
const SidebarChatHistory = module.exports.default;

const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });
const sessions = [
  { id: 'active', title: '当前对话', updatedAt: 200, messages: [{ content: '你好' }], persona: '编辑' },
  { id: 'old', title: '旧对话', updatedAt: 100, messages: [{ content: '历史' }] },
];
const props = {
  visible: true,
  sessions,
  filteredSessions: sessions,
  personaChatCount: 1,
  personaOnly: false,
  search: '对话',
  selectionMode: true,
  selectedIds: new Set(['active']),
  allSelected: false,
  activeChatId: 'active',
  busyChatIds: ['old'],
  renamingChatId: null,
  renamingChatTitle: '',
  Icon,
  formatTime: () => '时间',
  historyGroupLabel: (timestamp) => timestamp === 200 ? '今天' : '更早',
  personaBadgeLabel: (persona) => persona || '',
  onTogglePersonaFilter: () => {},
  onSearchChange: () => {},
  onClearSearch: () => {},
  onToggleSelectionMode: () => {},
  onOpenSession: () => {},
  onBeginRename: () => {},
  onRenameTitleChange: () => {},
  onCommitRename: () => {},
  onCancelRename: () => {},
  onToggleSessionSelection: () => {},
  onDeleteSession: () => {},
  onToggleAll: () => {},
  onDeleteSelected: () => {},
};

test('SidebarChatHistory preserves filtering, grouping and selection affordances', () => {
  const markup = renderToStaticMarkup(createElement(SidebarChatHistory, props));
  assert.match(markup, /助手历史/);
  assert.match(markup, /角色 1/);
  assert.match(markup, /当前对话/);
  assert.match(markup, /今天/);
  assert.match(markup, /更早/);
  assert.match(markup, /chat-history-selection-bar/);
  assert.match(markup, /已选 1 段/);
  assert.match(markup, /正在回答…/);
  assert.match(markup, /disabled/);
});

test('SidebarChatHistory is absent when the sidebar is closed', () => {
  assert.equal(renderToStaticMarkup(createElement(SidebarChatHistory, { ...props, visible: false })), '');
});
