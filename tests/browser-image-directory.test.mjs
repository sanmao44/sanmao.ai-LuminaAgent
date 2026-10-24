import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { saveImagesToDirectory } = createTsRequire(process.cwd())('./lib/browser-image-directory');

function directoryFixture(options = {}) {
  const operations = [];
  const directory = {
    async queryPermission(input) {
      operations.push({ action: 'query', input });
      if (options.permissionError) throw new Error('browser permission failed');
      return options.permission ?? 'granted';
    },
    async requestPermission(input) {
      operations.push({ action: 'request', input });
      return options.requestedPermission ?? 'granted';
    },
    async getFileHandle(name, input) {
      operations.push({ action: 'create', name, input });
      const index = operations.filter(item => item.action === 'create').length;
      return {
        async createWritable() {
          return {
            async write(blob) {
              operations.push({ action: 'write', name, blob });
              if (options.failWriteAt === index) throw new Error('磁盘写入失败');
            },
            async close() {
              operations.push({ action: 'close', name });
              if (options.failCloseAt === index) throw new Error('文件提交失败');
            },
            async abort() {
              operations.push({ action: 'abort', name });
              if (options.failAbort) throw new Error('abort failed');
            },
          };
        },
      };
    },
  };
  return { directory, operations };
}

function imageResponse(type = 'image/png') {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': type } });
}

test('empty image batches do not request permission or fetch files', async t => {
  const fixture = directoryFixture();
  const fetch = t.mock.method(globalThis, 'fetch', async () => imageResponse());
  await saveImagesToDirectory(fixture.directory, []);
  assert.deepEqual(fixture.operations, []);
  assert.equal(fetch.mock.callCount(), 0);
});

test('granted directories save archived same-origin URLs with the image MIME extension', async t => {
  const fixture = directoryFixture();
  const formats = ['image/png', 'IMAGE/JPEG; charset=binary', 'image/webp', 'image/gif', 'image/bmp', 'image/x-ms-bmp'];
  const extensions = ['png', 'jpg', 'webp', 'gif', 'bmp', 'bmp'];
  const images = formats.map((_, index) => ({ url: `/api/storage/file?name=archived-${index}` }));
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const index = fetched.length;
    fetched.push(url);
    return imageResponse(formats[index]);
  });

  await saveImagesToDirectory(fixture.directory, images);

  assert.deepEqual(fetched, images.map(image => image.url));
  assert.deepEqual(fixture.operations[0], { action: 'query', input: { mode: 'readwrite' } });
  assert.equal(fixture.operations.some(item => item.action === 'request'), false);
  const files = fixture.operations.filter(item => item.action === 'create');
  assert.equal(new Set(files.map(file => file.name)).size, images.length);
  for (const [index, file] of files.entries()) {
    assert.equal(file.name.endsWith(`.${extensions[index]}`), true);
    assert.deepEqual(file.input, { create: true });
    const actions = fixture.operations.filter(item => item.name === file.name).map(item => item.action);
    assert.deepEqual(actions, ['create', 'write', 'close']);
  }
  for (const item of fixture.operations.filter(item => item.action === 'write')) {
    assert.deepEqual(new Uint8Array(await item.blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
  }
});

test('prompted write permission is requested before downloading an image', async t => {
  const fixture = directoryFixture({ permission: 'prompt' });
  t.mock.method(globalThis, 'fetch', async () => {
    assert.deepEqual(fixture.operations.map(item => item.action), ['query', 'request']);
    return imageResponse();
  });
  await saveImagesToDirectory(fixture.directory, [{ url: '/api/storage/file?name=one.png' }]);
  assert.deepEqual(fixture.operations[1], { action: 'request', input: { mode: 'readwrite' } });
});

test('concurrent batches use distinct filenames even when saved in the same millisecond', async t => {
  const fixture = directoryFixture();
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  t.mock.method(globalThis, 'fetch', async () => imageResponse('image/gif'));
  const images = [{ url: '/api/storage/file?name=one.gif' }, { url: '/api/storage/file?name=two.gif' }];

  await Promise.all([
    saveImagesToDirectory(fixture.directory, images),
    saveImagesToDirectory(fixture.directory, images),
  ]);

  const files = fixture.operations.filter(item => item.action === 'create');
  assert.equal(files.length, 4);
  assert.equal(new Set(files.map(file => file.name)).size, 4);
  assert.equal(fixture.operations.filter(item => item.action === 'close').length, 4);
});

test('denied write permission stops before fetch with an actionable error', async t => {
  const fixture = directoryFixture({ permission: 'denied', requestedPermission: 'denied' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => imageResponse());
  await assert.rejects(saveImagesToDirectory(fixture.directory, [{ url: '/api/storage/file?name=one.png' }]), /重新选择本地目录并允许写入/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(fixture.operations.some(item => item.action === 'create'), false);
});

test('missing or failing browser permission APIs report recovery instructions', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => imageResponse());
  const missing = directoryFixture();
  delete missing.directory.queryPermission;
  delete missing.directory.requestPermission;
  await assert.rejects(saveImagesToDirectory(missing.directory, [{ url: '/one.png' }]), /重新选择本地目录并允许写入/);
  const failed = directoryFixture({ permissionError: true });
  await assert.rejects(saveImagesToDirectory(failed.directory, [{ url: '/one.png' }]), /无法获取目录写入权限/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('HTTP failures are reported after the remaining images are saved', async t => {
  const fixture = directoryFixture();
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async url => {
    fetched.push(url);
    return fetched.length === 1 ? new Response('unavailable', { status: 503 }) : imageResponse('image/gif');
  });
  await assert.rejects(saveImagesToDirectory(fixture.directory, [{ url: '/missing' }, { url: '/available' }]), error => {
    assert.match(error.message, /已保存 1\/2 张图片，1 张未保存/);
    assert.match(error.message, /第 1 张：下载失败（HTTP 503）/);
    return true;
  });
  assert.deepEqual(fetched, ['/missing', '/available']);
  assert.equal(fixture.operations.filter(item => item.action === 'close').length, 1);
  assert.equal(fixture.operations.some(item => item.action === 'create' && item.name.endsWith('-2.gif')), true);
});

test('network failures and non-image responses do not prevent later images from saving', async t => {
  const fixture = directoryFixture();
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/network-error') throw new Error('网络连接中断');
    if (url === '/html') return new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } });
    return imageResponse('image/webp');
  });
  await assert.rejects(saveImagesToDirectory(fixture.directory, [{ url: '/network-error' }, { url: '/html' }, { url: '/image' }]), error => {
    assert.match(error.message, /已保存 1\/3 张图片，2 张未保存/);
    assert.match(error.message, /网络连接中断/);
    assert.match(error.message, /不是受支持的图片格式/);
    return true;
  });
  assert.equal(fixture.operations.filter(item => item.action === 'create').length, 1);
  assert.equal(fixture.operations.filter(item => item.action === 'close').length, 1);
});

for (const stage of ['write', 'close']) {
  test(`${stage} failures abort the stream and preserve successful later files`, async t => {
    const fixture = directoryFixture(stage === 'write' ? { failWriteAt: 1 } : { failCloseAt: 1 });
    t.mock.method(globalThis, 'fetch', async () => imageResponse());
    await assert.rejects(saveImagesToDirectory(fixture.directory, [{ url: '/one' }, { url: '/two' }]), /已保存 1\/2 张图片，1 张未保存/);
    const files = fixture.operations.filter(item => item.action === 'create');
    const failedActions = fixture.operations.filter(item => item.name === files[0].name).map(item => item.action);
    assert.equal(failedActions.at(-1), 'abort');
    assert.equal(failedActions.includes('close'), stage === 'close');
    assert.deepEqual(fixture.operations.filter(item => item.name === files[1].name).map(item => item.action), ['create', 'write', 'close']);
  });
}

test('an abort failure keeps the original write error and continues the batch', async t => {
  const fixture = directoryFixture({ failWriteAt: 1, failAbort: true });
  t.mock.method(globalThis, 'fetch', async () => imageResponse());
  await assert.rejects(saveImagesToDirectory(fixture.directory, [{ url: '/one' }, { url: '/two' }]), error => {
    assert.match(error.message, /磁盘写入失败/);
    assert.doesNotMatch(error.message, /abort failed/);
    return true;
  });
  assert.equal(fixture.operations.filter(item => item.action === 'close').length, 1);
});
