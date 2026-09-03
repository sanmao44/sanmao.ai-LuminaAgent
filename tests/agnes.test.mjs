import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, afterEach } from 'node:test';
import ts from 'typescript';

async function importTypeScript(sourceUrl, source, fileName = sourceUrl.pathname) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const providersUrl = new URL('../lib/providers.ts', import.meta.url);
const providersSource = await readFile(providersUrl, 'utf8');
const detectionSource = await readFile(new URL('../lib/native-search-detection.ts', import.meta.url), 'utf8');
const modelKindSource = await readFile(new URL('../lib/model-kind.ts', import.meta.url), 'utf8');
const agnesSource = await readFile(new URL('../lib/agnes.ts', import.meta.url), 'utf8');
const providers = await importTypeScript(providersUrl, [
  detectionSource.replace('export function inferNativeSearch', 'function inferNativeSearch'),
  modelKindSource,
  agnesSource.replace(/^import .+;\r?\n/gm, ''),
  providersSource
    .replace("import { inferNativeSearch } from './native-search-detection';", '')
    .replace("import { inferModelKind } from './model-kind';", '')
    .replace("import { agnesModelCatalog } from './agnes';", ''),
].join('\n'));

const videoUrl = new URL('../lib/video-providers.ts', import.meta.url);
const videoPlatformSource = await readFile(new URL('../lib/video-platform.ts', import.meta.url), 'utf8');
const video = await importTypeScript(videoUrl, `${videoPlatformSource}\n${(await readFile(videoUrl, 'utf8')).replace("import { is65535Provider, isAgnesProvider, requiresPublicMediaRelay } from './video-platform';", '')}`);

const signedUrl = new URL('../lib/signed-media.ts', import.meta.url);
const signedSource = await readFile(signedUrl, 'utf8');
const signed = await importTypeScript(signedUrl, signedSource
  .replace(/import \{ resolveStoredFileWithFallback \} from '\.\/image-storage';\r?\n/, 'const resolveStoredFileWithFallback = () => null;\n')
  .replace(/import \{ resolveStoredVideoFile \} from '\.\/video-storage';\r?\n/, 'const resolveStoredVideoFile = () => null;\n')
  .replace(/import \{ getDefaultAudioStoragePath, resolveStoredAudioFile \} from '\.\/audio-storage';\r?\n/, 'const getDefaultAudioStoragePath = () => ""; const resolveStoredAudioFile = () => null;\n'));

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function agnesProvider(overrides = {}) {
  return {
    id: 'agnes-provider',
    name: 'Agnes',
    type: 'openai-compatible',
    platform: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'server-only-key',
    videoTransport: 'agnes-videos',
    videoBaseUrl: 'https://apihub.agnes-ai.com',
    videoGenerationPath: '/v1/videos',
    videoQueryPath: '/agnesapi',
    chatPath: '/chat/completions',
    responsesPath: '/responses',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    ...overrides,
  };
}

test('exposes the complete Agnes catalog with official billing defaults and limits', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ id: 'agnes-2.5-flash' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const models = await providers.discoverModels(agnesProvider());
  assert.deepEqual(models.map((model) => model.id), [
    'agnes-2.0-flash', 'agnes-2.5-flash', 'agnes-2.5-pro-alpha', 'agnes-2.5-pro-beta', 'agnes-2.5-pro',
    'agnes-image-2.0-flash', 'agnes-image-2.1-flash', 'agnes-video-v2.0', 'agnes-video-2.5', 'agnes-video-2.5-flash',
  ]);
  assert.equal(models.find((model) => model.id === 'agnes-2.0-flash').contextWindow, 512000);
  assert.equal(models.find((model) => model.id === 'agnes-2.0-flash').maxOutputTokens, 65536);
  assert.equal(models.find((model) => model.id === 'agnes-2.5-pro').contextWindow, 1000000);
  assert.equal(models.find((model) => model.id === 'agnes-2.5-pro').enabledByDefault, false);
  assert.equal(models.find((model) => model.id === 'agnes-video-2.5-flash').billing, 'temporary-free');
  assert.equal(calls[0].url, 'https://apihub.agnes-ai.com/v1/models');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer server-only-key');
});

test('validates Agnes credentials before reporting a connection', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 401, headers: { 'content-type': 'application/json', 'x-request-id': 'agnes-test-401' } });
  await assert.rejects(() => providers.testProviderConnection(agnesProvider()), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.providerStatus, 401);
    assert.equal(error.providerRequestId, 'agnes-test-401');
    assert.match(error.message, /API Key 无效/);
    return true;
  });
});

test('recognizes the domestic Agnes host', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://api.agnes-ai.cn/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'agnes-2.5-flash' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  assert.equal(providers.isAgnesProvider({ platform: 'custom', baseUrl: 'https://api.agnes-ai.cn/v1' }), true);
  const result = await providers.testProviderConnection(agnesProvider({ platform: 'custom', baseUrl: 'https://api.agnes-ai.cn/v1', videoBaseUrl: 'https://api.agnes-ai.cn' }));
  assert.equal(result.verified, true);
});

test('keeps the international Agnes gateway compatible', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://apihub.agnes-ai.com/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'agnes-2.5-flash' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  assert.equal(providers.isAgnesProvider({ platform: 'custom', baseUrl: 'https://apihub.agnes-ai.com/v1' }), true);
  assert.equal(providers.isAgnesProvider({ platform: 'custom', baseUrl: 'https://api.agnes-ai.com/v1' }), true);
});

test('supports Agnes Chat Completions, Responses and Messages protocols', async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(init.body) });
    const body = requests.at(-1).body;
    if (body.input) {
      return new Response(JSON.stringify({
        model: body.model,
        status: 'completed',
        output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'responses answer' }] }],
        usage: { input_tokens: 3, output_tokens: 4 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (body.system) {
      return new Response(JSON.stringify({ model: body.model, content: [{ type: 'text', text: 'messages answer' }], stop_reason: 'end_turn', usage: { prompt_tokens: 5, completion_tokens: 6 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: 'chat answer' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const messages = [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: [{ type: 'text', text: 'Describe this.' }, { type: 'image_url', image_url: { url: 'https://cdn.example/image.png' } }] }];
  const chat = await providers.chatCompletion(agnesProvider({ textProtocol: 'chat-completions' }), 'agnes-2.5-flash', { messages });
  const responses = await providers.chatCompletion(agnesProvider({ textProtocol: 'responses' }), 'agnes-2.5-flash', { messages });
  const anthropic = await providers.chatCompletion(agnesProvider({ textProtocol: 'messages' }), 'agnes-2.5-flash', { messages });

  assert.equal(requests[0].url, 'https://apihub.agnes-ai.com/v1/chat/completions');
  assert.equal(requests[0].body.max_tokens, 65536);
  assert.equal(requests[0].body.messages[1].content[1].image_url.url, 'https://cdn.example/image.png');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer server-only-key');
  assert.equal(responses.choices[0].message.content, 'responses answer');
  assert.deepEqual(responses.usage, { prompt_tokens: 3, input_tokens: 3, completion_tokens: 4, output_tokens: 4, total_tokens: 7 });
  assert.equal(requests[1].url, 'https://apihub.agnes-ai.com/v1/responses');
  assert.equal(requests[1].body.input[0].role, 'system');
  assert.equal(requests[1].body.max_output_tokens, 65536);
  assert.equal(anthropic.choices[0].message.content, 'messages answer');
  assert.equal(requests[2].url, 'https://apihub.agnes-ai.com/v1/messages');
  assert.equal(requests[2].body.system, 'Be concise.');
  assert.equal(requests[2].body.messages[0].role, 'user');
  assert.equal(requests[2].init.headers['x-api-key'], 'server-only-key');
  assert.equal(requests[2].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(requests[2].init.headers.Authorization, undefined);
});

test('builds Agnes image 2.0 and 2.1 payloads using documented fields', () => {
  const v20 = providers.buildAgnesImagePayload('agnes-image-2.0-flash', {
    prompt: 'product', width: 1001, height: 777, count: 2, outputFormat: 'jpeg', responseFormat: 'b64_json',
  }, ['https://cdn.example/a.png', 'https://cdn.example/b.png']);
  assert.equal(v20.size, '1001x777');
  assert.deepEqual(v20.extra_body.image, ['https://cdn.example/a.png', 'https://cdn.example/b.png']);
  assert.equal(v20.extra_body.response_format, 'b64_json');
  assert.equal(v20.response_format, undefined);

  const v21 = providers.buildAgnesImagePayload('agnes-image-2.1-flash', {
    prompt: 'wallpaper', aspectRatio: '21:9', resolution: '3K', outputFormat: 'webp',
  });
  assert.equal(v21.size, '3K');
  assert.equal(v21.ratio, '21:9');
  assert.equal(v21.extra_body.response_format, 'url');

  const legacySize = providers.buildAgnesImagePayload('agnes-image-2.1-flash', {
    prompt: 'legacy', width: 1920, height: 1080, aspectRatio: '16:9',
  });
  assert.equal(legacySize.size, '1920x1080');
  assert.equal(providers.normalizeProviderImages({ data: [{ url: 'https://cdn.example/result.png', revised_prompt: 'revised' }] })[0].revisedPrompt, 'revised');
  assert.equal(providers.normalizeProviderImages({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }] })[0].url, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB');
});

test('builds Agnes V2.0 image and keyframe video payloads', () => {
  const text = video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'cat', width: 1152, height: 768, numFrames: 121, frameRate: 24 });
  assert.deepEqual(text, {
    model: 'agnes-video-v2.0', prompt: 'cat', width: 1152, height: 768, num_frames: 121, frame_rate: 24,
    metadata: { size_mapping: { requested: '1152x768', normalized: '720p', width: 1152, height: 768 } },
  });
  const ratioPreset = video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'cat', aspectRatio: '16:9' });
  assert.equal(ratioPreset.width, 1024);
  assert.equal(ratioPreset.height, 576);
  const image = video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'cat', firstFrame: 'https://cdn.example/first.png', width: 1152, height: 768 });
  assert.equal(image.image, 'https://cdn.example/first.png');
  assert.equal(image.extra_body, undefined);
  const keyframes = video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'transition', videoMode: 'keyframe', firstFrame: 'https://cdn.example/first.png', lastFrame: 'https://cdn.example/last.png' });
  assert.deepEqual(keyframes.extra_body, { image: ['https://cdn.example/first.png', 'https://cdn.example/last.png'], mode: 'keyframes' });
  assert.equal(keyframes.image, undefined);
  assert.throws(
    () => video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'incomplete', videoMode: 'keyframe', firstFrame: 'https://cdn.example/first.png' }),
    (error) => error.code === 'AGNES_KEYFRAME_REQUIRED' && /两张图片/.test(error.message),
  );
  assert.throws(
    () => video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'text with image', videoMode: 'text', firstFrame: 'https://cdn.example/first.png' }),
    (error) => error.code === 'AGNES_TEXT_MEDIA_NOT_ALLOWED',
  );
  assert.throws(
    () => video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'empty reference mode', videoMode: 'reference' }),
    (error) => error.code === 'AGNES_REFERENCE_REQUIRED',
  );
  assert.throws(() => video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'bad size', width: 1153, height: 768 }), /宽度和高度必须是 64 的倍数/);
  assert.throws(() => video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'bad', referenceVideo: 'https://cdn.example/ref.mp4' }), /不接受参考视频/);
  assert.throws(() => video.buildAgnesVideoPayload('agnes-video-v2.0', { prompt: 'bad', numFrames: 82 }), /8n \+ 1/);
});

test('builds Agnes 2.5 modes and enforces Flash restrictions', () => {
  const text = video.buildAgnesVideoPayload('agnes-video-2.5', { prompt: 'city', seconds: 5, videoMode: 'text', aspectRatio: '2:3', videoSize: '960P' });
  assert.deepEqual(text, { model: 'agnes-video-2.5', prompt: 'city', seconds: '5', size: '960P', mode: 'text', aspect_ratio: '2:3' });
  const reference = video.buildAgnesVideoPayload('agnes-video-2.5', {
    prompt: 'use sources', seconds: 8, videoMode: 'reference', videoSize: '2K', referenceImages: ['a.png', 'b.png'], audios: ['a.mp3'], referenceVideos: ['v.mp4'], referenceVideoStartSeconds: 1, referenceVideoEndSeconds: 6, requireAudio: true,
  });
  assert.deepEqual(reference.images, ['a.png', 'b.png']);
  assert.deepEqual(reference.audios, ['a.mp3']);
  assert.deepEqual(reference.videos, [{ url: 'v.mp4', start_seconds: 1, end_seconds: 6, require_audio: true }]);
  const flash = video.buildAgnesVideoPayload('agnes-video-2.5-flash', { prompt: 'fast', seconds: 4, videoMode: 'reference', referenceImages: ['1.png'], audios: ['a.mp3'] });
  assert.equal(flash.size, '720P');
  assert.deepEqual(flash.images, ['1.png']);
  assert.deepEqual(flash.audios, ['a.mp3']);
  assert.throws(() => video.buildAgnesVideoPayload('agnes-video-2.5-flash', { prompt: 'too many', seconds: 5, videoMode: 'reference', referenceImages: ['1', '2', '3', '4', '5', '6'] }), /最多接收 5 张/);
  assert.throws(() => video.buildAgnesVideoPayload('agnes-video-2.5-flash', { prompt: 'video', seconds: 5, videoMode: 'reference', referenceVideos: ['v.mp4'] }), /不支持参考视频/);
  assert.throws(() => video.buildAgnesVideoPayload('agnes-video-2.5', { prompt: 'bad', seconds: 5, videoMode: 'text', referenceImages: ['image.png'] }), /text 模式不允许/);
  assert.throws(() => video.buildAgnesVideoPayload('agnes-video-2.5', { prompt: 'bad', seconds: 5, videoMode: 'keyframe', firstFrame: 'first.png', referenceImages: ['image.png'] }), /keyframe 模式不允许/);
});

test('prioritizes video_id and queries Agnes at /agnesapi with model_name only for 2.5', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(JSON.stringify({ id: 'task-1', task_id: 'task-1', video_id: 'video-1', status: 'queued', progress: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ id: 'task-1', task_id: 'task-1', video_id: 'video-1', status: 'completed', progress: 100, metadata: { url: 'https://cdn.example/generated.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const created = await video.submitRemoteVideo(agnesProvider(), 'agnes-video-2.5', { prompt: 'city', seconds: 5, videoMode: 'text' }, 'idem-1');
  assert.equal(created.videoId, 'video-1');
  assert.equal(created.providerTaskId, 'video-1');
  const completed = await video.pollRemoteVideo(agnesProvider(), created.providerTaskId, undefined, 'agnes-video-2.5');
  assert.equal(completed.status, 'done');
  assert.deepEqual(completed.videos, [{ url: 'https://cdn.example/generated.mp4' }]);
  assert.equal(calls[0], 'https://apihub.agnes-ai.com/v1/videos');
  assert.equal(calls[1], 'https://apihub.agnes-ai.com/agnesapi?video_id=video-1&model_name=agnes-video-2.5');

  let v20Url = '';
  globalThis.fetch = async (url) => {
    v20Url = String(url);
    return new Response(JSON.stringify({ status: 'completed', metadata: { url: 'https://cdn.example/v20.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await video.pollRemoteVideo(agnesProvider(), 'video-v20', undefined, 'agnes-video-v2.0');
  assert.equal(v20Url, 'https://apihub.agnes-ai.com/agnesapi?video_id=video-v20');
});

test('accepts documented Agnes completed video URL fields', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'succeeded', remixed_from_video_id: 'https://cdn.example/remixed.mp4' }), { status: 200, headers: { 'content-type': 'application/json' } });
  const completed = await video.pollRemoteVideo(agnesProvider(), 'video-remixed', undefined, 'agnes-video-2.5');
  assert.equal(completed.status, 'done');
  assert.deepEqual(completed.videos, [{ url: 'https://cdn.example/remixed.mp4' }]);
});

test('surfaces Agnes failed and rate-limited polling responses without accepting non-completed media', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'failed', error: { message: 'quota exceeded' }, metadata: { url: 'https://should-not-be-used.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  const failed = await video.pollRemoteVideo(agnesProvider(), 'video-failed', undefined, 'agnes-video-2.5');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'quota exceeded');
  assert.deepEqual(failed.videos, []);

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429, headers: { 'retry-after': '2' } });
  await assert.rejects(() => video.pollRemoteVideo(agnesProvider(), 'video-rate', undefined, 'agnes-video-2.5'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 2000);
    return true;
  });
});

test('does not retry a per-minute video submission limit and gives an actionable message', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'video generation rate limit exceeded: allows 1 requests per 1 minute(s)' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(() => video.submitRemoteVideo(agnesProvider(), 'agnes-video-2.5-flash', { prompt: 'a quiet ocean', seconds: 4, videoMode: 'text' }, 'idem-rate-limit'), (error) => {
    assert.equal(calls, 1);
    assert.equal(error.code, 'VIDEO_RATE_LIMITED');
    assert.match(error.message, /每 1 分钟最多生成 1 个视频/);
    assert.match(error.message, /等待约 60 秒/);
    return true;
  });
});

test('uses the Agnes media relay for local images without sending API credentials', async () => {
  const previous = {
    relay: process.env.SANMAO_MEDIA_RELAY_URL,
    defaultRelay: process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL,
    publicBase: process.env.SANMAO_PUBLIC_BASE_URL,
    uploadToken: process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN,
  };
  process.env.SANMAO_MEDIA_RELAY_URL = 'https://relay.example';
  delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL;
  delete process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN;
  delete process.env.SANMAO_PUBLIC_BASE_URL;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const form = init.body;
    assert.equal(form.get('kind'), 'image');
    assert.equal(form.get('file').type, 'image/png');
    return new Response(JSON.stringify({ ok: true, url: 'https://relay.example/api/relay/media/signed-token', expiresAt: '2026-08-29T00:30:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const url = await signed.prepareAgnesMediaUrl('data:image/png;base64,AAECAw==', 'image');
    assert.equal(url, 'https://relay.example/api/relay/media/signed-token');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://relay.example/api/relay/media');
    assert.equal(calls[0].init.headers, undefined);
  } finally {
    if (previous.relay === undefined) delete process.env.SANMAO_MEDIA_RELAY_URL; else process.env.SANMAO_MEDIA_RELAY_URL = previous.relay;
    if (previous.defaultRelay === undefined) delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL; else process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL = previous.defaultRelay;
    if (previous.publicBase === undefined) delete process.env.SANMAO_PUBLIC_BASE_URL; else process.env.SANMAO_PUBLIC_BASE_URL = previous.publicBase;
    if (previous.uploadToken === undefined) delete process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN; else process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN = previous.uploadToken;
  }
});

test('uses the latest automatically recovered relay URL without restarting the server', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-relay-refresh-'));
  const previous = {
    dataDir: process.env.SANMAO_DATA_DIR,
    mode: process.env.SANMAO_RELAY_MODE,
    relay: process.env.SANMAO_MEDIA_RELAY_URL,
    publicBase: process.env.SANMAO_PUBLIC_BASE_URL,
  };
  process.env.SANMAO_DATA_DIR = root;
  process.env.SANMAO_RELAY_MODE = '1';
  process.env.SANMAO_MEDIA_RELAY_URL = 'https://stale.trycloudflare.com';
  delete process.env.SANMAO_PUBLIC_BASE_URL;
  await mkdir(path.join(root, 'free-relay'), { recursive: true });
  await writeFile(path.join(root, 'free-relay', 'public-url.txt'), 'https://recovered.trycloudflare.com\n');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true, url: 'https://recovered.trycloudflare.com/api/relay/media/signed-token' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const url = await signed.prepareAgnesMediaUrl('data:image/png;base64,AAECAw==', 'image');
    assert.equal(url, 'https://recovered.trycloudflare.com/api/relay/media/signed-token');
    assert.deepEqual(calls, ['https://recovered.trycloudflare.com/api/relay/media']);
  } finally {
    if (previous.dataDir === undefined) delete process.env.SANMAO_DATA_DIR; else process.env.SANMAO_DATA_DIR = previous.dataDir;
    if (previous.mode === undefined) delete process.env.SANMAO_RELAY_MODE; else process.env.SANMAO_RELAY_MODE = previous.mode;
    if (previous.relay === undefined) delete process.env.SANMAO_MEDIA_RELAY_URL; else process.env.SANMAO_MEDIA_RELAY_URL = previous.relay;
    if (previous.publicBase === undefined) delete process.env.SANMAO_PUBLIC_BASE_URL; else process.env.SANMAO_PUBLIC_BASE_URL = previous.publicBase;
    await rm(root, { recursive: true, force: true });
  }
});

test('does not relay public Agnes image URLs and gives a recoverable error when relay is unavailable', async () => {
  const previous = {
    relay: process.env.SANMAO_MEDIA_RELAY_URL,
    defaultRelay: process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL,
    publicBase: process.env.SANMAO_PUBLIC_BASE_URL,
  };
  process.env.SANMAO_MEDIA_RELAY_URL = 'https://relay.example';
  delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL;
  delete process.env.SANMAO_PUBLIC_BASE_URL;
  globalThis.fetch = async () => { throw new Error('relay offline'); };
  try {
    assert.equal(await signed.prepareAgnesMediaUrl('https://cdn.example/source.png', 'image'), 'https://cdn.example/source.png');
    await assert.rejects(() => signed.prepareAgnesMediaUrl('data:image/png;base64,AAECAw==', 'image'), (error) => {
      assert.equal(error.code, 'AGNES_MEDIA_RELAY_UNAVAILABLE');
      assert.match(error.message, /中转服务不可用/);
      return true;
    });
  } finally {
    if (previous.relay === undefined) delete process.env.SANMAO_MEDIA_RELAY_URL; else process.env.SANMAO_MEDIA_RELAY_URL = previous.relay;
    if (previous.defaultRelay === undefined) delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL; else process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL = previous.defaultRelay;
    if (previous.publicBase === undefined) delete process.env.SANMAO_PUBLIC_BASE_URL; else process.env.SANMAO_PUBLIC_BASE_URL = previous.publicBase;
  }
});

test('does not contact the media relay for Agnes text-to-video', async () => {
  const previous = process.env.SANMAO_MEDIA_RELAY_URL;
  process.env.SANMAO_MEDIA_RELAY_URL = 'https://relay.example';
  const previousDefaultRelay = process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL;
  delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 'text-video-task', status: 'queued' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await video.submitRemoteVideo(agnesProvider(), 'agnes-video-2.5', { prompt: 'a quiet ocean', seconds: 5, videoMode: 'text' }, 'idem-text');
    assert.deepEqual(calls, ['https://apihub.agnes-ai.com/v1/videos']);
  } finally {
    if (previous === undefined) delete process.env.SANMAO_MEDIA_RELAY_URL; else process.env.SANMAO_MEDIA_RELAY_URL = previous;
    if (previousDefaultRelay === undefined) delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL; else process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL = previousDefaultRelay;
  }
});

test('does not pass local HTTP storage URLs through to Agnes', async () => {
  const previous = process.env.SANMAO_MEDIA_RELAY_URL;
  process.env.SANMAO_MEDIA_RELAY_URL = 'https://relay.example';
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('local storage should be resolved before any network request'); };
  try {
    await assert.rejects(() => signed.prepareAgnesMediaUrl('http://localhost:3210/api/storage/file?name=missing.png', 'image'), (error) => {
      assert.notEqual(error.code, undefined);
      return true;
    });
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.SANMAO_MEDIA_RELAY_URL; else process.env.SANMAO_MEDIA_RELAY_URL = previous;
  }
});

test('signs Agnes media, enforces expiry and protects the media path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-agnes-media-'));
  const previous = {
    dataDir: process.env.SANMAO_DATA_DIR,
    publicBase: process.env.SANMAO_PUBLIC_BASE_URL,
    relay: process.env.SANMAO_MEDIA_RELAY_URL,
    signingKey: process.env.SANMAO_MEDIA_SIGNING_KEY,
    defaultRelay: process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL,
  };
  process.env.SANMAO_DATA_DIR = root;
  process.env.SANMAO_PUBLIC_BASE_URL = 'https://studio.example';
  delete process.env.SANMAO_MEDIA_RELAY_URL;
  delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL;
  process.env.SANMAO_MEDIA_SIGNING_KEY = 'test-signing-key';
  try {
    const url = await signed.prepareAgnesMediaUrl('data:image/png;base64,AAECAw==', 'image');
    assert.match(url, /^https:\/\/studio\.example\/api\/media\//);
    const token = new URL(url).pathname.split('/').pop();
    const media = await signed.readSignedAgnesMedia(token);
    assert.deepEqual([...media.data], [0, 1, 2, 3]);
    assert.equal(media.mime, 'image/png');
    const decoded = decodeURIComponent(token);
    const tampered = `${decoded.slice(0, -1)}${decoded.endsWith('A') ? 'B' : 'A'}`;
    assert.equal(await signed.readSignedAgnesMedia(tampered), null);

    const [mediaId] = decoded.split('.');
    const expiredAt = Date.now() - 1000;
    const expiredPayload = `${mediaId}.${expiredAt}`;
    const expiredToken = `${expiredPayload}.${createHmac('sha256', 'test-signing-key').update(expiredPayload).digest('base64url')}`;
    assert.equal(await signed.readSignedAgnesMedia(expiredToken), null);

    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, 'must survive');
    const manifestPath = path.join(root, 'agnes-media', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.evil = { id: 'evil', filename: '../outside.txt', mime: 'image/png', kind: 'image', expiresAt: Date.now() - 1 };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const cleanup = await signed.cleanupExpiredAgnesMedia();
    assert.equal(cleanup.removed >= 1, true);
    assert.equal(await readFile(outside, 'utf8'), 'must survive');

    delete process.env.SANMAO_PUBLIC_BASE_URL;
    await assert.rejects(() => signed.prepareAgnesMediaUrl('data:image/png;base64,AA==', 'image'), (error) => error.code === 'AGNES_MEDIA_RELAY_REQUIRED');
    process.env.SANMAO_PUBLIC_BASE_URL = 'http://localhost:3210';
    await assert.rejects(() => signed.prepareAgnesMediaUrl('data:image/png;base64,AA==', 'image'), (error) => error.code === 'AGNES_PUBLIC_MEDIA_URL_INVALID');
    await assert.rejects(() => signed.prepareAgnesMediaUrl('data:video/mp4;base64,AA==', 'image'), (error) => error.code === 'AGNES_MEDIA_TYPE_NOT_ALLOWED');
  } finally {
    if (previous.dataDir === undefined) delete process.env.SANMAO_DATA_DIR; else process.env.SANMAO_DATA_DIR = previous.dataDir;
    if (previous.publicBase === undefined) delete process.env.SANMAO_PUBLIC_BASE_URL; else process.env.SANMAO_PUBLIC_BASE_URL = previous.publicBase;
    if (previous.relay === undefined) delete process.env.SANMAO_MEDIA_RELAY_URL; else process.env.SANMAO_MEDIA_RELAY_URL = previous.relay;
    if (previous.defaultRelay === undefined) delete process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL; else process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL = previous.defaultRelay;
    if (previous.signingKey === undefined) delete process.env.SANMAO_MEDIA_SIGNING_KEY; else process.env.SANMAO_MEDIA_SIGNING_KEY = previous.signingKey;
    await rm(root, { recursive: true, force: true });
  }
});
