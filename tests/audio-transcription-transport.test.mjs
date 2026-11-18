import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function createTransport({ allowed = true, result = { text: '你好。' }, failure = null } = {}) {
  const file = new File([new Uint8Array([1, 2, 3])], 'speech.wav', { type: 'audio/wav' });
  const form = new FormData();
  form.set('file', file);
  form.set('modelId', 'model-id');
  form.set('language', 'zh');
  form.set('prompt', '专有名词');
  form.set('responseFormat', 'verbose_json');
  form.set('temperature', '0.1');
  const submissions = [];
  let released = 0;
  class AudioTranscriptionInputError extends Error {}
  const transport = createTsRequire(process.cwd(), {
    './audio-transcription-application': { AudioTranscriptionInputError, AUDIO_TRANSCRIPTION_MAX_BYTES: 50 * 1024 * 1024 },
    './audio-transcription-composition': { transcribeAudio: async (...args) => { submissions.push(args); if (failure) throw failure; return result; } },
    './multipart-upload-http': {
      MalformedMultipartRequestError: class MalformedMultipartRequestError extends Error {},
      MultipartBodyTooLargeError: class MultipartBodyTooLargeError extends Error {},
      readBoundedMultipartFormData: async () => form,
    },
    '@/lib/auth': { isTrustedAppRequest: () => allowed },
    '@/lib/runtime-operation': { beginRuntimeRequest: async () => async () => { released += 1; }, RuntimeDrainingError: class RuntimeDrainingError extends Error {} },
  })('./apps/api/audio-transcription-transport');
  return { transport, submissions, get released() { return released; } };
}

test('transport accepts an uploaded file and maps Chinese UI settings to the application contract', async () => {
  const fixture = createTransport({ result: { text: '你好。', modelId: 'model-id', modelName: 'Muse ASR', responseFormat: 'verbose_json', temperature: 0.1 } });
  const response = await fixture.transport.handleAudioTranscriptionRequest(new Request('http://localhost/api/audio/transcriptions', { method: 'POST' }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).result, { text: '你好。', modelId: 'model-id', modelName: 'Muse ASR', responseFormat: 'verbose_json', temperature: 0.1 });
  assert.equal(fixture.submissions[0][0].modelId, 'model-id');
  assert.equal(fixture.submissions[0][0].file.name, 'speech.wav');
  assert.equal(fixture.submissions[0][0].language, 'zh');
  assert.equal(fixture.submissions[0][0].prompt, '专有名词');
  assert.equal(fixture.submissions[0][0].temperature, 0.1);
  assert.equal(fixture.released, 1);
});

test('transport enforces the app authentication boundary before reading uploads', async () => {
  const fixture = createTransport({ allowed: false });
  const response = await fixture.transport.handleAudioTranscriptionRequest(new Request('http://localhost/api/audio/transcriptions', { method: 'POST' }));
  assert.equal(response.status, 401);
  assert.equal(fixture.submissions.length, 0);
  assert.equal(fixture.released, 0);
});
