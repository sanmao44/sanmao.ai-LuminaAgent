import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const references = load('./lib/canvas/project-visual-references');
const contracts = load('./packages/contracts/creative');

function image(id, url, extra = {}) {
  return {
    id,
    kind: 'image',
    name: id,
    url,
    ...extra,
  };
}

test('project visual references resolve stable ids and ignore missing or non-image assets', () => {
  const assets = [
    image('canvas:local-1', '/api/storage/images?id=one', { indexId: 'index-1', storageKey: 'one' }),
    { id: 'video-1', kind: 'video', name: 'video', url: '/video.mp4' },
  ];

  assert.deepEqual(references.resolveProjectVisualReferences(
    ['index:index-1', 'canvas:local-1', 'missing', 'video-1'],
    assets,
  ), [{
    assetId: 'index:index-1',
    name: 'canvas:local-1',
    url: '/api/storage/images?id=one',
    storageKey: 'one',
  }]);
});

test('project visual references deduplicate equivalent assets and respect the project cap', () => {
  const assets = Array.from({ length: contracts.MAX_CREATIVE_PROJECT_REFERENCE_ASSETS + 2 }, (_, index) =>
    image(`asset-${index}`, `/image-${index}.png`, { sourceAssetId: `source-${index}` }));

  const resolved = references.resolveProjectVisualReferences(
    assets.map((asset) => asset.sourceAssetId),
    assets,
  );
  assert.equal(resolved.length, contracts.MAX_CREATIVE_PROJECT_REFERENCE_ASSETS);

  const duplicate = references.resolveProjectVisualReferences(
    ['source-0', 'asset-0'],
    assets,
  );
  assert.equal(duplicate.length, 1);
});

test('mergeProjectVisualReferences keeps explicit references first and supports one-shot exclusions', () => {
  const explicit = [{ kind: 'image', name: 'explicit', url: '/explicit.png' }];
  const project = [
    { assetId: 'project-a', name: 'A', url: '/a.png' },
    { assetId: 'project-b', name: 'B', url: '/b.png' },
  ];

  assert.deepEqual(references.mergeProjectVisualReferences(explicit, project, ['project-a']), [
    { kind: 'image', name: 'explicit', url: '/explicit.png' },
    { kind: 'image', name: 'B', url: '/b.png', projectAssetId: 'project-b' },
  ]);
});

test('mergeProjectVisualReferences deduplicates by asset identity and enforces request limit', () => {
  const result = references.mergeProjectVisualReferences(
    [
      { kind: 'image', name: 'explicit', url: '/same.png', storageKey: 'same' },
      { kind: 'image', name: 'second', url: '/second.png' },
    ],
    [
      { assetId: 'same-project', name: 'same project', url: '/same.png', storageKey: 'same' },
      { assetId: 'third', name: 'third', url: '/third.png' },
    ],
    [],
    2,
  );

  assert.deepEqual(result, [
    { kind: 'image', name: 'explicit', url: '/same.png', storageKey: 'same' },
    { kind: 'image', name: 'second', url: '/second.png' },
  ]);
});

test('project reference preview matches explicit-first image and video model limits', () => {
  const explicitImages = Array.from({ length: contracts.MAX_IMAGE_REFERENCES }, (_, index) => ({
    kind: 'image',
    name: `explicit-${index}`,
    url: `/explicit-${index}.png`,
  }));
  const project = [
    { assetId: 'project-a', name: 'A', url: '/a.png' },
    { assetId: 'project-b', name: 'B', url: '/b.png' },
  ];

  const imagePlan = references.planProjectVisualReferenceSubmission(
    explicitImages,
    project,
    [],
    contracts.MAX_IMAGE_REFERENCES,
  );
  assert.equal(imagePlan.references.length, contracts.MAX_IMAGE_REFERENCES);
  assert.equal(imagePlan.explicitCount, contracts.MAX_IMAGE_REFERENCES);
  assert.equal(imagePlan.projectCount, 0);
  assert.deepEqual(imagePlan.items.map((item) => item.status), ['model-limit', 'model-limit']);

  const videoPlan = references.planProjectVisualReferenceSubmission(
    explicitImages.slice(0, 4),
    project,
    [],
    5,
  );
  assert.equal(videoPlan.references.length, 5);
  assert.equal(videoPlan.explicitCount, 4);
  assert.equal(videoPlan.projectCount, 1);
  assert.deepEqual(videoPlan.items.map((item) => item.status), ['included', 'model-limit']);
});

test('project reference preview explains disabled defaults and explicit duplicates', () => {
  const project = [
    { assetId: 'project-a', name: 'A', url: '/same.png' },
    { assetId: 'project-b', name: 'B', url: '/b.png' },
  ];
  const explicit = [{ kind: 'image', name: 'linked', url: '/same.png' }];

  const duplicatePlan = references.planProjectVisualReferenceSubmission(explicit, project, [], 4);
  assert.deepEqual(duplicatePlan.items.map((item) => item.status), ['duplicate', 'included']);
  assert.equal(duplicatePlan.projectCount, 1);

  const disabledPlan = references.planProjectVisualReferenceSubmission(explicit, project, [], 4, false);
  assert.deepEqual(disabledPlan.references, explicit);
  assert.deepEqual(disabledPlan.items.map((item) => item.status), ['defaults-disabled', 'defaults-disabled']);
});
