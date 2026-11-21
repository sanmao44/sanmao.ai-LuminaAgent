import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const projectRoot = process.cwd();
const application = createTsRequire(projectRoot)('./apps/api/audio-voice-registration-application');
const registrationInput = {
  modelId: 'registry-model-id',
  registrationModel: 'voice-clone-tts',
  name: '我的配音',
  url: 'https://relay.example.test/audio/temporary-token',
  consent: true,
};

test('speech voice registration validates consent, public URL, model and name before using the provider port', async () => {
  let portCalls = 0;
  const port = {
    register: async (input) => { portCalls += 1; return { voiceId: 'voice-1', name: input.name, status: 'active' }; },
    list: async () => [],
  };

  const created = await application.registerSpeechVoice(registrationInput, port);
  assert.deepEqual(created, { voiceId: 'voice-1', name: '我的配音', status: 'active' });
  assert.equal(portCalls, 1);

  await assert.rejects(() => application.registerSpeechVoice({ ...registrationInput, consent: false }, port), /明确授权/);
  await assert.rejects(() => application.registerSpeechVoice({ ...registrationInput, url: 'file:///voice.wav' }, port), /HTTP 或 HTTPS/);
  await assert.rejects(() => application.registerSpeechVoice({ ...registrationInput, url: 'https://user:secret@voice.example/voice.wav' }, port), /HTTP 或 HTTPS/);
  await assert.rejects(() => application.registerSpeechVoice({ ...registrationInput, registrationModel: 'not-a-clone-model' }, port), /声音克隆型号无效/);
  await assert.rejects(() => application.registerSpeechVoice({ ...registrationInput, name: 'x'.repeat(81) }, port), /最多 80/);
  assert.equal(portCalls, 1);
});

test('voice list requires a configured model and known registration family', async () => {
  const calls = [];
  const voices = [{ voiceId: 'voice-1', name: '我的配音', status: 'active' }];
  const result = await application.listSpeechVoices({ modelId: 'registry-model-id', registrationModel: 'minimax-speech-2.8-hd-clone' }, {
    register: async () => voices[0],
    list: async (input) => { calls.push(input); return voices; },
  });
  assert.deepEqual(result, voices);
  assert.deepEqual(calls, [
    { modelId: 'registry-model-id', registrationModel: 'minimax-speech-2.8-hd-clone' },
    { modelId: 'registry-model-id', registrationModel: 'minimax-speech-2.8-turbo-clone' },
  ]);
  await assert.rejects(() => application.listSpeechVoices({ modelId: '', registrationModel: 'voice-clone-tts' }, { list: async () => [], register: async () => voices[0] }), /请选择有效的配音模型/);
});

test('MiniMax lists combine HD and Turbo registrations by shared voice ID while generic clone stays isolated', async () => {
  const calls = [];
  const port = {
    register: async () => ({ voiceId: 'unused', name: 'unused', status: 'active' }),
    list: async (input) => {
      calls.push(input.registrationModel);
      return input.registrationModel === 'minimax-speech-2.8-hd-clone'
        ? [
          { voiceId: 'shared', name: 'HD 名称', status: 'active' },
          { voiceId: 'hd-only', name: 'HD 专用', status: 'active' },
        ]
        : [
          { voiceId: 'shared', name: 'Turbo 名称', status: 'active', previewUrl: 'https://preview.example.test/shared.mp3' },
          { voiceId: 'turbo-only', name: 'Turbo 专用', status: 'active' },
        ];
    },
  };
  const minimaxVoices = await application.listSpeechVoices({ modelId: 'minimax-id', registrationModel: 'minimax-speech-2.8-hd-clone' }, port);
  assert.deepEqual(calls, ['minimax-speech-2.8-hd-clone', 'minimax-speech-2.8-turbo-clone']);
  assert.deepEqual(minimaxVoices, [
    { voiceId: 'shared', name: 'HD 名称', status: 'active', previewUrl: 'https://preview.example.test/shared.mp3' },
    { voiceId: 'hd-only', name: 'HD 专用', status: 'active' },
    { voiceId: 'turbo-only', name: 'Turbo 专用', status: 'active' },
  ]);

  calls.length = 0;
  await application.listSpeechVoices({ modelId: 'generic-id', registrationModel: 'voice-clone-tts' }, port);
  assert.deepEqual(calls, ['voice-clone-tts']);
});

test('voice preview application validates configured-model input before calling its port', async () => {
  const input = { modelId: 'registry-model-id', registrationModel: 'minimax-speech-2.8-hd-clone', previewUrl: 'https://ai.cangyuansuanli.cn/v1/audio/voices/task_123/preview' };
  let received;
  const port = {
    register: async () => ({ voiceId: 'unused', name: 'unused', status: 'active' }),
    list: async () => [],
    preview: async (value) => { received = value; return { body: new ArrayBuffer(2), contentType: 'audio/mpeg' }; },
  };
  const result = await application.previewSpeechVoice(input, port);
  assert.equal(received.previewUrl, input.previewUrl);
  assert.equal(result.contentType, 'audio/mpeg');
  await assert.rejects(() => application.previewSpeechVoice({ ...input, previewUrl: 'http://ai.cangyuansuanli.cn/audio.mp3' }, port), /试听地址无效/);
  await assert.rejects(() => application.previewSpeechVoice({ ...input, modelId: '' }, port), /请选择有效的配音模型/);
});

test('provider adapter sends only documented registration fields and normalizes the returned record', async () => {
  const calls = [];
  const adapter = createTsRequire(projectRoot, {
    [path.resolve(projectRoot, 'lib/providers')]: {
      authHeaders: () => ({ Authorization: 'Bearer private-test-key' }),
      runtimeBaseUrl: (provider) => provider.baseUrl,
    },
  })('./lib/clone/voice-registration');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return Response.json({ voice_id: 'voice-123', name: '样音', status: 'active', preview_url: 'https://ai.cangyuansuanli.cn/v1/audio/voices/task_preview-123/preview' }, { status: 201 });
  };
  try {
    const voice = await adapter.registerCangyuanSpeechVoice({ provider: { baseUrl: 'https://ai.cangyuansuanli.cn/v1', apiKey: 'private-test-key' }, model: { rawId: 'voice-clone-tts' } }, registrationInput);
    assert.deepEqual(voice, { voiceId: 'voice-123', name: '样音', status: 'active', previewUrl: 'https://ai.cangyuansuanli.cn/v1/audio/voices/task_preview-123/preview' });
    assert.equal(calls[0].url, 'https://ai.cangyuansuanli.cn/v1/audio/voices');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer private-test-key');
    assert.deepEqual(calls[0].body, { model: 'voice-clone-tts', name: '我的配音', url: registrationInput.url, consent: true });
    assert.equal(JSON.stringify(calls[0].body).includes('private-test-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registration marks only server failures and malformed success responses as unconfirmed', async () => {
  const adapter = createTsRequire(projectRoot, {
    [path.resolve(projectRoot, 'lib/providers')]: {
      authHeaders: () => ({ Authorization: 'Bearer private-test-key' }),
      runtimeBaseUrl: (provider) => provider.baseUrl,
    },
  })('./lib/clone/voice-registration');
  const runtime = { provider: { baseUrl: 'https://ai.cangyuansuanli.cn', apiKey: 'private-test-key' }, model: { rawId: 'voice-clone-tts' } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { message: 'invalid consent' } }, { status: 400 });
    await assert.rejects(() => adapter.registerCangyuanSpeechVoice(runtime, registrationInput), (error) => error.resultUnconfirmed === false);

    globalThis.fetch = async () => Response.json({ error: { message: 'upstream unavailable' } }, { status: 502 });
    await assert.rejects(() => adapter.registerCangyuanSpeechVoice(runtime, registrationInput), (error) => error.resultUnconfirmed === true);

    globalThis.fetch = async () => Response.json({ message: 'accepted' }, { status: 201 });
    await assert.rejects(() => adapter.registerCangyuanSpeechVoice(runtime, registrationInput), (error) => error.resultUnconfirmed === true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('voice list adapter queries the selected registration model and does not cache results', async () => {
  const calls = [];
  const adapter = createTsRequire(projectRoot, {
    [path.resolve(projectRoot, 'lib/providers')]: {
      authHeaders: () => ({ Authorization: 'Bearer private-test-key' }),
      runtimeBaseUrl: (provider) => provider.baseUrl,
    },
  })('./lib/clone/voice-registration');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ voices: [{ voice_id: 'voice-123', name: '样音', status: 'active' }] });
  };
  try {
    const result = await adapter.listCangyuanSpeechVoices({ provider: { baseUrl: 'https://ai.cangyuansuanli.cn', apiKey: 'private-test-key' }, model: { rawId: 'minimax-speech-2.8-hd-tts' } }, {
      modelId: 'registry-model-id', registrationModel: 'minimax-speech-2.8-hd-clone',
    });
    assert.deepEqual(result, [{ voiceId: 'voice-123', name: '样音', status: 'active' }]);
    assert.equal(calls[0].url, 'https://ai.cangyuansuanli.cn/v1/audio/voices?model=minimax-speech-2.8-hd-clone');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer private-test-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preview adapter sends the configured bearer token only to the exact official HTTPS preview endpoint', async () => {
  const calls = [];
  const adapter = createTsRequire(projectRoot, {
    [path.resolve(projectRoot, 'lib/providers')]: {
      authHeaders: () => ({ Authorization: 'Bearer private-test-key' }),
      runtimeBaseUrl: (provider) => provider.baseUrl,
    },
  })('./lib/clone/voice-registration');
  const runtime = { provider: { baseUrl: 'https://ai.cangyuansuanli.cn/v1', apiKey: 'private-test-key' }, model: { rawId: 'minimax-speech-2.8-hd-tts' } };
  const previewUrl = 'https://ai.cangyuansuanli.cn/v1/audio/voices/task_123/preview';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  };
  try {
    const result = await adapter.previewCangyuanSpeechVoice(runtime, previewUrl);
    assert.equal(result.contentType, 'audio/mpeg');
    assert.deepEqual([...new Uint8Array(result.body)], [1, 2, 3]);
    assert.equal(calls[0].url, previewUrl);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer private-test-key');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.redirect, 'manual');

    await assert.rejects(() => adapter.previewCangyuanSpeechVoice(runtime, 'https://attacker.example/v1/audio/voices/task_123/preview'), /与当前服务商不匹配/);
    await assert.rejects(() => adapter.previewCangyuanSpeechVoice(runtime, 'https://ai.cangyuansuanli.cn/v1/audio/voices/task_123/preview?target=secret'), /与当前服务商不匹配/);
    assert.equal(calls.length, 1, 'untrusted destinations must be rejected before fetch');

    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/audio.mp3' } });
    await assert.rejects(() => adapter.previewCangyuanSpeechVoice(runtime, previewUrl), /发生跳转/);
    globalThis.fetch = async () => Response.json({ error: 'not an audio preview' });
    await assert.rejects(() => adapter.previewCangyuanSpeechVoice(runtime, previewUrl), /未返回音频内容/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('composition allows only matching Cangyuan speech models and clone registration families', async () => {
  const calls = [];
  const module = createTsRequire(projectRoot, {
    '@/lib/cangyuan-provider': { isCangyuanProvider: (provider) => provider.platform === 'cangyuan' },
    '@/lib/clone/speech': {
      resolveSpeechRuntime: async (modelId) => ({
        model: { id: modelId, rawId: 'minimax-speech-2.8-hd-tts', capabilities: ['speech'] },
        provider: { platform: 'cangyuan' },
      }),
    },
    '@/lib/clone/voice-registration': {
      registerCangyuanSpeechVoice: async (_runtime, input) => { calls.push(input); return { voiceId: 'voice-id', name: input.name, status: 'active' }; },
      listCangyuanSpeechVoices: async (_runtime, input) => { calls.push(input); return []; },
      previewCangyuanSpeechVoice: async (_runtime, previewUrl) => { calls.push(previewUrl); return { body: new ArrayBuffer(1), contentType: 'audio/mpeg' }; },
      CangyuanSpeechVoiceError: class CangyuanSpeechVoiceError extends Error {},
    },
  })('./apps/api/audio-voice-registration-composition');
  const request = { ...registrationInput, registrationModel: 'minimax-speech-2.8-hd-clone' };
  await module.registerConfiguredSpeechVoice(request);
  assert.equal(calls.length, 1);
  await assert.rejects(() => module.registerConfiguredSpeechVoice({ ...request, registrationModel: 'voice-clone-tts' }), /不匹配/);
  assert.equal(calls.length, 1);
});

test('route authenticates voice management and returns stable list and create wire shapes', async () => {
  let trusted = true;
  const calls = [];
  const route = createTsRequire(projectRoot, {
    '@/lib/auth': { isTrustedAppRequest: () => trusted },
    '@/lib/runtime-operation': {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
    '@/apps/api/audio-voice-registration-application': {
      SpeechVoiceProviderError: class SpeechVoiceProviderError extends Error {},
      SpeechVoiceRegistrationInputError: class SpeechVoiceRegistrationInputError extends Error {},
      SpeechVoiceRegistrationUnavailableError: class SpeechVoiceRegistrationUnavailableError extends Error {},
    },
    '@/apps/api/audio-voice-registration-composition': {
      listConfiguredSpeechVoices: async (input) => { calls.push(['list', input]); return [{ voiceId: 'voice-1', name: '我的音色', status: 'active' }]; },
      registerConfiguredSpeechVoice: async (input) => { calls.push(['register', input]); return { voiceId: 'voice-2', name: input.name, status: 'active' }; },
    },
  })('./app/api/audio/voices/route');

  const listed = await route.GET(new Request('http://localhost/api/audio/voices?modelId=registry-model-id&registrationModel=voice-clone-tts'));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { voices: [{ voiceId: 'voice-1', name: '我的音色', status: 'active' }] });

  const created = await route.POST(new Request('http://localhost/api/audio/voices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationInput),
  }));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { voice: { voiceId: 'voice-2', name: '我的配音', status: 'active' } });
  assert.equal(calls.length, 2);

  trusted = false;
  const unauthorized = await route.GET(new Request('http://localhost/api/audio/voices?modelId=registry-model-id&registrationModel=voice-clone-tts'));
  assert.equal(unauthorized.status, 401);
  assert.equal(calls.length, 2);
});

test('preview route requires app authentication and returns proxied audio bytes without caching', async () => {
  let trusted = true;
  const calls = [];
  const route = createTsRequire(projectRoot, {
    '@/lib/auth': { isTrustedAppRequest: () => trusted },
    '@/lib/runtime-operation': {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
    '@/apps/api/audio-voice-registration-application': {
      SpeechVoiceProviderError: class SpeechVoiceProviderError extends Error {},
      SpeechVoiceRegistrationInputError: class SpeechVoiceRegistrationInputError extends Error {},
      SpeechVoiceRegistrationUnavailableError: class SpeechVoiceRegistrationUnavailableError extends Error {},
    },
    '@/apps/api/audio-voice-registration-composition': {
      previewConfiguredSpeechVoice: async (input) => {
        calls.push(input);
        return { body: new Uint8Array([8, 9]).buffer, contentType: 'audio/mpeg' };
      },
    },
  })('./app/api/audio/voices/preview/route');
  const url = new URL('http://localhost/api/audio/voices/preview');
  url.searchParams.set('modelId', 'registry-model-id');
  url.searchParams.set('registrationModel', 'minimax-speech-2.8-hd-clone');
  url.searchParams.set('previewUrl', 'https://ai.cangyuansuanli.cn/v1/audio/voices/task_123/preview');
  const response = await route.GET(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [8, 9]);
  assert.equal(calls.length, 1);

  trusted = false;
  const unauthorized = await route.GET(new Request(url));
  assert.equal(unauthorized.status, 401);
  assert.equal(calls.length, 1);
});
