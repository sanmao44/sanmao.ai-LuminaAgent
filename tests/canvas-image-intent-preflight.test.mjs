import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path, dependencies) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const modelPicker = await loadTypeScript('../lib/model-picker.ts', {});
const imageRequest = await loadTypeScript('../lib/canvas/image-reference-request.ts', {
  '../creative-references': {
    appendTextReferenceContext: value => value,
    replaceNaturalReferenceLabels: value => ({ value }),
    resolveCreativeReferenceRoles: () => ({ references: [], invalidNumbers: [] }),
  },
  '@/packages/contracts/creative': { MAX_IMAGE_REFERENCES: 16 },
  '@/lib/model-picker': modelPicker,
});
const taskRecovery = await loadTypeScript('../lib/canvas/task-recovery.ts', {
  './model': {
    addEdge: value => value,
    createMedia: () => ({}),
    nodeById: (document, id) => document.nodes.find(node => node.id === id),
    nodeSize: () => ({ w: 0, h: 0 }),
  },
});

test('Canvas image preflight calls JEV once and returns the same operation metadata for submission', async () => {
  const preview = {
    operation: 'reference-generate',
    classifierStatus: 'used',
    classifierModelId: 'jev-runtime',
    classifierMs: 14,
  };
  const requests = [];
  const result = await imageRequest.resolveCanvasImageIntentForSubmit({
    requestMode: 'auto',
    prompt: 'Use the connected image as a visual reference',
    imageReferenceCount: 1,
    hasMask: false,
    modelId: 'auto',
    preview: async request => { requests.push(request); return preview; },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].imageReferenceCount, 1);
  assert.equal(result.operation, 'reference-generate');
  assert.equal(result.intentPreview, preview);
});

test('Canvas image preflight skips JEV for explicit operations, masks, and text-only generation', async () => {
  const preview = () => assert.fail('JEV must not run for deterministic image operations');
  const explicit = await imageRequest.resolveCanvasImageIntentForSubmit({
    requestMode: 'reference-generate', prompt: 'new image', imageReferenceCount: 1,
    hasMask: false, modelId: 'auto', preview,
  });
  const masked = await imageRequest.resolveCanvasImageIntentForSubmit({
    requestMode: 'auto', prompt: 'edit', imageReferenceCount: 1,
    hasMask: true, modelId: 'auto', preview,
  });
  const textOnly = await imageRequest.resolveCanvasImageIntentForSubmit({
    requestMode: 'auto', prompt: 'new image', imageReferenceCount: 0,
    hasMask: false, modelId: 'auto', preview,
  });

  assert.equal(explicit.operation, 'reference-generate');
  assert.equal(masked.operation, 'edit');
  assert.equal(textOnly.operation, 'generate');
});

test('Canvas image preflight rejects a selected model missing the JEV-selected capability', async () => {
  await assert.rejects(imageRequest.resolveCanvasImageIntentForSubmit({
    requestMode: 'auto', prompt: 'Modify this reference', imageReferenceCount: 1,
    hasMask: false,
    modelId: 'reference-only',
    models: [{ id: 'reference-only', displayName: 'Reference only', kind: 'image', capabilities: ['generate', 'reference'] }],
    preview: async () => ({ operation: 'edit' }),
  }), /JEV 判定本次为改图/);
});

test('Canvas task recovery matches task identity before duplicate prompt text', () => {
  const earlier = {
    id: 'earlier', type: 'media', data: { kind: 'image', generation: { taskId: 'task-earlier', prompt: 'same prompt' } },
  };
  const exact = {
    id: 'exact', type: 'media', data: { kind: 'image', generation: { taskId: 'task-current', prompt: 'same prompt' } },
  };
  const document = { nodes: [earlier, exact] };

  assert.equal(taskRecovery.canvasNodeForGenerationLog(document, {
    id: 'task-current', taskId: 'task-current', prompt: 'same prompt', mode: 'generate',
  }), exact);
});

test('Canvas task recovery maps an in-flight variant image task to its generator', () => {
  const generator = {
    id: 'generator-1',
    type: 'generator',
    data: { variantStates: [{ id: 'variant-1', taskIds: ['variant-task-1'] }] },
  };

  assert.equal(taskRecovery.canvasNodeForGenerationLog({ nodes: [generator] }, {
    id: 'variant-task-1', taskId: 'variant-task-1', prompt: 'variant prompt', mode: 'generate',
  }), generator);
});
