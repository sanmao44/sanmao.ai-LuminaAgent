import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const references = load('./lib/canvas/three-d-references');
const model = load('./lib/canvas/model');
const connection = load('./lib/canvas/connection-command');
const generation = load('./lib/canvas/three-d-generation');
const draft = (options = {}) => ({ prompt: '一艘木船', options: { mode: 'multiview-to-3d', ...options } });
const image = (id, url = `https://cdn.example.test/${id}.png`) => ({
  ...model.createMedia('image', url, id, { x: 0, y: 0 }), id,
});
const urls = (value, nodes) => references.canvasThreeDReferenceOptions(value, nodes).multiviewImages;

test('connected image is available to single-image generation without copying its URL into the draft', () => {
  const value = draft({ mode: 'image-to-3d' });
  const source = image('front');
  const options = references.canvasThreeDReferenceOptions(value, [source]);
  assert.equal(options.imageUrl, source.data.url);
  assert.equal(value.options.imageUrl, undefined);
  assert.equal(references.resolveCanvasThreeDReferences(value, [source]).image.nodeId, source.id);
});

test('automatic multiview references follow incoming order and ignore unfinished or non-image nodes', () => {
  const nodes = [
    { ...image('unfinished'), data: { ...image('unfinished').data, status: 'running' } },
    model.createMedia('audio', 'https://cdn.example.test/sound.mp3', '声音', { x: 0, y: 0 }),
    ...['front', 'back', 'left', 'right', 'extra'].map((id) => image(id)),
  ];
  assert.deepEqual(urls(draft(), nodes), Object.fromEntries(
    ['front', 'back', 'left', 'right'].map((key) => [key, `https://cdn.example.test/${key}.png`]),
  ));
});

test('reordering automatic references changes the actual validated generation request', () => {
  const nodes = [image('a'), image('b'), image('c')];
  const value = draft();
  const moved = references.swapCanvasThreeDViews(value, nodes, 'front', 'back');
  const request = generation.buildCanvasThreeDRequest({
    modelId: 'provider:tripo3d-v3.1', rawModelId: 'tripo3d-v3.1', prompt: moved.prompt,
    options: references.canvasThreeDReferenceOptions(moved, nodes),
  });
  assert.deepEqual(request.options.multiviewImages, {
    front: nodes[1].data.url, back: nodes[0].data.url, left: nodes[2].data.url,
  });
  assert.equal(value.referenceNodes, undefined, 'the previous draft must remain immutable');
  assert.equal(moved.referenceNodes.front, nodes[1].id);
});

test('selection in an occupied view swaps the two images rather than duplicating one image', () => {
  const nodes = [image('a'), image('b')];
  const value = references.assignCanvasThreeDReference(draft(), nodes, 'front', {
    nodeId: 'b', url: nodes[1].data.url, name: 'b',
  });
  assert.deepEqual(urls(value, nodes), { front: nodes[1].data.url, back: nodes[0].data.url });
});

test('bound source edits update single and multiple image references live', () => {
  const source = image('source');
  const selected = { nodeId: source.id, url: source.data.url, name: '原图' };
  let value = references.assignCanvasThreeDReference(draft(), [source], 'image', selected);
  value = references.assignCanvasThreeDReference(value, [source], 'front', selected);
  const changed = image('source', 'https://cdn.example.test/replacement.png');
  const options = references.canvasThreeDReferenceOptions(value, [changed]);
  assert.equal(options.imageUrl, changed.data.url);
  assert.equal(options.multiviewImages.front, changed.data.url);
  assert.equal(value.options.imageUrl, undefined, 'node bindings must not persist a stale URL');
});

test('disconnected or deleted bound sources do not fall back to a stored URL', () => {
  const source = image('source');
  const value = {
    ...draft({ imageUrl: 'https://cdn.example.test/stale.png', multiviewImages: { front: 'https://cdn.example.test/stale.png' } }),
    referenceNodes: { image: source.id, front: source.id },
  };
  const options = references.canvasThreeDReferenceOptions(value, []);
  assert.equal(options.imageUrl, undefined);
  assert.equal(options.multiviewImages.front, undefined);
  assert.equal(references.resolveCanvasThreeDReferences(value, [image('other')]).image, undefined);
});

test('same image URL can occupy only one multiview slot even across different source nodes', () => {
  const first = image('first');
  const duplicate = image('duplicate', first.data.url);
  const third = image('third');
  assert.deepEqual(urls(draft(), [first, duplicate, third]), { front: first.data.url, back: third.data.url });
  assert.deepEqual(urls({ ...draft(), referenceNodes: { front: first.id, back: duplicate.id } }, [first, duplicate, third]), {
    front: first.data.url, left: third.data.url,
  });
});

test('legacy duplicate uploaded URLs are not counted as multiple views', () => {
  const value = draft({ multiviewImages: { front: 'https://cdn.example.test/shared.png', back: 'https://cdn.example.test/shared.png' } });
  assert.deepEqual(urls(value, []), { front: 'https://cdn.example.test/shared.png' });
});

test('uploaded and connected images share the same unique ordered view assignments', () => {
  const source = image('connected');
  const value = draft({ multiviewImages: { front: 'https://cdn.example.test/upload.png' } });
  assert.deepEqual(urls(value, [source]), { front: 'https://cdn.example.test/upload.png', back: source.data.url });
  const moved = references.swapCanvasThreeDViews(value, [source], 'front', 'back');
  assert.deepEqual(urls(moved, [source]), { front: source.data.url, back: 'https://cdn.example.test/upload.png' });
  assert.equal(moved.referenceNodes.front, source.id);
  assert.equal(moved.referenceNodes.back, null);
});

test('clearing a slot keeps it empty without automatically reusing a connected image', () => {
  const sources = [image('first'), image('second')];
  const cleared = references.assignCanvasThreeDReference(draft(), sources, 'front');
  assert.equal(cleared.referenceNodes.front, null);
  assert.deepEqual(urls(cleared, sources), { back: sources[1].data.url, left: sources[0].data.url });
  const single = references.assignCanvasThreeDReference(draft({ mode: 'image-to-3d' }), sources, 'image');
  assert.equal(references.canvasThreeDReferenceOptions(single, sources).imageUrl, undefined);
});

test('assigning an initial reference leaves unassigned slots available to later connections', () => {
  const first = image('first');
  const second = image('second');
  const value = references.assignCanvasThreeDReference(draft(), [first], 'front', {
    nodeId: first.id, url: first.data.url, name: '第一张',
  });
  assert.equal('back' in value.referenceNodes, false);
  assert.deepEqual(urls(value, [first, second]), { front: first.data.url, back: second.data.url });
});

test('switching image modes preserves separate single and multiview assignments', () => {
  const sources = [image('single'), image('front'), image('back')];
  const value = { ...draft(), referenceNodes: { image: 'single', front: 'front', back: 'back', left: null, right: null } };
  assert.equal(references.canvasThreeDReferenceOptions({ ...value, options: { mode: 'image-to-3d' } }, sources).imageUrl, sources[0].data.url);
  assert.deepEqual(urls(value, sources), { front: sources[1].data.url, back: sources[2].data.url });
});

test('real canvas connections feed 3D references and deleting the source removes it', () => {
  const source = image('connected');
  const target = model.createEmptyMedia('3d', { x: 400, y: 0 });
  const document = model.normalizeDocument({ nodes: [source, target], groups: [], edges: [] });
  const connected = connection.connectCanvasNodesInDocument(document, source.id, target.id, 'right', 'left', null, 'reference-image');
  assert.equal(connected.ok, true);
  assert.equal(references.canvasThreeDReferenceOptions(draft(), model.incomingReferences(connected.document, target.id)).imageUrl, source.data.url);
  const deleted = model.removeNodes(connected.document, [source.id]);
  assert.equal(references.canvasThreeDReferenceOptions(draft(), model.incomingReferences(deleted, target.id)).imageUrl, undefined);
});

test('persisting and normalizing a canvas keeps node bindings and explicit cleared slots', () => {
  const source = image('source');
  const target = model.createEmptyMedia('3d', { x: 400, y: 0 });
  target.data.threeDDraft = { ...draft(), referenceNodes: { image: source.id, front: null, back: source.id } };
  const restored = model.normalizeDocument(JSON.parse(JSON.stringify({ nodes: [source, target], edges: [], groups: [] })));
  assert.deepEqual(model.nodeById(restored, target.id).data.threeDDraft.referenceNodes, target.data.threeDDraft.referenceNodes);
});
