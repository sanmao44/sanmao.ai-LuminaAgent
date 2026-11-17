import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const noop = () => null;
const loader = createTsRequire(process.cwd(), {
  './ModelPicker': { __esModule: true, default: noop },
  './SelectMenu': {
    __esModule: true,
    default: ({ options, ariaLabel }) => createElement('div', { 'aria-label': ariaLabel },
      ...options.map((option) => createElement('span', { key: String(option.value) }, option.label))),
  },
});
const CreationParameterEditor = loader('./components/CreationParameterEditor').default;
const { defaultImageCreationSettings, normalizeImageCreationSettings } = loader('./lib/creation/settings');

function createRuntime({ rawId = 'nano-banana2.1', provider = { id: 'cangyuan', name: '沧元算力', platform: 'cangyuan' } } = {}) {
  const model = {
    id: `${provider.id}-image`,
    providerId: provider.id,
    providerName: provider.name,
    rawId,
    displayName: rawId,
    kind: 'image',
    enabled: true,
    published: true,
    capabilities: ['generate', 'reference'],
  };
  return {
    providers: [provider],
    models: [model],
    settings: { defaultProviderId: provider.id, defaultImageModelId: model.id },
  };
}

function renderEditor(runtime, settings) {
  return renderToStaticMarkup(createElement(CreationParameterEditor, {
    settings,
    runtime,
    onChange: () => undefined,
  }));
}

test('Cangyuan image settings retain documented sizes and allow the model n maximum', () => {
  const runtime = createRuntime();
  const modelId = runtime.models[0].id;
  const settings = normalizeImageCreationSettings({
    ...defaultImageCreationSettings(runtime),
    model: modelId,
    aspect: '1:4',
    count: 10,
  }, runtime);

  assert.equal(settings.aspect, '1:4');
  assert.equal(settings.count, 10);
  const markup = renderEditor(runtime, settings);
  assert.match(markup, /10 张/);
  assert.match(markup, /模型建议尺寸/);
});

test('Cangyuan image counts follow each documented model limit while other providers retain eight', () => {
  const unknownRuntime = createRuntime({ rawId: 'unlisted-image-model' });
  const unknown = normalizeImageCreationSettings({
    ...defaultImageCreationSettings(unknownRuntime),
    model: unknownRuntime.models[0].id,
    count: 10,
  }, unknownRuntime);
  assert.equal(unknown.count, 1);
  assert.doesNotMatch(renderEditor(unknownRuntime, unknown), /10 张/);

  const genericRuntime = createRuntime({
    rawId: 'generic-image-model',
    provider: { id: 'generic', name: 'Generic', platform: 'openai' },
  });
  const generic = normalizeImageCreationSettings({
    ...defaultImageCreationSettings(genericRuntime),
    model: genericRuntime.models[0].id,
    count: 10,
  }, genericRuntime);
  assert.equal(generic.count, 8);
  assert.doesNotMatch(renderEditor(genericRuntime, generic), /10 张/);
});
