import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const app = createTsRequire(process.cwd())('./apps/api/cangyuan-media-upload-application');

test('validates supported Cangyuan media and returns the published URL with metadata', async () => {
  const published = [];
  const result = await app.uploadCangyuanMedia({
    kind: 'audio',
    fileName: 'voice.wav',
    mimeType: 'audio/x-wav',
    bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
  }, {
    publish: async (input) => {
      published.push(input);
      return { url: 'https://relay.example/api/relay/media/signed-token', expiresAt: '2026-11-17T12:30:00.000Z' };
    },
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].mimeType, 'audio/wav');
  assert.deepEqual(result, {
    url: 'https://relay.example/api/relay/media/signed-token',
    expiresAt: '2026-11-17T12:30:00.000Z',
    mimeType: 'audio/wav',
    bytes: 12,
  });
});

test('rejects unsupported media and audio bytes that do not match their MIME', async () => {
  let publishCalls = 0;
  const port = { publish: async () => { publishCalls += 1; return { url: 'https://relay.example/media' }; } };
  await assert.rejects(() => app.uploadCangyuanMedia({
    kind: 'audio', fileName: 'invalid.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([1, 2, 3, 4]),
  }, port), /音频格式不匹配/);
  await assert.rejects(() => app.uploadCangyuanMedia({
    kind: 'image', fileName: 'photo.svg', mimeType: 'image/svg+xml', bytes: Uint8Array.from([1]),
  }, port), /图片仅支持/);
  await assert.rejects(() => app.uploadCangyuanMedia({
    kind: 'image', fileName: 'photo.png', mimeType: 'image/png', bytes: Uint8Array.from([1, 2, 3, 4]),
  }, port), /图片格式不匹配/);
  assert.equal(publishCalls, 0);
});

test('maps an invalid image rejected by the media adapter to a user input error', async () => {
  class PublicMediaError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }
  const composition = createTsRequire(process.cwd(), {
    '@/lib/signed-media': {
      PublicMediaError,
      preparePublicMediaBytes: async () => { throw new PublicMediaError('只支持有效图片。', 'AGNES_MEDIA_TYPE_NOT_ALLOWED'); },
    },
  })('./apps/api/cangyuan-media-upload-composition');

  await assert.rejects(() => composition.publishCangyuanMediaUpload({
    kind: 'image', fileName: 'photo.png', mimeType: 'image/png',
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }), (error) => error?.name === 'CangyuanMediaUploadInputError' && error.message === '只支持有效图片。');
});

test('rejects audio above the Cangyuan upload limit before publishing', async () => {
  let publishCalls = 0;
  const bytes = new Uint8Array(app.CANGYUAN_AUDIO_UPLOAD_MAX_BYTES + 1);
  bytes.set([0x49, 0x44, 0x33]);
  await assert.rejects(() => app.uploadCangyuanMedia({
    kind: 'audio', fileName: 'long.mp3', mimeType: 'audio/mpeg', bytes,
  }, { publish: async () => { publishCalls += 1; return { url: 'https://relay.example/media' }; } }), /不能超过 25 MiB/);
  assert.equal(publishCalls, 0);
});

test('accepts a supported video container and rejects video MIME or signature mismatches', async () => {
  const published = [];
  const bytes = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const result = await app.uploadCangyuanMedia({
    kind: 'video', fileName: 'reference.mp4', mimeType: 'video/mp4', bytes,
  }, { publish: async (input) => { published.push(input); return { url: 'https://relay.example/video-token' }; } });
  assert.equal(result.url, 'https://relay.example/video-token');
  assert.equal(published[0].mimeType, 'video/mp4');

  const port = { publish: async () => { throw new Error('must not publish invalid video'); } };
  await assert.rejects(() => app.uploadCangyuanMedia({
    kind: 'video', fileName: 'reference.mp4', mimeType: 'video/mp4', bytes: Uint8Array.from([1, 2, 3, 4]),
  }, port), /视频格式不匹配/);
  await assert.rejects(() => app.uploadCangyuanMedia({
    kind: 'video', fileName: 'reference.mkv', mimeType: 'video/x-matroska', bytes,
  }, port), /视频仅支持/);
});

test('enforces Cangyuan-specific image and video product upload limits', async () => {
  assert.equal(app.CANGYUAN_IMAGE_UPLOAD_MAX_BYTES, 30 * 1024 * 1024);
  assert.equal(app.CANGYUAN_VIDEO_UPLOAD_MAX_BYTES, 25 * 1024 * 1024);
  let publishCalls = 0;
  const port = { publish: async () => { publishCalls += 1; return { url: 'https://relay.example/media' }; } };
  await assert.rejects(() => app.uploadCangyuanMedia({
    kind: 'video', fileName: 'large.mp4', mimeType: 'video/mp4',
    bytes: new Uint8Array(app.CANGYUAN_VIDEO_UPLOAD_MAX_BYTES + 1),
  }, port), /本站上传限制/);
  assert.equal(publishCalls, 0);
});

test('upload route authenticates, parses multipart files, and returns a public relay URL', async () => {
  let trusted = true;
  const published = [];
  class CangyuanMediaUploadInputError extends Error {}
  const route = createTsRequire(process.cwd(), {
    '@/apps/api/cangyuan-media-upload-composition': {
      publishCangyuanMediaUpload: async (input) => {
        if (input.kind === 'image') throw new CangyuanMediaUploadInputError('文件内容与图片格式不匹配。');
        published.push(input);
        return { url: 'https://relay.example/api/relay/media/signed-token', mimeType: input.mimeType, bytes: input.bytes.byteLength };
      },
    },
    '@/apps/api/cangyuan-media-upload-application': {
      CANGYUAN_AUDIO_UPLOAD_MAX_BYTES: app.CANGYUAN_AUDIO_UPLOAD_MAX_BYTES,
      CANGYUAN_IMAGE_UPLOAD_MAX_BYTES: app.CANGYUAN_IMAGE_UPLOAD_MAX_BYTES,
      CANGYUAN_VIDEO_UPLOAD_MAX_BYTES: app.CANGYUAN_VIDEO_UPLOAD_MAX_BYTES,
      CangyuanMediaUploadInputError,
    },
    '@/lib/auth': { isTrustedAppRequest: () => trusted },
    '@/lib/runtime-operation': {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
  })('./app/api/cangyuan/media/upload/route');

  const file = new File([Uint8Array.from([0x49, 0x44, 0x33, 0x04])], 'reference.mp3', { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', file);
  form.append('kind', 'audio');
  const request = new Request('http://localhost:3210/api/cangyuan/media/upload', { method: 'POST', body: form });

  const response = await route.POST(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://relay.example/api/relay/media/signed-token');
  assert.equal(published.length, 1);
  assert.equal(published[0].fileName, 'reference.mp3');
  assert.equal(published[0].kind, 'audio');

  const videoForm = new FormData();
  videoForm.append('file', new File([Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])], 'reference.mp4', { type: 'video/mp4' }));
  videoForm.append('kind', 'video');
  const videoResponse = await route.POST(new Request('http://localhost:3210/api/cangyuan/media/upload', { method: 'POST', body: videoForm }));
  assert.equal(videoResponse.status, 200);
  assert.equal(published[1].kind, 'video');
  assert.equal(published[1].mimeType, 'video/mp4');

  const imageForm = new FormData();
  imageForm.append('file', new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'invalid.png', { type: 'image/png' }));
  imageForm.append('kind', 'image');
  const invalidImage = await route.POST(new Request('http://localhost:3210/api/cangyuan/media/upload', { method: 'POST', body: imageForm }));
  assert.equal(invalidImage.status, 400);
  assert.match((await invalidImage.json()).error, /图片格式不匹配/);
  assert.equal(published.length, 2);

  trusted = false;
  const unauthorized = await route.POST(new Request('http://localhost:3210/api/cangyuan/media/upload', { method: 'POST', body: form }));
  assert.equal(unauthorized.status, 401);

  trusted = true;
  const malformed = await route.POST(new Request('http://localhost:3210/api/cangyuan/media/upload', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'not multipart data',
  }));
  assert.equal(malformed.status, 400);
});
