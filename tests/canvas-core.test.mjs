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
  const core = new CanvasCore(document([{ id: 'a' }]));
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
