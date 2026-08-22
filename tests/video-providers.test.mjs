import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/video-providers.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const video = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const cliSourceUrl = new URL('../lib/jimeng-cli.ts', import.meta.url);
const cliSource = await readFile(cliSourceUrl, 'utf8');
const cliCompiled = ts.transpileModule(cliSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: cliSourceUrl.pathname,
}).outputText;
const jimengCli = await import(`data:text/javascript;base64,${Buffer.from(cliCompiled).toString('base64')}`);

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function provider(overrides = {}) {
  return {
    id: 'p1', name: 'fixture', type: 'openai-compatible', platform: '65535',
    baseUrl: 'https://gateway.example/v1', apiKey: 'secret',
    videoTransport: 'native-task', videoBaseUrl: 'https://task-api.example',
    videoTaskPath: '/v1/tasks', videoTaskStatusPath: '/v1/tasks/{id}',
    videoGenerationPath: '/v1/videos', authHeader: 'Authorization', authPrefix: 'Bearer ',
    ...overrides,
  };
}

test('builds the 65535 native task payload and preserves idempotency', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ task_id: 'task-123', status: 'pending' }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  const result = await video.submitRemoteVideo(provider(), 'seedance-video', {
    prompt: 'cinematic ocean sunrise', operation: 'generate', seconds: 5, aspectRatio: '16:9', resolution: '720p',
    firstFrame: 'https://example.com/first.png', referenceImages: [],
  }, 'idem-123');
  assert.equal(result.providerTaskId, 'task-123');
  assert.equal(result.status, 'pending');
  assert.equal(calls[0].url, 'https://task-api.example/v1/tasks');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'idem-123');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    kind: 'video', model: 'seedance-video', operation: 'generate', input: {
      prompt: 'cinematic ocean sunrise', seconds: 5, aspect_ratio: '16:9', resolution: '720p', input_mode: 'first_frame',
      input_reference: { image_url: 'https://example.com/first.png' }, reference_image_urls: [], audio_urls: [],
    },
  });
});

test('keeps legacy 65535 hosts on the native task transport', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ task_id: 'legacy-task', status: 'pending' }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  const result = await video.submitRemoteVideo({ ...provider(), platform: 'custom', baseUrl: 'https://task-api-1-cn.65535.space', videoTransport: undefined, videoBaseUrl: '' }, 'legacy-video', {
    prompt: 'legacy host', seconds: 5, aspectRatio: '16:9', resolution: '720p', referenceImages: [],
  }, 'idem-legacy');
  assert.equal(result.providerTaskId, 'legacy-task');
  assert.equal(calls[0].url, 'https://task-api-1-cn.65535.space/v1/tasks');
});

test('normalizes done results from common video URL fields', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'v-1', status: 'completed', result_urls: ['https://cdn.example/a.mp4'], cost_usd: 0.42 }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await video.submitRemoteVideo(provider({ platform: 'custom', videoTransport: 'openai-videos', videoBaseUrl: 'https://compat.example', videoTaskStatusPath: '/v1/videos/{id}' }), 'sora-compatible', { prompt: 'a paper boat', seconds: 5, aspectRatio: '16:9', resolution: '720p' }, 'idem-456');
  assert.equal(result.status, 'done');
  assert.equal(result.videos[0].url, 'https://cdn.example/a.mp4');
  assert.equal(result.costUsd, 0.42);
});

test('maps pending and failed task status responses', async () => {
  const responses = [
    new Response(JSON.stringify({ state: 'running' }), { status: 200 }),
    new Response(JSON.stringify({ state: 'failed', error: { message: 'quota' } }), { status: 200 }),
  ];
  globalThis.fetch = async () => responses.shift();
  const pending = await video.pollRemoteVideo(provider(), 'task-1');
  const failed = await video.pollRemoteVideo(provider(), 'task-1');
  assert.equal(pending.status, 'running');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'quota');
});

test('uses /v1/videos/{id} when auto mode targets a standard compatible provider', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await video.pollRemoteVideo(provider({
    platform: 'custom', baseUrl: 'https://compat.example/v1', videoBaseUrl: '', videoTransport: 'auto', videoTaskStatusPath: '/v1/tasks/{id}',
  }), 'task-auto');
  assert.equal(result.status, 'running');
  assert.equal(requestedUrl, 'https://compat.example/v1/videos/task-auto');
});

test('surfaces 429 and retry-after for exponential backoff', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'retry-after': '4' } });
  await assert.rejects(() => video.pollRemoteVideo(provider(), 'task-429'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 4000);
    return true;
  });
});

test('maps Dreamina image and frame inputs to their official flags', () => {
  assert.deepEqual(video.buildJimengCliArgs({ prompt: 'single image', firstFrame: 'first.png', seconds: 5, resolution: '720p' }), [
    'image2video', '--image', 'first.png', '--prompt', 'single image', '--duration', '5', '--video_resolution', '720p',
  ]);
  assert.deepEqual(video.buildJimengCliArgs({ prompt: 'between frames', firstFrame: 'first.png', lastFrame: 'last.png', seconds: 8, resolution: '1080p' }), [
    'frames2video', '--first', 'first.png', '--last', 'last.png', '--prompt', 'between frames', '--duration', '8', '--video_resolution', '1080p',
  ]);
});

test('maps Dreamina multimodal inputs without leaking unsupported frame flags', () => {
  assert.deepEqual(video.buildJimengCliArgs({ prompt: 'edit this', firstFrame: 'cover.png', referenceVideo: 'source.mp4', audio: 'voice.mp3', seconds: 5, aspectRatio: '16:9', resolution: '720p' }), [
    'multimodal2video', '--image', 'cover.png', '--video', 'source.mp4', '--audio', 'voice.mp3', '--prompt', 'edit this', '--duration', '5', '--ratio', '16:9', '--video_resolution', '720p',
  ]);
});

test('passes the selected Jimeng model version and resolution', () => {
  assert.deepEqual(video.buildJimengCliArgs({ prompt: 'a scene', seconds: 8, aspectRatio: '16:9', resolution: '1080p' }, 'seedance-2.5'), [
    'text2video', '--model_version', 'seedance2.5', '--prompt', 'a scene', '--duration', '8', '--ratio', '16:9', '--video_resolution', '1080p',
  ]);
  assert.equal(video.jimengModelVersion('seedance2.0_vip'), 'seedance2.0_vip');
  assert.equal(video.jimengModelVersion('seedance2.0mini'), 'seedance2.0mini');
});

test('preserves native 65535 multi-video and multi-audio inputs', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ task_id: 'task-multi', status: 'pending' }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  await video.submitRemoteVideo(provider(), 'seedance-2.0', {
    prompt: 'multi modal scene', seconds: 5, aspectRatio: '16:9', resolution: '720p',
    referenceVideos: ['https://example.com/a.mp4', 'https://example.com/b.mp4'],
    audios: ['https://example.com/a.mp3', 'https://example.com/b.mp3'],
  }, 'idem-multi');
  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.input.video, ['https://example.com/a.mp4', 'https://example.com/b.mp4']);
  assert.deepEqual(payload.input.audio_urls, ['https://example.com/a.mp3', 'https://example.com/b.mp3']);
});

test('maps Dreamina array media to repeated multimodal flags', () => {
  assert.deepEqual(video.buildJimengCliArgs({
    prompt: 'blend the sources', referenceVideos: ['a.mp4', 'b.mp4'], audios: ['a.mp3', 'b.mp3'], seconds: 5, aspectRatio: '16:9', resolution: '720p',
  }), [
    'multimodal2video', '--video', 'a.mp4', '--video', 'b.mp4', '--audio', 'a.mp3', '--audio', 'b.mp3', '--prompt', 'blend the sources', '--duration', '5', '--ratio', '16:9', '--video_resolution', '720p',
  ]);
});

test('extracts the official Dreamina device-flow URL without falling back to the installer page', () => {
  const challenge = jimengCli.extractJimengAuthChallenge([
    '请使用浏览器完成 OAuth Device Flow 登录。',
    'verification_uri: https://jimeng.jianying.com/ai-tool/cli-auth?verification_uri=https%3A%2F%2Fjimeng.jianying.com%2Fpassport%2Fopen%2Fscan_user_code%2F%3Fuser_code%3Dabc123',
    'user_code: abc123',
    'device_code: device-456',
  ].join('\n'));
  assert.equal(challenge.verificationUri.startsWith('https://jimeng.jianying.com/ai-tool/cli-auth?'), true);
  assert.equal(challenge.verificationUri.includes('user_code%3Dabc123'), true);
  assert.equal(challenge.deviceCode, 'device-456');
});

test('reconstructs a usable device-flow URL when an older CLI prints only user_code', () => {
  const challenge = jimengCli.extractJimengAuthChallenge('user_code: only-code\ndevice_code: only-device');
  assert.equal(challenge.verificationUri, 'https://jimeng.jianying.com/ai-tool/cli-auth?verification_uri=https%3A%2F%2Fjimeng.jianying.com%2Fpassport%2Fopen%2Fscan_user_code%2F%3Fuser_code%3Donly-code');
  assert.notEqual(challenge.verificationUri, 'https://jimeng.jianying.com/cli');
});
