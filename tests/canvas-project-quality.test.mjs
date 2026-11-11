import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const { deriveCanvasProjectQuality } = load('./lib/canvas/project-quality');

function node(id, type, data = {}) {
  return { id, type, data, position: { x: 0, y: 0 } };
}

function input({ nodes = [], edges = [], brief = null, versionCount = 0, taskLogs = [] } = {}) {
  return {
    document: { version: 'sanmao-canvas-3', nodes, edges, groups: [], camera: { x: 0, y: 0, zoom: 1 } },
    brief,
    versionCount,
    taskLogs,
    projectId: 'project-current',
    canvasId: 'canvas-current',
  };
}

test('quality check reports actionable project risks', () => {
  const result = deriveCanvasProjectQuality(input({
    nodes: [
      node('video', 'media', { kind: 'video', url: '/cut.mp4', status: 'completed' }),
      node('generator', 'generator', { kind: 'image', prompt: '', status: 'idle' }),
    ],
    taskLogs: [{ id: 'failed', status: 'error', mode: 'video', projectId: 'project-current', error: '超时' }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.score < 60);
  assert.deepEqual(result.scoreDeductions, { error: 35, warning: 15, info: 4 });
  assert.equal(result.score, Math.max(0, 100 - result.checks.reduce((score, check) => score + result.scoreDeductions[check.severity], 0)));
  assert.equal(result.checks.find((check) => check.id === 'failed-task').action.taskId, 'failed');
  assert.equal(result.checks.some((check) => check.id === 'missing-audio'), true);
  assert.equal(result.checks.some((check) => check.id === 'empty-generator'), true);
  assert.equal(result.checks.some((check) => check.id === 'version'), true);
});

test('quality check scopes task failures and recognizes a clean project', () => {
  const result = deriveCanvasProjectQuality(input({
    brief: { intent: '海报', style: '简洁', deliverable: 'image' },
    versionCount: 1,
    nodes: [node('image', 'media', { kind: 'image', url: '/poster.png', status: 'completed' })],
    taskLogs: [
      { id: 'other', status: 'error', mode: 'image', projectId: 'other-project' },
      { id: 'current', status: 'success', mode: 'image', projectId: 'project-current' },
    ],
  }));
  assert.equal(result.status, 'attention');
  assert.equal(result.score, 85);
  assert.equal(result.checks.some((check) => check.id === 'failed-task'), false);
  assert.equal(result.checks.some((check) => check.id === 'orphan-asset'), true);
  assert.equal(result.checks.find((check) => check.id === 'orphan-asset').action.nodeId, 'image');
});

test('empty projects without a configured brief only surface the brief check', () => {
  const result = deriveCanvasProjectQuality(input());
  assert.equal(result.status, 'attention');
  assert.deepEqual(result.checks.map((check) => check.id), ['brief']);
});
