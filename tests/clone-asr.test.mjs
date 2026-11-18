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

  assert.match(transcriptionModule.formatSrt([
    { start: 0, end: 1, text: '准确率90 %以上' },
  ]), /准确率90%以上/u);
});

test('SRT punctuation uses spaces for commas and preserves only enumeration marks, double quotes, and semantic number separators', () => {
  const srt = transcriptionModule.formatSrt([
    { start: 0, end: 2, text: '你好，世界。屏幕里不要出现标点！保留、并列词和“引号”。版本SANMAO.AI是3.5万，时间10:30。' },
  ]);

  const subtitle = srt.split('\r\n')[2];
  assert.equal(subtitle, '你好 世界 屏幕里不要出现标点 保留、并列词和“引号” 版本SANMAO.AI是3.5万 时间10:30');
  assert.doesNotMatch(subtitle, /[，,。！？!?；;]/u);
  assert.doesNotMatch(subtitle, /(?<!\p{N})[:：]|[:：](?!\p{N})/u);
});

test('SRT collapses repeated and mixed punctuation, trims cue-edge enumeration marks, and bridges compressed speech timing gaps', () => {
  const srt = transcriptionModule.formatSrt([
    { start: 66.446, end: 67, text: '、强化网络多智能体协同能力、、' },
    { start: 72.58, end: 74.38, text: '构建智预智防、、' },
    { start: 77.58, end: 78, text: '实现风险预警，、' },
    { start: 79.18, end: 81.44, text: '资源调度、、保障处置、' },
    { start: 82, end: 84, text: '他说，，、；。！！“方案”。' },
  ]);
  const cues = srt.trim().split('\r\n\r\n');

  assert.match(cues[0], /00:01:06,446 --> 00:01:12,580/u);
  assert.match(cues[0], /强化网络多智能体协同能力$/u);
  assert.match(cues[1], /构建智预智防$/u);
  assert.match(cues[2], /00:01:17,580 --> 00:01:19,180/u);
  assert.match(cues[2], /实现风险预警$/u);
  assert.match(cues[3], /资源调度、保障处置$/u);
  assert.match(cues[4], /他说 “方案”$/u);
  for (const cue of cues) assert.doesNotMatch(cue.split('\r\n')[2], /(?:、|[，,。！？!?；;：:])$/u);
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

test('long reference prose is not sent as a Whisper decoder prompt', () => {
  let encoded = false;
  const transcriber = {
    tokenizer: {
      encode() {
        encoded = true;
        return [40];
      },
    },
  };

  const decoderInputIds = transcriptionModule.buildWhisperDecoderInputIds(
    transcriber,
    `产品介绍。${'当智能技术融入千行百业，网络建设持续推进。'.repeat(20)}`,
    'zh',
  );

  assert.equal(decoderInputIds, undefined);
  assert.equal(encoded, false);
});

test('long reference documents contribute bounded named-term decoder hints', () => {
  const encodedCalls = [];
  const decoderInputIds = transcriptionModule.buildWhisperDecoderInputIds({
    tokenizer: {
      encode(text) {
        encodedCalls.push(text);
        return [40];
      },
      convert_tokens_to_ids(token) {
        return { '<|startoftranscript|>': 1, '<|zh|>': 2, '<|transcribe|>': 3 }[token];
      },
    },
    model: { generation_config: {
      decoder_start_token_id: 1,
      is_multilingual: true,
      lang_to_id: { '<|zh|>': 2 },
      task_to_id: { transcribe: 3 },
    } },
  }, `产品文档中提到《天穹平台》和 SANMAO.AI。${'这段普通说明文字不会进入识别提示。'.repeat(20)}`, 'zh');

  assert.deepEqual(decoderInputIds, [40, 1, 2, 3]);
  assert.equal(encodedCalls.length, 1);
  assert.match(encodedCalls[0], /天穹平台/);
  assert.match(encodedCalls[0], /SANMAO\.AI/);
  assert.doesNotMatch(encodedCalls[0], /普通说明文字/);
  assert.ok(Array.from(encodedCalls[0]).length <= 180);
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

test('normalization splits long unspaced Chinese ASR chunks into readable timed cues', () => {
  const text = '当AI融入千行百业，背后，是通信网络24小时的分秒守护。'.repeat(4);
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text,
    chunks: [{ text, timestamp: [0.4, 40.4] }],
  }, 45, 'test-model', 'zh');

  assert.ok(normalized.segments.length > 4);
  assert.ok(normalized.segments.every((segment) => Array.from(segment.text).length <= 20));
  assert.ok(normalized.segments.every((segment) => segment.end - segment.start <= 5.001));
  assert.equal(normalized.segments[0].start, 0.4);
  assert.equal(normalized.segments.at(-1).end, 40.4);
  assert.equal(normalized.segments.map((segment) => segment.text).join(''), text);

  const sparseWords = transcriptionModule.normalizeLocalAsrResult({
    text: '你好世界',
    chunks: [{ text: '你好世界', timestamp: [0, 20] }],
  }, 20, 'test-model', 'zh');
  assert.equal(sparseWords.segments.length, 4);
  assert.ok(sparseWords.segments.every((segment) => segment.end - segment.start <= 5));
});

test('unspaced Chinese chunks prefer clause boundaries over splitting a phrase', () => {
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: '中国移动与中兴通讯持续深化协作依托Agentic AI大模型',
    chunks: [{ text: '中国移动与中兴通讯持续深化协作依托Agentic AI大模型', timestamp: [0, 5.5] }],
  }, 5.5, 'test-model', 'zh');
  assert.ok(normalized.segments.some((segment) => /协作$/u.test(segment.text)));
  assert.ok(normalized.segments.every((segment) => !/依托$/u.test(segment.text)));

  const emergency = transcriptionModule.normalizeLocalAsrResult({
    text: '在广东广东移动针对汛期网络应急保障强化网络多智能体协同能力',
    chunks: [{ text: '在广东广东移动针对汛期网络应急保障强化网络多智能体协同能力', timestamp: [0, 5.5] }],
  }, 5.5, 'test-model', 'zh');
  assert.ok(emergency.segments.some((segment) => segment.text.includes('应急保障')));
  assert.ok(emergency.segments.every((segment) => !/应急保$/u.test(segment.text)));

  const closedLoop = transcriptionModule.normalizeLocalAsrResult({
    text: '实现风险预警资源调度保障处置全链路闭环灾害场景下',
    chunks: [{ text: '实现风险预警资源调度保障处置全链路闭环灾害场景下', timestamp: [0, 5.5] }],
  }, 5.5, 'test-model', 'zh');
  assert.ok(closedLoop.segments.some((segment) => segment.text.includes('全链路闭环')));
  assert.ok(closedLoop.segments.every((segment) => !/闭环灾害$/u.test(segment.text)));
});

test('reference punctuation restores matching clause boundaries without reordering audio', () => {
  const reference = '中国移动与中兴通讯持续深化协作，依托Agentic AI、大模型等创新技术，锚定商业闭环目标。在山东开展业务试点，随后在广东推广。';
  const recognized = '中国移动与中兴通讯持续深化协作依托Agentic AI大模型等创新技术锚定商业闭环目标在广东开展业务试点随后在山东推广';
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: recognized,
    chunks: [{ text: recognized, timestamp: [0, 12] }],
  }, 12, 'test-model', 'zh', reference);
  const lines = normalized.segments.map((segment) => segment.text);

  assert.ok(lines.some((line) => /协作，$/u.test(line)));
  assert.ok(lines.some((line) => /目标。$/u.test(line)));
  assert.match(lines.join(''), /在广东开展业务试点[，、]/u);
  assert.ok(lines.every((line) => !/依托$/u.test(line)));

  const numericReference = '事件定界准确率90%，试点覆盖率达到95%，平均时长为8.6小时。';
  const numericAsr = '事件定界准确率90%试点覆盖率达到95%平均时长为8.6小时';
  const numeric = transcriptionModule.normalizeLocalAsrResult({
    text: numericAsr,
    chunks: [{ text: numericAsr, timestamp: [0, 8] }],
  }, 8, 'test-model', 'zh', numericReference);
  const numericText = numeric.segments.map((segment) => segment.text).join('');
  assert.match(numericText, /90%，试点/u);
  assert.match(numericText, /95%，平均/u);
  assert.match(numericText, /8\.6小时。$/u);
});

test('decimal values split across ASR chunks remain intact inside one subtitle cue', () => {
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: '试点范围内覆盖问题处理时长由8.6小时降至5小时以内',
    chunks: [
      { text: '试点范围内覆盖问题处理时长由8', timestamp: [0, 3.78] },
      { text: '.6小时降至5小时以内', timestamp: [3.78, 8.2] },
    ],
  }, 8.2, 'test-model', 'zh');

  const cues = normalized.segments;
  assert.equal(cues.map((segment) => segment.text).join(''), '试点范围内覆盖问题处理时长由8.6小时降至5小时以内');
  assert.ok(cues.some((segment) => segment.text.includes('8.6小时')));
  assert.ok(cues.every((segment) => segment.end - segment.start <= 5));

  const sentenceBoundary = transcriptionModule.normalizeLocalAsrResult({
    text: '产品。2倍',
    chunks: [
      { text: '产品。', timestamp: [0, 1] },
      { text: '2倍', timestamp: [1, 2] },
    ],
  }, 2, 'test-model', 'zh');
  assert.deepEqual(sentenceBoundary.segments.map((segment) => segment.text), ['产品。', '2倍']);
});

test('reference-guided correction fixes high-confidence substitutions and keeps ASR timestamps', () => {
  const reference = '今天我们使用本地语音识别模型，根据参考文档校正产品名称和常见错字，同时保留原始字幕时间戳，方便用户检查识别结果。';
  const recognized = '今天我们使用本地语音识别模型，根据参考文档校正产品名称和常见错子，同时保留原始字幕时间戳，放便用户检查识别结果。';
  const input = {
    text: recognized,
    chunks: [{ text: recognized, timestamp: [0.5, 8.5] }],
  };
  const original = transcriptionModule.normalizeLocalAsrResult(input, 10, 'test-model', 'zh');
  const corrected = transcriptionModule.normalizeLocalAsrResult(input, 10, 'test-model', 'zh', reference);

  assert.equal(corrected.segments.map((segment) => segment.text).join(''), reference);
  assert.deepEqual(corrected.segments.map(({ start, end }) => ({ start, end })), original.segments.map(({ start, end }) => ({ start, end })));
  assert.deepEqual(corrected.words.map(({ start, end }) => ({ start, end })), original.words.map(({ start, end }) => ({ start, end })));
  assert.equal(corrected.text, reference);
});

test('reference-guided correction fixes local technical terms and canonical casing', () => {
  const reference = '依托Agentic AI、大模型与大数据创新技术，进一步锚定网络和业务目标。';
  const recognized = '依托AgenTik AI大模型与大数据创新技术进一步锚定网络和业务目标。';
  const input = { text: recognized, chunks: [{ text: recognized, timestamp: [0, 8] }] };
  const original = transcriptionModule.normalizeLocalAsrResult(input, 8, 'test-model', 'zh');
  const corrected = transcriptionModule.normalizeLocalAsrResult(input, 8, 'test-model', 'zh', reference);
  const compact = (value) => value.replace(/[\s\p{P}]/gu, '');

  assert.equal(compact(corrected.segments.map((segment) => segment.text).join('')), compact(reference));
  assert.equal(corrected.segments[0].start, original.segments[0].start);
  assert.equal(corrected.segments.at(-1).end, original.segments.at(-1).end);

  const dataReference = '以数智手段深挖O域数据价值，构建360°用户视图支撑经营，持续提升业务体验。';
  const dataAsr = '以数字手段深挖欧域数据价值，构建360度用户视图支撑经营，持续提升业务体验。';
  const dataCorrected = transcriptionModule.normalizeLocalAsrResult({
    text: dataAsr,
    chunks: [{ text: dataAsr, timestamp: [0, 8] }],
  }, 8, 'test-model', 'zh', dataReference);
  assert.equal(compact(dataCorrected.segments.map((segment) => segment.text).join('')), compact(dataReference));

  const orderReference = '今年方案先在山东、广东、河南三省开展高阶自智试点，随后总结经验并提升业务体验。';
  const orderAsr = '今年方案先在广东、山东、河南三省开展高阶自智试点，随后总结经验并提升业务体验。';
  const orderCorrected = transcriptionModule.normalizeLocalAsrResult({
    text: orderAsr,
    chunks: [{ text: orderAsr, timestamp: [0, 8] }],
  }, 8, 'test-model', 'zh', orderReference);
  const orderText = compact(orderCorrected.segments.map((segment) => segment.text).join(''));
  assert.match(orderText, /今年方案先在广东山东河南三省/u);

  const distantOrderReference = '今年方案先在山东试点，经过两个月的测试，然后部署到广东，并持续优化业务体验。';
  const distantOrderAsr = '今年方案先在广东试点，经过两个月的测试，然后部署到山东，并持续优化业务体验。';
  const distantOrderCorrected = transcriptionModule.normalizeLocalAsrResult({
    text: distantOrderAsr,
    chunks: [{ text: distantOrderAsr, timestamp: [0, 8] }],
  }, 8, 'test-model', 'zh', distantOrderReference);
  const distantOrderText = compact(distantOrderCorrected.segments.map((segment) => segment.text).join(''));
  assert.match(distantOrderText, /今年方案先在广东试点.*然后部署到山东/u);
});

test('reference-guided correction fixes one extra letter in a unique Latin product term', () => {
  const reference = '2026年依托Agentic AI、大模型和大数据创新技术。';
  const recognized = '2026年依托Agenttic AI大模型和大数据创新技术。';
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: recognized,
    chunks: [{ text: recognized, timestamp: [0, 4] }],
  }, 4, 'test-model', 'zh', reference);

  assert.equal(normalized.segments.map((segment) => segment.text).join(''), '2026年依托Agentic AI、大模型和大数据创新技术。');
});

test('reference-guided correction leaves repeated Latin terms unchanged', () => {
  const transcript = 'Agenttic AI supports Agenttic AI plans and keeps the project on track.';
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: transcript,
    chunks: [{ text: transcript, timestamp: [0, 5] }],
  }, 5, 'test-model', 'en', 'Agentic AI supports Agentic AI plans and keeps the project on track.');

  assert.equal(normalized.text, transcript);
});

test('overlapping near-identical ASR segments are stitched while later repeated speech remains', () => {
  const clipped = '可实现应急事件识别分析时长小于3分';
  const complete = '可实现应急事件识别分析时长小于三分钟';
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: `${clipped} ${complete} ${complete}`,
    chunks: [
      { text: clipped, timestamp: [10, 14.34] },
      { text: complete, timestamp: [10.04, 14.62] },
      { text: complete, timestamp: [20, 24.58] },
    ],
  }, 30, 'test-model', 'zh');

  assert.deepEqual(normalized.segments.map((segment) => segment.text), [complete, complete]);
  assert.deepEqual(normalized.segments.map(({ start, end }) => ({ start, end })), [
    { start: 10, end: 14.62 },
    { start: 20, end: 24.58 },
  ]);
  assert.equal(normalized.text, `${complete} ${complete}`);

  const repeatedSpeech = transcriptionModule.normalizeLocalAsrResult({
    text: `${complete} ${complete}`,
    chunks: [
      { text: complete, timestamp: [10, 14.5] },
      { text: complete, timestamp: [11, 15.5] },
    ],
  }, 20, 'test-model', 'zh');
  assert.deepEqual(repeatedSpeech.segments.map((segment) => segment.text), [complete, complete]);
});

test('reference correction preserves ambiguous wording and never inserts omitted words', () => {
  const reference = '经过多轮评估，我们最终选择了蓝色方案并提交项目结果给审核小组。经过多轮评估，我们最终选择了绿色方案并提交项目结果给审核小组。';
  const ambiguous = '经过多轮评估，我们最终选择了红色方案并提交项目结果给审核小组。';
  const normalized = transcriptionModule.normalizeLocalAsrResult({
    text: ambiguous,
    chunks: [{ text: ambiguous, timestamp: [0, 6] }],
  }, 8, 'test-model', 'zh', reference);
  assert.equal(normalized.segments.map((segment) => segment.text).join(''), ambiguous);

  const omitted = '经过多轮评估，我们最终选择了蓝色方案并提交结果给审核小组。';
  const withoutInsertion = transcriptionModule.normalizeLocalAsrResult({
    text: omitted,
    chunks: [{ text: omitted, timestamp: [0, 6] }],
  }, 8, 'test-model', 'zh', '经过多轮评估，我们最终选择了蓝色方案并提交项目结果给审核小组。');
  assert.equal(withoutInsertion.segments.map((segment) => segment.text).join(''), omitted);
});

test('transcription quality gate rejects dominant repetition and abnormally long cues', () => {
  const repeated = '组织'.repeat(100);
  const result = {
    text: repeated,
    words: [],
    segments: [{ start: 0.92, end: 46.26, text: repeated }],
    model: 'test-model',
  };

  assert.throws(
    () => transcriptionModule.assertLocalTranscriptionQuality(result),
    { name: 'LocalTranscriptionQualityError', message: /大段重复文本或异常长字幕时间段/ },
  );
  assert.doesNotThrow(() => transcriptionModule.assertLocalTranscriptionQuality({
    text: '本地语音识别正在稳定运行。',
    words: [],
    segments: [{ start: 0, end: 2.4, text: '本地语音识别正在稳定运行。' }],
    model: 'test-model',
  }));
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
  let retryError;
  const result = await transcriptionModule.loadWithLocalModelCacheRecovery(
    modelDirectory,
    false,
    async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('fetch failed');
      assert.equal(existsSync(weightFile), true);
      return 'loaded';
    },
    (error) => { retryError = error; },
  );
  assert.equal(result, 'loaded');
  assert.match(retryError.message, /fetch failed/);
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
