import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const presentation = createTsRequire(process.cwd())('./lib/generation-log-presentation');
const components = createTsRequire(process.cwd(), {
  '@/lib/generation-log-presentation': presentation,
  './GenerationLogAudio.css': {},
});
const { GenerationLogAudioPlayer, GenerationLogAudioWorks } = components('./components/GenerationLogAudio');

test('generation log audio controls render compact playback controls and filename-preserving download', () => {
  const markup = renderToStaticMarkup(createElement(GenerationLogAudioPlayer, {
    src: '/api/storage/audio?name=1740000000-speech.wav',
    title: 'Sample narration',
  }));
  assert.match(markup, /class="generation-log-audio-controls"/);
  assert.match(markup, /<audio[^>]+src="\/api\/storage\/audio\?name=1740000000-speech\.wav"/);
  assert.doesNotMatch(markup, /<audio[^>]*\scontrols(?:\s|>)/);
  assert.match(markup, /aria-label="播放音频"/);
  assert.match(markup, /aria-label="音频播放进度"/);
  assert.match(markup, /aria-label="音量"/);
  assert.match(markup, /download="1740000000-speech\.wav"/);
  assert.match(markup, />下载音频</);
});

test('generation log audio preview can reuse themed controls without duplicating viewer download actions', () => {
  const markup = renderToStaticMarkup(createElement(GenerationLogAudioPlayer, {
    src: '/api/media/preview/audio-1',
    downloadable: false,
  }));
  assert.match(markup, /generation-log-audio-preview/);
  assert.match(markup, /class="generation-log-audio-controls"/);
  assert.doesNotMatch(markup, /generation-log-audio-download/);
});

test('generation log audio works render saved results and their source labels', () => {
  const markup = renderToStaticMarkup(createElement(GenerationLogAudioWorks, {
    logs: [{
      id: 'audio-1', mode: 'audio', mediaKind: 'audio', status: 'success', source: 'canvas',
      prompt: 'Project narration', modelName: 'Gemini TTS', createdAt: '2026-11-17T00:00:00.000Z',
      audioUrl: '/api/storage/audio?name=project.wav',
    }],
  }));
  assert.match(markup, /aria-label="音频作品"/);
  assert.match(markup, /Project narration/);
  assert.match(markup, /画布生成/);
  assert.match(markup, /project\.wav/);
  assert.match(markup, /generation-log-audio-controls/);
  assert.doesNotMatch(markup, /<audio[^>]*\scontrols(?:\s|>)/);
});
