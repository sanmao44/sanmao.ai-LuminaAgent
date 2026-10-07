import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const clipboardPayload = createTsRequire(process.cwd())('./lib/canvas/clipboard-payload');

const imageNode = (id, x = 0, y = 0) => ({
  id,
  type: 'media',
  x,
  y,
  data: {
    kind: 'image',
    url: `/${id}.png`,
    referenceOrder: ['source'],
    generation: { kind: 'image', prompt: 'prompt', params: {}, referenceIds: ['source'] },
  },
});

const document = {
  version: 'sanmao-canvas-3',
  camera: { x: 0, y: 0, zoom: 1 },
  nodes: [imageNode('source'), imageNode('target', 120, 20), imageNode('outside', 300, 20)],
  groups: [{ id: 'group-1', name: 'Group', nodeIds: ['source', 'target'] }],
  edges: [
    { id: 'edge-1', source: 'source', target: 'target', sourceNodeIds: ['source'], kind: 'generated' },
    { id: 'edge-2', source: 'outside', target: 'target', kind: 'reference' },
  ],
};

test('clipboard payload keeps only selected nodes and internal edges/groups', () => {
  const payload = clipboardPayload.createCanvasClipboardPayload(document, ['source', 'target']);

  assert.equal(payload.type, 'sanmao-canvas-nodes');
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.nodes.map((node) => node.id), ['source', 'target']);
  assert.deepEqual(payload.edges.map((edge) => edge.id), ['edge-1']);
  assert.deepEqual(payload.groups.map((group) => group.id), ['group-1']);
  assert.equal(clipboardPayload.isCanvasClipboardPayload(payload), true);
  payload.nodes[0].data.url = '/changed.png';
  assert.equal(document.nodes[0].data.url, '/source.png');
});

test('clipboard payload validation rejects malformed or unsupported versions', () => {
  assert.equal(clipboardPayload.isCanvasClipboardPayload(null), false);
  assert.equal(clipboardPayload.isCanvasClipboardPayload({
    type: 'sanmao-canvas-nodes',
    version: 2,
    nodes: [],
    edges: [],
    groups: [],
  }), false);
  assert.equal(clipboardPayload.isCanvasClipboardPayload({
    type: 'sanmao-canvas-nodes',
    version: 1,
    nodes: [],
    edges: [],
    groups: [],
  }), true);
});

test('duplicating nodes creates independent ids, remaps references and preserves requested connections', () => {
  const copies = clipboardPayload.duplicateCanvasNodes(
    document,
    ['source', 'target'],
    { x: 48, y: 48 },
    false,
    true,
  );

  assert.equal(copies.nodes.length, 2);
  assert.equal(copies.groups.length, 1);
  assert.equal(copies.edges.length, 2);
  assert.notEqual(copies.nodes[0].id, 'source');
  assert.notEqual(copies.nodes[1].id, 'target');
  assert.deepEqual(copies.nodes[0].data.referenceOrder, [copies.nodes[0].id]);
  assert.deepEqual(copies.nodes[0].data.generation.referenceIds, [copies.nodes[0].id]);
  assert.equal(copies.nodes[0].x, 48);
  assert.equal(copies.nodes[1].y, 68);
  assert.equal(copies.edges.some((edge) => edge.source === 'outside'), true);
  assert.equal(copies.edges.every((edge) => edge.id !== 'edge-1'), true);
});

test('remapping references changes only known node ids', () => {
  const remapped = clipboardPayload.remapCanvasNodeReferences(imageNode('target'), new Map([
    ['source', 'source-copy'],
  ]));

  assert.deepEqual(remapped.data.referenceOrder, ['source-copy']);
  assert.deepEqual(remapped.data.generation.referenceIds, ['source-copy']);
  assert.equal(remapped.id, 'target');
});
