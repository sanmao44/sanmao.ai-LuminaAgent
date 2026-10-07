import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = (source, fileName) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName,
}).outputText;

async function loadCanvasPatch() {
  const read = async (relative) => {
    const url = new URL(relative, import.meta.url);
    return { url, source: await readFile(url, 'utf8') };
  };
  const [model, settings, mask, layers, videoEditor, videoClip, localEdit, patch] = await Promise.all([
    read('../lib/canvas/model.ts'),
    read('../lib/creation/settings.ts'),
    read('../lib/canvas/mask.ts'),
    read('../lib/canvas/layers.ts'),
    read('../lib/canvas/video-editor.ts'),
    read('../lib/canvas/video-clip.ts'),
    read('../lib/local-edit.ts'),
    read('../lib/canvas/patch.ts'),
  ]);

  const localEditRuntime = compile(localEdit.source, localEdit.url.pathname).replace(/\bexport\s+/g, '');
  const settingsCompiled = compile(settings.source, settings.url.pathname)
    .replace(/^\s*import\s+\{\s*getLastModelCall\s*\}\s+from\s+["']\.\.\/model-preferences["'];?\s*$/m, 'const getLastModelCall = () => null;')
    .replace(/^\s*import\s+\{\s*selectAutomaticModel\s*\}\s+from\s+["']\.\.\/model-selection["'];?\s*$/m, 'const selectAutomaticModel = (models, defaultProviderId, defaultModelId) => models.find((model) => model.id === defaultModelId) || models[0];')
    .replace(/^\s*import\s+\{\s*normalizeLocalEditAnnotations\s*\}\s+from\s+["']\.\.\/local-edit["'];?\s*$/m, '');
  const maskCompiled = compile(mask.source, mask.url.pathname)
    .replace(/\bobjectValue\b/g, 'maskObjectValue')
    .replace(/\bfiniteNumber\b/g, 'maskFiniteNumber')
    .replace(/^\s*import\s+\{\s*normalizeLocalEditAnnotations\s*\}\s+from\s+["']\.\.\/local-edit["'];?\s*$/m, '');
  const layersCompiled = compile(layers.source, layers.url.pathname);
  const videoEditorCompiled = compile(videoEditor.source, videoEditor.url.pathname);
  const videoClipCompiled = compile(videoClip.source, videoClip.url.pathname);
  const modelCompiled = compile(model.source, model.url.pathname)
    .replace(/^\s*import\s+\{\s*normalizeCreationSettings\s*\}\s+from\s+["']\.\.\/creation\/settings["'];?\s*$/m, '')
    .replace(/^\s*import\s+\{\s*normalizeCanvasMaskState\s*\}\s+from\s+["']\.\/mask["'];?\s*$/m, '')
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["']\.\/layers["'];?\s*$/m, '')
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["']\.\/video-editor["'];?\s*$/m, '')
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["']\.\/video-clip["'];?\s*$/m, '');

  const modelModule = await import(`data:text/javascript;base64,${Buffer.from(`${localEditRuntime}\n${settingsCompiled}\n${maskCompiled}\n${layersCompiled}\n${videoEditorCompiled}\n${videoClipCompiled}\n${modelCompiled}`).toString('base64')}`);
  const patchCompiled = compile(patch.source, patch.url.pathname)
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["']\.\/model["'];?\s*$/m, '');
  const patchModule = await import(`data:text/javascript;base64,${Buffer.from(`${localEditRuntime}\n${settingsCompiled}\n${maskCompiled}\n${layersCompiled}\n${videoEditorCompiled}\n${videoClipCompiled}\n${modelCompiled}\n${patchCompiled}`).toString('base64')}`);
  return { model: modelModule, patch: patchModule };
}

const { model, patch } = await loadCanvasPatch();

function emptyDocument() {
  return model.normalizeDocument({ nodes: [], edges: [], groups: [], camera: { x: 0, y: 0, zoom: 1 } });
}

test('Canvas Patch atomically adds, updates, and connects nodes', () => {
  const prompt = model.createPrompt({ x: 0, y: 0 }, '输入');
  const generator = model.createGenerator('image', { x: 360, y: 0 });
  const result = patch.validateCanvasPatch(emptyDocument(), {
    version: 1,
    runId: 'run-1',
    operations: [
      { op: 'add_node', node: prompt },
      { op: 'add_node', node: generator },
      { op: 'update_node', id: generator.id, patch: { x: 420, data: { prompt: '生成海报' } } },
      { op: 'connect', source: prompt.id, target: generator.id },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.document.nodes.find((node) => node.id === generator.id).x, 420);
  assert.equal(result.document.nodes.find((node) => node.id === generator.id).data.prompt, '生成海报');
  assert.equal(result.document.edges.length, 1);
  assert.equal(patch.applyCanvasPatch(emptyDocument(), {
    version: 1,
    operations: [{ op: 'add_node', node: prompt }],
  }).nodes.length, 1);
});

test('Canvas Patch rejects cycles, missing entities, malformed nodes, and empty patches', () => {
  const first = model.createPrompt({ x: 0, y: 0 }, 'A');
  const second = model.createPrompt({ x: 360, y: 0 }, 'B');
  const document = model.addEdge({ ...emptyDocument(), nodes: [first, second] }, first.id, second.id);

  const cycle = patch.validateCanvasPatch(document, {
    version: 1,
    operations: [{ op: 'connect', source: second.id, target: first.id }],
  });
  assert.equal(cycle.ok, false);

  const missing = patch.validateCanvasPatch(document, {
    version: 1,
    operations: [{ op: 'connect', source: first.id, target: 'missing' }],
  });
  assert.equal(missing.ok, false);

  const malformed = patch.validateCanvasPatch(document, {
    version: 1,
    operations: [{ op: 'add_node', node: { ...first, id: 'bad', type: 'unknown', x: '0' } }],
  });
  assert.equal(malformed.ok, false);
  assert.equal(patch.validateCanvasPatch(document, { version: 1, operations: [] }).ok, false);
});

test('Canvas Patch removes connected edges and rolls back a partial batch on failure', () => {
  const first = model.createPrompt({ x: 0, y: 0 }, 'A');
  const second = model.createPrompt({ x: 360, y: 0 }, 'B');
  const document = model.addEdge({ ...emptyDocument(), nodes: [first, second] }, first.id, second.id);
  const original = model.clone(document);

  const failed = patch.validateCanvasPatch(document, {
    version: 1,
    operations: [
      { op: 'update_node', id: first.id, patch: { x: 100 } },
      { op: 'connect', source: second.id, target: 'missing' },
    ],
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(document, original);

  const removed = patch.validateCanvasPatch(document, {
    version: 1,
    operations: [{ op: 'remove_nodes', ids: [first.id] }],
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.deepEqual(removed.document.nodes.map((node) => node.id), [second.id]);
  assert.equal(removed.document.edges.length, 0);
});

test('Canvas Patch rejects non-finite update coordinates', () => {
  const node = model.createPrompt({ x: 0, y: 0 }, '节点');
  const document = { ...emptyDocument(), nodes: [node] };
  assert.equal(patch.validateCanvasPatch(document, {
    version: 1,
    operations: [{ op: 'update_node', id: node.id, patch: { x: '100' } }],
  }).ok, false);
});
