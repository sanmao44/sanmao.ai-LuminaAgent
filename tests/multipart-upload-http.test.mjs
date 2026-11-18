import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { MalformedMultipartRequestError, MultipartBodyTooLargeError, readBoundedMultipartFormData } = createTsRequire(process.cwd())('./apps/api/multipart-upload-http');

test('reads bounded multipart form data without relying on Content-Length', async () => {
  const form = new FormData();
  form.set('kind', 'audio');
  const request = new Request('http://localhost/upload', { method: 'POST', body: form });
  const parsed = await readBoundedMultipartFormData(request, 1024);
  assert.equal(parsed.get('kind'), 'audio');
});

test('stops streaming a multipart request when its bytes exceed the configured limit', async () => {
  let cancelled = false;
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=test' },
    body: new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
      },
      cancel() { cancelled = true; },
    }),
    duplex: 'half',
  });

  await assert.rejects(() => readBoundedMultipartFormData(request, 5), MultipartBodyTooLargeError);
  assert.equal(cancelled, true);
});

test('reports malformed multipart requests as client input errors', async () => {
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'not multipart data',
  });

  await assert.rejects(() => readBoundedMultipartFormData(request, 1024), MalformedMultipartRequestError);
});
