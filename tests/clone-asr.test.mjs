import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function moduleCandidates(file) {
  return [file, `${file}.ts`, `${file}.tsx`, `${file}.js`, `${file}.mjs`, path.join(file, 'index.ts')];
}

async function resolveLocalModule(fromFile, specifier) {
  const base = specifier.startsWith('@/')
    ? path.resolve(repoRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const candidate of moduleCandidates(base)) if (existsSync(candidate)) return candidate;
  return null;
}

async function materializeModuleGraph(entry, outputRoot) {
  const files = new Map();
  const visit = async (sourceFile) => {
    if (files.has(sourceFile)) return files.get(sourceFile);
    const outputFile = path.join(outputRoot, path.relative(repoRoot, sourceFile).replace(/\.(?:tsx?|mts|cts)$/u, '.mjs'));
    files.set(sourceFile, outputFile);
    const transformed = ts.transpileModule(await readFile(sourceFile, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: sourceFile,
    }).outputText;
    let output = transformed;
    for (const match of transformed.matchAll(/(?:from\s+|import\s*\(\s*)(['"])([^'"]+)\1/gu)) {
      const localFile = await resolveLocalModule(sourceFile, match[2]);
      if (!localFile) continue;
      const importedFile = await visit(localFile);
      let replacement = path.relative(path.dirname(outputFile), importedFile).replaceAll('\\', '/');
      if (!replacement.startsWith('.')) replacement = `./${replacement}`;
      output = output.replaceAll(`'${match[2]}'`, `'${replacement}'`).replaceAll(`"${match[2]}"`, `"${replacement}"`);
    }
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, output, 'utf8');
    return outputFile;
  };
  return pathToFileURL(await visit(entry)).href;
}

const moduleRoot = await mkdtemp(path.join(repoRoot, 'tests', '.clone-asr-'));
const asrModule = await import(await materializeModuleGraph(path.join(repoRoot, 'lib', 'clone', 'asr.ts'), path.join(moduleRoot, 'modules')));
const transcriptionModule = await import(await materializeModuleGraph(path.join(repoRoot, 'lib', 'transcription', 'local-whisper.ts'), path.join(moduleRoot, 'modules')));

test('Clone ASR normalizes word timestamps, drops zero-length chunks and clips to the audio duration', () => {
  const normalized = asrModule.normalizeLocalAsrResult({
    text: '你好，世界。再见',
    chunks: [
      { text: '你好', timestamp: [-0.1, 0.25] },
      { text: '，', timestamp: [0.25, 0.35] },
      { text: '世界。', timestamp: [0.36, 0.9] },
      { text: '无效', timestamp: [0.9, 0.9] },
      { text: '再见', timestamp: [2, 2.4] },
      { text: '裁剪', timestamp: [3.9, 4.4] },
    ],
  }, 4, 'test-model', 'zh');

  assert.deepEqual(normalized.words, [
    { text: '你好', start: 0, end: 0.25 },
    { text: '，', start: 0.25, end: 0.35 },
    { text: '世界。', start: 0.36, end: 0.9 },
    { text: '再见', start: 2, end: 2.4 },
    { text: '裁剪', start: 3.9, end: 4 },
  ]);
  assert.deepEqual(normalized.segments.map(({ text, start, end }) => ({ text, start, end })), [
    { text: '你好，世界。', start: 0, end: 0.9 },
    { text: '再见', start: 2, end: 2.4 },
    { text: '裁剪', start: 3.9, end: 4 },
  ]);
  assert.equal(normalized.language, 'zh');
});

test('SRT serialization keeps ASR timings and emits stable cue numbering and timestamps', () => {
  const srt = transcriptionModule.formatSrt([
    { start: 0.125, end: 1.25, text: '第一句' },
    { start: 61.007, end: 62.999, text: 'Second line' },
    { start: 3, end: 3, text: 'zero-length cue' },
  ]);

  assert.equal(srt, [
    '1',
    '00:00:00,125 --> 00:00:01,250',
    '第一句',
    '',
    '2',
    '00:01:01,007 --> 00:01:02,999',
    'Second line',
    '',
  ].join('\r\n'));
});

await rm(moduleRoot, { recursive: true, force: true });
