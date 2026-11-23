import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DOCUMENT_URL,
  PREVIEW_ROOT,
  importCangyuanMiniMaxVoices,
  parseCangyuanMiniMaxVoiceDocument,
  verifyCangyuanMiniMaxVoicePreviews,
} from '../scripts/import-cangyuan-minimax-voices.mjs';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/cangyuan-minimax-voices');
const id = (number) => `voice_builtin_${number.toString(16).padStart(64, '0')}`;
const documentFor = (rows, language = '普通话') => `# MiniMax\n\n### ${language}\n\n\`\`\`voices\n${rows.map(([name, voiceId]) => `${name}\t${voiceId}`).join('\n')}\n\`\`\`\n`;

test('Cangyuan MiniMax directory preserves 327 exact provider IDs and official sample mappings', () => {
  const voices = contracts.CANGYUAN_MINIMAX_VOICES;
  assert.equal(contracts.CANGYUAN_MINIMAX_VOICE_COUNT, 327);
  assert.equal(new Set(voices.map((voice) => voice.voiceId)).size, 327);
  assert.equal(new Set(voices.map((voice) => voice.language)).size, 24);
  assert.deepEqual(voices.map((voice) => voice.number), Array.from({ length: 327 }, (_, index) => index + 1));
  for (const voice of voices) {
    assert.match(voice.voiceId, /^voice_builtin_[a-f0-9]{64}$/u);
    assert.equal(voice.previewUrl, `${PREVIEW_ROOT}${voice.voiceId}.mp3`);
    assert.equal(contracts.findCangyuanMiniMaxVoice(voice.voiceId), voice);
    assert.equal(Object.isFrozen(voice), true);
  }
  assert.equal(Object.isFrozen(voices), true);
  assert.equal(voices[0].name, '青涩青年音色-beta');
  assert.equal(voices[0].languageLabel, '中文（普通话）');
  assert.equal(voices.find((voice) => voice.language === '粤语').languageLabel, '中文（粤语）');
  assert.equal(contracts.findCangyuanMiniMaxVoice('male-qn-qingse'), undefined);
  assert.equal(contracts.findCangyuanMiniMaxVoice('unknown'), undefined);
  assert.equal(contracts.CANGYUAN_MINIMAX_VOICE_DOCUMENT_SOURCE, DOCUMENT_URL);
});

test('voice document parsing preserves exact values and rejects partial or duplicate data', () => {
  const markdown = `${documentFor([['示例音色', id(1)]])}\n${documentFor([['Gentle-voiced man', id(2)]], '英语')}`;
  const voices = parseCangyuanMiniMaxVoiceDocument(markdown.replace(/\n/gu, '\r\n'));
  assert.equal(voices[1].name, 'Gentle-voiced man');
  assert.equal(voices[1].languageLabel, '英语');
  assert.equal(voices[1].number, 2);
  assert.throws(() => parseCangyuanMiniMaxVoiceDocument(documentFor([['重复一', id(1)], ['重复二', id(1)]])), /重复/u);
  assert.throws(() => parseCangyuanMiniMaxVoiceDocument(documentFor([['无效编号', 'male-qn-qingse']])), /格式/u);
  assert.throws(() => parseCangyuanMiniMaxVoiceDocument(`\`\`\`voices\n示例\t${id(1)}\n\`\`\``), /分类/u);
  assert.throws(() => parseCangyuanMiniMaxVoiceDocument(`### 普通话\n\`\`\`voices\n示例\t${id(1)}`), /未结束/u);
  assert.throws(() => parseCangyuanMiniMaxVoiceDocument('# 空白文档'), /没有有效/u);
});

test('preview verification uses bounded unauthenticated HEAD requests only', async () => {
  const voices = parseCangyuanMiniMaxVoiceDocument(documentFor(Array.from({ length: 17 }, (_, index) => [`音色${index}`, id(index + 1)])));
  let active = 0;
  let maximum = 0;
  const calls = [];
  const count = await verifyCangyuanMiniMaxVoicePreviews(voices, {
    concurrency: 6,
    request: async (url, options) => {
      calls.push({ url, options });
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    },
  });
  assert.equal(count, 17);
  assert.equal(calls.length, 17);
  assert.equal(maximum, 6);
  for (const { url, options } of calls) {
    assert.equal(options.method, 'HEAD');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers, undefined);
    assert.equal(options.body, undefined);
    assert.ok(url.startsWith(PREVIEW_ROOT));
  }
});

test('preview verification rejects missing, non-audio, and mismatched official samples', async () => {
  const voices = parseCangyuanMiniMaxVoiceDocument(documentFor([['示例', id(1)]]));
  await assert.rejects(verifyCangyuanMiniMaxVoicePreviews(voices, { request: async () => new Response(null, { status: 404 }) }), /不可用/u);
  await assert.rejects(verifyCangyuanMiniMaxVoicePreviews(voices, { request: async () => new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }) }), /不可用/u);
  await assert.rejects(verifyCangyuanMiniMaxVoicePreviews([{ ...voices[0], previewUrl: 'https://example.com/sample.mp3' }]), /不匹配/u);
  await assert.rejects(verifyCangyuanMiniMaxVoicePreviews(voices, { concurrency: 9 }), /并发数/u);
});

test('import verifies every sample before replacing the directory and preserves prior output on failure', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-cangyuan-voices-'));
  const destination = path.join(directory, 'voices.json');
  const markdown = documentFor(Array.from({ length: 327 }, (_, index) => [`音色${index + 1}`, id(index + 1)]));
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, method: options.method });
    return options.method === 'GET'
      ? new Response(markdown, { status: 200 })
      : new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  };
  try {
    await writeFile(destination, 'preserved', 'utf8');
    await assert.rejects(importCangyuanMiniMaxVoices({ destination, request: async (_url, options) => options.method === 'GET' ? new Response(markdown) : new Response(null, { status: 404 }) }), /不可用/u);
    assert.equal(await readFile(destination, 'utf8'), 'preserved');
    const imported = await importCangyuanMiniMaxVoices({ destination, request });
    assert.equal(imported.length, 327);
    assert.equal(JSON.parse(await readFile(destination, 'utf8')).length, 327);
    assert.deepEqual(calls[0], { url: DOCUMENT_URL, method: 'GET' });
    assert.equal(calls.filter((call) => call.method === 'HEAD').length, 327);
    assert.equal(calls.some((call) => call.method === 'POST'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
