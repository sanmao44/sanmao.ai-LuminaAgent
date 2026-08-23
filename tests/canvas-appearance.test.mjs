import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/canvas/appearance.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const appearance = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('maps every canvas node category to a stable semantic color key', () => {
  const cases = [
    [{ type: 'media', data: { kind: 'image' } }, 'image'],
    [{ type: 'media', data: { kind: 'video' } }, 'video'],
    [{ type: 'prompt', data: {} }, 'agent'],
    [{ type: 'generator', data: { kind: 'image' } }, 'image-generator'],
    [{ type: 'generator', data: { kind: 'video' } }, 'video-generator'],
  ];

  assert.deepEqual(
    cases.map(([node]) => appearance.canvasNodeColorKey(node)),
    cases.map(([, color]) => color),
  );
  assert.deepEqual(appearance.CANVAS_NODE_COLOR_KEYS, cases.map(([, color]) => color));
});

test('resolves edge colors from source nodes and grouped source content', () => {
  const document = {
    nodes: [
      { id: 'agent', type: 'prompt', data: {} },
      { id: 'video-workflow', type: 'generator', data: { kind: 'video' } },
    ],
    groups: [{ id: 'group', nodeIds: ['video-workflow', 'agent'] }],
  };

  assert.equal(appearance.canvasSourceColorKey(document, 'agent'), 'agent');
  assert.equal(
    appearance.canvasSourceColorKey(document, 'video-workflow'),
    'video-generator',
  );
  assert.equal(appearance.canvasSourceColorKey(document, 'group'), 'video-generator');
  assert.equal(appearance.canvasSourceColorKey(document, 'missing'), 'image');
});
