import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asrSourcePath = path.join(repoRoot, 'lib', 'clone', 'asr.ts');
const source = await readFile(asrSourcePath, 'utf8');
const types = await readFile(new URL('../lib/clone/types.ts', import.meta.url), 'utf8');
const pipeline = await readFile(new URL('../lib/clone/pipeline.ts', import.meta.url), 'utf8');

function moduleCandidates(file) {
  return [file, `${file}.ts`, `${file}.tsx`, `${file}.js`, `${file}.mjs`, path.join(file, 'index.ts')];
}

async function resolveLocalModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
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
    for (const match of transformed.matchAll(/(?:from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\1/gu)) {
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
const asrModule = await import(await materializeModuleGraph(asrSourcePath, path.join(moduleRoot, 'modules')));

test('本地 ASR 使用现有 Transformers.js，并输出逐词时间戳', () => {
  assert.match(source, /automatic-speech-recognition/);
  assert.match(source, /Xenova\/whisper-tiny/);
  assert.match(source, /return_timestamps:\s*'word'/);
  assert.match(source, /chunk_length_s:\s*30/);
  assert.match(source, /stride_length_s:\s*5/);
  assert.match(source, /SANMAO_CLONE_ASR_LOCAL_ONLY/);
  assert.match(source, /models.*transformers/);
});

test('ASR 时间轴归一化包含可编辑的 words、segments 和完整文本', () => {
  assert.match(source, /export function groupTranscriptWords/);
  assert.match(source, /const longEnough = word\.end - current\.start >= maxSegmentSeconds/);
  assert.match(source, /gap > 1\.2/);
  assert.match(source, /export function normalizeLocalAsrResult/);
  assert.match(types, /export type CloneTranscriptWord/);
  assert.match(types, /export type CloneTranscriptSegment/);
  assert.match(types, /transcriptData\?: CloneTranscript/);
});

test('ASR 纯函数会过滤零时长词，并按停顿与句末分组', () => {
  const normalized = asrModule.normalizeLocalAsrResult({
    text: '你好 世界。 再见',
    chunks: [
      { text: '你好', timestamp: [0, 0.4] },
      { text: '无效', timestamp: [0.4, 0.4] },
      { text: '世界。', timestamp: [0.5, 1.0] },
      { text: '再见', timestamp: [2.5, 2.9] },
    ],
  }, 4, 'test-model', 'zh');
  assert.deepEqual(normalized.words.map(({ text, start, end }) => ({ text, start, end })), [
    { text: '你好', start: 0, end: 0.4 },
    { text: '世界。', start: 0.5, end: 1 },
    { text: '再见', start: 2.5, end: 2.9 },
  ]);
  assert.deepEqual(normalized.segments.map(({ text, start, end }) => ({ text, start, end })), [
    { text: '你好 世界。', start: 0, end: 1 },
    { text: '再见', start: 2.5, end: 2.9 },
  ]);
  assert.equal(normalized.language, 'zh');
});

test('参考音频 ASR 会进入脚本提示、镜头兜底字幕和 Blueprint', () => {
  assert.match(pipeline, /transcribeReferenceAudio/);
  assert.match(pipeline, /referenceAnalysis\?\.transcriptData/);
  assert.match(pipeline, /参考视频原始音频的本地 ASR/);
  assert.match(pipeline, /transcriptForShot\(referenceTranscript, shot\.start, shot\.end\)/);
  assert.match(pipeline, /transcriptData: transcript/);
  assert.match(pipeline, /writeScript\(chatRuntime, executionJob, normalized, referenceTranscript\)/);
});

test('ASR 失败只进入 warnings，不会阻塞参考视频克隆', () => {
  assert.match(pipeline, /本地 ASR 未完成/);
  assert.match(pipeline, /将继续使用画面拆解和原始环境音/);
  assert.match(pipeline, /transcript: null/);
});

await rm(moduleRoot, { recursive: true, force: true });
