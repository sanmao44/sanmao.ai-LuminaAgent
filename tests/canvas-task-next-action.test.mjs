import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { deriveCanvasTaskNextAction } = createTsRequire(process.cwd())('./lib/canvas/task-next-action');

const image = (overrides = {}) => ({
  id: overrides.id || 'image-task',
  status: overrides.status || 'success',
  mode: 'image',
  mediaKind: 'image',
  ...overrides,
});

test('task action prioritizes read-only confirmation over other work', () => {
  assert.deepEqual(deriveCanvasTaskNextAction([
    image({ id: 'check', status: 'error', errorCode: 'provider_result_unconfirmed' }),
    image({ id: 'restore', status: 'error', errorCode: 'provider_rejected' }),
    image({ id: 'running', status: 'pending' }),
  ]), {
    kind: 'check',
    count: 1,
    filter: 'pending',
    title: '有 1 个结果待核对',
    detail: '只读取原任务记录，确认前不会重复提交。',
    buttonLabel: '查看待确认',
  });
});

test('task action explains that an unconfirmed audio request may already be accepted', () => {
  assert.deepEqual(deriveCanvasTaskNextAction([
    image({ mode: 'audio', mediaKind: 'audio', status: 'error', errorCode: 'provider_result_unconfirmed' }),
  ]), {
    kind: 'check',
    count: 1,
    filter: 'pending',
    title: '有 1 个结果待核对',
    detail: '服务商可能已接收配音请求；先检查音频节点和记录，再决定是否重试。',
    buttonLabel: '查看待确认',
  });
});

test('task action points failed tasks to the existing recovery flow', () => {
  assert.deepEqual(deriveCanvasTaskNextAction([
    image({ status: 'error', errorCode: 'provider_rejected' }),
    image({ id: 'other', status: 'error', errorCode: 'provider_rejected' }),
  ]), {
    kind: 'restore',
    count: 2,
    filter: 'recoverable',
    title: '有 2 个失败任务可恢复',
    detail: '带回已保存参数成为可编辑草稿，检查后再提交。',
    buttonLabel: '查看可恢复',
  });
});

test('task action reports background work and an idle project clearly', () => {
  assert.equal(deriveCanvasTaskNextAction([
    image({ status: 'pending' }),
    image({ id: 'second', status: 'pending' }),
  ]).kind, 'running');
  assert.equal(deriveCanvasTaskNextAction([]).kind, 'ready');
});

test('task action directs old pending tasks to review instead of implying active progress', () => {
  const now = Date.now();
  const action = deriveCanvasTaskNextAction([
    image({ status: 'pending', createdAt: new Date(now - 20 * 60_000).toISOString() }),
    image({ id: 'recent', status: 'pending', createdAt: new Date(now - 2 * 60_000).toISOString() }),
  ]);
  assert.deepEqual(action, {
    kind: 'stale',
    count: 1,
    filter: 'pending',
    title: '1 个任务长时间没有回执',
    detail: '先核对原任务或停止本机等待；服务商可能仍在处理，重试会创建新任务。',
    buttonLabel: '查看并处理',
  });
});
