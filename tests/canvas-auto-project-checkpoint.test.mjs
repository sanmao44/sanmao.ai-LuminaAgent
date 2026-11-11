import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const checkpoint = createTsRequire(process.cwd())('./lib/canvas/auto-project-checkpoint');
const { CanvasCore } = createTsRequire(process.cwd())('./packages/canvas-core/runtime');

function document(nodes) {
  return { version: '1', nodes, edges: [], groups: [], camera: { x: 0, y: 0, zoom: 1 } };
}

function taskNode(id, status, url, taskId = 'task-1', kind = 'image', type = 'media') {
  return {
    id,
    type,
    x: 0,
    y: 0,
    data: { kind, status, url, generation: { kind, taskId } },
  };
}

test('completed task projection captures ready image and video outputs once per task', () => {
  const previous = document([
    taskNode('image', 'running', ''),
    taskNode('video', 'queued', '', 'video-task', 'video'),
  ]);
  const next = document([
    taskNode('image', 'completed', '/image.png'),
    taskNode('video', 'completed', '/video.mp4', 'video-task', 'video'),
    taskNode('batch-result', 'completed', '/image-2.png'),
  ]);

  assert.deepEqual(checkpoint.completedGeneratedTaskIds(previous, next), ['task-1', 'video-task']);
});

test('ordinary edits, imports, failures, audio and incomplete outputs do not create checkpoints', () => {
  const previous = document([
    taskNode('running', 'running', ''),
    taskNode('failed', 'failed', '', 'failed-task'),
    taskNode('audio', 'running', '', 'audio-task', 'audio'),
  ]);
  const next = document([
    taskNode('running', 'running', ''),
    taskNode('failed', 'failed', '', 'failed-task'),
    taskNode('audio', 'completed', '/voice.mp3', 'audio-task', 'audio'),
    taskNode('imported', 'completed', '/existing.png'),
  ]);

  assert.deepEqual(checkpoint.completedGeneratedTaskIds(previous, next), []);
});

test('upscale completion is recognized on its existing output node', () => {
  const previous = document([taskNode('upscale', 'running', '/source.png', 'upscale-task', 'image', 'upscale')]);
  const next = document([taskNode('upscale', 'completed', '/upscaled.png', 'upscale-task', 'image', 'upscale')]);

  assert.deepEqual(checkpoint.completedGeneratedTaskIds(previous, next), ['upscale-task']);
});

test('CanvasCore apply completion is projected from the pre-apply document', () => {
  const core = new CanvasCore(document([taskNode('image', 'running', '')]));
  const previous = core.document();
  const result = core.apply({
    id: 'complete-image',
    label: 'image.complete',
    apply: (current) => document(current.nodes.map((node) => taskNode(node.id, 'completed', '/image.png'))),
  });

  assert.deepEqual(checkpoint.completedGeneratedTaskIds(previous, result.document), ['task-1']);
  assert.equal(core.document(), result.document);
});

test('Canvas Agent completion checkpoints a non-empty reply under its stable run id', () => {
  const previous = document([{
    id: 'agent-prompt',
    type: 'prompt',
    x: 0,
    y: 0,
    data: { status: 'running', jobId: 'agent-run-1' },
  }]);
  const next = document([
    { ...previous.nodes[0], data: { status: 'completed', jobId: 'agent-run-1', agentResponse: '生成方案已完成' } },
    taskNode('agent-image', 'completed', '/agent.png', 'agent-run-1'),
  ]);

  assert.deepEqual(checkpoint.completedGeneratedTaskIds(previous, next), ['agent_agent-run-1']);
  assert.deepEqual(checkpoint.completedGeneratedTaskIds(previous, document([
    { ...previous.nodes[0], data: { status: 'completed', jobId: 'agent-run-1', agentResponse: ' ' } },
  ])), []);
});

test('successful speech generation has a stable checkpoint key and rejects incomplete identity', () => {
  assert.equal(checkpoint.speechCheckpointTriggerId('audio-node', 1730000000000), 'speech_audio-node_1730000000000');
  assert.equal(checkpoint.speechCheckpointTriggerId('audio-node', 1730000000000), checkpoint.speechCheckpointTriggerId('audio-node', 1730000000000));
  assert.equal(checkpoint.speechCheckpointTriggerId('', 1730000000000), '');
  assert.equal(checkpoint.speechCheckpointTriggerId('audio-node', Number.NaN), '');
});

test('Agent checkpoint keys are stable per run, canvas, action and resulting state', () => {
  const first = document([taskNode('agent-image', 'completed', '/image.png')]);
  const same = document([taskNode('agent-image', 'completed', '/image.png')]);
  const changed = document([taskNode('agent-image', 'completed', '/image-2.png')]);

  const triggerId = checkpoint.agentCheckpointTriggerId('run-1', 'canvas-a', 'images', first);
  assert.equal(triggerId, checkpoint.agentCheckpointTriggerId('run-1', 'canvas-a', 'images', same));
  assert.notEqual(triggerId, checkpoint.agentCheckpointTriggerId('run-1', 'canvas-a', 'images', changed));
  assert.notEqual(triggerId, checkpoint.agentCheckpointTriggerId('run-2', 'canvas-a', 'images', first));
  assert.notEqual(triggerId, checkpoint.agentCheckpointTriggerId('run-1', 'canvas-b', 'images', first));
  assert.match(triggerId, /^agent_[a-z0-9]+$/);
});

test('automatic checkpoint interval settings normalize to supported choices', () => {
  assert.equal(checkpoint.normalizeAutoProjectCheckpointIntervalMinutes(0), 0);
  assert.equal(checkpoint.normalizeAutoProjectCheckpointIntervalMinutes(1), 1);
  assert.equal(checkpoint.normalizeAutoProjectCheckpointIntervalMinutes(5), 5);
  assert.equal(checkpoint.normalizeAutoProjectCheckpointIntervalMinutes(15), 15);
  assert.equal(checkpoint.normalizeAutoProjectCheckpointIntervalMinutes(30), 0);
  assert.equal(checkpoint.normalizeAutoProjectCheckpointIntervalMinutes('5'), 0);
});

test('automatic checkpoint delay uses the latest checkpoint for the same canvas only', () => {
  const versions = [
    { id: 'manual-1', canvasId: 'canvas-a', createdAt: 100_000 },
    { id: 'auto_task-b', canvasId: 'canvas-b', createdAt: 200_000 },
    { id: 'auto_task-a-old', canvasId: 'canvas-a', createdAt: 300_000 },
    { id: 'auto_task-a-new', canvasId: 'canvas-a', createdAt: 400_000 },
  ];

  assert.equal(checkpoint.automaticProjectCheckpointDelay(versions, 'canvas-a', 5, 500_000), 200_000);
  assert.equal(checkpoint.automaticProjectCheckpointDelay(versions, 'canvas-a', 5, 700_000), 0);
  assert.equal(checkpoint.automaticProjectCheckpointDelay(versions, 'canvas-a', 0, 400_000), 0);
  assert.equal(checkpoint.automaticProjectCheckpointDelay(versions, 'canvas-c', 15, 0), 0);
});
