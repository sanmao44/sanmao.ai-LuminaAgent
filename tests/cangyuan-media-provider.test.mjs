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

test('Suno v6 payload maps all documented creation fields without sending references', () => {
  assert.deepEqual(provider.buildCangyuanMusicPayload('suno-v6', {
    prompt: 'Dream pop with soft synths', title: 'Night Drive', style_text: 'dream pop', instrumental: false,
    duration: 180, n: 1, audioWeight: 0.4, negativeTags: 'metal', personaId: 'persona-1',
    personaModel: 'future-compatible-model', styleWeight: 0.7, version: 'v6-wild', vocalGender: 'f',
    weirdnessConstraint: 0.2, sourceTaskId: 'job-1', sourceAudioId: 'audio-2',
  }), {
    model: 'suno-v6', prompt: 'Dream pop with soft synths', n: 1,
    source_task_id: 'job-1', source_audio_id: 'audio-2', instrumental: false,
    title: 'Night Drive', style_text: 'dream pop', duration: 180, audioWeight: 0.4,
    negativeTags: 'metal', personaId: 'persona-1', personaModel: 'future-compatible-model',
    styleWeight: 0.7, version: 'v6-wild', vocalGender: 'f', weirdnessConstraint: 0.2,
  });
});

test('music payload rejects unprofiled models, unsupported fields, and values outside documentation bounds', () => {
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6.1', { prompt: 'Song' }), /尚未接入/);
  assert.throws(() => provider.buildCangyuanMusicPayload('su2-suno-v6', { prompt: 'Song', title: 'Title' }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', n: 2 }), /n 目前只支持 1/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', duration: 9 }), /10–360/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', styleWeight: 1.1 }), /0–1/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', version: 'v5' }), /version 必须/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', vocalGender: 'x' }), /vocalGender 必须/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', referenceImage: 'https://example.test/a.png' }), /未支持的音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('su2-suno-v6', { prompt: 'Song', sourceTaskId: 'job-1' }), /不支持这些音乐参数/);
  assert.throws(() => provider.buildCangyuanMusicPayload('suno-v6', { prompt: 'Song', sourceAudioId: 'audio-1' }), /必须与 sourceTaskId 一起/);
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

test('Trellis sends its documented image-only payload and preserves model-specific parameters', () => {
  assert.deepEqual(provider.buildCangyuanThreeDPayload('trellis', {
    prompt: '', imageUrl: 'https://cdn.example.test/object.png', textureSize: '3072', seed: 'repeat-7',
    meshSimplify: 0.96, ssGuidanceStrength: 4.5, ssSamplingSteps: 30,
    slatGuidanceStrength: 6, slatSamplingSteps: 24,
  }), {
    model: 'trellis', image_url: 'https://cdn.example.test/object.png', texture_size: '3072', seed: 'repeat-7',
    mesh_simplify: 0.96, ss_guidance_strength: 4.5, ss_sampling_steps: 30,
    slat_guidance_strength: 6, slat_sampling_steps: 24,
  });
  assert.deepEqual(provider.buildCangyuanThreeDPayload('trellis', {
    prompt: 'optional guidance', imageUrl: 'http://cdn.example.test/object.png',
  }), { model: 'trellis', prompt: 'optional guidance', image_url: 'http://cdn.example.test/object.png' });
});

test('Trellis rejects missing or non-public images and incompatible Tripo options', () => {
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'data:image/png;base64,AA==' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://127.0.0.1/a.png' }), /公网图片地址/);
  assert.throws(() => provider.buildCangyuanThreeDPayload('trellis', { prompt: '', imageUrl: 'https://cdn.example.test/a.png', textureSize: '' }), /textureSize 必须/);
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

test('3D result URLs and provider states normalize without imposing a short task timeout', () => {
  assert.equal(provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'queued' }).status, 'pending');
  assert.equal(provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'in_progress' }).status, 'running');
  const resultUrl = 'https://cdn.example.test/model.glb?signature=a%2Fb&expires=123';
  const completed = provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'completed', data: [{ url: resultUrl }] });
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.outputs, [{ url: resultUrl }]);
  assert.equal(provider.normalizeCangyuanTask('3d', { id: 'three-d', status: 'failed', error: { message: 'bad prompt' } }).error, 'bad prompt');
});
