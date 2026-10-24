import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const requireTs = createTsRequire(process.cwd());
const { isBilibiliVideoUrl, resolveBilibiliPublicMedia, BilibiliPublicMediaError } = requireTs('./lib/bilibili-download');

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function fixture() {
  const bvid = 'BV1cBpi6YE8L';
  const pageUrl = `https://www.bilibili.com/video/${bvid}/`;
  const view = {
    code: 0,
    data: {
      bvid,
      cid: 42619766737,
      rights: { pay: 0, ugc_pay: 0, arc_pay: 0 },
      pages: [{ page: 1, cid: 42619766737 }, { page: 2, cid: 42619766738 }],
    },
  };
  const play = {
    code: 0,
    data: {
      quality: 64,
      durl: [{
        size: 24_896_209,
        url: 'https://edge.example.com:4483/video.mp4?sig=public',
        backup_url: [
          'https://upos.example.com/video.mp4?sig=public',
          'https://backup.example.com/video.mp4',
        ],
      }],
    },
  };
  const calls = [];
  const fetcher = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('https://api.bilibili.com/x/web-interface/view?')) return json(view);
    if (url.startsWith('https://api.bilibili.com/x/player/playurl?')) return json(play);
    throw new Error(`Unexpected request ${url}`);
  };
  return { bvid, pageUrl, view, play, calls, fetcher };
}

test('resolves one public progressive MP4 and selects a safe backup CDN', async () => {
  const sample = fixture();
  const media = await resolveBilibiliPublicMedia(`${sample.pageUrl}?spm_id_from=feed`, { fetcher: sample.fetcher });
  assert.deepEqual(media, {
    sourceUrl: sample.pageUrl,
    mediaUrl: 'https://upos.example.com/video.mp4?sig=public',
    id: sample.bvid,
    quality: 64,
    filesize: 24_896_209,
    mimeType: 'video/mp4',
    headers: { Referer: sample.pageUrl, 'User-Agent': 'Mozilla/5.0' },
  });
  assert.equal(sample.calls.length, 2);
  assert.equal(new URL(sample.calls[0].url).searchParams.get('bvid'), sample.bvid);
  const playUrl = new URL(sample.calls[1].url);
  assert.equal(playUrl.searchParams.get('bvid'), sample.bvid);
  assert.equal(playUrl.searchParams.get('cid'), '42619766737');
  assert.equal(playUrl.searchParams.get('fnval'), '1');
  for (const { init } of sample.calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Cookie, undefined);
    assert.equal(init.headers.Referer, sample.pageUrl);
  }
});

test('resolves the requested single part of a multipart BV video', async () => {
  const sample = fixture();
  const media = await resolveBilibiliPublicMedia(`https://m.bilibili.com/video/${sample.bvid}?p=2`, { fetcher: sample.fetcher });
  assert.equal(media.sourceUrl, `${sample.pageUrl}?p=2`);
  assert.equal(media.id, `${sample.bvid}_p2`);
  assert.equal(new URL(sample.calls[1].url).searchParams.get('cid'), '42619766738');
});

test('rejects non-video, lookalike, local, credentialed and malformed part URLs before fetching', async () => {
  const invalid = [
    'file:///tmp/video.mp4',
    'https://example.com/video/BV1cBpi6YE8L',
    'https://www.bilibili.com.evil.example/video/BV1cBpi6YE8L',
    'https://www.bilibili.com/video/BV1cBpi6YE8L/extra',
    'https://www.bilibili.com/video/BVshort',
    'https://user:secret@www.bilibili.com/video/BV1cBpi6YE8L',
    'https://www.bilibili.com:8443/video/BV1cBpi6YE8L',
    'https://www.bilibili.com/video/BV1cBpi6YE8L?p=0',
    'https://www.bilibili.com/video/BV1cBpi6YE8L?p=1&p=2',
  ];
  for (const url of invalid) {
    assert.equal(isBilibiliVideoUrl(url), false, url);
    let called = false;
    await assert.rejects(resolveBilibiliPublicMedia(url, { fetcher: async () => { called = true; throw new Error('fetch'); } }), BilibiliPublicMediaError);
    assert.equal(called, false);
  }
  assert.equal(isBilibiliVideoUrl('https://www.bilibili.com/video/BV1cBpi6YE8L/?p=2'), true);
});

test('rejects paid, mismatched and missing BV work metadata', async () => {
  for (const mutate of [
    (view) => { view.code = -404; },
    (view) => { view.data.bvid = 'BV1K7HY64Etk'; },
    (view) => { view.data.rights.pay = 1; },
    (view) => { view.data.rights.ugc_pay = 1; },
    (view) => { view.data.rights.arc_pay = 1; },
    (view) => { view.data.is_upower_exclusive = 1; },
    (view) => { view.data.pages = []; view.data.cid = 0; },
  ]) {
    const sample = fixture();
    mutate(sample.view);
    await assert.rejects(resolveBilibiliPublicMedia(sample.pageUrl, { fetcher: sample.fetcher }), BilibiliPublicMediaError);
    assert.equal(sample.calls.length, 1);
  }
});

test('rejects missing parts, multi-segment media, oversized media and unsafe CDN addresses', async () => {
  const missing = fixture();
  await assert.rejects(resolveBilibiliPublicMedia(`${missing.pageUrl}?p=3`, { fetcher: missing.fetcher }), BilibiliPublicMediaError);
  assert.equal(missing.calls.length, 1);

  for (const mutate of [
    (play) => { play.code = -404; },
    (play) => { play.data.is_drm = 1; },
    (play) => { play.data.durl.push({ size: 100, url: 'https://upos.example.com/second.mp4' }); },
    (play) => { play.data.durl[0].size = 1_073_741_825; },
    (play) => { play.data.durl[0].url = 'http://127.0.0.1/video.mp4'; play.data.durl[0].backup_url = []; },
    (play) => { play.data.durl[0].url = 'https://localhost/video.mp4'; play.data.durl[0].backup_url = []; },
    (play) => { play.data.durl[0].url = 'https://upos.example.com/stream.m3u8'; play.data.durl[0].backup_url = []; },
    (play) => { play.data.durl = []; },
  ]) {
    const sample = fixture();
    mutate(sample.play);
    await assert.rejects(resolveBilibiliPublicMedia(sample.pageUrl, { fetcher: sample.fetcher }), BilibiliPublicMediaError);
  }
});

test('reports public API HTTP failure', async () => {
  const sample = fixture();
  await assert.rejects(
    resolveBilibiliPublicMedia(sample.pageUrl, { fetcher: async () => json({}, 403) }),
    /HTTP 403/,
  );
});

test('consumes proxied API responses before closing each dispatcher', async () => {
  const sample = fixture();
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
  const proxiedRequire = createTsRequire(process.cwd(), {
    undici: {
      ProxyAgent: WaitingProxyAgent,
      fetch: async (url, init) => {
        const response = await sample.fetcher(url, init);
        const dispatcher = init.dispatcher;
        events.push(`${dispatcher.number}:fetch`);
        return {
          ok: response.ok,
          status: response.status,
          json: async () => {
            const value = await response.json();
            events.push(`${dispatcher.number}:consume`);
            dispatcher.consumed = true;
            dispatcher.finishClose?.();
            return value;
          },
        };
      },
    },
  });
  const proxied = proxiedRequire('./lib/bilibili-download');
  const media = await proxied.resolveBilibiliPublicMedia(sample.pageUrl, { proxy: 'http://proxy.example:8080' });
  assert.equal(media.id, sample.bvid);
  assert.deepEqual(events, ['1:fetch', '1:consume', '1:close', '2:fetch', '2:consume', '2:close']);
});
