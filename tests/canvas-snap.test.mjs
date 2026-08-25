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

test('supports all six node alignment anchors', () => {
  const horizontalCases = [
    ['left edge', 395, 400],
    ['right edge', 425, 420],
    ['horizontal center', 410, 410],
  ];
  for (const [label, proposedX, expectedX] of horizontalCases) {
    const result = snap.snapCanvasNodePositions(
      [node('moving', proposedX, 100), node('target', 400, 240, 120, 80)],
      ['moving'],
      positions(['moving', proposedX, 100], ['target', 400, 240]),
      10,
    );
    assert.equal(result.positions.moving.x, expectedX, label);
    assert.equal(result.guides.some((guide) => guide.axis === 'x'), true, label);
  }

  const verticalCases = [
    ['top edge', 235, 240],
    ['bottom edge', 285, 280],
    ['vertical center', 260, 260],
  ];
  for (const [label, proposedY, expectedY] of verticalCases) {
    const result = snap.snapCanvasNodePositions(
      [node('moving', 100, proposedY), node('target', 400, 240, 100, 120)],
      ['moving'],
      positions(['moving', 100, proposedY], ['target', 400, 240]),
      10,
    );
    assert.equal(result.positions.moving.y, expectedY, label);
    assert.equal(result.guides.some((guide) => guide.axis === 'y'), true, label);
  }
});

test('uses visible targets only and keeps the nearest candidate stable', () => {
  const result = snap.snapCanvasNodePositions(
    [
      node('moving', 100, 100),
      node('hidden', 400, 240),
      node('near', 405, 500),
      node('far', 408, 700),
    ],
    ['moving'],
    positions(
      ['moving', 395, 100],
      ['hidden', 400, 240],
      ['near', 405, 500],
      ['far', 408, 700],
    ),
    10,
    { visibleNodeIds: new Set(['moving', 'near', 'far']) },
  );

  assert.equal(result.positions.moving.x, 405);
  assert.equal(result.guides.find((guide) => guide.axis === 'x')?.targetId, 'near');
});

test('holds an active guide until the release threshold, then switches target', () => {
  const nodes = [
    node('moving', 100, 100),
    node('first', 400, 240),
    node('second', 412, 500),
  ];
  const activeGuide = [{ axis: 'x', position: 400, start: 80, end: 180, targetId: 'first' }];
  const held = snap.snapCanvasNodePositions(
    nodes,
    ['moving'],
    positions(['moving', 411, 100], ['first', 400, 240], ['second', 412, 500]),
    10,
    { previousGuides: activeGuide, releaseThreshold: 14 },
  );
  assert.equal(held.positions.moving.x, 400);
  assert.equal(held.guides.find((guide) => guide.axis === 'x')?.targetId, 'first');

  const released = snap.snapCanvasNodePositions(
    nodes,
    ['moving'],
    positions(['moving', 415, 100], ['first', 400, 240], ['second', 412, 500]),
    10,
    { previousGuides: activeGuide, releaseThreshold: 14 },
  );
  assert.equal(released.positions.moving.x, 412);
  assert.equal(released.guides.find((guide) => guide.axis === 'x')?.targetId, 'second');
});

test('keeps guide segments local when the target is far away', () => {
  const result = snap.snapCanvasNodePositions(
    [node('moving', 395, 100), node('target', 400, 1000)],
    ['moving'],
    positions(['moving', 395, 100], ['target', 400, 1000]),
    10,
  );
  const guide = result.guides.find((item) => item.axis === 'x');
  assert.ok(guide);
  assert.ok(guide.end - guide.start <= 180);
});

test('uses fine dashed guide styling without glow', async () => {
  const css = await readFile(new URL('../app/canvas.css', import.meta.url), 'utf8');
  assert.match(css, /\.canvas-snap-guide\.x\{[^}]*repeating-linear-gradient/);
  assert.match(css, /\.canvas-snap-guide\.y\{[^}]*repeating-linear-gradient/);
  assert.doesNotMatch(css, /\.canvas-snap-guide\{[^}]*box-shadow/);
});
