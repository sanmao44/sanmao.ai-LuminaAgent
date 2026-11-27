import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/model-registry.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const registry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function model(overrides = {}) {
  return {
    id: 'model-1',
    providerId: 'provider-1',
    providerName: 'APIKL',
    rawId: 'gpt-image-2-pro',
    displayName: 'gpt-image-2-pro',
    kind: 'image',
    enabled: false,
    published: false,
    capabilities: ['generate'],
    ...overrides,
  };
}

test('builds a disabled manual image model with generation capability', () => {
  const created = registry.buildManualModelRecord({
    id: 'manual-1',
    providerId: 'provider-1',
    providerName: 'APIKL',
    rawId: 'gpt-image-2-pro',
    displayName: 'GPT Image 2 Pro',
    kind: 'image',
    inferred: { kind: 'image', capabilities: [] },
  });
  assert.equal(created.source, 'manual');
  assert.equal(created.kind, 'image');
  assert.equal(created.enabled, false);
  assert.equal(created.published, false);
  assert.ok(created.capabilities.includes('generate'));
});

test('builds manual music and 3D models with their specific generation capabilities', () => {
  const music = registry.buildManualModelRecord({
    id: 'manual-music',
    providerId: 'provider-1',
    providerName: '沧元算力',
    rawId: 'song-generation-v2',
    displayName: 'Music v2',
    kind: 'audio',
    inferred: { kind: 'audio', capabilities: ['music-generate'] },
  });
  const threeD = registry.buildManualModelRecord({
    id: 'manual-3d',
    providerId: 'provider-1',
    providerName: '沧元算力',
    rawId: 'shape-3d-v1',
    displayName: '3D v1',
    kind: '3d',
    inferred: { kind: '3d', capabilities: [] },
  });

  assert.ok(music.capabilities.includes('music-generate'));
  assert.ok(!music.capabilities.includes('speech'));
  assert.ok(threeD.capabilities.includes('3d-generate'));
});

test('keeps manually selected transcription models out of the speech bucket', () => {
  const transcription = registry.buildManualModelRecord({
    id: 'manual-asr',
    providerId: 'provider-1',
    providerName: '通用接口',
    rawId: 'asr-v1',
    displayName: '语音转写 v1',
    kind: 'audio',
    inferred: { kind: 'audio', capabilities: ['transcription'] },
  });
  assert.ok(transcription.capabilities.includes('transcription'));
  assert.ok(!transcription.capabilities.includes('speech'));
});

test('manual audio models can remain unrouted until their purpose is confirmed', () => {
  const pending = registry.buildManualModelRecord({
    id: 'manual-audio',
    providerId: 'provider-1',
    providerName: '通用接口',
    rawId: 'vendor-audio-v1',
    displayName: '未知音频模型',
    kind: 'audio',
    inferred: { kind: 'audio', capabilities: [] },
  });
  assert.deepEqual(pending.capabilities, []);
  assert.deepEqual(pending.classification?.purposes, []);
  assert.equal(pending.classification?.requiresReview, true);
});

test('pending audio models appear in review filters, not speech filters', () => {
  const { modelMatchesLibraryCategory, modelLibraryCategoryLabel } = createTsRequire(process.cwd())('./lib/model-library-categories');
  const pending = registry.buildManualModelRecord({
    id: 'manual-audio', providerId: 'provider-1', providerName: '通用接口',
    rawId: 'vendor-audio-v1', displayName: '未知音频模型', kind: 'audio',
    inferred: { kind: 'audio', capabilities: [] },
  });
  assert.equal(modelMatchesLibraryCategory(pending, 'unknown'), true);
  assert.equal(modelMatchesLibraryCategory(pending, 'speech'), false);
  assert.equal(modelLibraryCategoryLabel(pending), '音频用途待确认');
});

test('preserves manual models and enabled state when upstream returns the same ID', () => {
  const existing = model({ id: 'manual-1', source: 'manual', enabled: true, published: true });
  const discovered = model({ id: 'discovered-1', source: 'discovered', enabled: false, published: false, displayName: 'Upstream name' });
  const merged = registry.mergeProviderModelRecords([existing], [discovered]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'manual-1');
  assert.equal(merged[0].source, 'manual');
  assert.equal(merged[0].enabled, true);
  assert.equal(merged[0].published, true);
  assert.equal(merged[0].displayName, 'Upstream name');
});

test('provider refresh replaces stale discovered audio purposes', () => {
  const previous = model({ source: 'discovered', capabilities: ['chat', 'speech'] });
  const capabilities = registry.reconcileDiscoveredModelCapabilities(previous, ['transcription']);
  assert.deepEqual(capabilities, ['chat', 'transcription']);
});

test('chat-only refresh removes stale inferred image capabilities from discovered models', () => {
  const previous = model({ source: 'discovered', kind: 'image', capabilities: ['generate', 'edit', 'reference', 'typography'] });
  assert.deepEqual(registry.reconcileDiscoveredModelCapabilities(previous, ['chat']), ['chat']);

  const manual = model({ source: 'manual', kind: 'image', capabilities: ['generate', 'edit'] });
  assert.deepEqual(registry.reconcileDiscoveredModelCapabilities(manual, ['chat']), ['generate', 'edit', 'chat']);
});

test('keeps a manual model missing from the latest upstream list and removes duplicate IDs', () => {
  const manual = model({ id: 'manual-1', rawId: 'gpt-image-2-4K', source: 'manual' });
  const discovered = [
    model({ id: 'discovered-1', rawId: 'gpt-image-2', source: 'discovered' }),
    model({ id: 'discovered-2', rawId: 'gpt-image-2', source: 'discovered' }),
  ];
  const merged = registry.mergeProviderModelRecords([manual], discovered);
  assert.deepEqual(merged.map((item) => item.rawId), ['gpt-image-2', 'gpt-image-2-4K']);
});
