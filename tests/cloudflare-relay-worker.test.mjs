import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import test from 'node:test';
import worker from '../relay/cloudflare/src/index.mjs';

const PNG_1X1 = await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
}).png().toBuffer();
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

test('enforces the raw streaming size limit when content length is absent', async () => {
  const { env, bucket } = makeEnvironment();
  const bytes = new Uint8Array(4 * 1024 * 1024 + 1);
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

test('rejects oversized multipart bodies even when content length is absent', async () => {
  const { env, bucket } = makeEnvironment();
  const body = new Uint8Array(4 * 1024 * 1024 + 128 * 1024 + 1);
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
