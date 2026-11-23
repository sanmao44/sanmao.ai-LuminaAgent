import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const provider = createTsRequire(process.cwd())('./lib/cangyuan-media-provider');

test('Cangyuan media URLs normalize a configured /v1 base and encode task ids', () => {
  assert.equal(provider.cangyuanMediaUrl('https://direct-api.cangyuansuanli.cn/v1/', 'music'), 'https://direct-api.cangyuansuanli.cn/v1/music');
  assert.equal(provider.cangyuanMediaUrl('https://direct-api.cangyuansuanli.cn/v1', '3d', 'task /?'), 'https://direct-api.cangyuansuanli.cn/v1/3d/generations/task%20%2F%3F');
});

test('Suno SU2 music payload fixes n=1 and only emits its documented options', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('su2-suno-v6-mini', {
    prompt: 'Dream pop with soft synths', instrumental: true, n: 1,
  }), {
    model: 'su2-suno-v6-mini', prompt: 'Dream pop with soft synths', n: 1,
    instrumental: true,
  });
});

test('Suno utility workflows map model-specific URL, task, timing, and stem fields', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-extend-audio', {
    prompt: 'continue with a soft piano outro', uploadUrl: 'https://cdn.example.test/source.mp3', continueAt: '32.5',
  }), {
    model: 'suno-extend-audio', prompt: 'continue with a soft piano outro', n: 1,
    upload_url: 'https://cdn.example.test/source.mp3', continue_at: '32.5',
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-mashup', {
    prompt: 'combine a piano piece with soft strings',
    uploadUrls: ['https://cdn.example.test/a.mp3', 'https://cdn.example.test/b.mp3'],
  }), {
    model: 'suno-mashup', prompt: 'combine a piano piece with soft strings', n: 1,
    upload_urls: ['https://cdn.example.test/a.mp3', 'https://cdn.example.test/b.mp3'],
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-replace-section', {
    prompt: 'replace with a short instrumental bridge', sourceTaskId: 'job-1', infillStartS: '12.5', infillEndS: '22',
  }), {
    model: 'suno-replace-section', prompt: 'replace with a short instrumental bridge', n: 1,
    source_task_id: 'job-1', infill_start_s: '12.5', infill_end_s: '22',
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-stem', {
    audioUrl: 'https://cdn.example.test/song.wav', stemType: 'split_stem_advanced', stemName: 'drums',
  }), {
    model: 'suno-stem', n: 1, audio_url: 'https://cdn.example.test/song.wav', type: 'split_stem_advanced', stem_name: 'drums',
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-stem', {
    audioUrl: 'https://cdn.example.test/song.wav',
  }), {
    model: 'suno-stem', n: 1, audio_url: 'https://cdn.example.test/song.wav',
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-cover-audio', {
    prompt: 'cover with a warm piano arrangement', sourceTaskId: 'job-1', sourceTrack: 1, customMode: true,
  }), {
    model: 'suno-cover-audio', prompt: 'cover with a warm piano arrangement', n: 1,
    source_task_id: 'job-1', source_track: 1, custom_mode: true,
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-cover-generate', {
    sourceTaskId: 'job-1',
  }), {
    model: 'suno-cover-generate', n: 1, source_task_id: 'job-1',
  });
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-cover-generate', {
    sourceTaskId: 'job-1', sourceAudioId: 'audio-1',
  }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-cover-generate', {
    sourceTaskId: 'job-1', sourceTrack: 0,
  }), /不支持这些音乐参数/);
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-add-instrumental', {
    prompt: 'add a light piano accompaniment', uploadUrl: 'https://cdn.example.test/vocal.mp3', tags: 'piano, gentle',
  }), {
    model: 'suno-add-instrumental', prompt: 'add a light piano accompaniment', n: 1,
    upload_url: 'https://cdn.example.test/vocal.mp3', tags: 'piano, gentle',
  });
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-extend-audio', {
    prompt: 'extend', uploadUrl: 'http://127.0.0.1/song.mp3',
  }), /公网音频地址/);
});

test('Suno v6 payload maps all documented creation fields without sending references', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-v6', {
    prompt: 'Dream pop with soft synths', title: 'Night Drive', style_text: 'dream pop', instrumental: false,
    duration: 180, n: 1, audioWeight: 0.4, negativeTags: 'metal', personaId: 'persona-1',
    personaModel: 'future-compatible-model', styleWeight: 0.7, version: 'v6-wild', vocalGender: 'f',
    weirdnessConstraint: 0.2,
  }), {
    model: 'suno-v6', prompt: 'Dream pop with soft synths', n: 1,
    instrumental: false,
    title: 'Night Drive', style_text: 'dream pop', duration: 180, audioWeight: 0.4,
    negativeTags: 'metal', personaId: 'persona-1', personaModel: 'future-compatible-model',
    styleWeight: 0.7, version: 'v6-wild', vocalGender: 'f', weirdnessConstraint: 0.2,
  });
});

test('ElevenLabs music sends its documented seed, target duration, instrumental, and format fields', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('elevenlabs-music', {
    prompt: 'Warm acoustic song', duration: 180, seed: 0, force_instrumental: true, output_format: 'mp3_hq',
  }), {
    model: 'elevenlabs-music', prompt: 'Warm acoustic song', n: 1, duration: 180,
    seed: 0, force_instrumental: true, output_format: 'mp3_hq',
  });
});

test('ElevenLabs sound effects v2 and v3 serialize their model-specific options', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v2', {
    prompt: 'A soft wooden door closes', duration: 0.5, loop: true, output_format: 'mp3_hq', prompt_influence: 1,
  }), {
    model: 'elevenlabs-sound-effects-v2', prompt: 'A soft wooden door closes', n: 1,
    duration: 0.5, loop: true, output_format: 'mp3_hq', prompt_influence: 1,
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v3', {
    prompt: 'Distant thunder', duration: 30, loop: false, output_format: 'mp3', prompt_influence: 0,
  }), {
    model: 'elevenlabs-sound-effects-v3', prompt: 'Distant thunder', n: 1,
    duration: 30, loop: false, output_format: 'mp3', prompt_influence: 0,
  });
});

test('ElevenLabs music profiles enforce documented prompt, duration, seed, and influence limits', () => {
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-music', { prompt: '' }), /请输入音乐生成描述/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-music', { prompt: 'x'.repeat(4_001) }), /最多 4000 个字符/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-music', { prompt: 'song', duration: 20 }), /仅支持 10、30、60、120、180 秒/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-music', { prompt: 'song', seed: -1 }), /不能小于 0/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v2', { prompt: 'rain', duration: 0.49 }), /必须在 0\.5–22 秒/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v2', { prompt: 'rain', duration: 22.1 }), /必须在 0\.5–22 秒/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v2', { prompt: 'rain', prompt_influence: 1.01 }), /必须在 0–1 之间/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v3', { prompt: 'rain', duration: 30.5 }), /必须在 0\.5–30 秒/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v3', { prompt: 'rain', duration: 31 }), /必须在 0\.5–30 秒/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v3', { prompt: 'rain', loop: 'yes' }), /loop 必须是布尔值/);
  assert.throws(() => provider.buildCangyuanMusicPayload('elevenlabs-sound-effects-v3', { prompt: 'rain', instrumental: true }), /不支持这些音乐参数/);
});

test('ElevenLabs sound effects accept half a second and whole seconds only', () => {
  for (const [model, maximum] of [['elevenlabs-sound-effects-v2', 22], ['elevenlabs-sound-effects-v3', 30]]) {
    for (const duration of [0.5, ...Array.from({ length: maximum }, (_, index) => index + 1)]) {
      assert.equal(provider.buildCangyuanMusicPayload(model, { prompt: 'UI click', duration }).duration, duration);
    }
    for (const duration of [0.7, 1.5, maximum - 0.5]) {
      assert.throws(() => provider.buildCangyuanMusicPayload(model, { prompt: 'UI click', duration }), /音效时长仅支持 0\.5 秒或/);
    }
    assert.throws(() => provider.buildCangyuanMusicPayload(model, { prompt: 'UI click', duration: 0.4 }), /必须在 0\.5–/);
  }
});

test('music payload rejects unprofiled models, unsupported fields, and values outside documentation bounds', () => {
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6.1', { prompt: 'Song' }), /尚未接入/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno', { prompt: 'Song' }), /尚未接入/);
  assert.throws(() => provider.buildCangyuanMusicPayload('su2-suno-v6', { prompt: 'Song', title: 'Title' }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', n: 2 }), /n 目前只支持 1/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', duration: 9 }), /10–360/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', styleWeight: 1.1 }), /0–1/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', version: '  ' }), /生成版本不能为空/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', vocalGender: '  ' }), /人声类型不能为空/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', referenceImage: 'https://example.test/a.png' }), /未支持的音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('su2-suno-v6', { prompt: 'Song', sourceTaskId: 'job-1' }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', sourceTaskId: 'job-1' }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', sourceAudioId: 'audio-1' }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', sourceTrack: 0 }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-extend-audio', { uploadUrl: 'https://cdn.example.test/source.mp3' }), /请输入音乐生成描述/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-replace-section', {
    prompt: 'bridge', sourceTaskId: 'job-1', infillStartS: '20', infillEndS: '10',
  }), /infillEndS 必须大于/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-extend-audio', {
    prompt: 'bridge', uploadUrl: 'https://cdn.example.test/source.mp3', continueAt: 20,
  }), /continueAt 必须是字符串/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-stem', {
    audioUrl: 'https://cdn.example.test/song.wav', stemType: 'split_stem_advanced', stemName: '  ',
  }), /高级分轨必须填写轨道名称/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-cover-audio', {
    prompt: 'cover', sourceTaskId: 'job-1', sourceTrack: 12,
  }), /sourceTrack 必须是 0–11/);
});

test('Suno music suggestions remain open to server-supported values', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-v6', {
    prompt: 'Song', version: ' future-v7 ', vocalGender: ' future-voice ',
  }), { model: 'suno-v6', prompt: 'Song', n: 1, version: 'future-v7', vocalGender: 'future-voice' });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-stem', {
    audioUrl: 'https://cdn.example.test/track.wav', stemType: ' future-separation ',
  }), { model: 'suno-stem', n: 1, audio_url: 'https://cdn.example.test/track.wav', type: 'future-separation' });
});

test('cover audio rejects unlisted source audio ids and retains the documented track selection', () => {
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-cover-audio', {
    prompt: 'Cover', sourceTaskId: 'job-1', sourceAudioId: 'audio-1',
  }), /不支持这些音乐参数.*sourceAudioId/);
  const payload = provider.buildCangyuanMusicPayload('suno-cover-audio', {
    prompt: 'Cover', sourceTaskId: 'job-1', sourceTrack: 0,
  });
  assert.equal(payload.source_track, 0);
  assert.equal('source_audio_id' in payload, false);
  assert.equal(provider.buildCangyuanMusicPayload('suno-midi', {
    sourceTaskId: 'job-1', sourceAudioId: 'audio-1',
  }).source_audio_id, 'audio-1');
});

test('Suno persona requires and maps its documented extraction fields', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-persona', {
    sourceTaskId: 'source-job', personaName: 'Warm alto', personaDescription: 'Low, warm female voice',
  }), {
    model: 'suno-persona', n: 1, source_task_id: 'source-job',
    persona_name: 'Warm alto', persona_description: 'Low, warm female voice',
  });
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-persona', {
    sourceTaskId: 'source-job', personaName: 'Warm alto',
  }), /必须提供 personaName 和 personaDescription/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-persona', {
    personaName: 'Warm alto', personaDescription: 'Low, warm female voice',
  }), /必须提供 sourceTaskId/);
});

test('Lyria and Suno SFX emit only their documented music options', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('lyria-3-pro', {
    prompt: 'cinematic strings', title: 'Northbound', lyrics: 'Hold the light', instrumental: false,
    duration: 184, seed: 12, bpm: 92, audio_format: 'wav', n: 1,
  }), {
    model: 'lyria-3-pro', prompt: 'cinematic strings', n: 1, instrumental: false,
    title: 'Northbound', lyrics: 'Hold the light', duration: 184, seed: 12, bpm: 92, audio_format: 'wav',
  });
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-sfx', {
    prompt: 'a wooden door closes', sound_key: 'custom-key', sound_loop: true, sound_tempo: 82.5, version: 'v8-experimental',
  }), {
    model: 'suno-sfx', prompt: 'a wooden door closes', n: 1,
    sound_key: 'custom-key', sound_loop: true, sound_tempo: 82.5, version: 'v8-experimental',
  });
});

test('Lyria and Suno SFX validate their documented ranges and do not accept each other model fields', () => {
  assert.throws(() => provider.buildCangyuanMusicPayload('lyria-3.5', { prompt: 'song', duration: 301 }), /5–300/);
  assert.throws(() => provider.buildCangyuanMusicPayload('lyria-3.5', { prompt: 'song', bpm: 29 }), /30–300/);
  assert.throws(() => provider.buildCangyuanMusicPayload('lyria-3.5', { prompt: 'song', style_text: 'pop' }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-sfx', { prompt: 'rain', lyrics: 'lyrics' }), /不支持这些音乐参数/);
});

test('music input bounds follow the documented model profile and do not invent workflow text limits', () => {
  assert.equal(provider.buildCangyuanMusicPayload('lyria-3.5', {
    prompt: 'song', duration: 300, bpm: 300, seed: 2_147_483_647,
  }).duration, 300);
  assert.throws(() => provider.buildCangyuanMusicPayload('lyria-3.5', { prompt: 'song', duration: 4 }), /5–300/);
  assert.throws(() => provider.buildCangyuanMusicPayload('lyria-3.5', { prompt: 'song', seed: 2_147_483_648 }), /固定生成编号.*0–2147483647/);

  assert.equal(provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'song', duration: 360 }).duration, 360);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'song', duration: 361 }), /10–360/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'song', style_text: 'x'.repeat(1_001) }), /最多 1000 个字符/);

  const longStyle = provider.buildCangyuanMusicPayload('suno-extend-audio', {
    prompt: 'continue', style_text: 'x'.repeat(1_001), uploadUrl: 'https://cdn.example.test/source.wav',
  });
  assert.equal(longStyle.style_text.length, 1_001);

  const longLyrics = provider.buildCangyuanMusicPayload('suno-replace-section', {
    prompt: 'replace', lyrics: 'x'.repeat(20_001), sourceTaskId: 'source-job', infillStartS: '1', infillEndS: '3',
  });
  assert.equal(longLyrics.lyrics.length, 20_001);
});

test('Tripo3D payload applies documented defaults and requires an image for its default mode', () => {
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'A wooden boat', mode: 'text-to-3d' }), {
    model: 'tripo3d', prompt: 'A wooden boat', mode: 'text-to-3d', texture: 'standard', pbr: false,
  });
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'A wooden boat' }), /必须提供公网图片地址/);
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d', {
    prompt: 'A wooden boat', imageUrl: 'https://cdn.example.test/boat.png',
  }), {
    model: 'tripo3d', prompt: 'A wooden boat', mode: 'image-to-3d',
    image_url: 'https://cdn.example.test/boat.png', texture: 'standard', pbr: false,
  });
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d', {
    prompt: 'A wooden boat', mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png', texture: 'HD', pbr: true,
  }), {
    model: 'tripo3d', prompt: 'A wooden boat', mode: 'image-to-3d',
    image_url: 'https://cdn.example.test/boat.png', texture: 'HD', pbr: true,
  });
});

test('Tripo3D requires a prompt in both generation modes', () => {
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', {
    prompt: '', mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png',
  }), /必须提供物体描述/);
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d', {
    prompt: 'A carved wooden boat', mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png',
  }), {
    model: 'tripo3d', prompt: 'A carved wooden boat', mode: 'image-to-3d', image_url: 'https://cdn.example.test/boat.png',
    texture: 'standard', pbr: false,
  });
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', {
    prompt: '', mode: 'text-to-3d',
  }), /必须提供物体描述/);
});

test('Tripo3D payload rejects unsupported URL, enum, type, and model-name variants', () => {
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'Boat', mode: 'image-to-3d' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'Boat', mode: 'text-to-3d', imageUrl: 'https://cdn.example.test/a.png' }), /不能同时/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'Boat', imageUrl: 'data:image/png;base64,AA==' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'Boat', imageUrl: 'https://192.168.1.12/boat.png' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'Boat', mode: 'text-to-3d', texture: '' }), /texture 必须/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'Boat', mode: 'text-to-3d', pbr: 'false' }), /pbr 必须/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: 'Boat', mode: 'text-to-3d', imageUrl: 42 }), /imageUrl 必须/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('Tripo3D', { prompt: 'Boat' }), /精确公共模型名/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('other-3d', { prompt: 'Boat', mode: 'text-to-3d' }), /模型尚未接入/);
});

test('Tripo v3.1 and P models build documented text, image, and multiview payloads', () => {
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d-v3.1', {
    prompt: 'A wooden boat', mode: 'text-to-3d', faceLimit: 50_000,
  }), {
    model: 'tripo3d-v3.1', prompt: 'A wooden boat', mode: 'text-to-3d', face_limit: 50_000,
  });
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d-p1', {
    prompt: '', mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png', texture: true,
  }), {
    model: 'tripo3d-p1', mode: 'image-to-3d', image_url: 'https://cdn.example.test/boat.png', texture: true,
  });
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d-p2', {
    prompt: '', mode: 'multiview-to-3d', multiviewImages: {
      front: 'https://cdn.example.test/front.png', left: 'https://cdn.example.test/left.png',
    },
  }), {
    model: 'tripo3d-p2', mode: 'multiview-to-3d', inputs: {
      front: 'https://cdn.example.test/front.png', left: 'https://cdn.example.test/left.png',
    },
  });
});

test('Tripo v3.1 options enforce dependent quality and part-generation constraints', () => {
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d-v3.1', {
    prompt: 'A carved boat', mode: 'text-to-3d', faceLimit: 2_000_000,
    generateParts: true, texture: false, pbr: false, quad: false,
    geometryQuality: 'detailed', textureQuality: 'fast', textureVersion: 'v3.5-20260815',
  }), {
    model: 'tripo3d-v3.1', prompt: 'A carved boat', mode: 'text-to-3d', face_limit: 2_000_000,
    generate_parts: true, texture: false, pbr: false, quad: false,
    geometry_quality: 'detailed', texture_quality: 'fast', texture_version: 'v3.5-20260815',
  });
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-v3.1', {
    prompt: 'A carved boat', mode: 'text-to-3d', generateParts: true,
  }), /都必须显式设为 false/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-p1', {
    prompt: 'A carved boat', mode: 'text-to-3d', faceLimit: 49,
  }), /50–20000/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-p1', {
    prompt: 'A carved boat', mode: 'text-to-3d', quad: true,
  }), /不支持 quad/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-p2', {
    prompt: 'A carved boat', mode: 'text-to-3d', faceLimit: 25_001, quad: true,
  }), /不能超过 25000/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-p2', {
    prompt: 'A carved boat', mode: 'text-to-3d', textureQuality: 'fast',
  }), /必须设置 textureVersion=v3.5-20260815/);
  for (const modelId of ['tripo3d-p1', 'tripo3d-p2']) {
    assert.throws(() => provider.buildCangyuanThreeDPayload(modelId, {
      prompt: 'A carved boat', mode: 'text-to-3d', geometryQuality: 'detailed',
    }), /不支持 geometryQuality/);
  }
});

test('Tripo multiview mode requires front plus another publicly reachable view', () => {
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-p1', {
    prompt: '', mode: 'multiview-to-3d', multiviewImages: { front: 'https://cdn.example.test/front.png' },
  }), /至少需要 2 张图片/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-p1', {
    prompt: '', mode: 'multiview-to-3d', multiviewImages: {
      back: 'https://cdn.example.test/back.png', left: 'https://cdn.example.test/left.png',
    },
  }), /必须包含正面 front/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d-p1', {
    prompt: '', mode: 'multiview-to-3d', multiviewImages: {
      front: 'https://cdn.example.test/front.png', left: 'https://127.0.0.1/left.png',
    },
  }), /公网图片地址/);
});

test('Trellis sends its documented image-only payload and preserves model-specific parameters', () => {
  assert.deepEqual(provider.buildCangyuanThreeDPayload('trellis', {
    prompt: '', imageUrl: 'https://cdn.example.test/object.png', textureSize: '3072', seed: '7',
    meshSimplify: 0.96, ssGuidanceStrength: 4.5, ssSamplingSteps: 30,
    slatGuidanceStrength: 6, slatSamplingSteps: 24,
  }), {
    model: 'trellis', image_url: 'https://cdn.example.test/object.png', texture_size: '3072', seed: '7',
    mesh_simplify: 0.96, ss_guidance_strength: 4.5, ss_sampling_steps: 30,
    slat_guidance_strength: 6, slat_sampling_steps: 24,
  });
  assert.deepEqual(provider.buildCangyuanThreeDPayload('trellis', {
    prompt: 'optional guidance', imageUrl: 'http://cdn.example.test/object.png',
  }), { model: 'trellis', prompt: 'optional guidance', image_url: 'http://cdn.example.test/object.png' });
});

test('Trellis image generation accepts an omitted optional prompt', () => {
  assert.deepEqual(provider.buildCangyuanThreeDPayload('trellis', {
    prompt: '', imageUrl: 'https://cdn.example.test/object.png',
  }), { model: 'trellis', image_url: 'https://cdn.example.test/object.png' });
});

test('Trellis rejects missing or non-public images and incompatible Tripo options', () => {
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'data:image/png;base64,AA==' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://127.0.0.1/a.png' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://cdn.example.test/a.png', textureSize: '' }), /textureSize 必须/);
  assert.deepEqual(provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://cdn.example.test/a.png', seed: 'repeat-7' }), {
    model: 'trellis', image_url: 'https://cdn.example.test/a.png', seed: 'repeat-7',
  });
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://cdn.example.test/a.png', seed: 7 }), /seed 必须是非空字符串/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://cdn.example.test/a.png', seed: '' }), /seed 必须是非空字符串/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://cdn.example.test/a.png', ssSamplingSteps: 51 }), /1–50/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('tripo3d', { prompt: '', mode: 'text-to-3d' }), /必须提供物体描述/);
});

test('Cangyuan adapter submits only the media contract and polls the matching task endpoint', async () => {
  const calls = [];
  const client = {
    baseUrl: 'https://direct-api.cangyuansuanli.cn/v1',
    headers: { Authorization: 'Bearer test-key' },
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'remote-3d', status: 'queued' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  };
  const submitted = await provider.submitCangyuanMediaTask(client, '3d', 'tripo3d', { prompt: 'A wooden boat', mode: 'text-to-3d' });
  assert.equal(submitted.id, 'remote-3d');
  assert.equal(submitted.status, 'pending');
  assert.equal(calls[0].url, 'https://direct-api.cangyuansuanli.cn/v1/3d/generations');
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'tripo3d', prompt: 'A wooden boat', mode: 'text-to-3d', texture: 'standard', pbr: false });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');

  await provider.pollCangyuanMediaTask(client, '3d', 'remote-3d');
  assert.equal(calls[1].url, 'https://direct-api.cangyuansuanli.cn/v1/3d/generations/remote-3d');
  assert.equal(calls[1].init.method, 'GET');
});

test('music result links retain same-index metadata from the documented extra object', () => {
  const normalized = provider.normalizeCangyuanTask('music', {
    task_id: 'remote-music',
    status: 'completed',
    music_url: ['https://cdn.example.test/one.mp3', 'https://cdn.example.test/two.mp3'],
    extra: {
      job_id: ['job-1', 'job-2'],
      audio_id: ['audio-1', 'audio-2'],
      title: ['First song', 'Second song'],
      duration: [120, 180],
    },
  });
  assert.equal(normalized.status, 'succeeded');
  assert.deepEqual(normalized.outputs, [
    { url: 'https://cdn.example.test/one.mp3', jobId: 'job-1', audioId: 'audio-1', title: 'First song', duration: 120 },
    { url: 'https://cdn.example.test/two.mp3', jobId: 'job-2', audioId: 'audio-2', title: 'Second song', duration: 180 },
  ]);
});

test('music normalizer preserves text-only and non-MP3 artifacts as successful outputs', () => {
  const lyrics = provider.normalizeCangyuanTask('music', { status: 'completed', text: 'Verse one\nChorus' });
  assert.equal(lyrics.status, 'succeeded');
  assert.deepEqual(lyrics.outputs, [{ text: 'Verse one\nChorus', artifactType: 'text' }]);

  const artifacts = provider.normalizeCangyuanTask('music', {
    status: 'completed',
    outputs: [
      { midi_url: 'https://cdn.example.test/song.mid', type: 'midi', name: 'song.mid' },
      { wav_url: 'https://cdn.example.test/song.wav', type: 'wav' },
      { url: 'https://cdn.example.test/vocals.zip', type: 'stem' },
    ],
  });
  assert.equal(artifacts.status, 'succeeded');
  assert.deepEqual(artifacts.outputs.map(({ url, artifactType }) => ({ url, artifactType })), [
    { url: 'https://cdn.example.test/song.mid', artifactType: 'midi' },
    { url: 'https://cdn.example.test/song.wav', artifactType: 'wav' },
    { url: 'https://cdn.example.test/vocals.zip', artifactType: 'stem' },
  ]);
});

test('3D result URLs and provider states normalize without imposing a short task timeout', () => {
  assert.equal(provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'queued' }).status, 'pending');
  assert.equal(provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'in_progress' }).status, 'running');
  const resultUrl = 'https://cdn.example.test/model.glb?signature=a%2Fb&expires=123';
  const completed = provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'completed', data: [{ url: resultUrl }] });
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.outputs, [{ url: resultUrl }]);
  assert.equal(provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'failed', error: { message: 'bad prompt' } }).error, 'bad prompt');
});
