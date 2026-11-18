import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from 'undici';
import { createTsRequire } from './ts-require.mjs';

const readerModule = createTsRequire(process.cwd())('./lib/provider-image-reference-reader');

function createReader({
  addresses = [{ address: '8.8.8.8', family: 4 }],
  maxBytes = 8,
  response = () => new Response(Uint8Array.of(1, 2, 3)),
  onRequest = async () => undefined,
} = {}) {
  let requestCount = 0;
  let dispatcherCount = 0;
  let pinnedLookup;
  const reader = readerModule.createProviderImageReferenceReader({
    maxBytes,
    resolveAddresses: async () => addresses,
    createDispatcher: (lookup) => {
      dispatcherCount += 1;
      pinnedLookup = lookup;
      return new Agent({ connect: { lookup } });
    },
    requestAsset: async (url, init) => {
      requestCount += 1;
      await onRequest(url, init, () => pinnedLookup);
      return response();
    },
  });
  return {
    reader,
    get requestCount() { return requestCount; },
    get dispatcherCount() { return dispatcherCount; },
    get pinnedLookup() { return pinnedLookup; },
  };
}

test('provider image reader accepts a public image and uses bounded no-redirect requests', async () => {
  const fixture = createReader({
    onRequest: async (url, init) => {
      assert.equal(url.href, 'https://assets.example/reference.png');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.headers['Accept-Encoding'], 'identity');
      assert.ok(init.dispatcher instanceof Agent);
    },
  });

  assert.deepEqual(Buffer.from(await fixture.reader.read('https://assets.example/reference.png')), Buffer.from([1, 2, 3]));
  assert.equal(fixture.requestCount, 1);
  assert.equal(fixture.dispatcherCount, 1);
});

test('provider image reader rejects reserved IPs and mixed public/private DNS answers', async () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '224.0.0.1', '240.0.0.1', '::1', 'fc00::1',
    'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1',
  ]) {
    assert.equal(readerModule.isPublicImageAddress(address), false, `${address} should be blocked`);
  }
  assert.equal(readerModule.isPublicImageAddress('1.1.1.1'), true);
  assert.equal(readerModule.isPublicImageAddress('2606:4700:4700::1111'), true);

  for (const addresses of [
    [{ address: '10.1.2.3', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '192.168.1.4', family: 4 }],
  ]) {
    const fixture = createReader({ addresses });
    await assert.rejects(fixture.reader.read('https://assets.example/reference.png'), /非公网地址/);
    assert.equal(fixture.requestCount, 0);
    assert.equal(fixture.dispatcherCount, 0);
  }
});

test('provider image reader pins requests to the validated DNS answer', async () => {
  let verifiedAnswer;
  let mismatchedHostError;
  const fixture = createReader({
    addresses: [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
    onRequest: async (url, _init, getLookup) => {
      const lookup = getLookup();
      verifiedAnswer = await new Promise((resolve, reject) => {
        lookup(url.hostname, { all: true, verbatim: true }, (error, result) => error ? reject(error) : resolve(result));
      });
      mismatchedHostError = await new Promise((resolve) => {
        lookup('attacker.example', { all: false }, (error) => resolve(error));
      });
    },
  });

  await fixture.reader.read('https://assets.example/reference.png');
  assert.deepEqual(verifiedAnswer, [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  assert.equal(mismatchedHostError.code, 'EHOSTUNREACH');
});

test('provider image reader blocks redirects and rejects oversized streaming bodies', async () => {
  const redirected = createReader({ response: () => new Response('redirect', { status: 302 }) });
  await assert.rejects(redirected.reader.read('https://assets.example/reference.png'), /HTTP 302/);

  let cancelled = false;
  const oversized = createReader({
    maxBytes: 3,
    response: () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(Uint8Array.of(1, 2, 3, 4));
      },
      cancel() { cancelled = true; },
    })),
  });
  await assert.rejects(oversized.reader.read('https://assets.example/reference.png'), /不能超过/);
  assert.equal(cancelled, true);
});

test('provider image reader rejects local hostnames and malformed URLs before DNS', async () => {
  const fixture = createReader();
  await assert.rejects(fixture.reader.read('http://metadata.google.internal/image.png'), /可公开访问/);
  await assert.rejects(fixture.reader.read('https://user:pass@assets.example/image.png'), /可公开访问/);
  assert.equal(fixture.requestCount, 0);
  assert.equal(fixture.dispatcherCount, 0);
});
