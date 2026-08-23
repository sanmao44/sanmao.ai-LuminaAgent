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

test('NOVA localStorage keys have a one-way migration target and no independent API config', () => {
  assert.match(storageSource, /nova\.v1\.projects/);
  assert.match(storageSource, /nova\.v1\.active/);
  assert.match(storageSource, /sanmao\.canvas\.projects/);
  assert.match(storageSource, /sanmao\.canvas\.nova-migrated/);
  assert.match(storageSource, /sanmao\.canvas\.nova-backup/);
  assert.match(storageSource, /legacyDocuments/);
  assert.doesNotMatch(storageSource, /apiKey|baseUrl|providers/);
});
