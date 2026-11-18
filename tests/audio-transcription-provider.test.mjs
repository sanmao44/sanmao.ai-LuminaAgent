import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const previousFetch = globalThis.fetch;
let calls;
const providerAdapter = createTsRequire(process.cwd(), {
  './providers': {
    authHeaders: () => ({ Authorization: 'Bearer test-key' }),
    runtimeBaseUrl: (provider) => provider.baseUrl,
  },
})('./lib/audio-transcription-provider');

function runtime(baseUrl = 'https://api.example.test/v1') {
  return {
    model: { id: 'provider-model-id', rawId: 'mu1-muse-asr', displayName: 'Muse 语音识别' },
    provider: { baseUrl, apiKey: 'test-key' },
  };
}

function request(responseFormat = 'verbose_json') {
  return {
    modelId: 'provider-model-id',
    file: { name: 'meeting.wav', mimeType: 'audio/wav', bytes: new Uint8Array([1, 2, 3]) },
    language: 'zh',
    prompt: '沧海、张小明',
    responseFormat,
    temperature: 0.2,
  };
}

test.after(() => { globalThis.fetch = previousFetch; });

test('posts the documented multipart fields to the OpenAI-compatible transcription endpoint', async () => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, form: init.body });
    return Response.json({ text: '识别内容。', language: 'zh', segments: [{ start: 0, end: 2, text: '识别内容。' }] });
  };

  const result = await providerAdapter.transcribeOpenAiCompatibleAudio(runtime(), request());

  assert.equal(calls[0].url, 'https://api.example.test/v1/audio/transcriptions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].init.headers['content-type'], undefined);
  assert.equal(calls[0].form.get('model'), 'mu1-muse-asr');
  assert.equal(calls[0].form.get('language'), 'zh');
  assert.equal(calls[0].form.get('prompt'), '沧海、张小明');
  assert.equal(calls[0].form.get('response_format'), 'verbose_json');
  assert.equal(calls[0].form.get('temperature'), '0.2');
  assert.equal(calls[0].form.get('file').name, 'meeting.wav');
  assert.equal(result.modelId, 'provider-model-id');
  assert.deepEqual(result.segments, [{ start: 0, end: 2, text: '识别内容。' }]);
});

test('accepts synchronous plain text and removes a duplicate v1 path suffix', async () => {
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('recognized words', { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  const result = await providerAdapter.transcribeOpenAiCompatibleAudio(runtime('https://api.example.test/v1/'), request('text'));
  assert.equal(calls[0], 'https://api.example.test/v1/audio/transcriptions');
  assert.equal(result.text, 'recognized words');
});

test('surfaces provider validation errors without starting a retry', async () => {
  let callsCount = 0;
  globalThis.fetch = async () => {
    callsCount += 1;
    return Response.json({ error: { message: 'language must be a valid code' } }, { status: 400 });
  };
  await assert.rejects(providerAdapter.transcribeOpenAiCompatibleAudio(runtime(), request()), /HTTP 400.*language must be a valid code/);
  assert.equal(callsCount, 1);
});
