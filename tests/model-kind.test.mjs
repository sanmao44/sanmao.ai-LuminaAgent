import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/model-kind.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const modelKind = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('classifies common chat model families from their names', () => {
  assert.equal(modelKind.inferModelKind({ rawId: 'Shanghai_AI_Laboratory/Intern-S1' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'OpenGVLab/InternVL3_5-241B-A28B' }), 'chat');
  assert.equal(modelKind.inferModelKind({ displayName: 'Step-3.7-Flash' }), 'chat');
  assert.equal(modelKind.inferModelKind({ displayName: 'Hiy3' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'codex-mini-latest' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'Tencent-Hunyuan/Hy3' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'doubao-seedance-2-0' }), 'video');
});

test('recognizes image-edit-only model names without treating them as text-to-image', () => {
  assert.equal(modelKind.isImageEditOnlyModel({ rawId: 'MusePublic/Qwen-Image-Edit' }), true);
  assert.equal(modelKind.isImageEditOnlyModel({ displayName: 'Qwen Image Edit' }), true);
  assert.equal(modelKind.isImageEditOnlyModel({ rawId: 'gpt-image-2' }), false);
});

test('uses discovered capabilities before name heuristics', () => {
  assert.equal(modelKind.inferModelKind({ rawId: 'vendor/custom-model', capabilities: ['video-generate'] }), 'video');
  assert.equal(modelKind.inferModelKind({ rawId: 'vendor/custom-model', capabilities: ['generate'] }), 'image');
  assert.equal(modelKind.inferModelKind({ rawId: 'vendor/custom-model', capabilities: ['chat'] }), 'chat');
});

test('keeps an explicit category even when capabilities overlap', () => {
  assert.equal(modelKind.resolveModelKind('chat', 'image', ['chat', 'generate']), 'chat');
  assert.equal(modelKind.resolveModelKind('image', 'chat', ['chat', 'video-generate']), 'image');
});

test('infers video before image for an unclassified video-capable model', () => {
  assert.equal(modelKind.resolveModelKind('unknown', 'image', ['generate', 'video-generate']), 'video');
});

test('recognizes common external video families from model ids alone', () => {
  for (const rawId of [
    'wan2.1-i2v-plus',
    'hunyuan-video',
    'cogvideo-x',
    'ltx-video-13b',
    'pixverse-v4',
    'vidu-2',
    'lumalabs-ray-2',
    'pika-2.2',
  ]) {
    assert.equal(modelKind.inferModelKind({ rawId }), 'video', rawId);
  }
});

test('infers image and chat for unclassified models from their capabilities', () => {
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', ['generate']), 'image');
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', ['chat', 'vision']), 'chat');
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', []), 'unknown');
});
