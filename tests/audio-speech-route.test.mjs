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
    '@/apps/api/audio-synthesis-composition': { synthesizeCanvasNarration: async () => result },
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
