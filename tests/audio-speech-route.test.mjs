import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function createRoute(result) {
  const started = [];
  const finished = [];
  const modules = {
    '@/apps/api/audio-synthesis-application': {
      AudioSynthesisInputError: class AudioSynthesisInputError extends Error {},
      AudioSynthesisUnavailableError: class AudioSynthesisUnavailableError extends Error {},
      audioSynthesisFailureCode: () => undefined,
      audioSynthesisLogMetadata: (input) => ({ prompt: input.text, requestedModelId: input.modelId || 'auto' }),
    },
    '@/apps/api/audio-synthesis-composition': {
      synthesizeCanvasNarration: async () => result,
      synthesizeSpeechPreview: async () => result,
    },
    '@/lib/auth': { isTrustedAppRequest: () => true },
    '@/lib/runtime-operation': {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
    '@/lib/generation-log': {
      startGenerationLog: async (log) => { started.push(log); return 'audio-log-1'; },
      finishGenerationLog: async (id, patch) => { finished.push({ id, patch }); },
    },
    '@/lib/generation-source': { normalizeGenerationSource: (source) => source || 'workspace' },
  };
  return {
    ...createTsRequire(process.cwd(), modules)('./app/api/audio/speech/route'),
    started,
    finished,
  };
}

test('audio speech route records its persistent result URL while returning playable bytes', async () => {
  const route = createRoute({
    data: new Uint8Array([1, 2, 3]),
    contentType: 'audio/mpeg',
    extension: 'mp3',
    engine: 'provider',
    modelId: 'cangyuan:gemini-tts',
    modelName: 'Gemini TTS',
    storageUrl: '/api/storage/audio?name=speech.mp3',
  });
  const response = await route.POST(new Request('http://localhost/api/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Persistent speech' }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [1, 2, 3]);
  assert.equal(response.headers.get('X-Audio-Url'), '/api/storage/audio?name=speech.mp3');
  assert.equal(route.started[0].mediaKind, 'audio');
  assert.equal(route.finished[0].id, 'audio-log-1');
  assert.equal(route.finished[0].patch.status, 'success');
  assert.equal(route.finished[0].patch.modelId, 'cangyuan:gemini-tts');
  assert.equal(route.finished[0].patch.modelName, 'Gemini TTS');
  assert.equal(route.finished[0].patch.audioUrl, '/api/storage/audio?name=speech.mp3');
  assert.equal(Number.isFinite(route.finished[0].patch.durationMs), true);
});

test('audio speech route percent-encodes Unicode model names in response headers', async () => {
  const modelName = 'MiniMax 2.8 高保真配音';
  const route = createRoute({
    data: new Uint8Array([1, 2, 3]),
    contentType: 'audio/mpeg',
    extension: 'mp3',
    engine: 'provider',
    modelId: 'minimax-speech-2.8-hd-tts',
    modelName,
  });
  const response = await route.POST(new Request('http://localhost/api/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Unicode model name' }),
  }));

  assert.equal(response.status, 200);
  const encoded = response.headers.get('X-Audio-Model');
  assert.equal(encoded, encodeURIComponent(modelName));
  assert.equal(decodeURIComponent(encoded), modelName);
});

test('audio speech route keeps successful responses alive for malformed Unicode model names', async () => {
  const malformed = `MiniMax ${String.fromCharCode(0xd800)} 配音`;
  const route = createRoute({
    data: new Uint8Array([1, 2, 3]),
    contentType: 'audio/mpeg',
    extension: 'mp3',
    engine: 'provider',
    modelId: 'minimax-speech-2.8-hd-tts',
    modelName: malformed,
  });

  const response = await route.POST(new Request('http://localhost/api/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Malformed Unicode model name' }),
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Audio-Model'), '');
  assert.equal(route.finished[0].patch.status, 'success');
});

test('audio speech route percent-encodes storage failures for ByteString headers', async () => {
  const message = '音频生成成功，但保存到媒体库失败。请先下载本次结果。';
  const route = createRoute({
    data: new Uint8Array([4, 5]),
    contentType: 'audio/mpeg',
    extension: 'mp3',
    engine: 'provider',
    modelId: 'cangyuan:gemini-tts',
    modelName: 'Gemini TTS',
    storageError: message,
  });
  const response = await route.POST(new Request('http://localhost/api/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Storage failure' }),
  }));

  assert.equal(response.status, 200);
  const encoded = response.headers.get('X-Audio-Storage-Error');
  assert.equal(encoded, encodeURIComponent(message));
  assert.equal(decodeURIComponent(encoded), message);
});

test('audio voice preview returns bytes without writing history or persistent media', async () => {
  const route = createRoute({
    data: new Uint8Array([7, 8]),
    contentType: 'audio/mpeg',
    extension: 'mp3',
    engine: 'provider',
  });
  const response = await route.POST(new Request('http://localhost/api/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好，这是一段音色试听。', preview: true, modelId: 'speech-model', voice: 'voice-a' }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [7, 8]);
  assert.deepEqual(route.started, []);
  assert.deepEqual(route.finished, []);
  assert.equal(response.headers.get('X-Audio-Url'), null);
});

test('audio voice preview rejects arbitrary text before invoking generation', async () => {
  const route = createRoute({ data: new Uint8Array([1]), contentType: 'audio/mpeg', extension: 'mp3', engine: 'provider' });
  const response = await route.POST(new Request('http://localhost/api/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '用户任意正文', preview: true }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(route.started, []);
});
