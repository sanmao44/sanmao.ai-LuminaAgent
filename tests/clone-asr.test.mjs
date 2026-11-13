import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, utimes, writeFile } from 'node:fs/promises';
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

test('reference text becomes an explicit Whisper decoder prefix', () => {
  const encodedCalls = [];
  const decoderInputIds = transcriptionModule.buildWhisperDecoderInputIds({
    tokenizer: {
      encode(text, options) {
        encodedCalls.push({ text, options });
        return [40, 41];
      },
      convert_tokens_to_ids(token) {
        return {
          '<|startoftranscript|>': 1,
          '<|zh|>': 2,
          '<|transcribe|>': 3,
        }[token];
      },
    },
    model: {
      generation_config: {
        decoder_start_token_id: 1,
        is_multilingual: true,
        lang_to_id: { '<|zh|>': 2 },
        task_to_id: { transcribe: 3 },
      },
    },
  }, 'SANMAO.AI', 'zh');

  assert.deepEqual(encodedCalls, [{ text: '<|startofprev|> SANMAO.AI', options: { add_special_tokens: false } }]);
  assert.deepEqual(decoderInputIds, [40, 41, 1, 2, 3]);
});

test('prompted transcriber calls are serialized without sharing decoder prompts', async () => {
  const calls = [];
  let active = 0;
  const tokenizer = {
    encode(text) {
      return text.endsWith('Alpha') ? [40] : [41];
    },
    convert_tokens_to_ids(token) {
      return { '<|startoftranscript|>': 1, '<|zh|>': 2, '<|transcribe|>': 3 }[token];
    },
  };
  const pipeline = async (_audio, options) => {
    active += 1;
    calls.push({ prompt: options.decoder_input_ids, active });
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { text: '你好', chunks: [{ text: '你好', timestamp: [0.25, 0.75] }] };
  };
  pipeline.tokenizer = tokenizer;
  pipeline.model = { generation_config: {
    decoder_start_token_id: 1,
    is_multilingual: true,
    lang_to_id: { '<|zh|>': 2 },
    task_to_id: { transcribe: 3 },
  } };
  const transcriber = async (_audio, options) => {
    return pipeline(_audio, options);
  };
  transcriber.tokenizer = tokenizer;
  transcriber.model = pipeline.model;

  const results = await Promise.all([
    Promise.resolve().then(() => {
      const decoder_input_ids = transcriptionModule.buildWhisperDecoderInputIds(transcriber, 'Alpha', 'zh');
      return transcriptionModule.runPromptedLocalTranscriber(transcriber, new Float32Array([0]), { decoder_input_ids });
    }),
    Promise.resolve().then(() => {
      const decoder_input_ids = transcriptionModule.buildWhisperDecoderInputIds(transcriber, 'Beta', 'zh');
      return transcriptionModule.runPromptedLocalTranscriber(transcriber, new Float32Array([0]), { decoder_input_ids });
    }),
  ]);

  assert.deepEqual(calls, [
    { prompt: [40, 1, 2, 3], active: 1 },
    { prompt: [41, 1, 2, 3], active: 1 },
  ]);
  assert.deepEqual(results.map((result) => result.chunks[0].timestamp), [[0.25, 0.75], [0.25, 0.75]]);
});

test('normalization keeps long transcripts beyond the historical silent limits', () => {
  const chunks = Array.from({ length: 4_001 }, (_, index) => ({
    text: `word-${index}`,
    timestamp: [index * 2, index * 2 + 0.5],
  }));
  const normalized = transcriptionModule.normalizeLocalAsrResult({ text: '', chunks }, 10_000, 'test-model');

  assert.equal(normalized.words.length, 4_001);
  assert.equal(normalized.segments.length, 4_001);
  assert.equal(normalized.words.at(-1).text, 'word-4000');
  assert.equal(normalized.segments.at(-1).text, 'word-4000');
});

test('normalization closes a final word with the known audio duration when Whisper omits its end', () => {
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: 'one two',
    chunks: [
      { text: 'one', timestamp: [0, 0.5] },
      { text: 'two', timestamp: [0.6, null] },
    ],
  }, 1.2, 'test-model');

  assert.deepEqual(normalized.words, [
    { text: 'one', start: 0, end: 0.5 },
    { text: 'two', start: 0.6, end: 1.2 },
  ]);
});

test('local model cache recovery removes stale downloads and retries once', async () => {
  const modelDirectory = await mkdtemp(path.join(repoRoot, 'tests', '.local-model-cache-'));
  const staleFile = path.join(modelDirectory, 'onnx', 'decoder_model.onnx.tmp.2147483000.abcd');
  const weightFile = path.join(modelDirectory, 'onnx', 'encoder_model.onnx');
  const configFile = path.join(modelDirectory, 'config.json');
  await mkdir(path.dirname(staleFile), { recursive: true });
  await writeFile(staleFile, 'partial');
  await writeFile(weightFile, 'corrupt weight');
  await writeFile(configFile, 'model config');
  const old = new Date(Date.now() - 11 * 60 * 1_000);
  await utimes(staleFile, old, old);

  let attempts = 0;
  const result = await transcriptionModule.loadWithLocalModelCacheRecovery(modelDirectory, false, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Invalid protobuf model');
    assert.equal(existsSync(weightFile), false);
    assert.equal(existsSync(configFile), true);
    return 'loaded';
  });

  assert.equal(result, 'loaded');
  assert.equal(attempts, 2);
  await rm(modelDirectory, { recursive: true, force: true });
});

test('local model cache recovery preserves weights when the failure is network-related', async () => {
  const modelDirectory = await mkdtemp(path.join(repoRoot, 'tests', '.local-model-cache-'));
  const weightFile = path.join(modelDirectory, 'onnx', 'encoder_model.onnx');
  await mkdir(path.dirname(weightFile), { recursive: true });
  await writeFile(weightFile, 'complete weight');
  let attempts = 0;
  const result = await transcriptionModule.loadWithLocalModelCacheRecovery(modelDirectory, false, async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('fetch failed');
    assert.equal(existsSync(weightFile), true);
    return 'loaded';
  });
  assert.equal(result, 'loaded');
  await rm(modelDirectory, { recursive: true, force: true });
});

test('local model cache recovery returns an actionable error after retry failure', async () => {
  const modelDirectory = await mkdtemp(path.join(repoRoot, 'tests', '.local-model-cache-'));
  let attempts = 0;
  await assert.rejects(
    transcriptionModule.loadWithLocalModelCacheRecovery(modelDirectory, false, async () => {
      attempts += 1;
      throw new Error('fetch failed');
    }),
    /本地语音识别模型下载或加载失败/,
  );
  assert.equal(attempts, 2);
  await rm(modelDirectory, { recursive: true, force: true });
});

test('local-only model loading does not retry and asks for the first-run download', async () => {
  const modelDirectory = await mkdtemp(path.join(repoRoot, 'tests', '.local-model-cache-'));
  let attempts = 0;
  await assert.rejects(
    transcriptionModule.loadWithLocalModelCacheRecovery(modelDirectory, true, async () => {
      attempts += 1;
      throw new Error('missing model');
    }),
    /允许首次联网下载模型/,
  );
  assert.equal(attempts, 1);
  await rm(modelDirectory, { recursive: true, force: true });
});

await rm(moduleRoot, { recursive: true, force: true });
