import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/AgentContextDock.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const module = { exports: {} };
const Stub = ({ children }) => createElement('div', { 'data-stub': 'context-tool' }, children);
const stubRequire = (specifier) => {
  if (specifier.startsWith('@/components/')) return Stub;
  return require(specifier);
};
new Function('require', 'module', 'exports', compiled)(stubRequire, module, module.exports);
const AgentContextDock = module.exports.default;

const props = {
  activeChatId: 'chat-1',
  activeAgentBusy: false,
  memorySummary: '摘要',
  persona: '角色',
  agentPersonaDraft: '',
  hasMessages: true,
  shareSelectionMode: true,
  shareBusy: false,
  selectedShareGroups: 1,
  selectableShareGroups: 2,
  allShareGroupsSelected: false,
  selectedShareMessages: 1,
  hasPendingMessages: false,
  Icon: ({ name }) => createElement('i', { 'data-icon': name }),
  onSaveMemory: async () => {},
  onSavePersona: async () => {},
  onBeginShareSelection: () => {},
  onToggleAllShareGroups: () => {},
  onClearShareGroupSelection: () => {},
  onResetShareSelection: () => {},
  onShareConversation: () => {},
};

test('AgentContextDock keeps memory, persona and share controls together', () => {
  const markup = renderToStaticMarkup(createElement(AgentContextDock, props));
  assert.match(markup, /agent-memory-dock/);
  assert.match(markup, /conversation-share-controls/);
  assert.match(markup, /1\/2/);
  assert.match(markup, /预览/);
});

test('AgentContextDock shows the share entry when selection is inactive', () => {
  const markup = renderToStaticMarkup(createElement(AgentContextDock, { ...props, shareSelectionMode: false }));
  assert.match(markup, /conversation-share-entry/);
  assert.doesNotMatch(markup, /conversation-share-controls/);
});
