import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

function selectMenu({ value, options, ariaLabel, className = '' }) {
  return createElement('label', { className }, [
    createElement('span', { key: 'label' }, ariaLabel),
    createElement('select', { key: 'select', 'aria-label': ariaLabel, value, readOnly: true }, options.map((option) =>
      createElement('option', { key: String(option.value), value: option.value }, option.label))),
  ]);
}

const load = createTsRequire(process.cwd(), {
  '@/components/ModelPicker': () => null,
  '@/components/SelectMenu': selectMenu,
  '@/components/canvas/CanvasAudioPlayer': ({ name }) => createElement('span', { 'data-audio-preview': true }, name),
  '@/components/audio/VoiceSampleButton': ({ optionAction = false }) => createElement('span', { 'data-voice-sample': true }, optionAction ? '试听' : '播放样音'),
  '@/components/audio/SpeechAdvancedOptions': Object.assign(() => null, { speechDialogueDraftError: () => '' }),
  '@/lib/model-selection': { selectAutomaticModel: (models) => models[0] },
  '@/lib/canvas/media': { formatCanvasAudioDuration: () => '0:00' },
  '@/lib/canvas/layers': { CANVAS_Z_INDEX: { modalPopover: 400, modelDialog: 500 } },
  '@/components/audio/voice-options': createTsRequire(process.cwd())('./components/audio/voice-options'),
  '@/components/audio/speech-format-options': createTsRequire(process.cwd())('./components/audio/speech-format-options'),
  '@/components/canvas/audio-speech-request': createTsRequire(process.cwd())('./components/canvas/audio-speech-request'),
  '@/components/cangyuan/CangyuanMusicOptionsFields': Object.assign(() => null, { cangyuanMusicTaskKindName: () => '音乐生成' }),
});
const panel = load('./components/canvas/CanvasAudioNodePanel');
const speechRequest = load('./components/canvas/audio-speech-request');

function render(model, data = { kind: 'audio', speechDraft: { text: '旁白' } }) {
  return renderToStaticMarkup(createElement(panel.default, {
    node: { id: 'audio-1', type: 'media', x: 0, y: 0, data },
    onReplaceAudio: async () => true,
    onSpeechDraftChange: () => {},
    onDurationChange: () => {},
    onNotify: () => {},
    models: [model],
    providers: [{ id: 'provider-1', type: 'openai-compatible', platform: 'custom' }],
  }));
}

test('canvas speech node offers model-directory voice, supported format, speed, and preview controls', () => {
  const markup = render({
    id: 'provider-1:gemini-tts', providerId: 'provider-1', providerName: '兼容服务商', rawId: 'gemini-tts',
    displayName: 'Gemini TTS', kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
  });

  assert.match(markup, /五车二/);
  assert.match(markup, /飞马座/);
  assert.match(markup, /MP3（通用播放）/);
  assert.match(markup, /FLAC（无损压缩）/);
  assert.match(markup, /语速/);
  assert.match(markup, /选择已收录音色后可播放样音/);
  assert.match(markup, /不调用配音接口、不消耗额度/);
  assert.doesNotMatch(markup, /沧元算力/);
});

test('canvas audio result pane keeps transcription and music history visible', () => {
  const markup = render({
    id: 'provider-1:tts', providerId: 'provider-1', providerName: '兼容服务商', rawId: 'vendor-tts',
    displayName: '兼容配音', kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
  }, {
    kind: 'audio',
    speechGenerations: [
      { text: '历史配音', engine: 'provider', modelName: '配音模型', createdAt: 3, url: '/api/canvas/assets/audio-1', name: '历史配音.mp3' },
    ],
    transcriptions: [
      { text: '第二次转写', modelId: 'asr-1', modelName: '转写模型', responseFormat: 'text', temperature: 0, sourceAudioName: 'take-2.wav', createdAt: 2 },
      { text: '第一次转写', modelId: 'asr-1', modelName: '转写模型', responseFormat: 'text', temperature: 0, sourceAudioName: 'take-1.wav', createdAt: 1 },
    ],
    musicTasks: [
      { id: 'music-2', modelId: 'music-1', modelName: '音乐模型', prompt: '第二首', status: 'succeeded', outputs: [{ url: 'https://example.test/two.wav', artifactType: 'wav' }], createdAt: '2026-11-18T00:00:02.000Z' },
      { id: 'music-1', modelId: 'music-1', modelName: '音乐模型', prompt: '第一首', status: 'failed', outputs: [], createdAt: '2026-11-18T00:00:01.000Z' },
    ],
  });
  assert.match(markup, /第二次转写/);
  assert.match(markup, /第一次转写/);
  assert.match(markup, /第二首/);
  assert.match(markup, /第一首/);
  assert.match(markup, /设为当前音频/);
  assert.match(markup, /历史配音/);
  assert.match(markup, /下载音频/);
});

test('canvas speech node keeps unknown provider voice entry and does not invent model-specific controls', () => {
  const markup = render({
    id: 'provider-1:custom-tts', providerId: 'provider-1', providerName: '其他服务商', rawId: 'custom-tts',
    displayName: 'Custom TTS', kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
  });

  assert.match(markup, /音色名称/);
  assert.match(markup, /选择已收录音色后可播放样音/);
  assert.doesNotMatch(markup, /aria-label="配音输出格式"/);
  assert.doesNotMatch(markup, /语速/);
});

test('canvas speech requests preserve selected controls and keep preview out of normal generation payloads', () => {
  assert.deepEqual(speechRequest.buildCanvasSpeechRequest({
    text: '旁白', voice: '  Ursa ', modelId: 'provider-1:gemini-tts', format: 'flac', speed: 1.25,
    projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'audio-1',
  }), {
    text: '旁白', voice: 'Ursa', modelId: 'provider-1:gemini-tts', format: 'flac', speed: 1.25,
    source: 'canvas', projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'audio-1',
  });
  assert.deepEqual(speechRequest.buildCanvasSpeechRequest({
    text: '固定试听短句', voice: '', modelId: 'provider-1:gemini-tts', preview: true, nodeId: 'audio-1',
  }), {
    text: '固定试听短句', modelId: 'provider-1:gemini-tts', preview: true, source: 'canvas', nodeId: 'audio-1',
  });
});
