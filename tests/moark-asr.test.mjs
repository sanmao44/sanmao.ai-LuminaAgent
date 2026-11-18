import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: moarkAsr } = await buildLibModules(
  ['lib/transcription/moark-asr'],
  'moark-asr',
);

test('Moark transcription follows the documented endpoint and SenseVoiceSmall request contract', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-moark-asr-'));
  const filePath = path.join(directory, 'voice.mp3');
  await writeFile(filePath, Buffer.from([1, 2, 3]));
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ text: '识别出的内容', model: 'SenseVoiceSmall' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await moarkAsr.transcribeMoarkAudioFile(filePath, {
      id: 'gitee',
      name: '模力方舟',
      type: 'openai-compatible',
      platform: 'gitee',
      baseUrl: 'https://api.moark.com/v1',
      apiKey: 'test-key',
    });

    assert.equal(request.url, 'https://api.moark.com/v1/audio/transcriptions');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    const form = request.options.body;
    assert.equal(form.get('model'), 'SenseVoiceSmall');
    assert.equal(form.get('language'), 'zh');
    assert.equal(form.get('file').name, 'voice.mp3');
    assert.deepEqual([...form.keys()].sort(), ['file', 'language', 'model']);
    assert.equal(result.text, '识别出的内容');
    assert.equal(result.model, 'SenseVoiceSmall');
    assert.deepEqual(result.segments, []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
