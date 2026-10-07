import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());

test('Agent request context marks canvas nodes as text-only and keeps dock execution explicit', () => {
  const { prepareAgentRequestContext } = load('./packages/agent-core/request-context');
  const normalizedWorkspace = { creativeProjectId: 'project-1', chatId: 'chat-1', canvasId: 'canvas-1', selectedNodeIds: ['node-1'] };
  const node = prepareAgentRequestContext({
    body: { source: 'canvas', executionMode: 'node', context: { selectedNodeIds: ['node-1'] }, canvasTarget: { kind: 'image', operation: 'edit' } },
    runId: 'run-1', normalizeWorkspaceContext: () => normalizedWorkspace, normalizeDocument: (value) => value, normalizeGenerationSource: () => 'canvas',
  });
  assert.equal(node.isCanvasSource, true);
  assert.equal(node.isCanvasNodeExecution, true);
  assert.equal(node.canvasTargetKind, 'image');
  assert.equal(node.taskContext.taskId, 'run-1');

  const dock = prepareAgentRequestContext({
    body: { source: 'canvas', executionMode: 'agent-dock', canvasTarget: { kind: 'image', operation: 'edit' } },
    runId: 'run-2', normalizeWorkspaceContext: () => null, normalizeDocument: (value) => value, normalizeGenerationSource: () => 'canvas',
  });
  assert.equal(dock.isCanvasNodeExecution, false);
});

test('Agent request context derives stable task ownership fields from workspace state', () => {
  const { prepareAgentRequestContext } = load('./packages/agent-core/request-context');
  const result = prepareAgentRequestContext({
    body: { context: { creativeProjectId: 'p', chatId: 'c', canvasId: 'cv', selectedNodeIds: ['n'] } },
    runId: 'agent-run', normalizeWorkspaceContext: (value) => value, normalizeDocument: (value) => value, normalizeGenerationSource: () => 'agent',
  });
  assert.deepEqual(result.taskContext, { projectId: 'p', chatId: 'c', canvasId: 'cv', nodeId: 'n', taskId: 'agent-run' });
});
