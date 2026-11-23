import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const presentation = createTsRequire(process.cwd())('./components/media-task-presentation');
const loader = createTsRequire(process.cwd(), {
  '@/components/media-task-presentation': presentation,
  '@/components/GenerationLogAudio': {
    GenerationLogAudioPlayer: ({ src }) => createElement('audio', { src }),
  },
});
const Output = loader('./components/MediaTaskAudioOutput').default;

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

test('sound-effect outputs retain playable results without music or continuation labels', () => {
  for (const audioId of [undefined, 'effect-1']) {
    const markup = renderToStaticMarkup(createElement(Output, {
      output: { artifactType: 'audio', url: 'https://cdn.example.test/click.mp3', audioId },
      index: 0,
      kind: 'sound-effect',
      canContinue: true,
    }));
    assert.match(markup, /<b>音效 1<\/b>/);
    assert.match(markup, /<audio src="https:\/\/cdn\.example\.test\/click\.mp3"><\/audio>/);
    assert.doesNotMatch(markup, /音乐|曲目|续写此曲/);
  }
  assert.equal(presentation.mediaTaskAudioOutputTitle({ title: '科技点击' }, 0, 'sound-effect'), '科技点击');
  assert.equal(presentation.mediaTaskAudioOutputTitle({}, 0), '音乐 1');
  assert.equal(presentation.mediaTaskAudioOutputTitle({ audioId: 'track-1' }, 0), '曲目 1');
  assert.equal(presentation.mediaTaskAudioOutputTitle({ artifactType: 'midi' }, 1, 'sound-effect'), 'MIDI 文件 2');
});

test('audio output purpose follows the saved provider model rather than the current editor tab', () => {
  for (const model of ['elevenlabs-sound-effects-v2', 'elevenlabs-sound-effects-v3', 'suno-sfx']) {
    assert.equal(presentation.mediaTaskAudioKind(model), 'sound-effect');
  }
  assert.equal(presentation.mediaTaskAudioKind('elevenlabs-music'), 'music');
  assert.equal(presentation.mediaTaskAudioKind(undefined), 'music');
});

test('explicit provider model-allowlist errors have actionable Chinese messages', () => {
  const error = 'This API key has a model allowlist, and the requested model "elevenlabs-sound-effects-v3" is not in it. Add elevenlabs-sound-effects-v3 to the key\'s model list on the API keys page (https://provider.example.test/api-keys) or clear the allowlist.';
  const message = presentation.mediaTaskErrorMessage(error);
  assert.match(message, /密钥未获准调用模型“elevenlabs-sound-effects-v3”/);
  assert.match(message, /更换已授权的服务连接/);
  assert.match(message, /服务商的 API 密钥页面/);
  assert.doesNotMatch(message, /https:|This API key|清空/);

  for (const original of ['HTTP 403: Forbidden', '余额不足', '读取结果超时', 'This model is unavailable', 'The model allowlist could not be loaded']) {
    assert.equal(presentation.mediaTaskErrorMessage(original), original);
  }
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
