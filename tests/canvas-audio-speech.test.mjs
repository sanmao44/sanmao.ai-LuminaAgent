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

const speechOptionsModule = createTsRequire(process.cwd(), {
  '@/components/SelectMenu': selectMenu,
  '@/components/audio/MiniMaxVoicePicker': ({ value }) => createElement('input', { 'aria-label': 'MiniMax 音色编号', value, readOnly: true }),
  '@/components/audio/SpeechVoiceRegistration': () => null,
})('./components/audio/SpeechAdvancedOptions');
const speechOptions = Object.assign(speechOptionsModule.default, {
  speechDialogueDraftError: speechOptionsModule.speechDialogueDraftError,
});

const load = createTsRequire(process.cwd(), {
  '@/components/ModelPicker': () => null,
  '@/components/SelectMenu': selectMenu,
  '@/components/canvas/CanvasAudioPlayer': ({ name }) => createElement('span', { 'data-audio-preview': true }, name),
  '@/components/cangyuan/CangyuanMusicOptionsFields': () => null,
  '@/components/audio/VoiceSampleButton': ({ model, voice, providerKey, optionAction = false }) => createElement('span', { 'data-voice-sample': true, 'data-sample-model': model, 'data-sample-voice': voice, 'data-sample-provider': providerKey }, optionAction ? '试听' : '播放样音'),
  '@/components/audio/SpeechAdvancedOptions': speechOptions,
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
const speechContracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
const musicOptions = createTsRequire(process.cwd(), {
  '@/components/cangyuan/CangyuanSuggestionInput': ({ ariaLabel, value }) => createElement('input', { 'aria-label': ariaLabel, value, readOnly: true }),
  '@/components/cangyuan/CangyuanMediaUploadField': ({ label }) => createElement('div', { 'aria-label': label }, label),
  './CangyuanMusicOptionsFields.css': {},
  '@/components/SelectMenu': selectMenu,
})('./components/cangyuan/CangyuanMusicOptionsFields').default;

function render(model, data = { kind: 'audio', speechDraft: { text: '旁白' } }, provider = { id: 'provider-1', type: 'openai-compatible', platform: 'custom' }) {
  return renderToStaticMarkup(createElement(panel.default, {
    node: { id: 'audio-1', type: 'media', x: 0, y: 0, data },
    onReplaceAudio: async () => true,
    onSpeechDraftChange: () => {},
    onDurationChange: () => {},
    onNotify: () => {},
    models: [model],
    providers: [provider],
  }));
}

test('canvas speech node offers model-directory voice, supported format, speed, and preview controls', () => {
  const markup = render({
    id: 'provider-1:gemini-tts', providerId: 'provider-1', providerName: '兼容服务商', rawId: 'gemini-tts',
    displayName: 'Gemini TTS', kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
  }, { kind: 'audio', speechDraft: { text: '旁白' } }, { id: 'provider-1', type: 'openai-compatible', platform: 'cangyuan' });

  assert.match(markup, /五车二/);
  assert.match(markup, /飞马座/);
  assert.match(markup, /MP3（通用播放）/);
  assert.match(markup, /FLAC（无损压缩）/);
  assert.match(markup, /语速/);
  assert.match(markup, /选择已收录音色后可播放样音/);
  assert.match(markup, /本地样音只播放精确匹配的预设音色，不消耗额度/);
  assert.match(markup, /配音参数/);
  assert.doesNotMatch(markup, /<details/);
  assert.doesNotMatch(markup, /沧元算力/);
});

test('canvas restores MiniMax speech options from the saved node draft', () => {
  const model = {
    id: 'provider-1:minimax-speech-2.8-hd-tts', providerId: 'provider-1', providerName: '兼容服务商',
    rawId: 'minimax-speech-2.8-hd-tts', displayName: 'MiniMax Speech 2.8 HD', kind: 'audio', enabled: true,
    published: true, capabilities: ['speech'],
  };
  const markup = render(model, {
    kind: 'audio',
    speechDraft: {
      modelId: model.id,
      text: '持久化测试',
      voiceId: 'voice-registered',
      aigcWatermark: false,
      bitrate: '128000',
      channel: '2',
      effectIntensity: -20,
      effectPitch: 3,
      effectTimbre: 12,
      latexRead: true,
      pitch: -2,
      pronunciationTone: '儿化',
      sampleRate: '44100',
      soundEffects: 'robotic',
      textNormalizationMode: 'quality',
      volume: 1.5,
    },
  }, { id: 'provider-1', type: 'openai-compatible', platform: 'cangyuan' });

  for (const value of ['128000', '2', 'robotic', 'quality', '44100']) assert.match(markup, new RegExp(`<option value="${value}" selected="">`));
  for (const label of ['生成水印', 'MP3 比特率', '声道', '力度效果', '音高效果', '音色效果', '公式朗读', '发音标注', '声音效果', '文本规范化方式', '音量']) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /value="-20"/);
  assert.match(markup, /value="3"/);
  assert.match(markup, /value="12"/);
  assert.match(markup, /value="1\.5"/);
});

test('canvas restores official MiniMax voices with the same sample identity instead of the registered-voice placeholder', () => {
  const catalog = createTsRequire(process.cwd())('./packages/contracts/cangyuan-minimax-voices');
  const provider = { id: 'provider-1', type: 'openai-compatible', platform: 'cangyuan' };
  for (const rawId of ['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']) {
    const model = {
      id: `provider-1:${rawId}`, providerId: 'provider-1', providerName: '兼容服务商', rawId,
      displayName: rawId, kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
    };
    for (const voice of catalog.CANGYUAN_MINIMAX_VOICES) {
      const markup = render(model, { kind: 'audio', speechDraft: { modelId: model.id, text: '精确音色测试', voiceId: voice.voiceId } }, provider);
      assert.ok(markup.includes(`data-sample-model="${rawId}" data-sample-voice="${voice.voiceId}" data-sample-provider="cangyuan"`));
      assert.match(markup, /官方参考样音与生成使用同一音色/);
      assert.doesNotMatch(markup, /已登记音色编号暂无预设样音|当前使用自备或已登记音色/);
    }
    const customMarkup = render(model, { kind: 'audio', speechDraft: { modelId: model.id, text: '克隆音色测试', voiceId: 'private-cloned-voice' } }, provider);
    assert.match(customMarkup, /当前使用自备或已登记音色/);
    assert.match(customMarkup, /已登记音色编号暂无预设样音/);
    assert.doesNotMatch(customMarkup, /data-sample-voice="voice_builtin_/);
  }
});

test('canvas restores every legacy MiniMax voice using its same-name same-language official sample', () => {
  const voices = createTsRequire(process.cwd())('./packages/contracts/minimax-system-voices');
  const official = voices.getMiniMaxSystemVoices('cangyuan');
  const provider = { id: 'provider-1', type: 'openai-compatible', platform: 'cangyuan' };
  for (const rawId of ['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']) {
    const model = { id: `provider-1:${rawId}`, providerId: 'provider-1', providerName: '兼容服务商', rawId, displayName: rawId, kind: 'audio', enabled: true, published: true, capabilities: ['speech'] };
    for (const legacy of voices.MINIMAX_SYSTEM_VOICES) {
      const exact = official.filter((voice) => voice.originalName === legacy.name && voice.languageLabel === legacy.languageLabel);
      assert.equal(exact.length, 1, legacy.voiceId);
      const markup = render(model, { kind: 'audio', speechDraft: { modelId: model.id, text: '恢复旧音色', voiceId: legacy.voiceId } }, provider);
      assert.ok(markup.includes(`data-sample-model="${rawId}" data-sample-voice="${exact[0].voiceId}" data-sample-provider="cangyuan"`));
      assert.match(markup, /官方参考样音与生成使用同一音色/);
      assert.doesNotMatch(markup, /已登记音色编号暂无预设样音|当前使用自备或已登记音色/);
    }
  }
});

test('canvas speech layout renders every catalog model and voice-clone engine variant', () => {
  const provider = { id: 'provider-1', type: 'openai-compatible', platform: 'cangyuan' };
  const cases = speechContracts.SPEECH_MODEL_PROFILE_LIST.flatMap((profile) => [
    { profile, engine: undefined },
    ...(profile.publicModel === 'voice-clone-tts'
      ? profile.engineOptions.map((engine) => ({ profile, engine }))
      : []),
  ]);

  for (const { profile, engine } of cases) {
    const model = {
      id: `provider-1:${profile.publicModel}`,
      providerId: 'provider-1',
      providerName: '兼容服务商',
      rawId: profile.publicModel,
      displayName: profile.publicModel,
      kind: 'audio',
      enabled: true,
      published: true,
      capabilities: ['speech'],
    };
    const markup = render(model, {
      kind: 'audio',
      speechDraft: { modelId: model.id, text: '布局检查', engine },
    }, provider);

    assert.match(markup, /class="canvas-audio-speech(?:\s|"|>)/, profile.publicModel);
    assert.match(markup, /class="canvas-audio-panel-main/, profile.publicModel);
    assert.doesNotMatch(markup, /<details/, profile.publicModel);
    if (profile.supportsAdvancedControls || profile.supportsDialogue || profile.supportsVoiceId) {
      assert.match(markup, /canvas-audio-speech-complex/, profile.publicModel);
    } else {
      assert.doesNotMatch(markup, /canvas-audio-speech-complex/, profile.publicModel);
    }
    if (profile.suggestedVoices.length) assert.match(markup, /aria-label="配音音色"/, profile.publicModel);
    if (profile.responseFormats.length || profile.publicModel === 'voice-clone-tts') {
      assert.match(markup, /aria-label="配音输出格式"/, `${profile.publicModel} ${engine || '默认引擎'}`);
    }
    if (profile.supportsDialogue) assert.match(markup, /多人对白/, profile.publicModel);
    if (profile.supportsVoiceId) assert.match(markup, /音色编号/, profile.publicModel);
    if (profile.publicModel === 'voice-clone-tts') assert.match(markup, /声音引擎/, engine || profile.publicModel);
  }
});

test('empty audio nodes give the editor width to generation controls instead of an empty results rail', () => {
  const markup = render({
    id: 'provider-1:tts', providerId: 'provider-1', providerName: '兼容服务商', rawId: 'vendor-tts',
    displayName: '兼容配音', kind: 'audio', enabled: true, published: true, capabilities: ['speech'],
  });

  assert.match(markup, /class="canvas-audio-panel-main"/);
  assert.doesNotMatch(markup, /aria-label="音频素材与生成记录"/);
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

test('custom speech voices never display a sample recorded for another voice', () => {
  const markup = render({
    id: 'provider-1:elevenlabs-v4-tts', providerId: 'provider-1', providerName: '兼容服务商',
    rawId: 'elevenlabs-v4-tts', displayName: 'ElevenLabs v4', kind: 'audio', enabled: true,
    published: true, capabilities: ['speech'],
  }, { kind: 'audio', speechDraft: { voice: 'alloy', text: '旁白' } }, { id: 'provider-1', type: 'openai-compatible', platform: 'cangyuan' });

  assert.match(markup, /自定义音色暂无对应样音/);
  assert.match(markup, /自定义音色不会使用其他音色代替/);
  assert.doesNotMatch(markup, />播放样音<\/span>/);
});

test('speech and music model-specific controls render expanded in the canvas workbench', () => {
  const speechMarkup = renderToStaticMarkup(createElement(speechOptions, {
    profile: {
      publicModel: 'voice-clone-tts',
      supportsAdvancedControls: true,
      supportsDialogue: false,
      supportsVoiceId: true,
      requiresVoiceId: false,
      engineOptions: ['qwen3'],
      languageCodes: ['zh'],
      emotionOptions: ['neutral'],
    },
    value: {},
    onChange: () => {},
    compact: true,
    alwaysVisible: true,
  }));

  assert.doesNotMatch(speechMarkup, /<details/);
  for (const label of ['自备音色编号', '声音引擎', '语言', '情绪', '语气说明', '随机种子（可选）', '音色相似度', '稳定度']) {
    assert.match(speechMarkup, new RegExp(label));
  }

  const musicMarkup = renderToStaticMarkup(createElement(musicOptions, {
    profile: {
      family: 'lyria', modelId: 'lyria-3-pro', allowedOptions: ['title', 'duration', 'instrumental', 'lyrics'],
      titleMaxLength: 80, durationRange: [3, 184], lyricsMaxLength: 3000,
    },
    options: {},
    onChange: () => {},
    alwaysVisible: true,
  }));

  assert.doesNotMatch(musicMarkup, /<details/);
  for (const label of ['目标时长', '纯音乐', '歌词', '节奏与输出', '节奏速度', '固定生成编号', '保存格式']) {
    assert.match(musicMarkup, new RegExp(label));
  }

  const workflowMarkup = renderToStaticMarkup(createElement(musicOptions, {
    profile: {
      family: 'suno-workflow', modelId: 'suno-extend-audio', allowedOptions: [
        'sourceAudioId', 'sourceTrack', 'title', 'style_text', 'lyrics', 'instrumental', 'customMode', 'tags',
        'audioWeight', 'negativeTags', 'personaId', 'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
      ],
      titleMaxLength: 80, styleTextMaxLength: 1000, lyricsMaxLength: 5000,
    },
    options: {},
    onChange: () => {},
    alwaysVisible: true,
  }));

  assert.doesNotMatch(workflowMarkup, /<details/);
  for (const label of ['待续写音频', '从此位置续写', '更多设置', '指定结果曲目编号', '曲目序号（从 0 开始）', '音乐风格', '完整歌词', '排除风格', '复用音色方案编号', '生成风格', '人声类型']) {
    assert.match(workflowMarkup, new RegExp(label));
  }
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
  assert.deepEqual(speechRequest.buildCanvasSpeechRequest({
    text: '自备音色', voice: 'Rachel', voiceId: 'registered-voice', modelId: 'provider-1:elevenlabs-v4-tts',
    profileModelId: 'elevenlabs-v4-tts', providerKey: 'cangyuan', nodeId: 'audio-1',
  }), {
    text: '自备音色', voiceId: 'registered-voice', modelId: 'provider-1:elevenlabs-v4-tts',
    source: 'canvas', nodeId: 'audio-1',
  });
});

test('canvas MiniMax speech requests forward the complete model-specific option set', () => {
  const request = speechRequest.buildCanvasSpeechRequest({
    text: '参数透传测试',
    voice: '',
    modelId: 'provider-1:minimax-speech-2.8-hd-tts',
    profileModelId: 'minimax-speech-2.8-hd-tts',
    providerKey: 'cangyuan',
    format: 'mp3',
    speed: 1.2,
    voiceId: 'registered-voice',
    aigcWatermark: false,
    bitrate: '128000',
    channel: '2',
    effectIntensity: -20,
    effectPitch: 3,
    effectTimbre: 12,
    emotion: 'calm',
    language: 'Chinese',
    latexRead: true,
    pitch: -2,
    pronunciationTone: '儿化',
    sampleRate: '44100',
    soundEffects: 'robotic',
    textNormalizationMode: 'quality',
    volume: 1.5,
    nodeId: 'audio-1',
  });

  assert.deepEqual({
    voiceId: request.voiceId,
    aigcWatermark: request.aigcWatermark,
    bitrate: request.bitrate,
    channel: request.channel,
    effectIntensity: request.effectIntensity,
    effectPitch: request.effectPitch,
    effectTimbre: request.effectTimbre,
    emotion: request.emotion,
    language: request.language,
    latexRead: request.latexRead,
    pitch: request.pitch,
    pronunciationTone: request.pronunciationTone,
    sampleRate: request.sampleRate,
    soundEffects: request.soundEffects,
    textNormalizationMode: request.textNormalizationMode,
    volume: request.volume,
    speed: request.speed,
  }, {
    voiceId: 'registered-voice',
    aigcWatermark: false,
    bitrate: '128000',
    channel: '2',
    effectIntensity: -20,
    effectPitch: 3,
    effectTimbre: 12,
    emotion: 'calm',
    language: 'Chinese',
    latexRead: true,
    pitch: -2,
    pronunciationTone: '儿化',
    sampleRate: '44100',
    soundEffects: 'robotic',
    textNormalizationMode: 'quality',
    volume: 1.5,
    speed: 1.2,
  });
});
