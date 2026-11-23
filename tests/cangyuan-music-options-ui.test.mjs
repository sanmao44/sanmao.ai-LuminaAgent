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
const musicFieldsModule = loader('./components/cangyuan/CangyuanMusicOptionsFields');
const CangyuanMusicOptionsFields = musicFieldsModule.default;
const { SFX_KEY_OPTIONS } = musicFieldsModule;
const { cangyuanMusicTaskKindName } = musicFieldsModule;
const { getCangyuanMusicModelProfile, CANGYUAN_MUSIC_MODEL_PROFILE_LIST } = loader('./packages/contracts/cangyuan-media');

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

function renderSfxOptions(options) {
  return renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
    profile: getCangyuanMusicModelProfile('suno-sfx'),
    options,
    onChange: () => undefined,
  }));
}

function renderElevenLabsOptions(modelId, options) {
  return renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
    profile: getCangyuanMusicModelProfile(modelId),
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

test('audio-node option layout renders every registered music and sound-effect model profile', () => {
  assert.equal(CANGYUAN_MUSIC_MODEL_PROFILE_LIST.length, 24);

  for (const profile of CANGYUAN_MUSIC_MODEL_PROFILE_LIST) {
    const markup = renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
      profile,
      options: {},
      onChange: () => undefined,
      alwaysVisible: true,
    }));

    assert.match(markup, /class="cangyuan-music-options(?:\s|\")/, profile.modelId);
    assert.doesNotMatch(markup, /<details/, profile.modelId);
  }
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
    assert.match(markup, /aria-label="固定生成编号"[^>]*min="0" max="2147483647"[^>]*value="0"/);
    assert.match(markup, /maxLength="20000"[^>]*>风吹过长夜</);
    assert.match(markup, /data-value="mp3">MP3 · 通用播放/);
    assert.match(markup, /data-value="wav">WAV · 后期编辑/);
    assert.match(markup, /data-value="m4a">M4A · 便于分享/);
    assert.match(markup, /<details class="cangyuan-music-advanced"><summary>节奏与输出</);
    assert.equal(markup.includes('184 秒'), modelId === 'lyria-3-pro');
  }
});

test('Lyria canvas options keep every parameter visible in a compact two-column panel', () => {
  const markup = renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
    profile: getCangyuanMusicModelProfile('lyria-3-pro'),
    options: {},
    onChange: () => undefined,
    alwaysVisible: true,
  }));

  assert.match(markup, /class="cangyuan-music-options cangyuan-music-options-lyria"/);
  assert.match(markup, /class="cangyuan-music-advanced is-always-visible"/);
  assert.doesNotMatch(markup, /<details/);
  assert.match(markup, /曲名[\s\S]*目标时长[\s\S]*纯音乐[\s\S]*歌词[\s\S]*节奏与输出[\s\S]*保存格式/);
});

test('music option controls take their limits from the selected model profile', () => {
  const sunoV6 = renderSunoV6Options({ duration: 10, style_text: 'dream pop' });
  assert.match(sunoV6, /maxLength="1000"[^>]*>dream pop</);
  assert.match(sunoV6, /type="number" min="10" max="360" step="1"[^>]*value="10"/);
  assert.match(sunoV6, /请求数量参数固定为 1；实际结果通常返回 2 首/);
  assert.doesNotMatch(sunoV6, /单次固定生成 1 首/);

  const renderWorkflow = (modelId, options) => renderToStaticMarkup(createElement(CangyuanMusicOptionsFields, {
    profile: getCangyuanMusicModelProfile(modelId), options, onChange: () => undefined,
  }));
  const extend = renderWorkflow('suno-extend-audio', {
    uploadUrl: 'https://cdn.example.test/source.wav', style_text: 'x'.repeat(1_001),
  });
  assert.doesNotMatch(extend, /maxLength="1000"/);
  const replace = renderWorkflow('suno-replace-section', {
    sourceTaskId: 'source-job', infillStartS: '1', infillEndS: '3', lyrics: 'x'.repeat(20_001),
  });
  assert.doesNotMatch(replace, /maxLength="20000"/);
});

test('Suno sound effect keys show Chinese names and keep accepted values unchanged', () => {
  const markup = renderSfxOptions({ sound_key: 'C#m', sound_tempo: 82 });

  assert.match(markup, /data-value="Any">任意调性/);
  assert.match(markup, /data-value="C#m">升 C 小调/);
  assert.match(markup, /data-value="C">C 大调/);
  assert.match(markup, /节奏速度（每分钟拍数，1–300）/);
  assert.equal(SFX_KEY_OPTIONS.find(({ label }) => label === '升 C 小调')?.value, 'C#m');
  assert.equal(SFX_KEY_OPTIONS.find(({ label }) => label === 'C 大调')?.value, 'C');
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

test('ElevenLabs music controls document length, discrete durations, seed, instrumental mode, and format cost', () => {
  const profile = getCangyuanMusicModelProfile('elevenlabs-music');
  assert.equal(profile.promptMaxLength, 4_000);
  assert.deepEqual(profile.durationValues, [10, 30, 60, 120, 180]);
  assert.equal(profile.durationDefault, 30);

  const markup = renderElevenLabsOptions('elevenlabs-music', {
    duration: 60, seed: 0, force_instrumental: true, output_format: 'mp3_hq',
  });
  for (const text of ['60 秒', '默认（30 秒）', '只生成伴奏', 'MP3 高码率（更高费用）', '最多 4000 字符', '一次任务可能返回多段音频']) {
    assert.match(markup, new RegExp(text));
  }
  assert.match(markup, /aria-label="音乐随机种子"[^>]*min="0"[^>]*value="0"/);
  assert.doesNotMatch(markup, /歌词|循环音效|描述影响度/);
});

test('ElevenLabs sound effects show model-specific limits and only their applicable controls', () => {
  const v2 = getCangyuanMusicModelProfile('elevenlabs-sound-effects-v2');
  assert.equal(v2.promptMaxLength, 4_000);
  assert.deepEqual(v2.durationRange, [0.5, 22]);
  assert.deepEqual(v2.promptInfluenceRange, [0, 1]);
  const v2Markup = renderElevenLabsOptions('elevenlabs-sound-effects-v2', {
    duration: 0.5, loop: true, prompt_influence: 0.3, output_format: 'mp3',
  });
  assert.match(v2Markup, /aria-label="音效时长"/);
  assert.match(v2Markup, /data-value="0.5">0.5 秒/);
  assert.match(v2Markup, /data-value="22">22 秒/);
  assert.doesNotMatch(v2Markup, /data-value="(?:0.7|23)"/);
  assert.match(v2Markup, /支持 0.5 秒或 1–22 的整数秒，默认 5 秒/);
  assert.match(v2Markup, /描述影响度/);
  assert.match(v2Markup, /MP3 与高码率 MP3 不改变价格/);
  assert.match(v2Markup, /生成可循环音效/);

  const v3 = getCangyuanMusicModelProfile('elevenlabs-sound-effects-v3');
  assert.deepEqual(v3.durationRange, [0.5, 30]);
  const v3Markup = renderElevenLabsOptions('elevenlabs-sound-effects-v3', { duration: 30 });
  assert.match(v3Markup, /data-value="0.5">0.5 秒/);
  assert.match(v3Markup, /data-value="30">30 秒/);
  assert.match(v3Markup, /支持 0.5 秒或 1–30 的整数秒，默认 5 秒/);
  assert.doesNotMatch(v3Markup, /歌词|只生成伴奏/);
});

test('Suno alias remains unavailable while official documentation marks it pending', () => {
  assert.equal(getCangyuanMusicModelProfile('suno'), null);
});

test('music workspace and canvas can label music and sound-effect profiles distinctly', () => {
  assert.equal(cangyuanMusicTaskKindName(getCangyuanMusicModelProfile('suno-v6')), '音乐');
  assert.equal(cangyuanMusicTaskKindName(getCangyuanMusicModelProfile('elevenlabs-music')), '音乐');
  assert.equal(cangyuanMusicTaskKindName(getCangyuanMusicModelProfile('suno-sfx')), '音效');
  assert.equal(cangyuanMusicTaskKindName(getCangyuanMusicModelProfile('elevenlabs-sound-effects-v2')), '音效');
  assert.equal(cangyuanMusicTaskKindName(getCangyuanMusicModelProfile('elevenlabs-sound-effects-v3')), '音效');
});
