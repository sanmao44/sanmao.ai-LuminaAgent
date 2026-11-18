import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const tools = load('./lib/canvas/audio-tools');

function audioDocument() {
  return { version: 1, nodes: [{ id: 'audio-1', type: 'media', x: 0, y: 0, data: { kind: 'audio' } }], edges: [], groups: [] };
}

test('canvas audio draft preserves all speech controls', () => {
  const next = tools.updateCanvasAudioDraftDocument(audioDocument(), 'audio-1', {
    text: '旁白', voice: 'Ursa', modelId: 'tts-1', format: 'flac', speed: 1.25,
  });
  assert.deepEqual(next.nodes[0].data.speechDraft, {
    text: '旁白', voice: 'Ursa', modelId: 'tts-1', format: 'flac', speed: 1.25,
  });
});

test('canvas speech model discovery excludes incompatible and transcription-only models', () => {
  const models = [
    { id: 'tts-compatible', providerId: 'compatible', rawId: 'vendor-tts', kind: 'audio', enabled: true, published: true, capabilities: ['speech'] },
    { id: 'tts-native', providerId: 'native', rawId: 'native-tts', kind: 'audio', enabled: true, published: true, capabilities: ['speech'] },
    { id: 'asr-compatible', providerId: 'compatible', rawId: 'whisper-large', kind: 'audio', enabled: true, published: true, capabilities: ['transcription'] },
    { id: 'dual-compatible', providerId: 'compatible', rawId: 'audio-dual', kind: 'audio', enabled: true, published: true, capabilities: ['speech', 'transcription'] },
  ];
  const providers = [
    { id: 'compatible', type: 'openai-compatible', modelLibraryEnabled: true },
    { id: 'native', type: 'google-gemini', modelLibraryEnabled: true },
  ];
  assert.deepEqual(tools.canvasAudioSpeechModels(models, providers).map((model) => model.id), ['tts-compatible', 'dual-compatible']);
  assert.deepEqual(tools.canvasAudioTranscriptionModels(models, providers).map((model) => model.id), ['asr-compatible', 'dual-compatible']);
});

test('canvas speech history migrates legacy single records before appending', () => {
  const previous = { text: '旧旁白', engine: 'provider', createdAt: 1 };
  const next = { text: '新旁白', engine: 'provider', createdAt: 2 };
  assert.deepEqual(tools.canvasAudioSpeechHistory(previous, undefined, next), [next, previous]);
});

test('canvas music tasks append by id and retain prior task records', () => {
  const first = { id: 'task-1', modelId: 'music-1', modelName: '音乐模型', status: 'running', outputs: [], createdAt: '2026-11-18T00:00:00.000Z' };
  const second = { ...first, status: 'succeeded', outputs: [{ url: 'https://example.test/song.mp3', artifactType: 'audio' }] };
  const withFirst = tools.updateCanvasAudioMusicTaskDocument(audioDocument(), 'audio-1', first);
  const withSecond = tools.updateCanvasAudioMusicTaskDocument(withFirst, 'audio-1', second);
  assert.equal(withSecond.nodes[0].data.musicTasks.length, 1);
  assert.equal(withSecond.nodes[0].data.musicTasks[0].status, 'succeeded');
  assert.equal(withSecond.nodes[0].data.status, 'completed');
});

test('transcription results are appended as node history', () => {
  const result = { text: '你好', modelId: 'asr-1', modelName: '转写模型', responseFormat: 'verbose_json', temperature: 0, sourceAudioName: 'voice.wav', createdAt: Date.now() };
  const next = tools.appendCanvasAudioTranscriptionDocument(audioDocument(), 'audio-1', result);
  assert.deepEqual(next.nodes[0].data.transcriptions, [result]);
});
