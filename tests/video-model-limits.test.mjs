import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const sourceUrl = new URL('../lib/video-model-limits.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
// Keep this focused unit test runnable without a TypeScript runtime loader.
// The production module imports the same helper from lib/video-platform.ts.
const standaloneSource = source.replace(
  "import { is65535Provider, isJimengProvider, type VideoProviderIdentity } from './video-platform';",
  `type VideoProviderIdentity = { platform?: string; videoTransport?: string; baseUrl?: string; videoBaseUrl?: string };
function is65535Provider(provider) {
  return Boolean(provider && (provider.platform === '65535' || /65535\\.space/i.test(provider.baseUrl || '') || /65535\\.space/i.test(provider.videoBaseUrl || '')));
}
function isJimengProvider(provider) {
  return Boolean(provider && (provider.platform === 'jimeng-cli' || provider.videoTransport === 'jimeng-cli'));
}`,
);
const compiled = ts.transpileModule(standaloneSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const limits = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('applies documented model limits only to 65535', () => {
  const seedance65535 = limits.getVideoModelLimits({ rawId: 'seedance-2.0' }, { platform: '65535' });
  assert.equal(seedance65535.minSeconds, 5);
  assert.equal(seedance65535.maxSeconds, 15);
  assert.deepEqual(seedance65535.resolutions, ['720p']);
  assert.equal(seedance65535.maxReferenceImages, 9);
  assert.equal(seedance65535.maxReferenceVideos, 3);
  assert.equal(seedance65535.maxAudios, 3);

  const seedanceOther = limits.getVideoModelLimits({ rawId: 'seedance-2.0' }, { platform: 'custom', videoTransport: 'native-task' });
  assert.equal(seedanceOther.minSeconds, 1);
  assert.equal(seedanceOther.maxSeconds, 60);
  assert.deepEqual(seedanceOther.resolutions, ['480p', '720p', '1080p']);
  assert.equal(seedanceOther.maxReferenceImages, 16);
  assert.equal(seedanceOther.maxReferenceVideos, 10);
  assert.equal(seedanceOther.maxAudios, 10);
  assert.deepEqual(seedanceOther.notes, []);
});

test('recognizes legacy 65535 hosts without restricting unrelated providers', () => {
  const legacy = limits.getVideoModelLimits({ rawId: 'veo-omni-flash' }, { platform: 'custom', videoBaseUrl: 'https://task-api-1-cn.65535.space' });
  assert.equal(legacy.fixedSeconds, 10);
  assert.deepEqual(legacy.resolutions, ['720p', '1080p']);

  const unrelated = limits.getVideoModelLimits({ rawId: 'veo-omni-flash' }, { platform: 'custom', videoBaseUrl: 'https://video.example.com' });
  assert.equal(unrelated.fixedSeconds, undefined);
  assert.deepEqual(unrelated.resolutions, ['480p', '720p', '1080p']);
  assert.deepEqual(unrelated.notes, []);
});

test('uses the official Jimeng parameter profile instead of generic defaults', () => {
  const seedance25 = limits.getVideoModelLimits({ rawId: 'seedance-2.5' }, { platform: 'jimeng-cli', videoTransport: 'jimeng-cli' });
  assert.equal(seedance25.minSeconds, 4);
  assert.equal(seedance25.maxSeconds, 30);
  assert.deepEqual(seedance25.resolutions, ['480p', '720p', '1080p']);
  assert.equal(seedance25.allowedSeconds[0], 4);
  assert.equal(seedance25.allowedSeconds.at(-1), 30);
  assert.equal(seedance25.allowedSeconds.length, 27);

  const mini = limits.getVideoModelLimits({ rawId: 'seedance2.0mini' }, { platform: 'custom', videoTransport: 'jimeng-cli' });
  assert.equal(mini.minSeconds, 5);
  assert.equal(mini.maxSeconds, 15);
  assert.deepEqual(mini.resolutions, ['720p']);

  const other = limits.getVideoModelLimits({ rawId: 'seedance-2.5' }, { platform: 'custom', videoTransport: 'openai-videos' });
  assert.equal(other.allowedSeconds, undefined);
  assert.deepEqual(other.resolutions, ['480p', '720p', '1080p']);
});
