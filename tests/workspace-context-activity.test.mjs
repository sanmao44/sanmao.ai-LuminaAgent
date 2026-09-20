import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { load } = await buildLibModules([
  'lib/workspace-context',
  'lib/task-activity/types',
  'lib/task-activity/adapters',
  'lib/provenance/types',
  'lib/provenance/normalize',
], 'adapters');
const context = await load('workspace-context');
const activity = await load('adapters');
const provenance = await load('normalize');

test('workspace context keeps a stable local scope and normalizes persisted values', () => {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  };

  const first = context.readWorkspaceContext();
  assert.match(first.creativeProjectId, /^creative_/);
  assert.match(first.chatId, /^chat_/);
  assert.deepEqual(first.selectedNodeIds, []);
  assert.deepEqual(first.assetIds, []);

  const updated = context.updateWorkspaceContext({
    canvasId: 'canvas-1',
    selectedNodeIds: ['node-1', 'node-1', '  node-2  ', ''],
    assetIds: ['asset-1'],
  });
  const reread = context.readWorkspaceContext();
  assert.equal(reread.creativeProjectId, first.creativeProjectId);
  assert.equal(reread.chatId, first.chatId);
  assert.equal(reread.canvasId, 'canvas-1');
  assert.deepEqual(reread.selectedNodeIds, ['node-1', 'node-2']);
  assert.deepEqual(reread.assetIds, ['asset-1']);
  assert.ok(reread.updatedAt >= updated.updatedAt);

  delete globalThis.window;
});

test('activity adapters expose one status vocabulary and preserve workspace IDs', () => {
  const generated = activity.activityTaskFromGenerationLog({
    id: 'log-1',
    createdAt: '2026-09-20T10:00:00.000Z',
    status: 'success',
    mode: 'agent',
    prompt: '换成东京夜景',
    projectId: 'creative-1',
    chatId: 'chat-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    taskId: 'run-1',
    durationMs: 1500,
    imageUrls: ['/api/storage/file?name=result.png'],
  });
  assert.deepEqual(generated, {
    id: 'log-1',
    kind: 'agent',
    status: 'succeeded',
    projectId: 'creative-1',
    chatId: 'chat-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    startedAt: Date.parse('2026-09-20T10:00:00.000Z'),
    finishedAt: Date.parse('2026-09-20T10:00:00.000Z') + 1500,
    canRetry: false,
    canCancel: false,
    outputIds: ['/api/storage/file?name=result.png'],
    sourceId: 'run-1',
  });

  const video = activity.activityTaskFromVideoTask({
    id: 'video-1',
    status: 'running',
    providerId: 'provider-1',
    modelId: 'model-1',
    operation: 'generate',
    source: 'canvas',
    idempotencyKey: 'key-1',
    input: { prompt: 'animate' },
    videoUrls: [],
    remoteVideoUrls: [],
    localVideoPaths: [],
    createdAt: '2026-09-20T10:00:00.000Z',
    providerProgress: 125,
    projectId: 'creative-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
  });
  assert.equal(video.status, 'running');
  assert.equal(video.progress, 100);
  assert.equal(video.canCancel, true);
  assert.equal(video.projectId, 'creative-1');
});

test('provenance helpers deduplicate sources and create stable edge IDs', () => {
  const drafts = provenance.provenanceDraftsForSources(
    ['node-a', 'node-a', '', ' node-b '],
    'edited_from',
    { projectId: 'creative-1', canvasId: 'canvas-1', taskId: 'run-1' },
  );
  assert.deepEqual(drafts.map((item) => item.fromId), ['node-a', 'node-b']);
  const edge = provenance.createProvenanceEdge({ ...drafts[0], toId: 'node-result' });
  assert.equal(edge.id, 'provenance:edited_from:node-a:node-result');
  assert.equal(edge.projectId, 'creative-1');

  const edges = provenance.normalizeCanvasProvenance({
    nodes: [{ data: { generation: { provenance: [edge] } } }],
  });
  assert.deepEqual(edges, [edge]);
});

test('agent route consumes the context and writes it into task logs', async () => {
  const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
  assert.match(route, /normalizeWorkspaceContext\(body\.context\)/);
  assert.match(route, /projectId: workspaceContext\.creativeProjectId/);
  assert.match(route, /canvasId: workspaceContext\.canvasId/);
  assert.match(route, /taskId: agentRunId/);
  assert.match(route, /\.\.\.taskContext/);
});
