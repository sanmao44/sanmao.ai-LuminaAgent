import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const WorkspaceTopbar = createTsRequire(new URL('../components', import.meta.url).pathname)('./WorkspaceTopbar').default;
const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });

function renderTopbar(overrides = {}) {
  return renderToStaticMarkup(createElement(WorkspaceTopbar, {
    section: 'agent',
    sidebarOpen: false,
    theme: 'light',
    syncStatus: 'synced',
    taskSummary: { total: 3, pending: 1, error: 0 },
    Icon,
    onOpenSidebar: () => {},
    onGoAgent: () => {},
    onGoGenerate: () => {},
    onGoVideo: () => {},
    onGoTasks: () => {},
    onToggleTheme: () => {},
    onCanvasClick: () => {},
    ...overrides,
  }));
}

test('WorkspaceTopbar renders one active mode and shared control hooks', () => {
  const markup = renderTopbar({ section: 'video' });
  assert.match(markup, /class="ui-control active"[^>]*aria-pressed="true"[^>]*><i data-icon="video"/);
  assert.equal((markup.match(/class="ui-control(?: ui-control--icon)?/g) || []).length, 7);
  assert.match(markup, /aria-label="打开任务记录，任务记录：1 项进行中；工作区已保存"/);
});

test('WorkspaceTopbar exposes stateful labels and disables the upcoming mode', () => {
  const markup = renderTopbar({ theme: 'dark', syncStatus: 'conflict', taskSummary: { total: 0, pending: 0, error: 0 } });
  assert.match(markup, /aria-label="切换浅色主题"/);
  assert.match(markup, /aria-label="音频，即将上线"[^>]*disabled=""/);
  assert.match(markup, /aria-label="打开任务记录，任务记录：暂无任务；工作区同步冲突"/);
});
