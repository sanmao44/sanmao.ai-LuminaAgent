import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/creation/settings.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText
  .replace(
    /^\s*import\s+\{\s*getLastModelCall\s*\}\s+from\s+["']\.\.\/model-preferences["'];?\s*$/m,
    'const getLastModelCall = () => null;',
  )
  .replace(
    /^\s*import\s+\{\s*selectAutomaticModel\s*\}\s+from\s+["']\.\.\/model-selection["'];?\s*$/m,
    `const selectAutomaticModel = (models, defaultProviderId, defaultModelId) => {
      const providerModels = defaultProviderId ? models.filter((model) => model.providerId === defaultProviderId) : [];
      return providerModels.find((model) => model.id === defaultModelId)
        || providerModels[0]
        || models.find((model) => model.id === defaultModelId)
        || models[0];
    };`,
  );
const settings = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const runtime = {
  models: [
    { id: 'qwen-edit', providerId: 'modelscope', kind: 'image', enabled: true, published: true, capabilities: ['edit', 'reference'] },
    { id: 'gpt-image', providerId: 'draw', kind: 'image', enabled: true, published: true, capabilities: ['generate'] },
  ],
  settings: {
    agentModelId: null,
    defaultImageModelId: 'gpt-image',
    defaultVideoModelId: null,
    defaultProviderId: null,
  },
};

test('pure image generation excludes edit-only models and honors the configured default', () => {
  assert.deepEqual(settings.imageModelOptions(runtime).map((model) => model.id), ['gpt-image']);
  const selected = settings.resolveAvailableCreationModel(settings.defaultImageCreationSettings(runtime), runtime);
  assert.equal(selected.model?.id, 'gpt-image');
});
