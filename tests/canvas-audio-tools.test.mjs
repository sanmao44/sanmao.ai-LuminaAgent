import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const tools = load('./lib/canvas/audio-tools');
const polling = load('./lib/cangyuan-media-task-polling');

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

test('canvas music and sound-effect model lists stay separate and submit through the matching model profile', () => {
  const models = [
    { id: 'music-lyria', providerId: 'cangyuan', rawId: 'lyria-3.5', kind: 'audio', enabled: true, published: true, capabilities: ['music-generate', 'sound-effect'] },
    { id: 'sfx-elevenlabs', providerId: 'cangyuan', rawId: 'elevenlabs-sound-effects-v3', kind: 'audio', enabled: true, published: true, capabilities: ['music-generate', 'sound-effect'] },
    { id: 'unknown-sfx', providerId: 'cangyuan', rawId: 'unknown-sfx', kind: 'audio', enabled: true, published: true, capabilities: ['sound-effect'] },
  ];
  const providers = [{ id: 'cangyuan', type: 'openai-compatible', creativeTaskProtocol: 'cangyuan-creative-v1', modelLibraryEnabled: true }];

  assert.deepEqual(tools.canvasAudioMusicModels(models, providers).map((model) => model.id), ['music-lyria']);
  assert.deepEqual(tools.canvasAudioSoundEffectModels(models, providers).map((model) => model.id), ['sfx-elevenlabs']);
  assert.deepEqual(tools.buildCanvasMusicRequest('sfx-elevenlabs', 'elevenlabs-sound-effects-v3', '雨点敲击玻璃', {}), {
    kind: 'music', modelId: 'sfx-elevenlabs', prompt: '雨点敲击玻璃', options: {},
  });
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

test('canvas music and sound-effect drafts persist independently', () => {
  const musicDraft = { modelId: 'music-1', prompt: '轻快的爵士乐', options: { duration: 30 } };
  const soundEffectDraft = { modelId: 'sfx-1', prompt: '雨声敲击玻璃', options: { duration: 5 } };
  const withMusic = tools.updateCanvasAudioMusicDraftDocument(audioDocument(), 'audio-1', musicDraft);
  const withSoundEffect = tools.updateCanvasAudioSoundEffectDraftDocument(withMusic, 'audio-1', soundEffectDraft);
  assert.deepEqual(withSoundEffect.nodes[0].data.musicDraft, musicDraft);
  assert.deepEqual(withSoundEffect.nodes[0].data.soundEffectDraft, soundEffectDraft);
});

test('canvas audio polling rotates through every active task while task updates merge by id', () => {
  const older = { id: 'older', modelId: 'sfx-1', providerModel: 'suno-sfx', modelName: '音效模型', status: 'running', outputs: [], createdAt: '2026-11-18T00:00:00.000Z' };
  const newer = { id: 'newer', modelId: 'music-1', providerModel: 'lyria-3.5', modelName: '音乐模型', status: 'running', outputs: [], createdAt: '2026-11-18T00:01:00.000Z' };
  const firstBatch = polling.nextCangyuanTaskPollBatch([newer, older], null, 1);
  const secondBatch = polling.nextCangyuanTaskPollBatch([newer, older], firstBatch.lastTaskId, 1);
  assert.deepEqual([firstBatch.tasks[0].id, secondBatch.tasks[0].id], ['newer', 'older']);

  const withOlder = tools.updateCanvasAudioMusicTaskDocument(audioDocument(), 'audio-1', older);
  const withBoth = tools.updateCanvasAudioMusicTaskDocument(withOlder, 'audio-1', newer);
  const olderCompleted = { ...older, status: 'succeeded', outputs: [{ url: 'https://example.test/effect.mp3', artifactType: 'audio' }] };
  const updated = tools.updateCanvasAudioMusicTaskDocument(withBoth, 'audio-1', olderCompleted);
  assert.equal(updated.nodes[0].data.musicTasks.find((task) => task.id === 'older').status, 'succeeded');
  assert.equal(updated.nodes[0].data.musicTasks.find((task) => task.id === 'newer').status, 'running');
  assert.equal(updated.nodes[0].data.musicTasks.length, 2);
});

test('transcription results are appended as node history', () => {
  const result = { text: '你好', modelId: 'asr-1', modelName: '转写模型', responseFormat: 'verbose_json', temperature: 0, sourceAudioName: 'voice.wav', createdAt: Date.now() };
  const next = tools.appendCanvasAudioTranscriptionDocument(audioDocument(), 'audio-1', result);
  assert.deepEqual(next.nodes[0].data.transcriptions, [result]);
});
