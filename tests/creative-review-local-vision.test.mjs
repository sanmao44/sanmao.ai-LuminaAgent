import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: localVision } = await buildLibModules(['lib/creative-review/local-vision'], 'lib/creative-review/local-vision');

function frame() {
  return { dataUrl: `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 217]).toString('base64')}`, location: '整张图片' };
}

test('explicit mismatch fails, while incomplete visual coverage stays unknown', () => {
  const mismatch = localVision.interpretVisualAssessment({
    coverage: 'uncertain', summary: '主体颜色不符合要求。',
    checks: [{ dimension: '主体', requirement: '主体为红色', observation: '主体为蓝色', result: 'mismatch' }],
  });
  assert.equal(mismatch.status, 'fail');
  assert.match(mismatch.observed, /主体为蓝色/);
  assert.match(mismatch.criterion, /明确不符/);

  const incomplete = localVision.interpretVisualAssessment({
    coverage: 'uncertain', summary: '有一项无法从静帧确认。',
    checks: [{ dimension: '动作', requirement: '人物持续行走', observation: '静帧无法判断是否持续', result: 'uncertain' }],
  }, '人物持续行走');
  assert.equal(incomplete.status, 'unknown');
  assert.match(incomplete.reason, /静帧/);
});

test('check-list output without coverage metadata remains uncertain', () => {
  const assessment = localVision.parseAssessment(JSON.stringify([{
    dimension: '商品主体', requirement: '商品', observation: '画面中看到人物', result: 'match',
  }]));
  assert.equal(assessment.coverage, 'uncertain');
  assert.equal(localVision.interpretVisualAssessment(assessment, '展示一件商品。').status, 'unknown');
});

test('missing coverage metadata keeps valid indexed checks uncertain and preserves explicit mismatches', () => {
  const requirements = ['展示红色商品', '商品居中'];
  const incomplete = localVision.parseAssessment(JSON.stringify({
    summary: '两项均已观察。',
    checks: requirements.map((_, index) => ({
      index, dimension: '画面要求', observation: '画面中可见对应内容', result: 'match',
    })),
  }), requirements);
  assert.equal(incomplete.coverage, 'uncertain');
  assert.equal(localVision.interpretVisualAssessment(incomplete, '展示红色商品，商品居中。').status, 'unknown');

  const mismatch = localVision.parseAssessment(JSON.stringify({
    summary: '颜色与要求不符。',
    checks: [{ index: 0, dimension: '颜色', observation: '商品呈蓝色', result: 'mismatch' }],
  }), requirements);
  const evidence = localVision.interpretVisualAssessment(mismatch, '展示红色商品，商品居中。');
  assert.equal(evidence.status, 'fail');
  assert.match(evidence.observed, /商品呈蓝色/);
});

test('accepts only known unquoted enum values in code-fenced model output', () => {
  const requirements = ['展示红色商品', '商品居中'];
  const output = [
    '```json',
    '{',
    '  "coverage": complete,',
    '  "summary": "画面符合需求。",',
    '  "checks": [',
    '    { "index": 0, "dimension": "主体", "observation": "可见红色商品", "result": match },',
    '    { "index": 1, "dimension": "构图", "observation": "商品位于画面中央", "result": match }',
    '  ]',
    '}',
    '```',
  ].join('\n');
  const assessment = localVision.parseAssessment(output, requirements);
  assert.equal(assessment.coverage, 'complete');
  assert.equal(localVision.interpretVisualAssessment(assessment, '展示红色商品，商品居中。').status, 'pass');

  assert.equal(localVision.parseAssessment(output.replace('"result": match', '"result": other'), requirements), null);
});

test('indexed checks must be ordered, unique, and complete to pass the parser boundary', () => {
  const requirements = ['展示红色商品', '商品居中'];
  const makeCheck = (index) => ({ index, dimension: '画面要求', observation: '画面中可见对应内容', result: 'match' });

  const partial = localVision.parseAssessment(JSON.stringify({
    coverage: 'complete', summary: '全部符合。', checks: [makeCheck(0)],
  }), requirements);
  assert.ok(partial);
  assert.equal(localVision.interpretVisualAssessment(partial, '展示红色商品，商品居中。').status, 'unknown');

  for (const checks of [
    [makeCheck(0), makeCheck(0)],
    [makeCheck(1), makeCheck(0)],
    [makeCheck(0), makeCheck(2)],
    [{ ...makeCheck(0), index: undefined }, makeCheck(1)],
  ]) {
    const assessment = localVision.parseAssessment(JSON.stringify({
      coverage: 'complete', summary: '全部符合。', checks,
    }), requirements);
    assert.equal(assessment, null);
  }
});

test('recovers the single-object array wrapper emitted by the local model', () => {
  const result = [{
    coverage: 'complete',
    summary: '画面符合需求。',
    checks: [{ dimension: '主体', requirement: '展示红色商品', observation: '可见红色商品', result: 'match' }],
  }];
  const assessment = localVision.parseAssessment(JSON.stringify(result));
  assert.equal(assessment.coverage, 'complete');
  assert.equal(localVision.interpretVisualAssessment(assessment, '展示红色商品').status, 'pass');
});

test('unanchored model requirements cannot produce a passing decision', () => {
  const evidence = localVision.interpretVisualAssessment({
    coverage: 'complete', summary: '全部符合。',
    checks: [{ dimension: '维度', requirement: '明确要求', observation: '出现四位仙侠人物', result: 'match' }],
  }, '展示一张商品图片，主体清晰可见。');
  assert.equal(evidence.status, 'unknown');
  assert.match(evidence.reason, /没有逐字出现在原始 brief/);
});

test('local reviewer parses bounded structured evidence and records real model usage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'creative-review-model-'));
  const previousPath = process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({ model_type: 'qwen3_5' }));
  process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = directory;
  try {
    const expected = JSON.stringify([{
      coverage: 'complete',
      summary: '图中主体与指定红色商品一致。',
      checks: [{ index: 0, dimension: '主体', observation: '可见红色商品', result: 'match' }],
    }]);
    const calls = [];
    const processor = async (text, images) => {
      calls.push({ text, images });
      return { input_ids: { dims: [1, 2] } };
    };
    processor.apply_chat_template = (messages) => JSON.stringify(messages);
    processor.decode = (tokens) => {
      assert.deepEqual(tokens, [303]);
      return expected;
    };
    const reviewer = localVision.createLocalCreativeVisualReviewer({
      loadRuntime: async (modelDirectory) => {
        assert.equal(modelDirectory, directory);
        return {
          processor,
          model: { generate: async (input) => {
            assert.equal(input.max_new_tokens, 192);
            assert.equal(typeof input.stopping_criteria?.[0], 'function');
            assert.deepEqual(input.stopping_criteria[0]([[]]), [false]);
            assert.equal(input.do_sample, false);
            return { tolist: () => [[101, 102, 303]] };
          } },
          readImage: async (blob) => {
            assert.ok(blob instanceof Blob);
            return { size: blob.size };
          },
        };
      },
    });
    const evidence = await reviewer({ mediaKind: 'image', brief: '展示红色商品', frames: [frame()] });
    assert.equal(evidence.status, 'pass');
    assert.match(evidence.expected, /红色商品/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /展示红色商品/);
    assert.match(calls[0].text, /禁止顶层数组/);
    assert.match(calls[0].text, /index 从 0 开始/);
    assert.doesNotMatch(calls[0].text, /brief 连续原文/);
    assert.equal(calls[0].images.length, 1);
    assert.deepEqual(reviewer.getUsage(), { modelCalls: 1, inputTokens: 2, outputTokens: 1, inferenceMs: reviewer.getUsage().inferenceMs });
    assert.equal((await reviewer.getModelIdentity())?.id, 'qwen3.5-0.8b-onnx-q4');
  } finally {
    if (previousPath === undefined) delete process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
    else process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('near-uniform decoded frames abstain before the visual model can hallucinate a pass', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'creative-review-flat-image-'));
  const previousPath = process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
  process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = directory;
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({ model_type: 'qwen3_5' }));
  let generateCalls = 0;
  try {
    const processor = async () => ({ input_ids: { dims: [1, 2] } });
    processor.apply_chat_template = () => 'prompt';
    processor.decode = () => '';
    const reviewer = localVision.createLocalCreativeVisualReviewer({
      loadRuntime: async () => ({
        processor,
        model: { generate: async () => {
          generateCalls += 1;
          return { tolist: () => [[101, 102, 303]] };
        } },
        readImage: async () => ({ width: 2, height: 2, channels: 3, data: new Uint8Array([
          255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0,
        ]) }),
      }),
    });
    const evidence = await reviewer({ mediaKind: 'image', brief: '展示一件红色商品', frames: [frame()] });
    assert.equal(evidence.status, 'unknown');
    assert.equal(evidence.source, 'rule');
    assert.match(evidence.observed, /0\.000/);
    assert.match(evidence.reason, /不接受其语义判定/);
    assert.equal(generateCalls, 0);
    assert.equal(reviewer.getUsage().modelCalls, 0);
  } finally {
    if (previousPath === undefined) delete process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
    else process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing local model abstains without attempting a download', async () => {
  const previousPath = process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
  process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = path.join(os.tmpdir(), `missing-review-model-${process.pid}`);
  let loadCalls = 0;
  try {
    const reviewer = localVision.createLocalCreativeVisualReviewer({ loadRuntime: async () => { loadCalls += 1; throw new Error('unexpected load'); } });
    const evidence = await reviewer({ mediaKind: 'video', brief: '展示城市夜景', frames: [frame()] });
    assert.equal(evidence.status, 'unknown');
    assert.match(evidence.reason, /不会下载模型/);
    assert.equal(loadCalls, 0);
    assert.equal(await reviewer.getModelIdentity(), null);
  } finally {
    if (previousPath === undefined) delete process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
    else process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = previousPath;
  }
});

test('returns unknown at the deadline and retains queued calls until uncancellable inference settles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'creative-review-timeout-'));
  const previousPath = process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
  process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = directory;
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({ model_type: 'qwen3_5' }));
  let generateCalls = 0;
  let stopGeneration;
  try {
    const processor = async () => ({ input_ids: { dims: [1, 2] } });
    processor.apply_chat_template = () => 'prompt';
    processor.decode = () => '';
    const reviewer = localVision.createLocalCreativeVisualReviewer({
      deadlineMs: 20,
      loadRuntime: async () => ({
        processor,
        model: { generate: async (input) => {
          generateCalls += 1;
          stopGeneration = input.stopping_criteria[0];
          return await new Promise(() => {});
        } },
        readImage: async () => ({ image: true }),
      }),
    });
    const startedAt = Date.now();
    const first = await reviewer({ mediaKind: 'image', brief: '展示一件商品', frames: [frame()] });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(first.status, 'unknown');
    assert.match(first.reason, /deadline/);
    assert.deepEqual(stopGeneration([[]]), [true], 'deadline must signal the generation stopping criterion');
    assert.ok(elapsedMs < 500, 'deadline should return promptly, took ' + elapsedMs + 'ms');
    const second = await reviewer({ mediaKind: 'image', brief: '展示另一件商品', frames: [frame()] });
    assert.equal(second.status, 'unknown');
    assert.match(second.reason, /deadline/);
    assert.equal(generateCalls, 1, 'an expired queued request must not start inference');
  } finally {
    if (previousPath === undefined) delete process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
    else process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('serializes concurrent image reviews instead of dropping the later output', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'creative-review-queue-'));
  const previousPath = process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
  process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = directory;
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({ model_type: 'qwen3_5' }));
  let generateCalls = 0;
  let activeGenerations = 0;
  let peakGenerations = 0;
  let resolveFirst;
  let notifyFirst;
  const firstStarted = new Promise((resolve) => { notifyFirst = resolve; });
  try {
    const processor = async () => ({ input_ids: { dims: [1, 2] } });
    processor.apply_chat_template = () => 'prompt';
    processor.decode = (tokens) => JSON.stringify({
      coverage: 'complete', summary: '画面符合对应要求。', checks: [{
        index: 0,
        dimension: '主体',
        requirement: tokens[0] === 303 ? '展示第一件商品' : '展示第二件商品',
        observation: '画面中可见商品', result: 'match',
      }],
    });
    const reviewer = localVision.createLocalCreativeVisualReviewer({
      loadRuntime: async () => ({
        processor,
        model: { generate: async () => {
          generateCalls += 1;
          activeGenerations += 1;
          peakGenerations = Math.max(peakGenerations, activeGenerations);
          if (generateCalls === 1) {
            notifyFirst();
            await new Promise((resolve) => { resolveFirst = resolve; });
          }
          activeGenerations -= 1;
          return { tolist: () => [[101, 102, generateCalls === 1 ? 303 : 304]] };
        } },
        readImage: async () => ({ image: true }),
      }),
    });
    const first = reviewer({ mediaKind: 'image', brief: '展示第一件商品', frames: [frame()] });
    const second = reviewer({ mediaKind: 'image', brief: '展示第二件商品', frames: [frame()] });
    await firstStarted;
    assert.equal(generateCalls, 1, 'the second request waits for the single CPU model slot');
    resolveFirst();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map((result) => result.status), ['pass', 'pass']);
    assert.equal(generateCalls, 2);
    assert.equal(peakGenerations, 1);
  } finally {
    if (previousPath === undefined) delete process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
    else process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('requires each original brief clause exactly once before passing', () => {
  const brief = '商品居中，背景为白色，并展示红色包装';
  const requirements = localVision.extractBriefRequirements(brief);
  assert.deepEqual(requirements, ['商品居中', '背景为白色', '并展示红色包装']);
  const base = { coverage: 'complete', summary: '画面符合需求。' };
  const incomplete = localVision.interpretVisualAssessment({ ...base, checks: [
    { dimension: '主体', requirement: requirements[0], observation: '商品居中', result: 'match' },
    { dimension: '背景', requirement: requirements[1], observation: '背景为白色', result: 'match' },
  ] }, brief);
  assert.equal(incomplete.status, 'unknown');
  assert.match(incomplete.reason, /没有按原文顺序恰好核对全部 3 项/);
  const duplicate = localVision.interpretVisualAssessment({ ...base, checks: [
    { dimension: '主体', requirement: requirements[0], observation: '商品居中', result: 'match' },
    { dimension: '背景', requirement: requirements[0], observation: '背景为白色', result: 'match' },
    { dimension: '包装', requirement: requirements[2], observation: '红色包装', result: 'match' },
  ] }, brief);
  assert.equal(duplicate.status, 'unknown');
  const complete = localVision.interpretVisualAssessment({ ...base, checks: requirements.map((requirement) => ({
    dimension: '视觉要求', requirement, observation: '画面观察可核对', result: 'match',
  })) }, brief);
  assert.equal(complete.status, 'pass');
});

test('a generate call that returns after its deadline cannot produce a pass', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'creative-review-blocked-deadline-'));
  const previousPath = process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
  process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = directory;
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({ model_type: 'qwen3_5' }));
  try {
    const processor = async () => ({ input_ids: { dims: [1, 2] } });
    processor.apply_chat_template = () => 'prompt';
    processor.decode = () => JSON.stringify({ coverage: 'complete', summary: '符合', checks: [
      { dimension: '画面', requirement: '展示一件商品', observation: '可见商品', result: 'match' },
    ] });
    const reviewer = localVision.createLocalCreativeVisualReviewer({
      deadlineMs: 10,
      loadRuntime: async () => ({
        processor,
        model: { generate: async () => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
          return { tolist: () => [[101, 102, 303]] };
        } },
        readImage: async () => ({ image: true }),
      }),
    });
    const evidence = await reviewer({ mediaKind: 'image', brief: '展示一件商品', frames: [frame()] });
    assert.equal(evidence.status, 'unknown');
    assert.match(evidence.reason, /deadline/);
  } finally {
    if (previousPath === undefined) delete process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
    else process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('caller cancellation returns unknown promptly and keeps the queued single-flight slot until inference settles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'creative-review-cancel-'));
  const previousPath = process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
  process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = directory;
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({ model_type: 'qwen3_5' }));
  let notifyGenerate;
  let resolveGeneration;
  let stopGeneration;
  let generateCalls = 0;
  const generationStarted = new Promise((resolve) => { notifyGenerate = resolve; });
  try {
    const processor = async () => ({ input_ids: { dims: [1, 2] } });
    processor.apply_chat_template = () => 'prompt';
    processor.decode = () => '';
    const reviewer = localVision.createLocalCreativeVisualReviewer({
      deadlineMs: 500,
      loadRuntime: async () => ({
        processor,
        model: { generate: async (input) => {
          stopGeneration = input.stopping_criteria[0];
          generateCalls += 1;
          if (generateCalls === 1) {
            notifyGenerate();
            return await new Promise((resolve) => { resolveGeneration = resolve; });
          }
          return { tolist: () => [[101, 102, 303]] };
        } },
        readImage: async () => ({ image: true }),
      }),
    });
    const controller = new AbortController();
    const pending = reviewer({ mediaKind: 'image', brief: '展示一件商品', frames: [frame()], signal: controller.signal });
    await generationStarted;
    controller.abort();
    const cancelled = await pending;
    assert.equal(cancelled.status, 'unknown');
    assert.match(cancelled.reason, /已取消/);
    assert.deepEqual(stopGeneration([[]]), [true], 'caller cancellation must signal the generation stopping criterion');

    const queuedController = new AbortController();
    const whileBusy = reviewer({ mediaKind: 'image', brief: '展示另一件商品', frames: [frame()], signal: queuedController.signal });
    queuedController.abort();
    const queuedResult = await whileBusy;
    assert.equal(queuedResult.status, 'unknown');
    assert.match(queuedResult.reason, /排队期间评审已取消/);
    resolveGeneration({ tolist: () => [[101, 102, 303]] });
    await new Promise((resolve) => setImmediate(resolve));

    await reviewer({ mediaKind: 'image', brief: '展示第三件商品', frames: [frame()] });
    assert.equal(generateCalls, 2, 'a new call may start after the cancelled inference settles');
  } finally {
    if (previousPath === undefined) delete process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR;
    else process.env.SANMAO_CREATIVE_REVIEW_MODEL_DIR = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
