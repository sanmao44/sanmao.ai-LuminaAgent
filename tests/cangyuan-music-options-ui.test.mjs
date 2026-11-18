import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loader = createTsRequire(process.cwd(), {
  '@/components/SelectMenu': {
    __esModule: true,
    default: ({ options, ariaLabel }) => createElement('div', { 'aria-label': ariaLabel },
      ...options.map((option) => createElement('span', { key: String(option.value), 'data-value': String(option.value) }, option.label))),
  },
  '@/components/cangyuan/CangyuanSuggestionInput': {
    __esModule: true,
    default: ({ options, ariaLabel, value, placeholder }) => createElement('div', { 'aria-label': ariaLabel },
      createElement('input', { value, placeholder, readOnly: true }),
      ...options.map((option) => typeof option === 'string'
        ? createElement('span', { key: option, 'data-value': option }, option)
        : createElement('span', { key: option.value, 'data-value': option.value }, option.label))),
  },
  '@/components/cangyuan/CangyuanMediaUploadField': {
    __esModule: true,
    default: ({ label }) => createElement('div', null, label),
  },
  './CangyuanMusicOptionsFields.css': {},
});
const CangyuanMusicOptionsFields = loader('./components/cangyuan/CangyuanMusicOptionsFields').default;
const { getCangyuanMusicModelProfile } = loader('./packages/contracts/cangyuan-media');

function renderStemOptions(options) {
  return renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
    profile: getCangyuanMusicModelProfile('suno-stem'),
    options,
    onChange: () => undefined,
  }));
}

function renderSunoV6Options(options) {
  return renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
    profile: getCangyuanMusicModelProfile('suno-v6'),
    options,
    onChange: () => undefined,
  }));
}

test('Suno stem UI makes type optional and only requires a track name for advanced separation', () => {
  const defaultMarkup = renderStemOptions({ audioUrl: 'https://cdn.example.test/song.wav' });
  assert.match(defaultMarkup, /默认处理/);
  assert.doesNotMatch(defaultMarkup, /要提取的音轨名称/);

  const advancedMarkup = renderStemOptions({
    audioUrl: 'https://cdn.example.test/song.wav',
    stemType: 'split_stem_advanced',
  });
  assert.match(advancedMarkup, /要提取的音轨名称/);
  assert.match(advancedMarkup, /required=""/);
});

test('Suno v6 persona model presents Chinese presets while keeping provider values', () => {
  const markup = renderSunoV6Options({});

  assert.match(markup, /人格类型/);
  assert.match(markup, /data-value="style_persona">风格人格/);
  assert.match(markup, /data-value="voice_persona">声音人格/);
  assert.match(markup, /data-value="__custom_persona_model__">自定义/);
  assert.doesNotMatch(markup, /Persona 模型|Persona ID/);
});

test('Suno v6 persona model keeps a custom provider value editable', () => {
  const markup = renderSunoV6Options({ personaModel: 'future-compatible-model' });

  assert.match(markup, /data-value="__custom_persona_model__">自定义/);
  assert.match(markup, /自定义人格类型/);
  assert.match(markup, /value="future-compatible-model"/);
});

test('Lyria UI preserves every documented creative option with model-specific bounds', () => {
  for (const modelId of ['lyria-3.5', 'lyria-3-pro']) {
    const markup = renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
      profile: getCangyuanMusicModelProfile(modelId),
      options: { title: '长夜', duration: 5, bpm: 30, seed: 0, audio_format: 'wav', lyrics: '风吹过长夜', instrumental: false },
      onChange: () => undefined,
    }));

    assert.match(markup, /maxLength="160"/);
    assert.match(markup, /min="5" max="300" step="1"[^>]*value="5"/);
    assert.match(markup, /aria-label="节奏速度，每分钟节拍数"[^>]*min="30" max="300"/);
    assert.match(markup, /aria-label="固定创作变化编号"[^>]*min="0" max="2147483647"[^>]*value="0"/);
    assert.match(markup, /maxLength="20000"[^>]*>风吹过长夜</);
    assert.match(markup, /data-value="mp3">MP3 · 通用播放/);
    assert.match(markup, /data-value="wav">WAV · 后期编辑/);
    assert.match(markup, /data-value="m4a">M4A · 便于分享/);
    assert.match(markup, /<details class="cangyuan-music-advanced"><summary>节奏与输出</);
    assert.equal(markup.includes('184 秒'), modelId === 'lyria-3-pro');
  }
});

test('music UI translates recommended versions and preserves custom server-supported choices', () => {
  const markup = renderSunoV6Options({ version: 'future-v7', vocalGender: 'future-voice' });
  assert.match(markup, /data-value="v6">自然人声/);
  assert.match(markup, /data-value="v6-wild">大胆明亮/);
  assert.match(markup, /data-value="v6-mini">快速轻量/);
  assert.match(markup, /value="future-v7"/);
  assert.match(markup, /value="future-voice"/);
});

test('cover UI only offers the documented source track selector while other workflows keep audio ids', () => {
  const render = (modelId) => renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
    profile: getCangyuanMusicModelProfile(modelId), options: {}, onChange: () => undefined,
  }));
  const cover = render('suno-cover-audio');
  assert.doesNotMatch(cover, /指定结果曲目编号/);
  assert.match(cover, /曲目序号/);
  assert.match(render('suno-midi'), /指定结果曲目编号/);
  assert.match(render('suno-persona'), /指定结果曲目编号/);
});
