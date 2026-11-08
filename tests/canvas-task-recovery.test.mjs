import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(path.join(process.cwd(), 'lib'));
const { normalizeDocument, createMedia, createPrompt } = load('./canvas/model');
const { canvasGenerationLogRecoveryStatus, canvasNodeForGenerationLog, recoverCanvasTask, recoverCanvasUpscaleTask, mergeCanvasTaskImages } = load('./canvas/task-recovery');
const { applyCanvasTaskRecordRecovery } = load('./canvas/task-record-recovery');
const params = { kind: 'image', model: 'test', aspect: '1:1' };
const input = { nodeId: 'pending', taskId: 'task-a', status: 'success', urls: ['/one.png', '/two.png', '/three.png'], imageParams: params };

test('provider receipt timeout remains pending so the canvas does not claim a failure', () => {
  assert.equal(canvasGenerationLogRecoveryStatus({ status: 'error', errorCode: 'provider_result_unconfirmed' }), 'pending');
  assert.equal(canvasGenerationLogRecoveryStatus({ status: 'error', errorCode: 'provider_rejected' }), 'error');
  assert.equal(canvasGenerationLogRecoveryStatus({ status: 'success' }), 'success');
  assert.equal(canvasGenerationLogRecoveryStatus({}), undefined);
  assert.equal(canvasGenerationLogRecoveryStatus({ status: 'queued', errorCode: 'provider_result_unconfirmed' }), 'queued');
});

test('successful task records require image URLs before updating the canvas or checkpointing', async () => {
  let updated = false;
  let checkpointed = false;
  const result = await applyCanvasTaskRecordRecovery({
    record: { status: 'success', imageUrls: [] },
    nodeId: 'pending',
    taskId: 'task-a',
    imageParams: params,
    updateDocument: () => { updated = true; return true; },
    queueCheckpoint: () => { checkpointed = true; },
  });

  assert.deepEqual(result, { kind: 'missing_output' });
  assert.equal(updated, false);
  assert.equal(checkpointed, false);
});

test('a failed background document save does not queue an automatic checkpoint', async () => {
  const events = [];
  const result = await applyCanvasTaskRecordRecovery({
    record: { status: 'success', imageUrls: ['/recovered.png'] },
    nodeId: 'pending',
    taskId: 'task-a',
    imageParams: params,
    updateDocument: (updater) => {
      updater(fixture());
      events.push('save-failed');
      return false;
    },
    queueCheckpoint: () => events.push('checkpoint'),
  });

  assert.deepEqual(result, { kind: 'save_failed', taskState: 'recovered' });
  assert.deepEqual(events, ['save-failed']);
});

test('a recovered result is checkpointed only after the canvas update succeeds', async () => {
  const events = [];
  const result = await applyCanvasTaskRecordRecovery({
    record: { status: 'success', imageUrls: ['/recovered.png', '/recovered.png'] },
    nodeId: 'pending',
    taskId: 'task-a',
    imageParams: params,
    updateDocument: (updater) => {
      assert.equal(updater(fixture()).nodes[0].data.url, '/recovered.png');
      events.push('saved');
      return true;
    },
    queueCheckpoint: () => events.push('checkpoint'),
  });

  assert.deepEqual(result, { kind: 'recovered', imageCount: 1 });
  assert.deepEqual(events, ['saved', 'checkpoint']);
});

test('unconfirmed task records remain pending and do not create checkpoints', async () => {
  let checkpointed = false;
  let updatedStatus;
  const result = await applyCanvasTaskRecordRecovery({
    record: { status: 'error', errorCode: 'provider_result_unconfirmed' },
    nodeId: 'pending',
    taskId: 'task-a',
    imageParams: params,
    updateDocument: (updater) => {
      updatedStatus = updater(fixture()).nodes[0].data.status;
      return true;
    },
    queueCheckpoint: () => { checkpointed = true; },
  });

  assert.deepEqual(result, { kind: 'pending' });
  assert.equal(updatedStatus, 'running');
  assert.equal(checkpointed, false);
});

test('a result for a replaced task does not update the canvas or queue a checkpoint', async () => {
  let checkpointed = false;
  const replacedTask = fixture();
  replacedTask.nodes[0].data.jobId = 'new-task';
  const result = await applyCanvasTaskRecordRecovery({
    record: { status: 'success', imageUrls: ['/old-result.png'] },
    nodeId: 'pending',
    taskId: 'task-a',
    imageParams: params,
    updateDocument: (updater) => updater(replacedTask) === replacedTask,
    queueCheckpoint: () => { checkpointed = true; },
  });

  assert.deepEqual(result, { kind: 'stale' });
  assert.equal(checkpointed, false);
});

function fixture(type = 'media') {
  const node = type === 'media' ? createMedia('image', '', '等待', { x: 10, y: 20 }) : createPrompt({ x: 10, y: 20 });
  node.id = 'pending';
  node.data.jobId = 'task-a';
  node.data.status = 'running';
  return normalizeDocument({ nodes: [node], edges: [], groups: [] });
}

test('recovery retains every image, the placeholder identity, and its placement', () => {
  const document = recoverCanvasTask(fixture(), input);
  assert.deepEqual(document.nodes.map((node) => node.data.url), input.urls);
  assert.equal(document.nodes[0].id, 'pending');
  assert.equal(document.nodes[0].x, 10);
  assert.equal(document.nodes[0].data.status, 'completed');
  assert.ok(document.nodes.every((node) => node.data.generation.taskId === 'task-a'));
  assert.equal(document.edges.length, 2);
});

test('repeated recovery and HTTP completion keep node identities without duplicate images', () => {
  const recovered = recoverCanvasTask(fixture(), input);
  const ids = recovered.nodes.map((node) => node.id);
  const outputs = input.urls.map((url) => createMedia('image', url, 'HTTP result', { x: 500, y: 500 }, {
    model: 'provider-model', generation: { kind: 'image', prompt: 'prompt', params, taskId: 'task-a', createdAt: 123 },
  }));
  const merged = mergeCanvasTaskImages(recovered, 'pending', 'task-a', outputs);
  assert.deepEqual(merged.nodes.map((node) => node.id), ids);
  assert.ok(merged.nodes.every((node) => node.data.model === 'provider-model'));
  assert.equal(merged.edges.length, 2);
  assert.deepEqual(recoverCanvasTask(merged, input).nodes.map((node) => node.id), ids);
});

test('HTTP completion followed by recovery adds no duplicate nodes', () => {
  const outputs = input.urls.map((url) => createMedia('image', url, 'HTTP result', { x: 0, y: 0 }, {
    generation: { kind: 'image', prompt: '', params, taskId: 'task-a', createdAt: 123 },
  }));
  const merged = mergeCanvasTaskImages(fixture(), 'pending', 'task-a', outputs);
  assert.deepEqual(recoverCanvasTask(merged, input).nodes.map((node) => node.id), merged.nodes.map((node) => node.id));
});

test('reordered results preserve every image and its original node identity', () => {
  const recovered = recoverCanvasTask(fixture(), input);
  const identities = recovered.nodes.map((node) => [node.data.url, node.id]);
  const reordered = recoverCanvasTask(recovered, { ...input, urls: [...input.urls].reverse() });
  assert.deepEqual(reordered.nodes.map((node) => [node.data.url, node.id]), identities);
  assert.equal(reordered.edges.length, 2);
});

test('partial replies add new images without replacing earlier recovered images', () => {
  const partial = recoverCanvasTask(fixture(), { ...input, urls: ['/one.png'] });
  const extended = recoverCanvasTask(partial, { ...input, urls: ['/two.png', '/three.png'] });
  assert.deepEqual(extended.nodes.map((node) => node.data.url), input.urls);
  assert.equal(extended.nodes[0].id, 'pending');
  assert.deepEqual(recoverCanvasTask(extended, input).nodes.map((node) => node.id), extended.nodes.map((node) => node.id));
});

test('late pending and error replies cannot replace a completed image', () => {
  const completed = recoverCanvasTask(fixture(), input);
  for (const status of ['pending', 'error']) assert.equal(recoverCanvasTask(completed, { ...input, status }), completed);
});

test('late replies from an old task cannot affect a retry or deleted node', () => {
  const retry = fixture();
  retry.nodes[0].data.jobId = 'new-task';
  for (const status of ['pending', 'error', 'success']) assert.equal(recoverCanvasTask(retry, { ...input, status }), retry);
  const deleted = normalizeDocument(null);
  assert.equal(recoverCanvasTask(deleted, input), deleted);
  assert.equal(mergeCanvasTaskImages(deleted, 'pending', 'task-a', fixture().nodes), deleted);
});

test('Agent recovery retains all outputs and completion does not duplicate them', () => {
  const document = recoverCanvasTask(fixture('prompt'), input);
  assert.equal(document.nodes.length, 4);
  assert.equal(document.edges.length, 3);
  assert.equal(document.nodes[0].data.status, 'completed');
  const outputs = input.urls.map((url) => createMedia('image', url, 'Agent result', { x: 0, y: 0 }, {
    generation: { kind: 'image', prompt: '', params, taskId: 'task-a', parentNodeId: 'pending', createdAt: 123 },
  }));
  assert.deepEqual(mergeCanvasTaskImages(document, 'pending', 'task-a', outputs).nodes.map((node) => node.id), document.nodes.map((node) => node.id));
});

test('video recovery updates only its video placeholder', () => {
  const video = fixture(); video.nodes[0].data.kind = 'video';
  const result = recoverCanvasTask(video, { ...input, urls: ['/video.mp4'] });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].data.url, '/video.mp4');
  assert.equal(result.nodes[0].data.kind, 'video');
});

test('upscale task snapshots update the existing node only after a retained output is available', () => {
  const upscale = load('./canvas/model').createUpscaleNode({ x: 40, y: 60 });
  upscale.id = 'upscale-node';
  upscale.data.status = 'running';
  upscale.data.jobId = 'worker-task';
  upscale.data.upscaleRequestId = 'request-key';
  const document = normalizeDocument({ nodes: [upscale], edges: [], groups: [] });
  const pending = recoverCanvasUpscaleTask(document, {
    nodeId: 'upscale-node', taskId: 'worker-task', requestId: 'request-key', status: 'processing',
  });
  assert.equal(pending, document);

  const completed = recoverCanvasUpscaleTask(document, {
    nodeId: 'upscale-node', taskId: 'worker-task', requestId: 'request-key', status: 'succeeded',
    imageUrl: '/upscaled.png', modelName: 'Cloud Upscaler',
  });
  assert.equal(completed.nodes.length, 1);
  assert.equal(completed.edges, document.edges);
  assert.equal(completed.nodes[0].id, 'upscale-node');
  assert.equal(completed.nodes[0].data.url, '/upscaled.png');
  assert.equal(completed.nodes[0].data.model, 'Cloud Upscaler');
  assert.equal(completed.nodes[0].data.resultSource, 'upscale-node');
  assert.equal(completed.nodes[0].data.status, 'completed');
  assert.equal(completed.nodes[0].data.generation.taskId, 'request-key');
  assert.equal(recoverCanvasUpscaleTask(completed, {
    nodeId: 'upscale-node', taskId: 'worker-task', requestId: 'request-key', status: 'succeeded', imageUrl: '/upscaled.png',
  }), completed);
});

test('upscale failures preserve the node and stale task snapshots are ignored', () => {
  const upscale = load('./canvas/model').createUpscaleNode();
  upscale.id = 'upscale-node';
  upscale.data.status = 'running';
  upscale.data.jobId = 'new-worker-task';
  upscale.data.upscaleRequestId = 'new-request-key';
  const document = normalizeDocument({ nodes: [upscale], edges: [], groups: [] });
  assert.equal(recoverCanvasUpscaleTask(document, {
    nodeId: 'upscale-node', taskId: 'old-worker-task', requestId: 'new-request-key', status: 'succeeded', imageUrl: '/old.png',
  }), document);
  const failed = recoverCanvasUpscaleTask(document, {
    nodeId: 'upscale-node', taskId: 'new-worker-task', requestId: 'new-request-key', status: 'failed', error: 'Provider failed',
  });
  assert.equal(failed.nodes[0].id, 'upscale-node');
  assert.equal(failed.nodes[0].data.status, 'failed');
  assert.equal(failed.nodes[0].data.statusLabel, 'Provider failed');
  assert.equal(failed.nodes[0].data.progress, undefined);
});

test('a missing video task record ends local tracking without claiming provider failure', () => {
  const video = fixture();
  video.nodes[0].data.kind = 'video';
  video.nodes[0].data.progress = 0;
  video.nodes[0].data.processingStartedAt = 123;
  const message = '后台任务记录已丢失，服务商状态未知；请核对生成记录后再操作，避免重复提交';
  const result = recoverCanvasTask(video, {
    ...input,
    status: 'error',
    urls: [],
    error: message,
  });

  assert.equal(result.nodes[0].data.status, 'failed');
  assert.equal(result.nodes[0].data.progress, undefined);
  assert.equal(result.nodes[0].data.processingStartedAt, undefined);
  assert.equal(result.nodes[0].data.statusLabel, message);
});

test('audio generation logs resolve their existing audio node by task and node lineage', () => {
  const audio = createMedia('audio', '/voice.mp3', '配音', { x: 10, y: 20 });
  audio.id = 'audio-node';
  audio.data.jobId = 'audio-task';
  const document = normalizeDocument({ nodes: [audio], edges: [], groups: [] });
  assert.equal(canvasNodeForGenerationLog(document, { id: 'log-1', taskId: 'audio-task', mode: 'audio', mediaKind: 'audio', prompt: '旁白' })?.id, 'audio-node');
  assert.equal(canvasNodeForGenerationLog(document, { id: 'log-2', mode: 'audio', mediaKind: 'audio', nodeId: 'audio-node', prompt: '旁白' })?.id, 'audio-node');
});
