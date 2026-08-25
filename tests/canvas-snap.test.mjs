import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const snap = await loadTypeScript('../lib/canvas/snap.ts');

function node(id, x, y, w = 100, h = 80) {
  return { id, x, y, w, h };
}

function positions(...items) {
  return Object.fromEntries(items.map(([id, x, y]) => [id, { x, y }]));
}

test('snaps a node to another node edge and reports a vertical guide', () => {
  const result = snap.snapCanvasNodePositions(
    [node('moving', 188, 40), node('target', 400, 240)],
    ['moving'],
    positions(['moving', 298, 240], ['target', 400, 240]),
    10,
  );

  assert.equal(result.positions.moving.x, 300);
  assert.equal(result.positions.moving.y, 240);
  assert.deepEqual(
    result.guides.map(({ axis, position, targetId }) => ({ axis, position, targetId })),
    [
      { axis: 'x', position: 400, targetId: 'target' },
      { axis: 'y', position: 240, targetId: 'target' },
    ],
  );
});

test('supports center and bottom alignment without changing the other axis', () => {
  const result = snap.snapCanvasNodePositions(
    [node('moving', 120, 200), node('target', 500, 100, 140, 120)],
    ['moving'],
    positions(['moving', 528, 132], ['target', 500, 100]),
    10,
  );

  assert.equal(result.positions.moving.x, 520);
  assert.equal(result.positions.moving.y, 140);
  assert.equal(result.guides.length, 2);
});

test('moves a multi-selection by one shared delta', () => {
  const result = snap.snapCanvasNodePositions(
    [
      node('first', 100, 100),
      node('second', 260, 180),
      node('target', 500, 100),
    ],
    ['first', 'second'],
    positions(['first', 490, 240], ['second', 650, 320], ['target', 500, 100]),
    10,
  );

  assert.equal(result.positions.first.x, 500);
  assert.equal(result.positions.second.x, 660);
  assert.equal(result.positions.second.x - result.positions.first.x, 160);
});

test('does not snap outside the threshold and ignores dragged nodes as targets', () => {
  const result = snap.snapCanvasNodePositions(
    [node('first', 100, 100), node('second', 300, 100)],
    ['first', 'second'],
    positions(['first', 189, 100], ['second', 389, 100]),
    10,
  );

  assert.deepEqual(result.positions, positions(['first', 189, 100], ['second', 389, 100]));
  assert.deepEqual(result.guides, []);
});
