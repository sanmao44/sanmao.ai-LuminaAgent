import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/clone/speech.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
// speech.ts 顶层 import 会连带拉起 providers/store（依赖 next 运行时），单测里换成等价的桩。
const bundled = [
  source.replace(/^import .*;\r?\n/gm, ''),
  "function authHeaders() { return { Authorization: 'Bearer test' }; }",
  'function runtimeBaseUrl(provider) { return provider.baseUrl; }',
].join('\n');
const compiled = ts.transpileModule(bundled, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const speech = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(16)]);
const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33]), Buffer.alloc(32, 1)]);

function runtime(baseUrl = 'https://ai.gitee.com/v1') {
  return { model: { rawId: 'GLM-TTS' }, provider: { baseUrl } };
}

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    return await handler(calls.length, calls[calls.length - 1]);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function audioResponse(buffer, contentType) {
  return { ok: true, status: 200, headers: new Headers(contentType ? { 'content-type': contentType } : {}), arrayBuffer: async () => buffer };
}

test('配音地址兼容带与不带 /v1 的服务商地址', () => {
  assert.equal(speech.speechEndpoint({ baseUrl: 'https://ai.gitee.com/v1' }), 'https://ai.gitee.com/v1/audio/speech');
  assert.equal(speech.speechEndpoint({ baseUrl: 'https://api.example.com' }), 'https://api.example.com/v1/audio/speech');
});

test('留空音色时不发送 voice，避免 Gitee 这类没有该参数的服务商直接 400', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    await speech.synthesizeSpeech(runtime(), { text: '这是一句配音' });
    assert.equal(stub.calls.length, 1);
    assert.equal('voice' in stub.calls[0].body, false);
    assert.equal(stub.calls[0].body.model, 'GLM-TTS');
    assert.equal(stub.calls[0].body.input, '这是一句配音');
  } finally { stub.restore(); }
});

test('带了 voice 被服务商 400 拒绝时，去掉 voice 自动重试一次', async () => {
  const stub = stubFetch((count) => (count === 1
    ? { ok: false, status: 400, text: async () => 'unknown argument voice', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }
    : audioResponse(wav, 'audio/wav')));
  try {
    const result = await speech.synthesizeSpeech(runtime(), { text: '再来一句', voice: 'alloy' });
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0].body.voice, 'alloy');
    assert.equal('voice' in stub.calls[1].body, false);
    assert.equal(result.contentType, 'audio/wav');
    assert.equal(result.buffer.length, wav.length);
  } finally { stub.restore(); }
});

test('按响应头与文件头判断真实音频容器', () => {
  assert.equal(speech.speechContentType(wav, 'audio/wav'), 'audio/wav');
  assert.equal(speech.speechContentType(wav, 'audio/x-wav'), 'audio/wav');
  assert.equal(speech.speechContentType(wav, 'application/octet-stream'), 'audio/wav');
  assert.equal(speech.speechContentType(mp3, 'application/octet-stream'), 'audio/mpeg');
  assert.equal(speech.audioExtension('audio/wav'), 'wav');
  assert.equal(speech.audioExtension('audio/mpeg'), 'mp3');
});

test('服务商用 200 回 JSON 报错时不能当音频存盘', async () => {
  const stub = stubFetch(() => audioResponse(Buffer.from('{"error":"quota exceeded"}'), 'application/json'));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '你好' }), /没有返回音频|配音接口/);
  } finally { stub.restore(); }
});

test('接口失败时抛出带状态码与详情的中文错误', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 429, text: async () => 'Today the free API access limit exceeded.', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '你好' }), /HTTP 429/);
  } finally { stub.restore(); }
});

test('服务商要求 voice 必填时自动补默认音色重试，不会无限重试', async () => {
  const required = { ok: false, status: 400, text: async () => '{"error":{"message":"voice is required","param":"voice"}}', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
  const stub = stubFetch((count) => (count === 1 ? required : audioResponse(mp3, 'audio/mpeg')));
  try {
    const result = await speech.synthesizeSpeech(runtime(), { text: '你好' });
    assert.equal(stub.calls.length, 2);
    assert.equal('voice' in stub.calls[0].body, false);
    assert.equal(stub.calls[1].body.voice, speech.DEFAULT_SPEECH_VOICE);
    assert.equal(result.contentType, 'audio/mpeg');
  } finally { stub.restore(); }
});

test('与 voice 无关的 400 最多只重试一次', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 400, text: async () => 'model not found', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '你好', voice: 'alloy' }), /HTTP 400/);
    assert.equal(stub.calls.length, 2);
  } finally { stub.restore(); }
});
