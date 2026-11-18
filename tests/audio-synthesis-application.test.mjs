import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';
import { createTsRequire } from './ts-require.mjs';

const { main: application } = await buildLibModules(
  ['apps/api/audio-synthesis-application', 'packages/contracts/audio-synthesis'],
  'audio-synthesis-application',
);
const speechContract = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');

test('audio synthesis classifies transport failures as provider-result-unconfirmed', () => {
  assert.equal(application.audioSynthesisFailureCode(Object.assign(new Error('服务商在约 2 分钟内没有返回结果'), { name: 'TimeoutError' })), 'provider_result_unconfirmed');
  assert.equal(application.audioSynthesisFailureCode(new Error('配音接口失败：HTTP 502')), 'provider_result_unconfirmed');
  assert.equal(application.audioSynthesisFailureCode(new Error('所选配音模型当前不可用')), undefined);
  assert.equal(application.audioSynthesisFailureCode(new Error('配音文本为空。')), undefined);
});

test('audio synthesis trims the script and optional voice before calling the provider port', async () => {
  const signal = new AbortController().signal;
  let received;
  const result = await application.synthesizeAudioRequest(
    { text: '  你好，世界。  ', voice: ' 温柔女声 ' },
    { synthesize: async (input, receivedSignal) => {
      received = { input, signal: receivedSignal };
      return { data: new Uint8Array([1, 2, 3]), contentType: 'audio/wav', extension: 'wav', engine: 'offline' };
    } },
    signal,
  );
  assert.deepEqual(received.input, { text: '你好，世界。', voice: '温柔女声' });
  assert.equal(received.signal, signal);
  assert.equal(result.contentType, 'audio/wav');
  assert.equal(result.engine, 'offline');
});

test('audio synthesis preserves model-specific format and speed options through the shared contract', async () => {
  let received;
  await application.synthesizeAudioRequest(
    { text: '语音参数', modelId: 'gemini-id', voice: 'Ursa', format: 'flac', speed: 1.25 },
    { synthesize: async (input) => {
      received = input;
      return { data: new Uint8Array([1]), contentType: 'audio/flac', extension: 'flac', engine: 'provider' };
    } },
  );
  assert.deepEqual(received, {
    text: '语音参数', modelId: 'gemini-id', voice: 'Ursa', format: 'flac', speed: 1.25,
  });
});

test('speech profiles distinguish official model limits from the platform input cap and resolve engine defaults', () => {
  assert.equal(speechContract.SPEECH_PLATFORM_TEXT_LIMIT, 5000);
  assert.equal(speechContract.getSpeechModelProfile('gemini-tts').textMaxLength, undefined);
  assert.equal(speechContract.getSpeechModelProfile('mu1-muse-tts').textMaxLength, undefined);
  assert.deepEqual(speechContract.getSpeechModelResponseFormats('voice-clone-tts'), ['mp3', 'wav']);
  assert.deepEqual(speechContract.getSpeechModelResponseFormats('voice-clone-tts', 'minimax-speech-2.6-hd'), ['mp3', 'flac']);
  assert.deepEqual(speechContract.getSpeechModelResponseFormats('voice-clone-tts', 'elevenlabs-v4-turbo'), ['mp3', 'wav', 'opus', 'pcm']);
  assert.deepEqual(speechContract.getSpeechModelSpeedRange('voice-clone-tts', 'elevenlabs-v4'), { min: 0.7, max: 1.2 });
  assert.deepEqual(speechContract.getSpeechModelAdvancedOptions('gemini-tts', { engine: 'turbo', voiceId: 'stale' }), {});
  assert.deepEqual(speechContract.getSpeechModelProfile('voice-clone-tts').languageCodes, ['auto', 'ru', 'en', 'de', 'fr', 'es', 'it', 'pt', 'zh', 'ja', 'ko']);
  assert.ok(speechContract.getSpeechModelProfile('voice-clone-tts').emotionOptions.includes('disgusted'));
});

test('audio synthesis validates voice-clone engine, format, language, emotion, and numeric bounds', async () => {
  let received;
  const port = { synthesize: async (input) => {
    received = input;
    return { data: new Uint8Array([1]), contentType: 'audio/flac', extension: 'flac', engine: 'provider' };
  } };
  await application.synthesizeAudioRequest({
    text: '克隆音色测试', modelId: 'provider:voice-clone-tts', voiceId: 'registered-voice',
    engine: 'minimax-speech-2.6-hd', language: 'zh', emotion: 'disgusted', speed: 1,
    format: 'flac', seed: 0, similarityBoost: 0.75, stability: 0.5, instruct: '语气温和',
  }, port);
  assert.equal(received.engine, 'minimax-speech-2.6-hd');
  assert.equal(received.emotion, 'disgusted');
  assert.equal(received.voiceId, 'registered-voice');
  await assert.rejects(application.synthesizeAudioRequest({
    text: '克隆音色测试', modelId: 'provider:voice-clone-tts', voiceId: 'registered-voice', format: 'flac',
  }, port), /引擎组合不支持 flac/);
  await assert.rejects(application.synthesizeAudioRequest({
    text: '克隆音色测试', modelId: 'provider:voice-clone-tts', voiceId: 'registered-voice', engine: 'unknown-engine',
  }, port), /引擎不在当前型号支持范围内/);
  await assert.rejects(application.synthesizeAudioRequest({
    text: '克隆音色测试', modelId: 'provider:voice-clone-tts', voiceId: 'registered-voice', language: 'pl',
  }, port), /声音语言不受当前型号支持/);
  await assert.rejects(application.synthesizeAudioRequest({
    text: '克隆音色测试', modelId: 'provider:voice-clone-tts', voiceId: 'registered-voice', emotion: 'calm',
  }, port), /情绪不受当前型号支持/);
  await assert.rejects(application.synthesizeAudioRequest({
    text: '克隆音色测试', modelId: 'provider:voice-clone-tts', voiceId: 'registered-voice', speed: 2.1,
  }, port), /语速需在 0.5–2/);
  await assert.rejects(application.synthesizeAudioRequest({
    text: '克隆音色测试', modelId: 'provider:voice-clone-tts', engine: 'qwen3',
  }, port), /需要已登记的音色编号/);
});

test('dialogue synthesis keeps the required description and structured lines while enforcing documented limits', async () => {
  let received;
  const port = { synthesize: async (input) => {
    received = input;
    return { data: new Uint8Array([1]), contentType: 'audio/mpeg', extension: 'mp3', engine: 'provider' };
  } };
  await application.synthesizeAudioRequest({
    text: '两位角色在车站道别', modelId: 'provider:elevenlabs-dialogue',
    dialogue: [{ voice: 'Rachel', text: '一路顺风。' }, { voice: 'Roger', text: '回头见。' }], stability: 0.4,
  }, port);
  assert.deepEqual(received.dialogue, [
    { voice: 'Rachel', text: '一路顺风。' }, { voice: 'Roger', text: '回头见。' },
  ]);
  assert.equal(received.text, '两位角色在车站道别');
  await assert.rejects(application.synthesizeAudioRequest({
    text: '两位角色在车站道别', modelId: 'provider:elevenlabs-dialogue', dialogue: 1,
  }, port), /1 到 50 句/);
  await assert.rejects(application.synthesizeAudioRequest({
    text: '对白说明', modelId: 'provider:elevenlabs-dialogue', dialogue: [{ voice: 'Rachel', text: '台词' }],
    engine: 'turbo',
  }, port), /不支持这些设置：语音引擎/);
});

test('audio generation log metadata preserves the requested voice and automatic model preference', () => {
  assert.deepEqual(application.audioSynthesisLogMetadata({
    text: '  配音草稿  ',
    voice: ' 温柔女声 ',
    format: 'wav',
    speed: 1.5,
  }), {
    prompt: '配音草稿',
    requestedModelId: 'auto',
    voice: '温柔女声',
    format: 'wav',
    speed: 1.5,
  });
});

test('audio generation log metadata preserves an explicit model and rejects invalid retry parameters', () => {
  assert.deepEqual(application.audioSynthesisLogMetadata({
    text: '保留配置',
    voice: '清晰女声',
    modelId: 'speech-model-a',
  }), {
    prompt: '保留配置',
    requestedModelId: 'speech-model-a',
    voice: '清晰女声',
  });
  assert.throws(() => application.audioSynthesisLogMetadata({ text: '超长音色', voice: 'v'.repeat(101) }), /音色名称最多 100 个字符/);
});

test('audio synthesis preserves an explicit speech model selection through the application contract', async () => {
  let received;
  await application.synthesizeAudioRequest(
    { text: '指定模型配音', voice: '清晰女声', modelId: 'provider-a:speech-v1' },
    { synthesize: async (input) => {
      received = input;
      return { data: new Uint8Array([1]), contentType: 'audio/mpeg', extension: 'mp3', engine: 'provider', modelId: 'provider-a:speech-v1' };
    } },
  );
  assert.deepEqual(received, { text: '指定模型配音', voice: '清晰女声', modelId: 'provider-a:speech-v1' });
});

test('audio synthesis persists successful output and preserves provider bytes when storage fails', async () => {
  const audio = new Uint8Array([4, 5, 6]);
  const synthesis = { synthesize: async () => ({ data: audio, contentType: 'audio/mpeg', extension: 'mp3', engine: 'provider' }) };
  let persisted;
  const result = await application.synthesizeAndPersistAudio(
    { text: '保存配音' },
    synthesis,
    { persist: async (data, contentType) => {
      persisted = { data, contentType };
      return { url: '/api/storage/audio?name=speech.mp3' };
    } },
  );
  assert.deepEqual(persisted, { data: audio, contentType: 'audio/mpeg' });
  assert.equal(result.storageUrl, '/api/storage/audio?name=speech.mp3');

  const unsaved = await application.synthesizeAndPersistAudio(
    { text: '保留原始结果' },
    synthesis,
    { persist: async () => { throw new Error('disk full'); } },
  );
  assert.equal(unsaved.storageError, '音频生成成功，但保存到媒体库失败。请先下载本次结果。');
  assert.deepEqual(unsaved.data, audio);
});

test('audio synthesis preserves project and canvas provenance metadata without changing spoken text', async () => {
  let received;
  await application.synthesizeAudioRequest(
    {
      text: '  项目旁白  ',
      source: 'canvas',
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodeId: 'audio-node',
    },
    { synthesize: async (input) => {
      received = input;
      return { data: new Uint8Array([1]), contentType: 'audio/wav', extension: 'wav', engine: 'offline' };
    } },
  );
  assert.deepEqual(received, {
    text: '项目旁白',
    source: 'canvas',
    projectId: 'project-1',
    canvasId: 'canvas-1',
    nodeId: 'audio-node',
  });
});

test('audio synthesis rejects empty and oversized scripts before contacting the provider', async () => {
  let calls = 0;
  const port = { synthesize: async () => { calls += 1; throw new Error('unexpected'); } };
  await assert.rejects(application.synthesizeAudioRequest({ text: '   ' }, port), /输入配音文本/);
  await assert.rejects(application.synthesizeAudioRequest({ text: 'x'.repeat(5001) }, port), /最多 5000 个字符/);
  await assert.rejects(application.synthesizeAudioRequest({ text: '有效文本', voice: 'v'.repeat(101) }, port), /音色名称最多 100 个字符/);
  await assert.rejects(application.synthesizeAudioRequest({ text: '有效文本', modelId: 12 }, port), /配音模型无效/);
  await assert.rejects(application.synthesizeAudioRequest({ text: '有效文本', modelId: 'm'.repeat(161) }, port), /模型 ID 最多 160 个字符/);
  await assert.rejects(application.synthesizeAudioRequest({ text: '有效文本', format: 'ogg' }, port), /格式无效/);
  await assert.rejects(application.synthesizeAudioRequest({ text: '有效文本', speed: Number.NaN }, port), /速度必须是有限数字/);
  assert.equal(calls, 0);
});

test('audio synthesis rejects invalid provider artifacts before returning them to the client', async () => {
  await assert.rejects(
    application.synthesizeAudioRequest({ text: '你好' }, { synthesize: async () => ({ data: new Uint8Array(), contentType: 'audio/wav', extension: 'wav', engine: 'provider' }) }),
    /没有返回有效音频/,
  );
  await assert.rejects(
    application.synthesizeAudioRequest({ text: '你好' }, { synthesize: async () => ({ data: new Uint8Array([1]), contentType: 'application/json', extension: 'json', engine: 'provider' }) }),
    /无法识别的音频格式/,
  );
});

test('audio MIME type validation accepts browser-playable audio containers', async () => {
  const result = await application.synthesizeAudioRequest(
    { text: '你好' },
    { synthesize: async () => ({ data: new Uint8Array([1]), contentType: 'audio/webm', extension: 'webm', engine: 'provider' }) },
  );
  assert.equal(result.extension, 'webm');
});
