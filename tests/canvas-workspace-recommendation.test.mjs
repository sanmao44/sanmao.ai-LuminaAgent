import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { deriveCanvasWorkspaceRecommendation } = createTsRequire(process.cwd())('./lib/canvas/workspace-recommendation');

const projectAction = {
  kind: 'draft-content',
  label: '让 AI 起草第一版内容',
  detail: '先产出可编辑草案。',
};

test('workspace recommendation puts task recovery ahead of project progression', () => {
  const taskAction = {
    kind: 'restore',
    count: 2,
    filter: 'recoverable',
    title: '有 2 个失败任务可恢复',
    detail: '带回已保存参数成为可编辑草稿，检查后再提交。',
    buttonLabel: '查看可恢复',
  };

  assert.deepEqual(deriveCanvasWorkspaceRecommendation(projectAction, taskAction), {
    kind: 'task',
    title: taskAction.title,
    detail: taskAction.detail,
    buttonLabel: taskAction.buttonLabel,
    filter: taskAction.filter,
  });
});

test('workspace recommendation uses the project action when no task needs attention', () => {
  const taskAction = {
    kind: 'ready',
    count: 0,
    filter: null,
    title: '任务链路已就绪',
    detail: '没有需要处理的异常任务。',
    buttonLabel: '查看全部',
  };

  assert.deepEqual(deriveCanvasWorkspaceRecommendation(projectAction, taskAction), {
    kind: 'project',
    title: projectAction.label,
    detail: projectAction.detail,
    action: projectAction,
  });
});
