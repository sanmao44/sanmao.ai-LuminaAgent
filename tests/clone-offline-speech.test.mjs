import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/clone/offline-speech.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
// 这个模块只用 node: 内置模块（data: URL 解析不了相对路径），类型导入会被 tsc 擦掉。
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const offline = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const ON_WINDOWS = process.platform === 'win32';

test('本机离线配音按平台开关，非 Windows 直接拒绝', async () => {
  assert.equal(offline.offlineSpeechSupported(), ON_WINDOWS);
  assert.equal(offline.OFFLINE_SPEECH_LABEL, '本机离线配音');
  if (!ON_WINDOWS) await assert.rejects(() => offline.synthesizeOfflineSpeech('你好'), /只支持 Windows/);
});

test('空文本不会去启动系统语音合成', async () => {
  await assert.rejects(() => offline.synthesizeOfflineSpeech('   '), /配音文本为空/);
  await assert.rejects(() => offline.synthesizeOfflineSpeech(undefined), /配音文本为空/);
});

test('Windows 上真的合成出能探测时长的 wav', { skip: !ON_WINDOWS }, async () => {
  const audio = await offline.synthesizeOfflineSpeech('今天带你看一家超好吃的火锅店，毛肚和锅底必点。');
  assert.equal(audio.contentType, 'audio/wav');
  assert.equal(audio.buffer.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(audio.buffer.subarray(8, 12).toString('latin1'), 'WAVE');
  assert.ok(audio.buffer.length > 10_000, 'wav 太小：' + audio.buffer.length);
});

test('填了系统里没有的 OpenAI 风格音色名时不报错，自动退回中文音色', { skip: !ON_WINDOWS }, async () => {
  const audio = await offline.synthesizeOfflineSpeech('回退测试', { voice: 'alloy' });
  assert.equal(audio.contentType, 'audio/wav');
  assert.ok(audio.buffer.length > 1_000);
});
