import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../components/workspace-topbar-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { workspaceTaskSummaryLabel, workspaceTaskSummaryTone, workspaceTopbarModes, workspaceTopbarStatusTone } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('WorkspaceTopbar keeps image, video and Agent active mode semantics', () => {
  assert.deepEqual(workspaceTopbarModes('generate'), { imageActive: true, videoActive: false, agentActive: false });
  assert.deepEqual(workspaceTopbarModes('angle'), { imageActive: true, videoActive: false, agentActive: false });
  assert.deepEqual(workspaceTopbarModes('video'), { imageActive: false, videoActive: true, agentActive: false });
  assert.deepEqual(workspaceTopbarModes('agent'), { imageActive: false, videoActive: false, agentActive: true });
});

test('WorkspaceTopbar task summary prioritizes failures, then active work', () => {
  assert.equal(workspaceTaskSummaryLabel({ total: 4, pending: 1, error: 2 }), '2 项需处理');
  assert.equal(workspaceTaskSummaryTone({ total: 4, pending: 1, error: 2 }), 'attention');
  assert.equal(workspaceTaskSummaryLabel({ total: 4, pending: 2, error: 0 }), '2 项进行中');
  assert.equal(workspaceTaskSummaryTone({ total: 4, pending: 2, error: 0 }), 'working');
  assert.equal(workspaceTaskSummaryLabel({ total: 3, pending: 0, error: 0 }), '3 项已完成');
  assert.equal(workspaceTaskSummaryLabel({ total: 0, pending: 0, error: 0 }), '暂无任务');
  assert.equal(workspaceTaskSummaryTone({ total: 3, pending: 0, error: 0 }), 'ready');
});

test('WorkspaceTopbar keeps sync failures visible above task completion state', () => {
  const done = { total: 3, pending: 0, error: 0 };
  assert.equal(workspaceTopbarStatusTone(done, 'offline'), 'attention');
  assert.equal(workspaceTopbarStatusTone(done, 'error'), 'attention');
  assert.equal(workspaceTopbarStatusTone(done, 'conflict'), 'attention');
  assert.equal(workspaceTopbarStatusTone(done, 'syncing'), 'working');
  assert.equal(workspaceTopbarStatusTone(done, 'synced'), 'ready');
});
