import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/asset-references.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'asset-references.ts',
}).outputText;
const refs = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('asset references normalize local storage URLs without absolute paths', () => {
  assert.equal(refs.storageKeyFromAssetUrl('image', '/api/storage/file?name=2026/a.png'), 'images/2026/a.png');
  assert.equal(refs.storageKeyFromAssetUrl('video', 'http://localhost:3210/api/storage/file?name=clip.mp4'), 'videos/clip.mp4');
  assert.equal(refs.storageKeyFromAssetUrl('audio', '/api/storage/file?name=../secret.mp3'), undefined);
  assert.equal(refs.normalizeAssetStorageKey('image', 'C:\\Users\\demo\\a.png'), undefined);
  assert.equal(refs.normalizeAssetStorageKey('image', '/images/a.png'), undefined);
});

test('portable references prefer stable asset id and storage key', () => {
  assert.deepEqual(refs.portableAssetReference('image', {
    assetId: 'asset_123',
    url: '/api/storage/file?name=cover.png',
  }), { assetId: 'asset_123', storageKey: 'images/cover.png' });
});
