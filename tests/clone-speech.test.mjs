import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const projectRoot = process.cwd();
let runtimeCandidates = [];
const load = createTsRequire(projectRoot, {
  [path.resolve(projectRoot, 'lib/providers')]: {
    authHeaders: () => ({ Authorization: 'Bearer test' }),
    runtimeBaseUrl: (provider) => provider.baseUrl,
  },
  [path.resolve(projectRoot, 'lib/store')]: {
    getRuntimeModelCandidates: async (modelId, kind) => {
      assert.equal(kind, 'audio');
      return modelId && modelId !== 'auto'
        ? runtimeCandidates.filter((runtime) => runtime.model.id === modelId)
        : runtimeCandidates;
    },
  },
});
const speech = load('./lib/clone/speech');

const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(16)]);
const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33]), Buffer.alloc(32, 1)]);

function runtime(baseUrl = 'https://ai.gitee.com/v1') {
  return { model: { rawId: 'GLM-TTS' }, provider: { baseUrl } };
}

function cangyuanRuntime(rawId = 'gemini-tts') {
  return { model: { rawId }, provider: { platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1' } };
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

test('自动配音选择跳过排在前面的纯音乐模型', async () => {
  const musicRuntime = { model: { id: 'music-model', capabilities: ['music-generate'] }, provider: {} };
  const speechRuntime = { model: { id: 'speech-model', capabilities: ['speech'] }, provider: {} };
  runtimeCandidates = [musicRuntime, speechRuntime];
  assert.equal(await speech.resolveSpeechRuntime(), speechRuntime);
});

test('显式选择音乐模型时配音应用返回明确的不支持错误', async () => {
  runtimeCandidates = [{ model: { id: 'music-model', capabilities: ['music-generate'] }, provider: {} }];
  const compositionLoad = createTsRequire(projectRoot, {
    [path.resolve(projectRoot, 'lib/clone/speech')]: {
      resolveSpeechRuntime: speech.resolveSpeechRuntime,
      synthesizeSpeech: async () => { throw new Error('音乐模型不应调用 TTS'); },
      audioExtension: () => 'mp3',
    },
    [path.resolve(projectRoot, 'lib/clone/offline-speech')]: {
      offlineSpeechSupported: () => false,
      synthesizeOfflineSpeech: async () => { throw new Error('不应回退到离线配音'); },
    },
    [path.resolve(projectRoot, 'lib/audio-storage')]: {
      persistAudioBuffer: async () => ({ url: '/api/storage/audio/test.mp3' }),
    },
  });
  const composition = compositionLoad('./apps/api/audio-synthesis-composition');
  await assert.rejects(
    composition.synthesizeCanvasNarration({ text: '一段旁白', modelId: 'music-model' }),
    /所选配音模型当前不可用或不支持配音/,
  );
});

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

test('沧元 Gemini TTS 按型号发送可选音色、格式和速度', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    await speech.synthesizeSpeech(cangyuanRuntime('gemini-tts'), {
      text: '沧元合成测试', voice: 'Ursa', format: 'flac', speed: 1.25,
    });
    assert.equal(stub.calls.length, 1);
    assert.deepEqual(stub.calls[0].body, {
      model: 'gemini-tts', input: '沧元合成测试', voice: 'Ursa', response_format: 'flac', speed: 1.25,
    });
    assert.equal(stub.calls[0].url, 'https://direct-api.cangyuansuanli.cn/v1/audio/speech');
  } finally { stub.restore(); }
});

test('沧元 Muse TTS 发送型号支持的字段并保留文档默认格式行为', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    await speech.synthesizeSpeech(cangyuanRuntime('mu1-muse-tts'), {
      text: '沧元 Muse 合成', voice: 'fable', format: 'opus',
    });
    assert.deepEqual(stub.calls[0].body, {
      model: 'mu1-muse-tts', input: '沧元 Muse 合成', voice: 'fable', response_format: 'opus',
    });
    await speech.synthesizeSpeech(cangyuanRuntime('mu1-muse-tts'), { text: '使用默认音色和格式' });
    assert.deepEqual(stub.calls[1].body, { model: 'mu1-muse-tts', input: '使用默认音色和格式' });
  } finally { stub.restore(); }
});

test('沧元 TTS accepts recommended-as-guidance voice values but rejects undocumented model options', async () => {
  const stub = stubFetch(() => audioResponse(Buffer.from([1, 2, 3]), 'application/octet-stream'));
  try {
    const result = await speech.synthesizeSpeech(cangyuanRuntime('mu1-muse-tts'), {
      text: '自定义音色', voice: 'my-provider-voice', format: 'pcm',
    });
    assert.deepEqual(stub.calls[0].body, {
      model: 'mu1-muse-tts', input: '自定义音色', voice: 'my-provider-voice', response_format: 'pcm',
    });
    assert.equal(result.contentType, 'audio/pcm');
    assert.equal(speech.audioExtension(result.contentType), 'pcm');
    await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('mu1-muse-tts'), {
      text: '不支持速度', speed: 1,
    }), /不支持速度参数/);
    await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('gemini-tts'), {
      text: '速度越界', speed: 4.1,
    }), /速度必须在 0.25–4 之间/);
    await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('mu1-muse-tts'), {
      text: '不支持格式', format: 'aac',
    }), /不支持 aac 格式/);
    await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('undocumented-tts'), {
      text: '型号未核实',
    }), /模型尚未接入/);
    assert.equal(stub.calls.length, 1);
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
  assert.equal(speech.audioExtension('audio/webm'), 'webm');
  assert.equal(speech.audioExtension('audio/pcm'), 'pcm');
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
