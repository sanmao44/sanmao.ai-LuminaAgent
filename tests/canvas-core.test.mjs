import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../packages/canvas-core/runtime.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { CanvasCore } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function document(nodes = []) {
  return { version: 'test', nodes, edges: [], groups: [], camera: { x: 0, y: 0, zoom: 1 } };
}

test('CanvasCore applies transactions and supports undo/redo without React', () => {
  const core = new CanvasCore(document([{ id: 'a' }]));
  const result = core.apply({
    id: 'add-b',
    label: 'add node',
    operations: [{
      id: 'add-b',
      label: 'add node',
      apply: (value) => ({ ...value, nodes: [...value.nodes, { id: 'b' }] }),
    }],
  });
  assert.equal(result.changed, true);
  assert.deepEqual(core.document().nodes.map((node) => node.id), ['a', 'b']);
  assert.equal(core.history().past.length, 1);
  assert.equal(core.undo()?.nodes.length, 1);
  assert.equal(core.redo()?.nodes.length, 2);
});

test('CanvasCore keeps selection and viewport outside document operations', () => {
  const core = new CanvasCore({
    ...document([{ id: 'a' }]),
    groups: [{ id: 'group-1', nodeIds: ['a'] }],
  });
  core.setSelection({ nodeIds: ['a', 'a'], groupId: 'group-1' });
  assert.deepEqual(core.selection(), { nodeIds: ['a'], groupId: 'group-1' });
  core.setViewport({ x: 20, y: 30, zoom: 1.5 });
  assert.deepEqual(core.viewport(), { x: 20, y: 30, zoom: 1.5 });
  assert.equal(core.history().past.length, 0);
});

test('CanvasCore caps history and clears redo after a new operation', () => {
  const core = new CanvasCore(document(), { maxHistory: 2 });
  for (let index = 1; index <= 3; index += 1) {
    core.apply({ id: `add-${index}`, label: 'add', apply: (value) => ({ ...value, nodes: [...value.nodes, { id: String(index) }] }) });
  }
  assert.equal(core.history().past.length, 2);
  core.undo();
  core.apply({ id: 'add-final', label: 'add', apply: (value) => ({ ...value, nodes: [...value.nodes, { id: 'final' }] }) });
  assert.equal(core.history().future.length, 0);
});

test('CanvasCore history is the single owner for sequential edits and boundaries', () => {
  const core = new CanvasCore(document());
  const add = (id) => core.apply({
    id: `add-${id}`,
    label: 'add',
    apply: (value) => ({ ...value, nodes: [...value.nodes, { id }] }),
  });

  add('a');
  add('b');
  assert.deepEqual(core.document().nodes.map((node) => node.id), ['a', 'b']);
  assert.equal(core.history().past.length, 2);
  assert.equal(core.undo()?.nodes.at(-1)?.id, 'a');
  assert.equal(core.redo()?.nodes.at(-1)?.id, 'b');
  core.undo();
  core.record();
  assert.equal(core.history().past.length, 2);
  add('c');
  assert.equal(core.history().future.length, 0);
  assert.deepEqual(core.undo()?.nodes.map((node) => node.id), ['a']);
});

test('CanvasCore document remains the authority when an Agent patch is validated and applied', () => {
  const core = new CanvasCore(document());
  const patch = { id: 'agent-node', label: 'agent patch', apply: (value) => ({ ...value, nodes: [{ id: 'agent-node' }] }) };
  assert.equal(core.apply(patch).changed, true);
  assert.deepEqual(core.document().nodes.map((node) => node.id), ['agent-node']);
  assert.equal(core.history().past.length, 1);
  assert.deepEqual(core.undo()?.nodes, []);
});

test('CanvasCore notifies projections and prunes selection after document changes', () => {
  const core = new CanvasCore({
    ...document([{ id: 'a' }, { id: 'b' }]),
    edges: [{ id: 'edge-1', source: 'a', target: 'b' }],
    groups: [{ id: 'group-1', nodeIds: ['a', 'b'] }],
  });
  let notifications = 0;
  const unsubscribe = core.subscribe(() => { notifications += 1; });
  core.setSelection({ nodeIds: ['a', 'b'], groupId: 'group-1', edgeId: 'edge-1' });
  core.apply({
    id: 'remove-a',
    label: 'remove node',
    apply: (value) => ({
      ...value,
      nodes: value.nodes.filter((node) => node.id !== 'a'),
      edges: [],
      groups: [],
    }),
  });
  assert.deepEqual(core.selection(), { nodeIds: ['b'] });
  assert.equal(notifications, 2);
  unsubscribe();
});

test('CanvasCore owns node, multi, group, edge, and cleared selection values', () => {
  const core = new CanvasCore({
    ...document([{ id: 'a' }, { id: 'b' }]),
    edges: [{ id: 'edge-1', source: 'a', target: 'b' }],
    groups: [{ id: 'group-1', nodeIds: ['a', 'b'] }],
  });
  core.setSelection({ nodeIds: ['a'] });
  assert.deepEqual(core.selection(), { nodeIds: ['a'] });
  core.setSelection({ nodeIds: ['a', 'b'] });
  assert.deepEqual(core.selection(), { nodeIds: ['a', 'b'] });
  core.setSelection({ nodeIds: ['a', 'b'], groupId: 'group-1' });
  assert.deepEqual(core.selection(), { nodeIds: ['a', 'b'], groupId: 'group-1' });
  core.setSelection({ nodeIds: [], edgeId: 'edge-1' });
  assert.deepEqual(core.selection(), { nodeIds: [], edgeId: 'edge-1' });
  core.setSelection({ nodeIds: [] });
  assert.deepEqual(core.selection(), { nodeIds: [] });
});

test('CanvasCore history snapshots protect nested document data', () => {
  const initial = {
    ...document([{ id: 'a', data: { label: 'before' } }]),
    edges: [{ id: 'edge-1', source: 'a', target: 'a', data: { weight: 1 } }],
    groups: [{ id: 'group-1', nodeIds: ['a'], data: { color: 'blue' } }],
  };
  const core = new CanvasCore(initial);
  core.apply({
    id: 'mutate-nested',
    label: 'mutate nested data',
    apply: (value) => ({
      ...value,
      nodes: value.nodes.map((node) => ({ ...node, data: { ...node.data, label: 'after' } })),
      edges: value.edges.map((edge) => ({ ...edge, data: { ...edge.data, weight: 2 } })),
      groups: value.groups.map((group) => ({ ...group, data: { ...group.data, color: 'red' } })),
    }),
  });
  const liveDocument = core.document();
  liveDocument.nodes[0].data.label = 'mutated in place';
  liveDocument.edges[0].data.weight = 3;
  liveDocument.groups[0].data.color = 'green';
  assert.equal(core.undo().nodes[0].data.label, 'before');
  assert.equal(core.document().edges[0].data.weight, 1);
  assert.equal(core.document().groups[0].data.color, 'blue');
  core.document().nodes[0].data.label = 'mutated after undo';
  const redone = core.redo();
  assert.equal(redone.nodes[0].data.label, 'mutated in place');
  assert.equal(redone.edges[0].data.weight, 3);
  assert.equal(redone.groups[0].data.color, 'green');
});
