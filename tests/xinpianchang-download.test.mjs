import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/xinpianchang-download.ts', import.meta.url);
const compiled = ts.transpileModule(await readFile(sourceUrl, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(createTsRequire(new URL('../lib', import.meta.url).pathname), module, module.exports);
const { isXinpianchangVideoUrl, resolveXinpianchangPublicMedia, XinpianchangPublicMediaError } = module.exports;

function loadWithUndici(undici) {
  const instance = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    createTsRequire(new URL('../lib', import.meta.url).pathname, { undici }),
    instance,
    instance.exports,
  );
  return instance.exports;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function fixture(id = '13727498') {
  const buildId = 'current-build_123';
  const vid = `vid_${id}`;
  const appKey = `key_${id}`;
  const calls = [];
  const formats = [
    { quality: '2160p', mime: 'video/mp4', bitrate: 9_000_000, filesize: 1_073_741_825, height: 2160, url: 'https://cdn.example.com/2160p.mp4' },
    { quality: '1080p', mime: 'video/mp4', bitrate: 4_000_000, filesize: 80_000_000, height: 1080, url: null },
    { quality: '720p', mime: 'video/mp4', bitrate: 2_000_000, filesize: 30_000_000, height: 720, url: 'https://cdn.example.com/720p.mp4?sig=public' },
    { quality: '360p', mime: 'video/mp4', bitrate: 300_000, filesize: 5_000_000, height: 360, url: 'https://cdn.example.com/360p.mp4' },
  ];
  const fetcher = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://www.xinpianchang.com/') {
      return new Response(`<html><script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ buildId })}</script></html>`);
    }
    if (url === `https://www.xinpianchang.com/_next/data/${buildId}/a${id}.json`) {
      return json({ pageProps: { detail: { id: Number(id), video: { vid, appKey } } } });
    }
    if (url === `https://mod-api.xinpianchang.com/mod/api/v2/media/${vid}?appKey=${appKey}`) {
      return json({ status: 0, data: { private: 0, resource: { progressive: formats } } });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return { fetcher, calls, formats, buildId, vid, appKey };
}

test('resolves an arbitrary public work through home build ID, Next data and media API', async () => {
  const { fetcher, calls } = fixture('13727498');
  const media = await resolveXinpianchangPublicMedia(
    'https://www.xinpianchang.com/a13727498?from=homeRecommend&index=5-2-14',
    { fetcher },
  );
  assert.deepEqual(media, {
    sourceUrl: 'https://www.xinpianchang.com/a13727498',
    mediaUrl: 'https://cdn.example.com/720p.mp4?sig=public',
    id: 'a13727498',
    quality: '720p',
    filesize: 30_000_000,
    mimeType: 'video/mp4',
    headers: { Range: 'bytes=0-', Referer: 'https://www.xinpianchang.com/a13727498' },
  });
  assert.equal(calls.length, 3);
  for (const { init } of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Cookie, undefined);
  }
});

test('consumes each proxied response before closing its dispatcher', async () => {
  const base = fixture();
  const events = [];
  let requestNumber = 0;
  class WaitingProxyAgent {
    constructor(proxy) {
      assert.equal(proxy, 'http://proxy.example:8080');
      this.number = ++requestNumber;
      this.consumed = false;
    }
    close() {
      events.push(`${this.number}:close`);
      if (this.consumed) return Promise.resolve();
      return new Promise((resolve) => { this.finishClose = resolve; });
    }
    destroy() {
      events.push(`${this.number}:destroy`);
      this.finishClose?.();
      return Promise.resolve();
    }
  }
  const proxied = loadWithUndici({
    ProxyAgent: WaitingProxyAgent,
    fetch: async (url, init) => {
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Cookie, undefined);
      const response = await base.fetcher(url, init);
      const dispatcher = init.dispatcher;
      events.push(`${dispatcher.number}:fetch`);
      return {
        ok: response.ok,
        status: response.status,
        text: async () => {
          const body = await response.text();
          events.push(`${dispatcher.number}:consume`);
          dispatcher.consumed = true;
          dispatcher.finishClose?.();
          return body;
        },
      };
    },
  });
  let timeout;
  try {
    const media = await Promise.race([
      proxied.resolveXinpianchangPublicMedia('https://www.xinpianchang.com/a13727498?from=share', { proxy: 'http://proxy.example:8080' }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('proxy dispatcher closed before response body was consumed')), 500); }),
    ]);
    assert.equal(media.id, 'a13727498');
    assert.deepEqual(events, [
      '1:fetch', '1:consume', '1:close',
      '2:fetch', '2:consume', '2:close',
      '3:fetch', '3:consume', '3:close',
    ]);
  } finally {
    clearTimeout(timeout);
  }
});

test('destroys the proxy dispatcher when an endpoint rejects a request', async () => {
  const calls = [];
  const proxied = loadWithUndici({
    ProxyAgent: class {
      close() { calls.push('close'); return Promise.resolve(); }
      destroy() { calls.push('destroy'); return Promise.resolve(); }
    },
    fetch: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(
    proxied.resolveXinpianchangPublicMedia('https://www.xinpianchang.com/a13727498', { proxy: 'http://proxy.example:8080' }),
    /HTTP 403/,
  );
  assert.deepEqual(calls, ['destroy']);
});

test('uses another work ID without a fixed video ID or build path', async () => {
  const { fetcher, calls } = fixture('13838106');
  const media = await resolveXinpianchangPublicMedia('http://xinpianchang.com/a13838106/', { fetcher });
  assert.equal(media.id, 'a13838106');
  assert.equal(media.sourceUrl, 'https://www.xinpianchang.com/a13838106');
  assert.match(calls[1].url, /\/a13838106\.json$/);
  assert.match(calls[2].url, /media\/vid_13838106\?appKey=key_13838106$/);
});

test('rejects non-work, lookalike, local and credentialed source URLs before any request', async () => {
  const badUrls = [
    'file:///tmp/video.mp4',
    'https://example.com/a13727498',
    'https://www.xinpianchang.com.evil.example/a13727498',
    'https://www.xinpianchang.com/a13727498/extra',
    'https://www.xinpianchang.com/a0',
    'https://user:password@www.xinpianchang.com/a13727498',
    'https://www.xinpianchang.com:8443/a13727498',
  ];
  for (const url of badUrls) {
    assert.equal(isXinpianchangVideoUrl(url), false, url);
    let called = false;
    await assert.rejects(
      resolveXinpianchangPublicMedia(url, { fetcher: async () => { called = true; throw new Error('should not fetch'); } }),
      XinpianchangPublicMediaError,
      url,
    );
    assert.equal(called, false, url);
  }
  assert.equal(isXinpianchangVideoUrl('https://www.xinpianchang.com/a12345678?from=feed'), true);
});

test('rejects malformed Next data, mismatched work ID and media identifiers', async () => {
  const base = fixture();
  const invalidResponses = [
    ['missing build ID', (url) => url.endsWith('/'), new Response('<html></html>')],
    ['bad build ID', (url) => url.endsWith('/'), new Response('<script id="__NEXT_DATA__">{"buildId":"../bad"}</script>')],
    ['mismatched work', (url) => url.includes('/_next/data/'), json({ pageProps: { detail: { id: 42, video: { vid: base.vid, appKey: base.appKey } } } })],
    ['bad media ID', (url) => url.includes('/_next/data/'), json({ pageProps: { detail: { id: 13727498, video: { vid: '../bad', appKey: base.appKey } } } })],
  ];
  for (const [name, match, response] of invalidResponses) {
    const fetcher = async (input, init) => match(String(input)) ? response.clone() : base.fetcher(input, init);
    await assert.rejects(resolveXinpianchangPublicMedia('https://www.xinpianchang.com/a13727498', { fetcher }), XinpianchangPublicMediaError, name);
  }
});

test('rejects private media and missing or unsafe formats', async () => {
  const base = fixture();
  const variants = [
    { status: 1, data: { private: 0, resource: { progressive: base.formats } } },
    { status: 0, data: { private: 1, resource: { progressive: base.formats } } },
    { status: 0, data: { private: 0, resource: { progressive: [{ ...base.formats[2], url: 'http://127.0.0.1/private.mp4' }] } } },
    { status: 0, data: { private: 0, resource: { progressive: [{ ...base.formats[2], url: 'https://cdn.example.com/big.mp4', filesize: 1_073_741_825 }] } } },
    { status: 0, data: { private: 0, resource: { progressive: [] } } },
  ];
  for (const payload of variants) {
    const fetcher = (input, init) => String(input).includes('/mod/api/v2/media/') ? Promise.resolve(json(payload)) : base.fetcher(input, init);
    await assert.rejects(resolveXinpianchangPublicMedia('https://www.xinpianchang.com/a13727498', { fetcher }), XinpianchangPublicMediaError);
  }
});

test('reports public endpoint HTTP failure', async () => {
  const fetcher = async () => new Response('Forbidden', { status: 403 });
  await assert.rejects(
    resolveXinpianchangPublicMedia('https://www.xinpianchang.com/a13727498', { fetcher }),
    /HTTP 403/,
  );
});
