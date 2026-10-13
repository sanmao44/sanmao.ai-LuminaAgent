import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(path.join(process.cwd(), 'lib'));
const { normalizeDocument, createMedia, createPrompt } = load('./canvas/model');
const { recoverCanvasTask, mergeCanvasTaskImages } = load('./canvas/task-recovery');
const params = { kind: 'image', model: 'test', aspect: '1:1' };
const input = { nodeId: 'pending', taskId: 'task-a', status: 'success', urls: ['/one.png', '/two.png', '/three.png'], imageParams: params };
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
