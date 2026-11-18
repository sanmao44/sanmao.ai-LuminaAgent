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
  '@/lib/model-selection': { selectAutomaticModel: (models) => models[0] },
  '@/lib/canvas/media': { formatCanvasAudioDuration: () => '0:00' },
  '@/lib/canvas/layers': { CANVAS_Z_INDEX: { modalPopover: 400, modelDialog: 500 } },
  '@/components/audio/voice-options': createTsRequire(process.cwd())('./components/audio/voice-options'),
  '@/components/audio/speech-format-options': createTsRequire(process.cwd())('./components/audio/speech-format-options'),
  '@/components/canvas/audio-speech-request': createTsRequire(process.cwd())('./components/canvas/audio-speech-request'),
});
const panel = load('./components/canvas/CanvasAudioNodePanel');
const speechRequest = load('./components/canvas/audio-speech-request');

function render(model) {
  return renderToStaticMarkup(createElement(panel.default, {
    node: { id: 'audio-1', type: 'media', x: 0, y: 0, data: { kind: 'audio', speechDraft: { text: '旁白' } } },
    onReplaceAudio: async () => true,
    onSpeechDraftChange: () => {},
    onDurationChange: () => {},
    onNotify: () => {},
    models: [model],
    providers: [{ id: 'provider-1', platform: 'custom' }],
  }));
}

test('canvas speech node offers model-directory voice, supported format, speed, and preview controls', () => {
  const markup = render({
    id: 'provider-1:gemini-tts', providerId: 'provider-1', providerName: '兼容服务商', rawId: 'gemini-tts',
    displayName: 'Gemini TTS', kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
  });

  assert.match(markup, /五车二/);
  assert.match(markup, /佩伽索斯/);
  assert.match(markup, /MP3（通用播放）/);
  assert.match(markup, /FLAC（无损压缩）/);
  assert.match(markup, /语速/);
  assert.match(markup, /试听音色/);
  assert.match(markup, /按当前模型正常计费，不保存到记录/);
  assert.doesNotMatch(markup, /沧元算力/);
});

test('canvas speech node keeps unknown provider voice entry and does not invent model-specific controls', () => {
  const markup = render({
    id: 'provider-1:custom-tts', providerId: 'provider-1', providerName: '其他服务商', rawId: 'custom-tts',
    displayName: 'Custom TTS', kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
  });

  assert.match(markup, /音色名称/);
  assert.match(markup, /试听音色/);
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
