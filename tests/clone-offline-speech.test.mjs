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
const ON_MAC = process.platform === 'darwin';

test('本机离线配音按平台开关，Windows / macOS 之外直接拒绝', async () => {
  // Windows 走 System.Speech、macOS 走 say + afconvert，两条路都不装依赖、不花钱。
  assert.equal(offline.offlineSpeechSupported(), ON_WINDOWS || ON_MAC);
  assert.equal(offline.OFFLINE_SPEECH_LABEL, '本机离线配音');
  if (!ON_WINDOWS && !ON_MAC) await assert.rejects(() => offline.synthesizeOfflineSpeech('你好'), /只支持 Windows 与 macOS/);
});

test('两个平台的合成命令都按各自系统的坑写死', () => {
  // Windows：中文写进 .ps1 会因代码页变乱码，必须写文本文件；选不上指定音色要退回中文音色。
  assert.match(source, /SelectVoice\(\$Voice\)/);
  assert.match(source, /Culture\.Name -like 'zh\*'/);
  assert.match(source, /\[Console\]::Error\.WriteLine\('VOICE:' \+ \$chosen\)/);
  assert.match(source, /\[Text\.Encoding\]::UTF8/);
  // macOS：say 只写 AIFF，而 Chromium 播不了 AIFF → 用系统自带的 afconvert 转 WAV。
  assert.match(source, /'say'/);
  assert.match(source, /--data-format=LEI16@22050/);
  assert.match(source, /'afconvert', \['-f', 'WAVE', '-d', 'LEI16@22050'/);
  assert.match(source, /contentType: 'audio\/wav'/);
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
  // 关键：不能静默留在英文默认音色上，否则中文等于没念。要报出实际用的中文音色。
  assert.match(String(audio.voice || ''), /Huihui|Kangkang|Yaoyao|Chinese|Tingting|Meijia/i);
});
