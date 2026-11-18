import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loader = createTsRequire(process.cwd(), {
  '@/components/GenerationLogAudio': {
    GenerationLogAudioPlayer: ({ src }) => createElement('audio', { src }),
  },
});
const Output = loader('./components/MediaTaskAudioOutput').default;
const presentation = loader('./components/media-task-presentation');

test('media task output displays text results without treating them as audio', () => {
  const markup = renderToStaticMarkup(createElement(Output, {
    output: { artifactType: 'text', text: '第一段歌词\n第二段歌词' },
    index: 0,
  }));

  assert.match(markup, /第一段歌词/);
  assert.match(markup, /第二段歌词/);
  assert.doesNotMatch(markup, /<audio/);
  assert.doesNotMatch(markup, /未返回可播放或可读取的结果/);
});

test('media task output presents MIDI as a download and keeps ordinary audio playable', () => {
  const midi = renderToStaticMarkup(createElement(Output, {
    output: { artifactType: 'midi', url: 'https://cdn.example.test/song.mid', name: 'song.mid' },
    index: 0,
  }));
  assert.match(midi, /MIDI 音乐文件/);
  assert.match(midi, /href="https:\/\/cdn\.example\.test\/song\.mid" download="song\.mid">下载文件/);
  assert.doesNotMatch(midi, /<audio/);

  const audio = renderToStaticMarkup(createElement(Output, {
    output: { artifactType: 'audio', url: 'https://cdn.example.test/song.mp3' },
    index: 0,
  }));
  assert.match(audio, /<audio src="https:\/\/cdn\.example\.test\/song\.mp3"><\/audio>/);
});

test('media task presentation translates generation modes and provider states', () => {
  assert.equal(presentation.mediaTaskModeLabel('image-to-3d'), '图生 3D');
  assert.equal(presentation.mediaTaskModeLabel('multiview-to-3d'), '多视图 3D');
  assert.equal(presentation.mediaTaskModeLabel(undefined), '三维生成任务');
  assert.equal(presentation.mediaTaskProviderStatusLabel('in_progress', 'running'), '服务商正在生成…');
  assert.equal(presentation.mediaTaskProviderStatusLabel('queued', 'pending'), '等待服务商处理…');
  assert.equal(presentation.mediaTaskProviderStatusLabel('incomplete', 'running'), '服务商正在处理…');
  assert.equal(presentation.mediaTaskProviderStatusLabel('unknown_state', 'running'), '服务商正在处理…');
});
