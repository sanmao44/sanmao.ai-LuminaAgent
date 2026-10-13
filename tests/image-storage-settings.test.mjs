import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function withStorageFixture(run, overrides = {}) {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'sanmao-image-settings-'));
  const environment = {
    SANMAO_DATA_DIR: path.join(root, 'data'),
    SANMAO_PROVIDER_CONFIG_DIR: path.join(root, 'config'),
    SANMAO_MEDIA_ROOT: path.join(root, 'media'),
    SANMAO_IMAGE_STORAGE_PATH: '',
    SANMAO_NETWORK_MODE: 'local',
    SANMAO_ADMIN_PASSWORD: '',
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try {
    const load = createTsRequire(process.cwd(), overrides);
    await run({ root, load, storage: load('./lib/image-storage'), media: load('./lib/media-paths'), store: load('./lib/store') });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsPromises.rm(root, { recursive: true, force: true });
  }
}

function storedName(url) {
  return new URL(url, 'http://sanmao.test').searchParams.get('name');
}

test('switching default → custom A → custom B → default keeps old image URLs readable without moving files', async () => {
  await withStorageFixture(async ({ root, storage, store }) => {
    const original = await storage.persistImageBuffer(png);
    const customA = path.join(root, 'custom-a');
    const customB = path.join(root, 'custom-b');

    await store.patchSettings({ imageStoragePath: customA });
    assert.equal(storage.resolveStoredFileWithFallback(customA, storedName(original.url)), path.join(original.path, original.name));
    assert.deepEqual(await fsPromises.readdir(customA), [], 'switching directories never copies the old images');
    const imageA = await storage.persistImageBuffer(png, 'image/png', customA);

    await store.patchSettings({ imageStoragePath: customB });
    assert.equal(storage.resolveStoredFileWithFallback(customB, imageA.name), path.join(customA, imageA.name));
    assert.equal(storage.resolveStoredFileWithFallback(customB, original.name), path.join(original.path, original.name));
    assert.deepEqual(await fsPromises.readdir(customB), []);
    const imageB = await storage.persistImageBuffer(png, 'image/png', customB);

    await store.patchSettings({ imageStoragePath: '' });
    assert.equal((await store.getPublicState()).settings.imageStoragePath, '');
    assert.equal(storage.resolveStoredFileWithFallback('', imageA.name), path.join(customA, imageA.name));
    assert.equal(storage.resolveStoredFileWithFallback('', imageB.name), path.join(customB, imageB.name));
    assert.equal(await storage.resolveStoredImageReference(imageA.url, ''), `data:image/png;base64,${png.toString('base64')}`);
    assert.deepEqual(await fsPromises.readdir(customA), [imageA.name], 'write probes are removed and existing files remain');
    assert.deepEqual(await fsPromises.readdir(customB), [imageB.name]);
  });
});

test('relative settings paths are saved as absolute server paths and invalid directories do not change settings', async () => {
  await withStorageFixture(async ({ root, store }) => {
    const target = path.join(root, 'relative-images');
    const relative = path.relative(process.cwd(), target);
    await store.patchSettings({ imageStoragePath: `  ${relative}  ` });
    assert.equal((await store.getPublicState()).settings.imageStoragePath, target);
    assert.deepEqual(await fsPromises.readdir(target), []);

    const file = path.join(root, 'ordinary-file');
    await fsPromises.writeFile(file, 'keep');
    await assert.rejects(store.patchSettings({ imageStoragePath: file }), /图片保存目录不可写/);
    assert.equal((await store.getPublicState()).settings.imageStoragePath, target);
    assert.equal(await fsPromises.readFile(file, 'utf8'), 'keep');
  });
});

test('a write permission error refuses settings changes', async () => {
  await withStorageFixture(async ({ root, store }) => {
    const target = path.join(root, 'denied-images');
    await assert.rejects(store.patchSettings({ imageStoragePath: target }), /图片保存目录不可写/);
    assert.equal((await store.getPublicState()).settings.imageStoragePath, '');
    assert.deepEqual(await fsPromises.readdir(target), []);
  }, {
    'node:fs/promises': {
      ...fsPromises,
      open: async () => { throw Object.assign(new Error('fixture denied'), { code: 'EACCES' }); },
    },
  });
});

test('a partial write failure closes and removes only its own probe', async () => {
  await withStorageFixture(async ({ root, store }) => {
    const target = path.join(root, 'write-failure-images');
    await fsPromises.mkdir(target);
    await fsPromises.writeFile(path.join(target, 'keep.txt'), 'keep');
    await assert.rejects(store.patchSettings({ imageStoragePath: target }), /图片保存目录不可写/);
    assert.equal((await store.getPublicState()).settings.imageStoragePath, '');
    assert.deepEqual(await fsPromises.readdir(target), ['keep.txt']);
  }, {
    'node:fs/promises': {
      ...fsPromises,
      open: async (...args) => {
        const handle = await fsPromises.open(...args);
        return {
          writeFile: async () => { await handle.writeFile('partial'); throw new Error('fixture disk full'); },
          close: () => handle.close(),
        };
      },
    },
  });
});

test('registry persistence failure refuses a switch and preserves the existing registry', async () => {
  let refuseRename = false;
  await withStorageFixture(async ({ root, store, media }) => {
    const customA = path.join(root, 'custom-a');
    await store.patchSettings({ imageStoragePath: customA });
    const registry = path.join(root, 'media', 'media-roots.json');
    const original = await fsPromises.readFile(registry, 'utf8');

    refuseRename = true;
    const customB = path.join(root, 'custom-b');
    await assert.rejects(store.patchSettings({ imageStoragePath: customB }), /无法记录历史图片目录/);
    assert.equal((await store.getPublicState()).settings.imageStoragePath, customA);
    assert.equal(await fsPromises.readFile(registry, 'utf8'), original);
    assert.ok(media.knownMediaRoots('image').includes(customA));
    assert.equal(media.knownMediaRoots('image').includes(customB), false);
    assert.deepEqual(await fsPromises.readdir(customB), []);
    assert.deepEqual((await fsPromises.readdir(path.dirname(registry))).filter((name) => name.endsWith('.tmp')), []);
  }, {
    'node:fs': {
      ...fs,
      renameSync: (...args) => {
        if (refuseRename) throw Object.assign(new Error('fixture registry denied'), { code: 'EACCES' });
        return fs.renameSync(...args);
      },
    },
  });
});

test('a full historical-root registry retains both directories involved in the current switch', async () => {
  await withStorageFixture(async ({ root, media, storage }) => {
    const oldRoots = Array.from({ length: 24 }, (_, index) => path.join(root, `old-${index}`));
    assert.equal(media.rememberMediaRoots('image', oldRoots), true);
    const next = path.join(root, 'next-images');
    await storage.prepareImageStoragePath(next, oldRoots[0]);
    assert.ok(media.knownMediaRoots('image').includes(oldRoots[0]));
    assert.ok(media.knownMediaRoots('image').includes(next));
    assert.equal(media.knownMediaRoots('image').length, 24);
    assert.ok(storage.getStorageRoots(next).includes(storage.getDefaultStoragePath()));
    assert.equal(storage.resolveStoredFile(next, '../outside.png'), null);
  });
});

test('existing root registries without lookup-only metadata remain readable and eligible for legacy merge', async () => {
  await withStorageFixture(async ({ root, load }) => {
    const oldRoot = path.join(root, 'historical-images');
    await fsPromises.mkdir(oldRoot);
    await fsPromises.writeFile(path.join(oldRoot, 'historic.png'), png);
    const registry = path.join(root, 'media', 'media-roots.json');
    await fsPromises.mkdir(path.dirname(registry), { recursive: true });
    await fsPromises.writeFile(registry, JSON.stringify({ version: 1, updatedAt: '', roots: { image: [oldRoot] } }));
    const media = load('./lib/media-paths');
    const storage = load('./lib/image-storage');
    assert.ok(media.knownMediaRoots('image').includes(oldRoot));
    assert.deepEqual(media.lookupOnlyMediaRoots('image'), []);
    const library = load('./lib/media-library');
    await library.runMediaLibraryMerge();
    assert.deepEqual(await fsPromises.readFile(path.join(storage.getDefaultStoragePath(), 'historic.png')), png);
    assert.deepEqual(await fsPromises.readFile(path.join(oldRoot, 'historic.png')), png);
  });
});

test('custom settings roots remain lookup-only during startup merge while default and legacy media still work', async () => {
  await withStorageFixture(async ({ root, load, media, storage, store }) => {
    const customA = path.join(root, 'custom-a');
    const customB = path.join(root, 'custom-b');
    await store.patchSettings({ imageStoragePath: customA });
    const imageA = await storage.persistImageBuffer(png, 'image/png', customA);
    await store.patchSettings({ imageStoragePath: customB });
    const imageB = await storage.persistImageBuffer(png, 'image/png', customB);

    const defaultRoot = storage.getDefaultStoragePath();
    await store.patchSettings({ imageStoragePath: defaultRoot });
    assert.equal(media.lookupOnlyMediaRoots('image').includes(defaultRoot), false);
    const original = await storage.persistImageBuffer(png, 'image/png', defaultRoot);
    const legacyRoot = path.join(root, 'data', 'images');
    await fsPromises.mkdir(legacyRoot, { recursive: true });
    await fsPromises.writeFile(path.join(legacyRoot, 'legacy.png'), png);

    const library = load('./lib/media-library');
    await library.runMediaLibraryMerge();
    assert.equal(fs.existsSync(path.join(defaultRoot, imageA.name)), false);
    assert.equal(fs.existsSync(path.join(defaultRoot, imageB.name)), false);
    assert.deepEqual(await fsPromises.readFile(path.join(customA, imageA.name)), png);
    assert.deepEqual(await fsPromises.readFile(path.join(customB, imageB.name)), png);
    assert.deepEqual(await fsPromises.readFile(path.join(defaultRoot, original.name)), png);
    assert.deepEqual(await fsPromises.readFile(path.join(defaultRoot, 'legacy.png')), png);
    assert.deepEqual(await fsPromises.readFile(path.join(legacyRoot, 'legacy.png')), png);

    const restarted = createTsRequire(process.cwd());
    const restartedStorage = restarted('./lib/image-storage');
    const restartedLibrary = restarted('./lib/media-library');
    await restartedLibrary.runMediaLibraryMerge();
    assert.equal(restartedStorage.resolveStoredFileWithFallback('', imageA.name), path.join(customA, imageA.name));
    assert.equal(fs.existsSync(path.join(defaultRoot, imageA.name)), false);
  });
});

test('opening storage resolves the saved server directory, waits for the opener, reports errors and preserves LAN authorization', async () => {
  const calls = [];
  let fail = false;
  await withStorageFixture(async ({ root, load, storage }) => {
    const target = path.join(root, 'open-images');
    const saved = path.relative(process.cwd(), target);
    const openFolder = load('./lib/mcp/open-folder');
    const auth = load('./lib/auth');
    const route = createTsRequire(process.cwd(), {
      '@/lib/store': { getPublicState: async () => ({ settings: { imageStoragePath: saved } }) },
      '@/lib/image-storage': storage,
      '@/lib/auth': auth,
      '@/lib/mcp/open-folder': openFolder,
    })('./app/api/storage/open/route');

    let response = await route.POST(new Request('http://127.0.0.1:3210/api/storage/open', { method: 'POST' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).path, target);
    assert.equal((await fsPromises.stat(target)).isDirectory(), true);
    assert.deepEqual(calls[0].args, [target]);
    assert.equal(calls[0].options.detached, true);
    assert.equal('windowsHide' in calls[0].options, false, 'the user requested a visible file-manager window');

    fail = true;
    response = await route.POST(new Request('http://127.0.0.1:3210/api/storage/open', { method: 'POST' }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /fixture opener missing/);
    fail = false;

    process.env.SANMAO_NETWORK_MODE = 'lan';
    process.env.SANMAO_ADMIN_PASSWORD = 'fixture-only-password';
    const remote = new Request('http://192.168.1.20:3210/api/storage/open', { method: 'POST' });
    const countBefore = calls.length;
    assert.equal((await route.POST(remote)).status, 401);
    assert.equal(calls.length, countBefore);
    const cookie = auth.adminCookie(remote).split(';', 1)[0];
    const authorized = new Request(remote.url, { method: 'POST', headers: { cookie } });
    assert.equal((await route.POST(authorized)).status, 200);
  }, {
    'node:child_process': {
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit(fail ? 'error' : 'spawn', ...(fail ? [new Error('fixture opener missing')] : [])));
        return child;
      },
    },
  });
});
