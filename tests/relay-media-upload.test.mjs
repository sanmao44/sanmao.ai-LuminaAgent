import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const MP4_HEADER = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

test('self-hosted relay publishes a valid video and rejects malformed or oversized input', async () => {
  const previousMode = process.env.SANMAO_RELAY_MODE;
  const previousUploadToken = process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN;
  process.env.SANMAO_RELAY_MODE = '1';
  delete process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN;
  const stored = [];
  const route = createTsRequire(process.cwd(), {
    '@/lib/signed-media': {
      PUBLIC_MEDIA_TTL_MS: 30 * 60 * 1000,
      storeSignedMedia: async (bytes, mime, kind, options) => {
        stored.push({ bytes, mime, kind, options });
        return { url: 'https://relay.example/api/relay/media/video-token', expiresAt: Date.now() + options.ttlMs, bytes: bytes.byteLength };
      },
    },
    '@/lib/runtime-operation': {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
  })('./app/api/relay/media/route');

  const request = (bytes, mime = 'video/mp4', token) => {
    const form = new FormData();
    form.set('file', new File([bytes], 'reference.mp4', { type: mime }));
    form.set('kind', 'video');
    return new Request('https://relay.example/api/relay/media', {
      method: 'POST',
      ...(token ? { headers: { 'x-sanmao-relay-token': token } } : {}),
      body: form,
    });
  };

  try {
    const unconfigured = await route.POST(request(MP4_HEADER));
    assert.equal(unconfigured.status, 503);
    assert.equal(stored.length, 0);

    process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN = 'test-self-hosted-upload-token';
    const unauthorized = await route.POST(request(MP4_HEADER, 'video/mp4', 'wrong-token'));
    assert.equal(unauthorized.status, 401);
    assert.equal(stored.length, 0);

    const valid = await route.POST(request(MP4_HEADER, 'video/mp4', process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN));
    assert.equal(valid.status, 200);
    assert.equal(stored[0].kind, 'video');
    assert.equal(stored[0].mime, 'video/mp4');
    assert.deepEqual([...stored[0].bytes], [...MP4_HEADER]);

    const malformed = await route.POST(request(Uint8Array.from([1, 2, 3, 4]), 'video/mp4', process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN));
    assert.equal(malformed.status, 415);
    const oversized = await route.POST(request(new Uint8Array(25 * 1024 * 1024 + 1), 'video/mp4', process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN));
    assert.equal(oversized.status, 413);
    assert.equal(stored.length, 1);
  } finally {
    if (previousMode === undefined) delete process.env.SANMAO_RELAY_MODE;
    else process.env.SANMAO_RELAY_MODE = previousMode;
    if (previousUploadToken === undefined) delete process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN;
    else process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN = previousUploadToken;
  }
});

test('self-hosted signed media read route serves only supported media MIME types', async () => {
  let mime = 'video/mp4';
  const route = createTsRequire(process.cwd(), {
    '@/lib/signed-media': {
      readSignedMedia: async () => ({ mime, data: Buffer.from(MP4_HEADER) }),
      isSupportedRelayMime: (value) => new Set([
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4',
        'video/mp4', 'video/quicktime', 'video/webm',
      ]).has(value),
    },
  })('./app/api/relay/media/[token]/route');

  const supported = await route.GET(new Request('https://relay.example/api/relay/media/token'), { params: Promise.resolve({ token: 'token' }) });
  assert.equal(supported.status, 200);
  assert.equal(supported.headers.get('content-type'), 'video/mp4');

  mime = 'video/x-msvideo';
  const unsupported = await route.GET(new Request('https://relay.example/api/relay/media/token'), { params: Promise.resolve({ token: 'token' }) });
  assert.equal(unsupported.status, 404);
});
