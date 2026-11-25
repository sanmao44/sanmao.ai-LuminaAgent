import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const creation = load('./lib/creation/settings');

const cangyuanProvider = {
  id: 'cangyuan',
  name: '沧元算力',
  platform: 'cangyuan',
  videoTransport: 'cangyuan-videos',
};

function videoModel(rawId, providerId = cangyuanProvider.id) {
  return {
    id: `${providerId}:${rawId}`,
    providerId,
    providerName: providerId === cangyuanProvider.id ? '沧元算力' : 'Other',
    rawId,
    displayName: rawId,
    kind: 'video',
    enabled: true,
    published: true,
    capabilities: ['video-generate'],
  };
}

test('one-click cinematic includes only documented Cangyuan models that accept its image input', () => {
  const runtime = {
    providers: [cangyuanProvider],
    models: [
      videoModel('gf1-gemini-omni-flash'),
      videoModel('veo-3.1-fast'),
      videoModel('mu1-muse-podcast'),
      videoModel('kl3-kling-2.1'),
    ],
  };

  assert.deepEqual(
    creation.oneClickCinematicVideoModelOptions(runtime).map((model) => model.rawId),
    ['gf1-gemini-omni-flash', 'veo-3.1-fast'],
  );
  assert.equal(
    creation.oneClickCinematicVideoModelConfiguration(runtime.models[0], cangyuanProvider).inputMode,
    'reference',
  );
  assert.equal(
    creation.oneClickCinematicVideoModelConfiguration(runtime.models[1], cangyuanProvider).inputMode,
    'first-frame',
  );
  assert.equal(creation.oneClickCinematicVideoModelConfiguration(runtime.models[2], cangyuanProvider), null);
  assert.equal(creation.oneClickCinematicVideoModelConfiguration(runtime.models[3], cangyuanProvider), null);
});

test('project aspect ratio resolves to a documented Cangyuan ratio without changing other providers', () => {
  const model = videoModel('gf1-gemini-omni-flash');
  const configuration = creation.oneClickCinematicVideoModelConfiguration(model, cangyuanProvider);
  const aspectRatio = creation.resolveOneClickCinematicAspectRatio({
    requested: 'project',
    project: '4:5',
    configuration,
  });

  assert.ok(configuration.aspectRatios.includes(aspectRatio));
  assert.equal(aspectRatio, '9:16');
  assert.equal(
    creation.resolveOneClickCinematicAspectRatio({
      requested: 'project',
      project: '4:5',
      configuration: { inputMode: 'first-frame' },
    }),
    '4:5',
  );
});

test('non-Cangyuan video model selection retains its existing behavior', () => {
  const provider = { id: 'other', platform: 'custom', videoTransport: 'openai-videos' };
  const model = videoModel('unlisted-video', provider.id);
  const runtime = { providers: [provider], models: [model] };

  assert.deepEqual(creation.oneClickCinematicVideoModelOptions(runtime), [model]);
  assert.equal(creation.oneClickCinematicVideoModelConfiguration(model, provider).inputMode, 'first-frame');
});
