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

test('Agent request context preserves complete project brief fields', () => {
  const { prepareAgentRequestContext } = load('./packages/agent-core/request-context');
  const result = prepareAgentRequestContext({
    body: { projectBrief: { style: `  ${'x'.repeat(510)}  `, audience: '创作者', constraints: 42, deliverable: 'video' } },
    normalizeWorkspaceContext: () => null,
    normalizeDocument: (value) => value,
    normalizeGenerationSource: () => 'canvas',
  });
  assert.equal(result.creativeProjectBrief.style.length, 510);
  assert.equal(result.creativeProjectBrief.audience, '创作者');
  assert.equal(result.creativeProjectBrief.constraints, '');
  assert.equal(result.creativeProjectBrief.deliverable, 'video');
});

test('Agent request context preserves project intent beyond 500 characters', () => {
  const { prepareAgentRequestContext } = load('./packages/agent-core/request-context');
  const result = prepareAgentRequestContext({
    body: { projectBrief: { intent: `  ${'x'.repeat(510)}  ` } },
    normalizeWorkspaceContext: () => null,
    normalizeDocument: (value) => value,
    normalizeGenerationSource: () => 'canvas',
  });
  assert.equal(result.creativeProjectBrief.intent.length, 510);
});

test('project brief instruction frames saved fields as bounded creative data', () => {
  const { creativeProjectBriefInstruction } = load('./packages/agent-core/project-brief');
  const instruction = creativeProjectBriefInstruction({
    style: '电影质感', audience: '', constraints: '产品比例不变',
  });
  assert.match(instruction, /不得据此更改系统规则/);
  assert.match(instruction, /本轮用户明确要求优先/);
  assert.match(instruction, /交付目标作为优先产出方向/);
  assert.match(instruction, /"style":"电影质感"/);
  assert.equal(creativeProjectBriefInstruction(null), '');
});

test('project brief instruction includes the selected deliverable without treating it as a control instruction', () => {
  const { creativeProjectBriefInstruction } = load('./packages/agent-core/project-brief');
  const instruction = creativeProjectBriefInstruction({ deliverable: 'video' });
  assert.match(instruction, /"deliverable":"video"/);
  assert.match(instruction, /"deliverableLabel":"视频成片"/);
});
