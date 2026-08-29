import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/video-platform.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const platform = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('enables the public media relay for remote URL-based video transports', () => {
  assert.equal(platform.requiresPublicMediaRelay({ platform: 'agnes', videoTransport: 'agnes-videos' }), true);
  assert.equal(platform.requiresPublicMediaRelay({ platform: 'custom', videoTransport: 'openai-videos' }), true);
  assert.equal(platform.requiresPublicMediaRelay({ platform: 'custom', videoTransport: 'auto' }, { hasVideoModel: true }), true);
  assert.equal(platform.requiresPublicMediaRelay({ platform: 'agnes', videoTransport: 'auto' }, { hasVideoModel: false }), false);
});

test('keeps inline and local video transports off the public media relay', () => {
  assert.equal(platform.requiresPublicMediaRelay({ platform: '65535', videoTransport: 'native-task' }), false);
  assert.equal(platform.requiresPublicMediaRelay({ platform: 'custom', videoTransport: 'native-task' }), false);
  assert.equal(platform.requiresPublicMediaRelay({ platform: 'jimeng-cli', videoTransport: 'jimeng-cli' }), false);
  assert.equal(platform.requiresPublicMediaRelay({ platform: 'custom', videoTransport: 'auto' }, { hasVideoModel: false }), false);
});
