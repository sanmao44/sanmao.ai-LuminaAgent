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
  return { model: { rawId: 'GLM-TTS' }, provider: { type: 'openai-compatible', baseUrl } };
}

function cangyuanRuntime(rawId = 'gemini-tts') {
  return { model: { rawId }, provider: { type: 'openai-compatible', platform: 'cangyuan', baseUrl: 'https://ai.cangyuansuanli.cn/v1' } };
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

test('Cangyuan MiniMax 2.8 TTS uses the documented public API host', () => {
  const provider = cangyuanRuntime().provider;
  assert.equal(speech.speechEndpoint(provider, 'minimax-speech-2.8-hd-tts'), 'https://direct-api.cangyuansuanli.cn/v1/audio/speech');
  assert.equal(speech.speechEndpoint(provider, 'minimax-speech-2.8-turbo-tts'), 'https://direct-api.cangyuansuanli.cn/v1/audio/speech');
  assert.equal(speech.speechEndpoint(provider, 'gemini-tts'), 'https://ai.cangyuansuanli.cn/v1/audio/speech');
  assert.equal(speech.speechEndpoint({ baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', platform: 'cangyuan' }, 'minimax-speech-2.8-hd-tts'), 'https://direct-api.cangyuansuanli.cn/v1/audio/speech');
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

test('Cangyuan model identifiers do not leak Cangyuan-only settings to another compatible provider', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    await assert.rejects(() => speech.synthesizeSpeech({
      ...cangyuanRuntime('gemini-tts'),
      provider: { type: 'openai-compatible', platform: 'custom', baseUrl: 'https://api.example.test/v1' },
    }, { text: '跨服务商合成测试', voice: 'Ursa', format: 'flac' }), /仅支持 MP3 或 WAV/);
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('model-specific speech fields are forwarded only when documented', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    await speech.synthesizeSpeech(cangyuanRuntime('mu1-muse-tts'), {
      text: 'Muse 合成', voice: 'fable', format: 'opus',
    });
    assert.deepEqual(stub.calls[0].body, {
      model: 'mu1-muse-tts', input: 'Muse 合成', voice: 'fable', response_format: 'opus',
    });
    await speech.synthesizeSpeech(cangyuanRuntime('mu1-muse-tts'), { text: '使用默认音色和格式' });
    assert.deepEqual(stub.calls[1].body, { model: 'mu1-muse-tts', input: '使用默认音色和格式' });
  } finally { stub.restore(); }
});

test('registered ElevenLabs voice ids take precedence over preset voices in the provider request', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    await speech.synthesizeSpeech(cangyuanRuntime('elevenlabs-v4-tts'), {
      text: '使用自备音色', voice: 'Rachel', voiceId: 'registered-voice',
    });
    assert.deepEqual(stub.calls[0].body, {
      model: 'elevenlabs-v4-tts', input: '使用自备音色', voice_id: 'registered-voice',
    });
  } finally { stub.restore(); }
});

test('MiniMax 2.8 HD/Turbo speech maps documented controls to provider field names', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  const input = {
    text: '请用指定音色读这句话。', voiceId: 'minimax-voice', format: 'mp3', speed: 1.25,
    aigcWatermark: false, bitrate: '128000', channel: '2', effectIntensity: -15, effectPitch: 20,
    effectTimbre: -5, emotion: 'whisper', language: 'Chinese,Yue', latexRead: true, pitch: -3,
    pronunciationTone: '轻柔语气', sampleRate: '44100', soundEffects: 'robotic',
    textNormalizationMode: 'quality', volume: 1.4,
  };
  try {
    for (const model of ['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']) {
      await speech.synthesizeSpeech(cangyuanRuntime(model), input);
      assert.deepEqual(stub.calls.at(-1).body, {
        model, input: input.text, response_format: 'mp3', voice_id: 'minimax-voice', speed: 1.25,
        aigc_watermark: false, bitrate: '128000', channel: '2', effect_intensity: -15,
        effect_pitch: 20, effect_timbre: -5, emotion: 'whisper', language: 'Chinese,Yue',
        latex_read: true, pitch: -3, pronunciation_tone: '轻柔语气', sample_rate: '44100',
        sound_effects: 'robotic', text_normalization_mode: 'quality', volume: 1.4,
      });
    }
    assert.equal(stub.calls.length, 2);
  } finally { stub.restore(); }
});

test('legacy MiniMax system voice IDs resolve to the same official voice while other providers keep their native values', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    const voiceId = 'Chinese (Mandarin)_Reliable_Executive';
    const voices = load('./packages/contracts/minimax-system-voices');
    const legacy = voices.MINIMAX_SYSTEM_VOICES.find((voice) => voice.voiceId === voiceId);
    const official = voices.getMiniMaxSystemVoices('cangyuan').find((voice) => voice.originalName === legacy.name && voice.languageLabel === legacy.languageLabel);
    await speech.synthesizeSpeech(cangyuanRuntime('minimax-speech-2.8-hd-tts'), {
      text: '核对系统音色编号', voiceId,
    });
    assert.equal(stub.calls[0].body.voice_id, official.voiceId);
    assert.equal(stub.calls[0].url, 'https://direct-api.cangyuansuanli.cn/v1/audio/speech');
    await speech.synthesizeSpeech({
      model: { rawId: 'minimax-speech-2.8-hd-tts' },
      provider: { type: 'openai-compatible', platform: 'custom', baseUrl: 'https://api.example.test/v1' },
    }, { text: '原厂音色编号', voice: voiceId });
    assert.equal(stub.calls[1].body.voice, voiceId);
    assert.equal(stub.calls[1].body.voice_id, undefined);
    assert.equal(stub.calls[1].url, 'https://api.example.test/v1/audio/speech');
  } finally { stub.restore(); }
});

test('MiniMax official preview voice IDs are submitted unchanged for both speech models', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  const voiceId = 'voice_builtin_0926716995a44310f0f378dfee7db1c71a4e863239558b1b5326ace922d80294';
  try {
    for (const model of ['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']) {
      await speech.synthesizeSpeech(cangyuanRuntime(model), { text: '核对官方试听音色编号', voiceId });
      assert.equal(stub.calls.at(-1).body.voice_id, voiceId);
      assert.equal(stub.calls.at(-1).body.model, model);
      assert.equal(stub.calls.at(-1).body.voice, undefined);
    }
    assert.equal(stub.calls.length, 2);
  } finally { stub.restore(); }
});

test('all 327 legacy voices submit the exact official sample identity for both MiniMax models without network access', async () => {
  const voices = load('./packages/contracts/minimax-system-voices');
  const samples = load('./components/audio/voice-samples');
  const official = voices.getMiniMaxSystemVoices('cangyuan');
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    for (const model of ['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']) {
      for (const legacy of voices.MINIMAX_SYSTEM_VOICES) {
        const exact = official.filter((voice) => voice.originalName === legacy.name && voice.languageLabel === legacy.languageLabel);
        assert.equal(exact.length, 1, legacy.voiceId);
        await speech.synthesizeSpeech(cangyuanRuntime(model), { text: '核对试听与实际生成音色一致', voiceId: legacy.voiceId });
        const call = stub.calls.at(-1);
        const sample = samples.getSpeechVoiceSample(model, legacy.voiceId, 'cangyuan');
        assert.equal(call.body.voice_id, exact[0].voiceId, `${model}/${legacy.voiceId}`);
        assert.equal(call.body.voice_id, sample.provenance.voiceId);
        assert.equal(call.body.model, model);
        assert.equal(call.body.voice, undefined);
      }
    }
    for (const voiceId of ['private-clone-voice', 'unknown', `voice_builtin_${'0'.repeat(64)}`]) {
      await speech.synthesizeSpeech(cangyuanRuntime('minimax-speech-2.8-hd-tts'), { text: '自备音色编号不变', voiceId });
      assert.equal(stub.calls.at(-1).body.voice_id, voiceId);
      assert.equal(samples.getSpeechVoiceSample('minimax-speech-2.8-hd-tts', voiceId, 'cangyuan'), null);
    }
    assert.equal(stub.calls.length, 657);
  } finally { stub.restore(); }
});

test('MiniMax TTS rejects missing voices, unsupported options, invalid bounds, and bitrate on non-MP3', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    const runtime = cangyuanRuntime('minimax-speech-2.8-hd-tts');
    await assert.rejects(() => speech.synthesizeSpeech(runtime, { text: '缺少音色编号' }), /必须填写已登记的音色编号/);
    await assert.rejects(() => speech.synthesizeSpeech(runtime, { text: '不支持种子', voiceId: 'id', seed: 1 }), /不支持这些设置.*随机种子/);
    await assert.rejects(() => speech.synthesizeSpeech(runtime, { text: '比特率与 WAV 冲突', voiceId: 'id', format: 'wav', bitrate: '128000' }), /仅支持 MP3/);
    await assert.rejects(() => speech.synthesizeSpeech(runtime, { text: '参数越界', voiceId: 'id', volume: 10.1 }), /音量超出允许范围/);
    await assert.rejects(() => speech.synthesizeSpeech(runtime, { text: '语速越界', voiceId: 'id', speed: 2.1 }), /速度必须在 0.5–2 之间/);
    await assert.rejects(() => speech.synthesizeSpeech(runtime, { text: 'x'.repeat(10001), voiceId: 'id' }), /最多 10000 个字符/);
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('voice-clone-tts does not expose MiniMax engines from its former mixed engine list', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('voice-clone-tts'), {
      text: '引擎应被拒绝', voiceId: 'id', engine: 'minimax-speech-2.8-hd',
    }), /所选语音引擎不在当前型号支持范围内/);
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('clone speech omits legacy neutral speed for Qwen3 and Chatterbox and resolves the default engine', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    for (const engine of [undefined, 'qwen3', 'chatterbox']) {
      await speech.synthesizeSpeech(cangyuanRuntime('voice-clone-tts'), {
        text: '克隆配音', voiceId: 'registered-voice', engine, speed: 1, format: 'mp3', seed: 0,
      });
      assert.deepEqual(stub.calls.at(-1).body, {
        model: 'voice-clone-tts', input: '克隆配音', voice_id: 'registered-voice',
        engine: engine || 'qwen3', response_format: 'mp3', seed: 0,
      });
    }
    assert.equal(stub.calls.length, 3);
  } finally { stub.restore(); }
});

test('clone speech rejects unsupported speed changes before submitting and keeps ElevenLabs speed bounds', async () => {
  const stub = stubFetch(() => audioResponse(mp3, 'audio/mpeg'));
  try {
    for (const engine of [undefined, 'qwen3', 'chatterbox']) {
      await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('voice-clone-tts'), {
        text: '不能静默忽略调整', voiceId: 'registered-voice', engine, speed: 1.25,
      }), /当前克隆声音引擎暂不接受语速调整/);
    }
    assert.equal(stub.calls.length, 0);
    for (const engine of ['elevenlabs-v4', 'elevenlabs-v4-turbo']) {
      for (const speed of [0.7, 1, 1.2]) {
        await speech.synthesizeSpeech(cangyuanRuntime('voice-clone-tts'), {
          text: '指定引擎语速', voiceId: 'registered-voice', engine, speed,
        });
        assert.equal(stub.calls.at(-1).body.speed, speed);
        assert.equal(stub.calls.at(-1).body.engine, engine);
      }
      await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('voice-clone-tts'), {
        text: '不能超出引擎范围', voiceId: 'registered-voice', engine, speed: 1.25,
      }), /速度必须在 0.7–1.2 之间/);
    }
    assert.equal(stub.calls.length, 6);
  } finally { stub.restore(); }
});

test('clone speech does not retry a rejected parameter or replace the selected voice and engine', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 422, headers: new Headers(), text: async () => '{"error":{"message":"incompatible settings"}}' }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('voice-clone-tts'), {
      text: '保持指定音色', voiceId: 'registered-voice', speed: 1,
    }), /HTTP 422/);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].body.voice_id, 'registered-voice');
    assert.equal(stub.calls[0].body.engine, 'qwen3');
    assert.equal('speed' in stub.calls[0].body, false);
  } finally { stub.restore(); }
});

test('clone speech explains ElevenLabs voice incompatibility in Chinese without switching engines', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 422, headers: new Headers(), text: async () => JSON.stringify({ error: { message: 'The ElevenLabs engines speak only ElevenLabs voices — create a voice with engine: elevenlabs.', code: 'bad_response_status_code' } }) }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(cangyuanRuntime('voice-clone-tts'), {
      text: '保持音色与引擎', voiceId: 'registered-voice', engine: 'elevenlabs-v4', speed: 1,
    }), /当前音色与 ElevenLabs 引擎不兼容.*bad_response_status_code/);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].body.voice_id, 'registered-voice');
    assert.equal(stub.calls[0].body.engine, 'elevenlabs-v4');
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
    await assert.rejects(() => speech.synthesizeSpeech({
      ...cangyuanRuntime('undocumented-tts'),
      provider: { ...cangyuanRuntime('undocumented-tts').provider, type: 'google-gemini' },
    }, { text: '原生协议不兼容' }), /暂不支持兼容的语音生成接口/);
    // Unsupported options are rejected before a provider request is sent.
    assert.equal(stub.calls.length, 1);
  } finally { stub.restore(); }
});

test('服务商拒绝指定音色时不静默去掉音色重试', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 400, text: async () => 'unknown argument voice', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '再来一句', voice: 'alloy' }), /HTTP 400/);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].body.voice, 'alloy');
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

test('服务商返回结构化 JSON 错误时保留上游消息、类型和代码', async () => {
  const payload = JSON.stringify({
    error: {
      message: 'openai_error',
      type: 'bad_response_status_code',
      param: '',
      code: 'bad_response_status_code',
    },
  });
  const stub = stubFetch(() => audioResponse(Buffer.from(payload), 'application/json'));
  try {
    await assert.rejects(
      () => speech.synthesizeSpeech(runtime(), { text: '你好' }),
      /配音接口返回错误.*消息：openai_error.*类型：bad_response_status_code.*代码：bad_response_status_code/,
    );
  } finally { stub.restore(); }
});

test('服务商响应头中的请求编号会附加到配音错误', async () => {
  const stub = stubFetch(() => ({
    ok: false,
    status: 502,
    headers: new Headers({ 'x-request-id': 'cangyuan-request-123' }),
    text: async () => '{"error":{"message":"openai_error"}}',
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '你好' }), /请求编号：cangyuan-request-123/);
  } finally { stub.restore(); }
});

test('接口失败时抛出带状态码与详情的中文错误', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 429, text: async () => 'Today the free API access limit exceeded.', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '你好' }), /HTTP 429/);
  } finally { stub.restore(); }
});

test('服务商要求必填音色时不擅自替换成 alloy', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 400, text: async () => '{"error":{"message":"voice is required","param":"voice"}}', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '你好' }), /voice is required/);
    assert.equal(stub.calls.length, 1);
    assert.equal('voice' in stub.calls[0].body, false);
  } finally { stub.restore(); }
});

test('与 voice 无关的 400 也不会擅自改写请求重试', async () => {
  const stub = stubFetch(() => ({ ok: false, status: 400, text: async () => 'model not found', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
  try {
    await assert.rejects(() => speech.synthesizeSpeech(runtime(), { text: '你好', voice: 'alloy' }), /HTTP 400/);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].body.voice, 'alloy');
  } finally { stub.restore(); }
});
