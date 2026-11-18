import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import test from 'node:test';
import worker from '../relay/cloudflare/src/index.mjs';

const PNG_1X1 = await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
}).png().toBuffer();
const MP3_HEADER = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const AAC_ADTS_HEADER = Uint8Array.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]);
const MP4_HEADER = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM_HEADER = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88]);
const SIGNING_KEY = 'test-signing-key-with-at-least-32-bytes';

async function collectBody(body) {
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      length += result.value.byteLength;
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
  return new Uint8Array(body);
}

class MemoryBucket {
  objects = new Map();

  async put(key, body, options = {}) {
    this.objects.set(key, { body: await collectBody(body), httpMetadata: options.httpMetadata || {} });
  }

  async get(key) {
    const item = this.objects.get(key);
    if (!item) return null;
    return { ...item, body: new Uint8Array(item.body) };
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor ? Math.max(0, keys.indexOf(cursor) + 1) : 0;
    const selected = keys.slice(start, start + limit);
    return {
      objects: selected.map((key) => ({ key })),
      truncated: start + limit < keys.length,
      cursor: start + limit < keys.length ? selected.at(-1) : undefined,
    };
  }
}

function makeEnvironment(options = {}) {
  const bucket = options.bucket || new MemoryBucket();
  const limiter = options.limiter || { limit: async () => ({ success: true }) };
  return {
    env: {
      MEDIA_BUCKET: bucket,
      UPLOAD_LIMITER: limiter,
      MEDIA_SIGNING_KEY: SIGNING_KEY,
    },
    bucket,
  };
}

async function uploadRequest(bytes = PNG_1X1) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'reference.png');
  form.append('kind', 'image');
  return new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '192.0.2.10' },
    body: form,
  });
}

async function rawUploadRequest(bytes = PNG_1X1, contentType = 'image/png') {
  return new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '192.0.2.10',
      'content-type': contentType,
    },
    body: bytes,
  });
}

async function rawAudioUploadRequest(bytes = MP3_HEADER, contentType = 'audio/mpeg') {
  return new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '192.0.2.10',
      'content-type': contentType,
    },
    body: bytes,
  });
}

async function rawVideoUploadRequest(bytes = MP4_HEADER, contentType = 'video/mp4') {
  return new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '192.0.2.10', 'content-type': contentType },
    body: bytes,
  });
}

test('health endpoint reports ready only when storage, limiter, and signing secret exist', async () => {
  const { env } = makeEnvironment();
  const ready = await worker.fetch(new Request('https://relay.example.workers.dev/api/health'), env);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { service: 'sanmao-ai-studio', ok: true, relay: 'r2' });

  const unconfigured = await worker.fetch(new Request('https://relay.example.workers.dev/api/health'), {});
  assert.equal(unconfigured.status, 503);
});

test('streams an image to R2 and serves it through a short-lived signed URL', async () => {
  const { env, bucket } = makeEnvironment();
  const uploaded = await worker.fetch(await rawUploadRequest(), env);
  assert.equal(uploaded.status, 200);
  const payload = await uploaded.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.bytes, PNG_1X1.length);
  assert.ok(Date.parse(payload.expiresAt) > Date.now());
  assert.match(payload.url, /^https:\/\/relay\.example\.workers\.dev\/api\/relay\/media\//);
  assert.equal(bucket.objects.size, 1);

  const served = await worker.fetch(new Request(payload.url), env);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), new Uint8Array(PNG_1X1));
});

test('keeps the existing multipart relay contract working', async () => {
  const { env, bucket } = makeEnvironment();
  const uploaded = await worker.fetch(await uploadRequest(), env);
  assert.equal(uploaded.status, 200);
  const payload = await uploaded.json();
  assert.equal(payload.bytes, PNG_1X1.length);
  assert.deepEqual([...bucket.objects.values()][0].body, new Uint8Array(PNG_1X1));
});

test('stores raw audio uploads and serves them through a short-lived signed URL', async () => {
  const { env, bucket } = makeEnvironment();
  const uploaded = await worker.fetch(await rawAudioUploadRequest(), env);
  assert.equal(uploaded.status, 200);
  const payload = await uploaded.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.bytes, MP3_HEADER.length);
  assert.match(payload.url, /^https:\/\/relay\.example\.workers\.dev\/api\/relay\/media\//);
  assert.equal(bucket.objects.size, 1);

  const served = await worker.fetch(new Request(payload.url), env);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), MP3_HEADER);
});

test('detects ADTS AAC before the broader MPEG frame signature', async () => {
  const { env, bucket } = makeEnvironment();
  const uploaded = await worker.fetch(await rawAudioUploadRequest(AAC_ADTS_HEADER, 'audio/aac'), env);
  assert.equal(uploaded.status, 200);
  const payload = await uploaded.json();
  assert.equal(payload.bytes, AAC_ADTS_HEADER.length);
  assert.equal([...bucket.objects.values()][0].httpMetadata.contentType, 'audio/aac');

  const form = new FormData();
  form.append('file', new Blob([AAC_ADTS_HEADER], { type: 'audio/aac' }), 'reference.aac');
  form.append('kind', 'audio');
  const multipart = await worker.fetch(new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '192.0.2.10' },
    body: form,
  }), env);
  assert.equal(multipart.status, 200);
});

test('accepts multipart audio and rejects audio with a mismatched declared MIME', async () => {
  const { env, bucket } = makeEnvironment();
  const form = new FormData();
  form.append('file', new Blob([MP3_HEADER], { type: 'audio/mpeg' }), 'reference.mp3');
  form.append('kind', 'audio');
  const accepted = await worker.fetch(new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '192.0.2.10' },
    body: form,
  }), env);
  assert.equal(accepted.status, 200);

  const mismatched = await worker.fetch(await rawAudioUploadRequest(MP3_HEADER, 'audio/wav'), env);
  assert.equal(mismatched.status, 415);
  assert.equal(bucket.objects.size, 1);
});

test('stores raw and multipart video references and serves signed videos', async () => {
  const { env, bucket } = makeEnvironment();
  const uploaded = await worker.fetch(await rawVideoUploadRequest(), env);
  assert.equal(uploaded.status, 200);
  const payload = await uploaded.json();
  const served = await worker.fetch(new Request(payload.url), env);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), MP4_HEADER);

  const form = new FormData();
  form.append('file', new Blob([WEBM_HEADER], { type: 'video/webm' }), 'reference.webm');
  form.append('kind', 'video');
  const multipart = await worker.fetch(new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.10' }, body: form,
  }), env);
  assert.equal(multipart.status, 200);
  assert.equal(bucket.objects.size, 2);
  assert.equal([...bucket.objects.values()][1].httpMetadata.contentType, 'video/webm');
});

test('rejects malformed or MIME-mismatched videos before writing to R2', async () => {
  const { env, bucket } = makeEnvironment();
  const malformed = await worker.fetch(await rawVideoUploadRequest(Uint8Array.from([1, 2, 3, 4])), env);
  assert.equal(malformed.status, 415);
  const mismatch = await worker.fetch(await rawVideoUploadRequest(MP4_HEADER, 'video/webm'), env);
  assert.equal(mismatch.status, 415);
  assert.equal(bucket.objects.size, 0);
});

test('enforces the streaming video limit without relying on Content-Length', async () => {
  const { env, bucket } = makeEnvironment();
  const request = new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '192.0.2.10', 'content-type': 'video/mp4' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(MP4_HEADER);
        controller.enqueue(new Uint8Array(25 * 1024 * 1024 - MP4_HEADER.byteLength + 1));
        controller.close();
      },
    }),
    duplex: 'half',
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.equal(bucket.objects.size, 0);
});

test('rejects raw audio over the 25 MiB relay limit before reading it', async () => {
  const { env, bucket } = makeEnvironment();
  const response = await worker.fetch(new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '192.0.2.10',
      'content-type': 'audio/mpeg',
      'content-length': String(25 * 1024 * 1024 + 1),
    },
    body: MP3_HEADER,
  }), env);
  assert.equal(response.status, 413);
  assert.equal(bucket.objects.size, 0);
});

test('rejects malformed images before writing to R2', async () => {
  const { env, bucket } = makeEnvironment();
  const response = await worker.fetch(await uploadRequest(Uint8Array.from([1, 2, 3, 4])), env);
  assert.equal(response.status, 415);
  assert.equal(bucket.objects.size, 0);
});

test('rejects truncated PNG streams before completing an R2 object', async () => {
  const { env, bucket } = makeEnvironment();
  const response = await worker.fetch(await rawUploadRequest(PNG_1X1.subarray(0, 24)), env);
  assert.equal(response.status, 415);
  assert.equal(bucket.objects.size, 0);
});

test('enforces the raw image streaming size limit when content length is absent', async () => {
  const { env, bucket } = makeEnvironment();
  const bytes = new Uint8Array(30 * 1024 * 1024 + 1);
  const request = new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '192.0.2.10',
      'content-type': 'image/png',
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    duplex: 'half',
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.equal(bucket.objects.size, 0);
});

test('enforces the shared relay per-IP rate limit', async () => {
  let rateKey = '';
  const { env, bucket } = makeEnvironment({
    limiter: {
      limit: async ({ key }) => {
        rateKey = key;
        return { success: false };
      },
    },
  });
  const response = await worker.fetch(await uploadRequest(), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(rateKey, '192.0.2.10');
  assert.equal(bucket.objects.size, 0);
});

test('rejects oversized multipart bodies beyond the image upload limit even when content length is absent', async () => {
  const { env, bucket } = makeEnvironment();
  const body = new Uint8Array(30 * 1024 * 1024 + 128 * 1024 + 1);
  const request = new Request('https://relay.example.workers.dev/api/relay/media', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '192.0.2.10',
      'content-type': 'multipart/form-data; boundary=test',
    },
    body,
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.equal(bucket.objects.size, 0);
});

test('does not read R2 objects when a signed URL token is modified', async () => {
  let reads = 0;
  const { env } = makeEnvironment({
    bucket: {
      put: async () => {},
      get: async () => { reads += 1; return null; },
    },
  });
  const uploaded = await worker.fetch(await uploadRequest(), env);
  const payload = await uploaded.json();
  const tamperedUrl = payload.url.slice(0, -1) + (payload.url.endsWith('a') ? 'b' : 'a');
  const response = await worker.fetch(new Request(tamperedUrl), env);
  assert.equal(response.status, 404);
  assert.equal(reads, 0);
});

test('Cloudflare config binds R2, a unique per-account rate limit, and upload pause switch', async () => {
  const config = JSON.parse(await readFile(new URL('../relay/cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.r2_buckets[0].binding, 'MEDIA_BUCKET');
  assert.equal(config.ratelimits[0].name, 'UPLOAD_LIMITER');
  assert.match(config.ratelimits[0].namespace_id, /^\d+$/u);
  assert.equal(config.ratelimits[0].simple.period, 60);
  assert.equal(config.vars.MEDIA_UPLOADS_ENABLED, 'true');
  assert.equal(config.triggers, undefined);
});

test('can pause public uploads without disabling reads of existing media', async () => {
  const { env } = makeEnvironment();
  const uploaded = await worker.fetch(await rawUploadRequest(), env);
  const payload = await uploaded.json();
  env.MEDIA_UPLOADS_ENABLED = 'false';

  const health = await worker.fetch(new Request('https://relay.example.workers.dev/api/health'), env);
  const upload = await worker.fetch(await rawUploadRequest(), env);
  const read = await worker.fetch(new Request(payload.url), env);

  assert.equal(health.status, 503);
  assert.equal(upload.status, 503);
  assert.equal(read.status, 200);
});
