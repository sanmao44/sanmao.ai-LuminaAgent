import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  if (sourceUrl.pathname.endsWith('/lib/canvas/model.ts')) {
    const settingsUrl = new URL('../lib/creation/settings.ts', import.meta.url);
    const settingsSource = await readFile(settingsUrl, 'utf8');
    const settingsCompiled = ts.transpileModule(settingsSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: settingsUrl.pathname,
    }).outputText.replace(
      /^\s*import\s+\{\s*getLastModelCall\s*\}\s+from\s+["']\.\.\/model-preferences["'];?\s*$/m,
      'const getLastModelCall = () => null;',
    );
    const modelCompiled = compiled.replace(
      /^\s*import\s+\{\s*normalizeCreationSettings\s*\}\s+from\s+["']\.\.\/creation\/settings["'];?\s*$/m,
      '',
    );
    return import(`data:text/javascript;base64,${Buffer.from(`${settingsCompiled}\n${modelCompiled}`).toString('base64')}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const model = await loadTypeScript('../lib/canvas/model.ts');
const storageSource = await readFile(new URL('../lib/canvas/storage.ts', import.meta.url), 'utf8');

test('normalizes NOVA-compatible documents and drops invalid graph references', () => {
  const result = model.normalizeDocument({
    nodes: [
      { id: 'image-1', type: 'media', x: 10, y: 20, data: { kind: 'image', url: '/api/storage/file?name=a.png' } },
      { id: 'text-1', type: 'prompt', x: 100, y: 200, data: { text: '夜晚' } },
      { id: 'bad', type: 'media', x: 'nope', y: 0, data: {} },
    ],
    groups: [{ id: 'group-1', name: '参考组', nodeIds: ['image-1', 'text-1', 'missing'] }],
    edges: [
      { id: 'edge-1', source: 'image-1', target: 'text-1' },
      { id: 'edge-bad', source: 'missing', target: 'text-1' },
    ],
    camera: { x: 20, y: 30, zoom: 9 },
  });
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.groups[0].nodeIds, ['image-1', 'text-1']);
  assert.equal(result.edges.length, 1);
  assert.equal(result.camera.zoom, 3);
});

test('creates media, prompt, generator, groups, edges and reference order', () => {
  const empty = model.normalizeDocument(null);
  const image = model.createMedia('image', '/image.png', '参考图', { x: 0, y: 0 });
  const prompt = model.createPrompt({ x: 360, y: 0 }, '保留主体');
  const generator = model.createGenerator('image', { x: 720, y: 0 }, { model: 'image-model' });
  let document = { ...empty, nodes: [image, prompt, generator] };
  document = model.addEdge(document, image.id, generator.id);
  document = model.addEdge(document, prompt.id, generator.id);
  assert.equal(model.incomingReferences(document, generator.id).length, 1);
  assert.equal(model.incomingContext(document, generator.id).length, 2);
  const grouped = model.createGroup(document, [image.id, prompt.id]);
  assert.equal(grouped.groups.length, 1);
  assert.equal(grouped.groups[0].nodeIds.length, 2);
  assert.equal(model.edgePath(grouped, grouped.edges[0]).startsWith('M '), true);
});

test('supports selectable canvas edge path styles', () => {
  const empty = model.normalizeDocument(null);
  const source = model.createPrompt({ x: 0, y: 0 }, '输入');
  const target = model.createGenerator('image', { x: 480, y: 160 });
  const document = model.addEdge(
    { ...empty, nodes: [source, target] },
    source.id,
    target.id,
  );
  const edge = document.edges[0];
  assert.match(model.edgePath(document, edge, 'curve'), / C /);
  assert.match(model.edgePath(document, edge, 'straight'), / L /);
  assert.match(model.edgePath(document, edge, 'orthogonal'), / H .* V .* H /);
});

test('expands a grouped source into all media references and preserves manual order', () => {
  const empty = model.normalizeDocument(null);
  const first = model.createMedia('image', '/first.png', '第一张', { x: 0, y: 0 });
  const second = model.createMedia('image', '/second.png', '第二张', { x: 360, y: 0 });
  const generator = model.createGenerator('image', { x: 720, y: 0 });
  let document = { ...empty, nodes: [first, second, generator] };
  document = model.createGroup(document, [first.id, second.id]);
  document = model.addEdge(document, first.id, generator.id);
  assert.deepEqual(model.incomingReferences(document, generator.id).map((node) => node.data.name), ['第一张', '第二张']);
  document = model.reorderReferences(document, generator.id, [second.id, first.id]);
  assert.deepEqual(model.incomingReferences(document, generator.id).map((node) => node.data.name), ['第二张', '第一张']);
});

function arrangeDocument(nodes, edges = [], groups = []) {
  const empty = model.normalizeDocument(null);
  return model.normalizeDocument({ ...empty, nodes, edges, groups });
}

function overlaps(left, right, gap = 0) {
  const document = { nodes: [left, right], groups: [], edges: [] };
  const a = model.entityBounds(document, left.id);
  const b = model.entityBounds(document, right.id);
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

test('arranges a directed workflow from inputs to outputs without overlap', () => {
  const prompt = model.createPrompt({ x: 900, y: 500 }, '构图');
  const source = model.createMedia('image', '/source.png', '输入', { x: 80, y: 900 });
  const generator = model.createGenerator('image', { x: -300, y: -300 });
  const result = model.createMedia('image', '/result.png', '结果', { x: -600, y: 1200 });
  let document = arrangeDocument([prompt, source, generator, result]);
  document = model.addEdge(document, prompt.id, generator.id);
  document = model.addEdge(document, source.id, generator.id);
  document = model.addEdge(document, generator.id, result.id);
  const arranged = model.arrangeCanvas(document);
  const byId = (id) => arranged.document.nodes.find((node) => node.id === id);
  assert.equal(arranged.changed, true);
  assert.ok(byId(prompt.id).x < byId(generator.id).x);
  assert.ok(byId(source.id).x < byId(generator.id).x);
  assert.ok(byId(generator.id).x < byId(result.id).x);
  assert.equal(overlaps(byId(prompt.id), byId(source.id)), false);
});

test('arranges unconnected nodes in a non-overlapping grid', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => model.createMedia('image', `/grid-${index}.png`, `网格 ${index}`, { x: index * 17, y: index * 13 }));
  const document = arrangeDocument(nodes);
  const arranged = model.arrangeCanvas(document).document;
  for (let left = 0; left < arranged.nodes.length; left += 1) {
    for (let right = left + 1; right < arranged.nodes.length; right += 1) assert.equal(overlaps(arranged.nodes[left], arranged.nodes[right]), false);
  }
});

test('selection-only arrangement leaves unselected nodes and external edges unchanged', () => {
  const first = model.createPrompt({ x: 800, y: 800 }, '输入');
  const second = model.createGenerator('image', { x: -800, y: -800 });
  const outside = model.createMedia('image', '/outside.png', '外部节点', { x: 2400, y: 70 });
  let document = arrangeDocument([first, second, outside]);
  document = model.addEdge(document, first.id, second.id);
  document = model.addEdge(document, second.id, outside.id);
  const beforeOutside = { x: outside.x, y: outside.y };
  const beforeEdges = JSON.stringify(document.edges);
  const arranged = model.arrangeCanvas(document, [first.id, second.id]);
  const nextOutside = arranged.document.nodes.find((node) => node.id === outside.id);
  assert.deepEqual({ x: nextOutside.x, y: nextOutside.y }, beforeOutside);
  assert.equal(JSON.stringify(arranged.document.edges), beforeEdges);
  assert.ok(arranged.document.nodes.find((node) => node.id === first.id).x < arranged.document.nodes.find((node) => node.id === second.id).x);
});

test('keeps complete groups together and preserves relative positions for partial selection', () => {
  const first = model.createMedia('image', '/first.png', '第一张', { x: 600, y: 400 });
  const second = model.createMedia('image', '/second.png', '第二张', { x: 1100, y: 650 });
  const result = model.createGenerator('image', { x: -500, y: -500 });
  let document = arrangeDocument([first, second, result]);
  document = model.createGroup(document, [first.id, second.id]);
  document = model.addEdge(document, first.id, result.id);
  const grouped = model.arrangeCanvas(document);
  const groupedFirst = grouped.document.nodes.find((node) => node.id === first.id);
  const groupedSecond = grouped.document.nodes.find((node) => node.id === second.id);
  assert.equal(groupedSecond.x - groupedFirst.x, second.x - first.x);
  assert.equal(groupedSecond.y - groupedFirst.y, second.y - first.y);
  const partial = model.arrangeCanvas(document, [first.id, result.id]);
  const partialFirst = partial.document.nodes.find((node) => node.id === first.id);
  const partialSecond = partial.document.nodes.find((node) => node.id === second.id);
  assert.equal(partialFirst.groupId, partialSecond.groupId);
  assert.deepEqual({ x: partialSecond.x, y: partialSecond.y }, { x: second.x, y: second.y });
});

test('handles cycles, empty selections, and deterministic output', () => {
  const first = model.createPrompt({ x: 1000, y: 20 }, 'A');
  const second = model.createGenerator('image', { x: -1000, y: 20 });
  let document = arrangeDocument([first, second]);
  document = model.addEdge(document, first.id, second.id);
  document = model.addEdge(document, second.id, first.id);
  const arranged = model.arrangeCanvas(document);
  assert.equal(overlaps(arranged.document.nodes[0], arranged.document.nodes[1]), false);
  assert.deepEqual(model.arrangeCanvas(document).document.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })), arranged.document.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })));
  const emptySelection = model.arrangeCanvas(document, []);
  assert.equal(emptySelection.changed, false);
  assert.deepEqual(emptySelection.arrangedIds, []);
});

test('NOVA localStorage keys have a one-way migration target and no independent API config', () => {
  assert.match(storageSource, /nova\.v1\.projects/);
  assert.match(storageSource, /nova\.v1\.active/);
  assert.match(storageSource, /sanmao\.canvas\.projects/);
  assert.match(storageSource, /sanmao\.canvas\.nova-migrated/);
  assert.match(storageSource, /sanmao\.canvas\.nova-backup/);
  assert.match(storageSource, /legacyDocuments/);
  assert.doesNotMatch(storageSource, /apiKey|baseUrl|providers/);
});
