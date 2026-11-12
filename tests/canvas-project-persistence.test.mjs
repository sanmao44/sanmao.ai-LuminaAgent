import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { decompressSync, strFromU8 } from 'fflate';
import { createTsRequire } from './ts-require.mjs';

class MemoryStorage {
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class MemoryIndexedDB {
  constructor() {
    this.database = {
      version: 0,
      stores: new Map(),
      failWrite: null,
      failDelete: null,
      beforeNextReadWrite: null,
      lastTransaction: Promise.resolve(),
      objectStoreNames: { contains: (name) => this.database.stores.has(name) },
      createObjectStore: (name, options = {}) => {
        const store = { keyPath: options.keyPath, records: new Map(), createIndex() {} };
        this.database.stores.set(name, store);
        return store;
      },
      seed: (name, key, value) => {
        const store = this.database.stores.get(name);
        store.records.set(key, { key, value: clone(value) });
      },
      close() {},
      transaction: (name, mode) => this.createTransaction(name, mode),
    };
  }

  open(_name, version) {
    const request = { result: this.database, error: null };
    queueMicrotask(() => {
      if (version > this.database.version) {
        this.database.version = version;
        request.onupgradeneeded?.({ target: request });
      }
      request.onsuccess?.({ target: request });
    });
    return request;
  }

  createTransaction(name, mode) {
    const database = this.database;
    const backing = database.stores.get(name);
    if (!backing) throw new Error(`Missing object store ${name}`);
    const queue = [];
    const writes = [];
    let scheduled = false;
    let aborted = false;
    let finished = false;
    let schedulePump = () => {};
    let transactionReady = false;
    let pendingSchedule = false;
    let releaseTransaction;
    const previousTransaction = database.lastTransaction;
    database.lastTransaction = new Promise((resolve) => { releaseTransaction = resolve; });
    const transaction = {
      mode,
      error: null,
      abort: () => {
        aborted = true;
        schedulePump();
      },
      objectStore: () => ({
        get: (key) => enqueue({ type: 'get', key }),
        getAll: () => enqueue({ type: 'getAll' }),
        put: (value) => enqueue({ type: 'put', value }),
        delete: (key) => enqueue({ type: 'delete', key }),
        clear: () => enqueue({ type: 'clear' }),
        count: () => enqueue({ type: 'count' }),
      }),
    };
    const enqueue = (operation) => {
      const request = { result: undefined, error: null };
      queue.push({ ...operation, request });
      schedulePump();
      return request;
    };
    const abortWith = (error, request) => {
      request.error = error;
      transaction.error = error;
      request.onerror?.({ target: request });
      transaction.onerror?.({ target: transaction });
      aborted = true;
    };
    const finishAbort = () => {
      if (finished) return;
      finished = true;
      releaseTransaction();
      transaction.onabort?.({ target: transaction });
    };
    const process = () => {
      scheduled = false;
      if (finished) return;
      if (aborted) { finishAbort(); return; }
      if (mode === 'readwrite' && database.beforeNextReadWrite) {
        const before = database.beforeNextReadWrite;
        database.beforeNextReadWrite = null;
        before();
      }
      while (queue.length && !aborted) {
        const { type, key, value, request } = queue.shift();
        if (type === 'get') request.result = clone(backing.records.get(key));
        else if (type === 'getAll') request.result = [...backing.records.values()].map(clone);
        else if (type === 'count') request.result = backing.records.size;
        else if (type === 'put') {
          const recordKey = value[backing.keyPath];
          const injected = database.failWrite?.({ store: name, key: recordKey, value });
          if (injected) { abortWith(injected, request); break; }
          writes.push({ type, key: recordKey, value: clone(value) });
          request.result = recordKey;
        } else if (type === 'delete') {
          const injected = database.failDelete?.({ store: name, key });
          if (injected) { abortWith(injected, request); break; }
          writes.push({ type, key });
          request.result = undefined;
        } else if (type === 'clear') {
          writes.push({ type });
          request.result = undefined;
        }
        request.onsuccess?.({ target: request });
      }
      if (aborted) { finishAbort(); return; }
      if (queue.length) { schedulePump(); return; }
      if (mode === 'readwrite') {
        for (const write of writes) {
          if (write.type === 'clear') backing.records.clear();
          else if (write.type === 'delete') backing.records.delete(write.key);
          else backing.records.set(write.key, write.value);
        }
      }
      finished = true;
      releaseTransaction();
      transaction.oncomplete?.({ target: transaction });
    };
    schedulePump = () => {
      if (scheduled || finished) return;
      if (!transactionReady) {
        pendingSchedule = true;
        previousTransaction.then(() => {
          transactionReady = true;
          if (pendingSchedule) schedulePump();
        });
        return;
      }
      pendingSchedule = false;
      scheduled = true;
      queueMicrotask(process);
    };
    return transaction;
  }
}

async function fixture({ initialize = true } = {}) {
  globalThis.window = Object.assign(new EventTarget(), { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
  const indexedDB = new MemoryIndexedDB();
  globalThis.indexedDB = indexedDB;
  globalThis.BroadcastChannel = undefined;
  const load = createTsRequire(path.join(process.cwd(), 'lib'));
  const storage = load('./canvas/storage');
  const clientHistory = load('./client-history');
  const creative = load('./creative-projects');
  const model = load('./canvas/model');
  const { CanvasProjectSession } = load('./canvas/project-session');
  const { CanvasCore } = load('../packages/canvas-core/runtime');
  const empty = model.normalizeDocument(null);
  const project = (id) => ({ id, name: id, createdAt: 100, updatedAt: 100 });
  const imageDocument = (...ids) => model.normalizeDocument({ ...empty, nodes: ids.map((id) => ({ id, type: 'media', x: 0, y: 0, data: { kind: 'image', url: `/api/storage/file?name=${id}.png` } })) });
  if (initialize) {
    window.localStorage.setItem(storage.CANVAS_PROJECTS_KEY, JSON.stringify([project('a')]));
    window.localStorage.setItem(storage.CANVAS_ACTIVE_KEY, JSON.stringify('a'));
    window.localStorage.setItem(`${storage.CANVAS_PROJECT_PREFIX}a`, JSON.stringify(empty));
    await storage.ensureCanvasStorage();
  }
  return {
    storage, model, CanvasProjectSession, CanvasCore, empty, project, imageDocument,
    indexedDB: indexedDB.database, canvasEntries: () => clientHistory.listCanvasStorageEntries(), creative,
    reloadStorage: () => createTsRequire(path.join(process.cwd(), 'lib'))('./canvas/storage'),
  };
}

test('a stale project list cannot remove a newly created canvas or its image nodes', async () => {
  const { storage, project, imageDocument } = await fixture();
  const stale = storage.readCanvasProjects();
  assert.equal(await storage.createCanvasProject(project('b'), imageDocument('b-image')), true);
  assert.equal(await storage.saveCanvasProjects(stale, 'a'), true);
  assert.deepEqual(storage.readCanvasProjects().map((p) => p.id), ['b', 'a']);
  assert.equal(storage.loadCanvasDocument('b').nodes[0].id, 'b-image');
});

test('a winning IndexedDB index survives a concurrent first legacy migration', async () => {
  const { storage, project, imageDocument, indexedDB } = await fixture({ initialize: false });
  const staleProjects = [{ ...project('stale'), projectId: 'stale-project' }];
  const winnerProjects = [{ ...project('winner'), projectId: 'winner-project' }];
  const winnerDocument = imageDocument('winner-image');
  window.localStorage.setItem('nova.v1.projects', JSON.stringify(staleProjects));
  window.localStorage.setItem('nova.v1.project.stale', JSON.stringify(imageDocument('stale-image')));

  // Another tab commits after this initializer read the empty index but before
  // its import transaction reads the keys.
  indexedDB.beforeNextReadWrite = () => {
    indexedDB.seed('canvas-state', 'canvas:projects', winnerProjects);
    indexedDB.seed('canvas-state', 'canvas:active', 'winner');
    indexedDB.seed('canvas-state', 'canvas:document:winner', winnerDocument);
    indexedDB.seed('canvas-state', 'meta:creative-projects', []);
  };

  await storage.ensureCanvasStorage();
  assert.deepEqual(storage.readCanvasProjects().map((item) => item.id), ['winner']);
  assert.deepEqual(storage.loadCanvasDocument('winner'), winnerDocument);
  assert.equal(storage.loadCanvasDocument('stale').nodes.length, 0);
});

test('snapshot reads and storage-event refreshes never write back an established project index', async () => {
  const { storage, CanvasProjectSession, empty } = await fixture();
  const session = new CanvasProjectSession();
  session.open('a');
  const writes = [];
  const setItem = window.localStorage.setItem;
  window.localStorage.setItem = function (key, value) {
    writes.push(key);
    setItem.call(this, key, value);
  };
  storage.readCanvasWorkspace();
  await storage.ensureCanvasStorage();
  await session.refresh(empty);
  assert.deepEqual(writes, []);
});

test('startup selection survives reload after another tab changes the shared default', async () => {
  const { storage, project, empty } = await fixture();
  const firstTab = window.sessionStorage;
  firstTab.removeItem('sanmao.canvas.tab-active');
  assert.equal((await storage.ensureCanvasStorage()).activeId, 'a');
  window.sessionStorage = new MemoryStorage();
  await storage.createCanvasProject(project('b'), empty);
  assert.equal((await storage.ensureCanvasStorage()).activeId, 'b');
  window.sessionStorage = firstTab;
  assert.equal((await storage.ensureCanvasStorage()).activeId, 'a');
});

test('successful Nova migration reclaims only source copies covered by the retained backup', async () => {
  const { storage, model, imageDocument } = await fixture({ initialize: false });
  window.localStorage.setItem(storage.CANVAS_PROJECTS_KEY, JSON.stringify([{ id: 'a', name: 'a', createdAt: 100, updatedAt: 100 }]));
  window.localStorage.setItem(storage.CANVAS_ACTIVE_KEY, JSON.stringify('a'));
  const legacyProjects = [{ id: 'a', name: 'a', createdAt: 100, updatedAt: 100 }];
  const legacyDocument = imageDocument('legacy');
  const backup = {
    backedUpAt: '2026-11-10T00:00:00.000Z',
    source: 'nova.v1',
    projects: legacyProjects,
    activeId: 'a',
    documents: { a: legacyDocument },
  };
  window.localStorage.setItem('nova.v1.projects', JSON.stringify(legacyProjects));
  window.localStorage.setItem('nova.v1.active', JSON.stringify('a'));
  window.localStorage.setItem('nova.v1.project.a', JSON.stringify(legacyDocument));
  window.localStorage.setItem('sanmao.canvas.nova-backup', JSON.stringify(backup));
  window.localStorage.setItem('sanmao.canvas.nova-migrated', JSON.stringify({
    migratedAt: '2026-11-10T00:00:00.000Z',
    source: 'nova.v1',
    backupKey: 'sanmao.canvas.nova-backup',
  }));
  window.localStorage.setItem('sanmao-generate-tasks', 'preserve');
  window.localStorage.setItem('sanmao.canvas.project.a', JSON.stringify(imageDocument('current')));

  await storage.ensureCanvasStorage();

  assert.equal(window.localStorage.getItem('nova.v1.projects'), null);
  assert.equal(window.localStorage.getItem('nova.v1.active'), null);
  assert.equal(window.localStorage.getItem('nova.v1.project.a'), null);
  const retainedBackup = window.localStorage.getItem('sanmao.canvas.nova-backup');
  assert.ok(retainedBackup?.startsWith('sanmao:deflate:v1:'));
  const encodedBackup = retainedBackup.slice('sanmao:deflate:v1:'.length);
  const backupBytes = Uint8Array.from(Buffer.from(encodedBackup, 'base64'));
  assert.deepEqual(JSON.parse(strFromU8(decompressSync(backupBytes))), backup);
  assert.equal(window.localStorage.getItem('sanmao-generate-tasks'), 'preserve');
  assert.deepEqual(storage.loadCanvasDocument('a'), model.normalizeDocument(imageDocument('current')));
});

test('Nova source data changed after migration is retained for recovery', async () => {
  const { storage, imageDocument } = await fixture({ initialize: false });
  const legacyProjects = [{ id: 'a', name: 'a', createdAt: 100, updatedAt: 100 }];
  const backup = {
    backedUpAt: '2026-11-10T00:00:00.000Z',
    source: 'nova.v1',
    projects: legacyProjects,
    activeId: 'a',
    documents: { a: imageDocument('legacy') },
  };
  window.localStorage.setItem('nova.v1.projects', JSON.stringify(legacyProjects));
  window.localStorage.setItem('nova.v1.active', JSON.stringify('a'));
  window.localStorage.setItem('nova.v1.project.a', JSON.stringify(imageDocument('later-edit')));
  window.localStorage.setItem('sanmao.canvas.nova-backup', JSON.stringify(backup));
  window.localStorage.setItem('sanmao.canvas.nova-migrated', JSON.stringify({
    migratedAt: '2026-11-10T00:00:00.000Z',
    source: 'nova.v1',
    backupKey: 'sanmao.canvas.nova-backup',
  }));

  await storage.ensureCanvasStorage();

  assert.notEqual(window.localStorage.getItem('nova.v1.project.a'), null);
  assert.notEqual(window.localStorage.getItem('sanmao.canvas.nova-backup'), null);
});

test('autosave touches only the latest project row, preserving concurrent rename and creation', async () => {
  const { storage, project, imageDocument, empty } = await fixture();
  await storage.createCanvasProject(project('b'), empty);
  await storage.renameCanvasProject('a', '新名称');
  assert.equal(await storage.saveCanvasDocument('a', imageDocument('generated'), empty), true);
  assert.equal(storage.readCanvasProjects().find((p) => p.id === 'a').name, '新名称');
  assert.equal(storage.readCanvasProjects().length, 2);
});

test('an old editor cannot erase images saved by another editor of the same canvas', async () => {
  const { storage, CanvasProjectSession, empty, imageDocument } = await fixture();
  const old = new CanvasProjectSession();
  const fresh = new CanvasProjectSession();
  old.open('a'); fresh.open('a');
  assert.equal(await fresh.save(imageDocument('one', 'two', 'three')), true);
  assert.equal(await old.save(empty), false);
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((n) => n.id), ['one', 'two', 'three']);
  assert.match(storage.describeCanvasSaveFailure(), /其他页面/);
});

test('background refresh retains this editor selection and unchanged undo history', async () => {
  const { storage, CanvasProjectSession, CanvasCore, empty, imageDocument, project } = await fixture();
  const session = new CanvasProjectSession();
  const core = new CanvasCore(session.open('a'));
  core.apply({ id: 'generate', label: 'generate', apply: () => imageDocument('one') });
  assert.equal(await session.save(core.document()), true);
  const history = core.history();
  await storage.createCanvasProject(project('b'), empty);
  const refreshed = await session.refresh(core.document());
  assert.equal(refreshed.activeId, 'a');
  assert.equal(refreshed.document, undefined);
  assert.deepEqual(core.history(), history);
  assert.equal(core.history().past.length, 1);
  assert.equal((await storage.ensureCanvasStorage()).activeId, 'b');
});

test('refresh preserves generated unsaved nodes and rejects a conflicting subsequent save', async () => {
  const { storage, CanvasProjectSession, imageDocument, empty } = await fixture();
  const session = new CanvasProjectSession();
  session.open('a');
  const generated = imageDocument('one', 'two', 'three');
  assert.equal(await storage.saveCanvasDocument('a', imageDocument('remote'), empty), true);
  const refreshed = await session.refresh(generated);
  assert.equal(refreshed.activeId, 'a');
  assert.equal(refreshed.document, undefined);
  assert.equal(session.hasUnsavedChanges(generated), true);
  assert.equal(await session.save(generated), false);
  assert.equal(generated.nodes.length, 3);
  assert.equal(storage.loadCanvasDocument('a').nodes[0].id, 'remote');
});

test('interactive save rebases a same-project conflict and retains both tab edits', async () => {
  const { storage, CanvasProjectSession, imageDocument, empty } = await fixture();
  const session = new CanvasProjectSession();
  session.open('a');
  const current = imageDocument('local');
  assert.equal(await storage.saveCanvasDocument('a', imageDocument('remote'), empty), true);
  const result = await session.saveRecoveringConflict(current);
  assert.equal(result.saved, true);
  assert.equal(result.rebased, true);
  assert.deepEqual(result.document.nodes.map((node) => node.id), ['remote', 'local']);
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((node) => node.id), ['remote', 'local']);
  assert.equal(await session.save(result.document), true);
});

test('interactive save keeps a local image deletion while retaining a concurrent image', async () => {
  const { storage, CanvasProjectSession, imageDocument, empty } = await fixture();
  const baseline = imageDocument('deleted', 'kept');
  assert.equal(await storage.saveCanvasDocument('a', baseline, empty), true);
  const session = new CanvasProjectSession();
  session.open('a');
  const current = imageDocument('kept', 'local');
  const remote = imageDocument('deleted', 'kept', 'remote');
  assert.equal(await storage.saveCanvasDocument('a', remote, baseline), true);

  const result = await session.saveRecoveringConflict(current);
  assert.equal(result.saved, true);
  assert.deepEqual(result.document.nodes.map((node) => node.id), ['kept', 'remote', 'local']);
  assert.equal(result.document.nodes.some((node) => node.id === 'deleted'), false);
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((node) => node.id), ['kept', 'remote', 'local']);
});

test('interactive save retries after a transient metadata write failure', async () => {
  const { storage, CanvasProjectSession, imageDocument } = await fixture();
  const session = new CanvasProjectSession();
  session.open('a');
  const current = imageDocument('local');
  let failed = false;
  globalThis.indexedDB.database.failWrite = ({ key }) => {
    if (!failed && key === 'meta:creative-projects') {
      failed = true;
      return new Error('transient metadata failure');
    }
    return null;
  };
  const result = await session.saveRecoveringConflict(current);
  assert.equal(result.saved, true);
  assert.equal(result.rebased, true);
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((node) => node.id), ['local']);
});

test('deleted rename targets and delayed autosave never affect another project or resurrect documents', async () => {
  const { storage, CanvasProjectSession, empty, project, canvasEntries } = await fixture();
  await storage.createCanvasProject(project('b'), empty);
  const session = new CanvasProjectSession();
  session.open('a');
  assert.equal(await storage.deleteCanvasProject('a'), true);
  assert.equal(await storage.renameCanvasProject('a', '误改'), false);
  assert.equal(await session.save(empty), false);
  assert.equal(storage.readCanvasProjects()[0].name, 'b');
  assert.equal((await canvasEntries()).some((entry) => entry.key === 'canvas:document:a'), false);
  assert.equal((await session.refresh(empty)).activeId, 'b');
});

test('explicit backup restore keeps replacement semantics', async () => {
  const { storage, project, imageDocument, empty, canvasEntries } = await fixture();
  await storage.createCanvasProject(project('b'), imageDocument('new-image'));
  assert.equal(await storage.restoreCanvasWorkspace({ projects: [project('a')], documents: { a: empty }, activeId: 'a' }), true);
  assert.deepEqual(storage.readCanvasProjects().map((p) => p.id), ['a']);
  assert.equal((await canvasEntries()).some((entry) => entry.key === 'canvas:document:b'), false);
});

test('quota failure while creating a canvas does not publish an empty replacement', async () => {
  const { storage, project, imageDocument, indexedDB } = await fixture();
  indexedDB.failWrite = ({ key }) => key === 'canvas:document:b'
    ? Object.assign(new Error('full'), { name: 'QuotaExceededError' }) : null;
  assert.equal(await storage.createCanvasProject(project('b'), imageDocument('new-image')), false);
  assert.deepEqual(storage.readCanvasProjects().map((p) => p.id), ['a']);
  assert.match(storage.describeCanvasSaveFailure(), /空间不足|本地存储已满/);
});

test('canvas autosave prunes old automatic checkpoints on quota failure and retries without losing current work', async () => {
  const { storage, model, empty, imageDocument, indexedDB, creative, reloadStorage } = await fixture();
  const projectId = storage.readCanvasProjects()[0].projectId;
  let versions = creative.appendCreativeProjectVersion(storage.readCanvasWorkspace().creativeProjects, projectId, {
    id: 'manual-1', canvasId: 'a', label: '手动版本', createdAt: 10, snapshot: model.snapshot(empty),
  });
  for (let index = 1; index <= 3; index += 1) {
    versions = creative.appendAutomaticCreativeProjectVersion(versions, projectId, {
      canvasId: 'a', label: `自动 ${index}`, createdAt: 20 + index, snapshot: model.snapshot(imageDocument(`auto-${index}`)),
    }, [`task-${index}`]);
  }
  assert.equal(await creative.saveCreativeProjects(versions), true);

  let documentQuotaFailureInjected = false;
  indexedDB.failWrite = ({ key }) => {
    if (key === 'canvas:document:a' && !documentQuotaFailureInjected) {
      documentQuotaFailureInjected = true;
      return Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    }
    return null;
  };

  assert.equal(await storage.saveCanvasDocument('a', imageDocument('saved-after-recovery'), empty), true, storage.describeCanvasSaveFailure());
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((node) => node.id), ['saved-after-recovery']);
  const savedVersions = storage.readCanvasWorkspace().creativeProjects[0].versions;
  assert.equal(savedVersions.some((version) => version.id === 'manual-1'), true);
  assert.equal(savedVersions.some((version) => version.id === 'auto_task-1'), false);
  assert.equal(savedVersions.some((version) => version.id === 'auto_task-3'), true);
  assert.equal(storage.takeCanvasStorageAutomaticCheckpointCleanupCount(), 1);

  const reloaded = reloadStorage();
  await reloaded.ensureCanvasStorage();
  assert.deepEqual(reloaded.loadCanvasDocument('a').nodes.map((node) => node.id), ['saved-after-recovery']);
  const reloadedVersions = reloaded.readCanvasWorkspace().creativeProjects[0].versions;
  assert.equal(reloadedVersions.some((version) => version.id === 'manual-1'), true);
  assert.equal(reloadedVersions.some((version) => version.id === 'auto_task-1'), false);
  assert.equal(reloadedVersions.some((version) => version.id === 'auto_task-3'), true);
});

test('canvas autosave restores automatic checkpoints when quota recovery cannot save the document', async () => {
  const { storage, model, empty, imageDocument, indexedDB, creative, reloadStorage } = await fixture();
  const projectId = storage.readCanvasProjects()[0].projectId;
  let versions = creative.appendCreativeProjectVersion(storage.readCanvasWorkspace().creativeProjects, projectId, {
    id: 'manual-1', canvasId: 'a', label: '手动版本', createdAt: 10, snapshot: model.snapshot(empty),
  });
  for (let index = 1; index <= 3; index += 1) {
    versions = creative.appendAutomaticCreativeProjectVersion(versions, projectId, {
      canvasId: 'a', label: `自动 ${index}`, createdAt: 20 + index, snapshot: model.snapshot(imageDocument(`auto-${index}`)),
    }, [`task-${index}`]);
  }
  assert.equal(await creative.saveCreativeProjects(versions), true);

  indexedDB.failWrite = ({ key }) => key === 'canvas:document:a'
    ? Object.assign(new Error('document too large'), { name: 'QuotaExceededError' }) : null;

  assert.equal(await storage.saveCanvasDocument('a', imageDocument('unsaved'), empty), false);
  assert.deepEqual(storage.loadCanvasDocument('a'), empty);
  const savedVersions = storage.readCanvasWorkspace().creativeProjects[0].versions;
  assert.equal(savedVersions.filter((version) => version.id.startsWith('auto_')).length, 3);
  assert.equal(savedVersions.some((version) => version.id === 'manual-1'), true);
  assert.equal(storage.takeCanvasStorageAutomaticCheckpointCleanupCount(), 0);

  indexedDB.failWrite = null;
  const reloaded = reloadStorage();
  await reloaded.ensureCanvasStorage();
  assert.deepEqual(reloaded.loadCanvasDocument('a'), empty);
  const reloadedVersions = reloaded.readCanvasWorkspace().creativeProjects[0].versions;
  assert.equal(reloadedVersions.filter((version) => version.id.startsWith('auto_')).length, 3);
  assert.equal(reloadedVersions.some((version) => version.id === 'manual-1'), true);
});

test('canvas persistence refuses inline images and preserves the last saved document', async () => {
  const { storage, model, empty, imageDocument } = await fixture();
  const previous = imageDocument('already-saved');
  assert.equal(await storage.saveCanvasDocument('a', previous, empty), true);
  const withInlineImage = model.normalizeDocument({
    ...previous,
    nodes: [...previous.nodes, {
      id: 'inline-image', type: 'media', x: 20, y: 20,
      data: { kind: 'image', url: 'data:image/png;base64,AA==' },
    }],
  });

  assert.equal(await storage.saveCanvasDocument('a', withInlineImage, previous), false);
  assert.deepEqual(storage.loadCanvasDocument('a'), previous);
  assert.match(storage.describeCanvasSaveFailure(), /内嵌图片未能归档/);
});

test('failed snapshot replacement preserves original canvas documents and removes partial writes', async () => {
  const { storage, project, imageDocument, empty, indexedDB, canvasEntries } = await fixture();
  await storage.saveCanvasDocument('a', imageDocument('existing-image'), empty);
  const before = storage.readCanvasWorkspace();
  indexedDB.failWrite = ({ key }) => key === 'canvas:document:c'
    ? Object.assign(new Error('full'), { name: 'QuotaExceededError' }) : null;
  assert.equal(await storage.restoreCanvasWorkspace({ projects: [project('b'), project('c')], documents: { b: imageDocument('remote-image'), c: empty }, activeId: 'b' }), false);
  assert.deepEqual(storage.readCanvasWorkspace(), before);
  assert.equal((await canvasEntries()).some((entry) => entry.key === 'canvas:document:b'), false);
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((node) => node.id), ['existing-image']);
});

test('a partial overwrite of an existing document rolls back if a later restore write fails', async () => {
  const { storage, project, imageDocument, empty, indexedDB } = await fixture();
  await storage.saveCanvasDocument('a', imageDocument('existing-image'), empty);
  const before = storage.readCanvasWorkspace();
  indexedDB.failWrite = ({ key, value }) => key === 'canvas:ui' && value.value.replacement
    ? new Error('write failed') : null;
  assert.equal(await storage.restoreCanvasWorkspace({ projects: [project('a')], documents: { a: empty }, activeId: 'a', ui: { replacement: true } }), false);
  assert.deepEqual(storage.readCanvasWorkspace(), before);
});

test('the very first canvas retains its tab selection when another tab creates a canvas', async () => {
  const { storage, project, empty } = await fixture();
  window.localStorage = new MemoryStorage();
  window.sessionStorage = new MemoryStorage();
  const firstTab = window.sessionStorage;
  const initial = await storage.ensureCanvasStorage();
  window.sessionStorage = new MemoryStorage();
  await storage.createCanvasProject(project('b'), empty);
  window.sessionStorage = firstTab;
  assert.equal((await storage.ensureCanvasStorage()).activeId, initial.activeId);
});

for (const operation of ['create', 'rename', 'delete', 'save']) {
  test(`${operation} rolls back the document and index if creative metadata cannot be written`, async () => {
    const { storage, project, imageDocument, empty, indexedDB, canvasEntries } = await fixture();
    await storage.createCanvasProject(project('b'), imageDocument('existing'));
    const before = storage.readCanvasWorkspace();
    indexedDB.failWrite = ({ key }) => key === 'meta:creative-projects'
      ? Object.assign(new Error('full'), { name: 'QuotaExceededError' }) : null;
    const result = operation === 'create' ? await storage.createCanvasProject(project('c'), imageDocument('new'))
      : operation === 'rename' ? storage.renameCanvasProject('a', 'renamed')
        : operation === 'delete' ? storage.deleteCanvasProject('b')
          : storage.saveCanvasDocument('a', imageDocument('new'), empty);
    assert.equal(await result, false);
    assert.deepEqual(storage.readCanvasWorkspace(), before);
    assert.equal((await canvasEntries()).some((entry) => entry.key === 'canvas:document:c'), false);
  assert.match(storage.describeCanvasSaveFailure(), /空间不足|本地存储已满/);
  });
}

test('failed document deletion does not remove the canvas from the index', async () => {
  const { storage, project, imageDocument, indexedDB } = await fixture();
  await storage.createCanvasProject(project('b'), imageDocument('existing'));
  const before = storage.readCanvasWorkspace();
  indexedDB.failDelete = ({ key }) => key === 'canvas:document:b' ? new Error('remove failed') : null;
  assert.equal(await storage.deleteCanvasProject('b'), false);
  assert.deepEqual(storage.readCanvasWorkspace(), before);
});

function capturedTask(h) {
  const session = new h.CanvasProjectSession();
  const core = new h.CanvasCore(session.open('a'));
  const scope = session.capture({
    mounted: () => true,
    document: () => core.document(),
    update: (updater) => core.replace(updater(core.document())),
    commit: (updater) => core.apply({ id: 'test', label: 'test', apply: updater }),
    onFailure: () => assert.fail('unexpected persistence failure'),
  });
  const open = (id) => core.replace(session.open(id), { clearHistory: true });
  return { scope, session, core, open };
}

test('late generated images go to their original canvas after switching, preserving concurrent edits', async () => {
  const h = await fixture();
  const { scope, session, core, open } = capturedTask(h);
  const result = Promise.resolve(h.imageDocument('one', 'two', 'three'));
  await h.storage.createCanvasProject(h.project('b'), h.imageDocument('other-canvas'));
  open('b');
  await h.storage.saveCanvasDocument('a', h.imageDocument('other-tab'), h.empty);
  const images = await result;
  const update = scope.updateDoc((doc) => ({ ...doc, nodes: [...doc.nodes, ...images.nodes] }));
  const persistence = session.waitForPersistence(scope.projectId);
  assert.equal(await update, true);
  assert.equal(await persistence, true);
  assert.deepEqual(core.document().nodes.map((n) => n.id), ['other-canvas']);
  assert.deepEqual(h.storage.loadCanvasDocument('a').nodes.map((n) => n.id), ['other-tab', 'one', 'two', 'three']);
  assert.equal((await h.storage.ensureCanvasStorage()).activeId, 'b');
  open('a');
  assert.equal(core.document().nodes.length, 4);
  const reloaded = h.reloadStorage();
  await reloaded.ensureCanvasStorage();
  assert.deepEqual(reloaded.loadCanvasDocument('a').nodes.map((node) => node.id), ['other-tab', 'one', 'two', 'three']);
});

test('task callbacks use the active Core after switching back, retaining unsaved edits and undo', async () => {
  const h = await fixture();
  const { scope, session, core, open } = capturedTask(h);
  await h.storage.createCanvasProject(h.project('b'), h.empty);
  open('b'); open('a');
  await scope.commit(() => h.imageDocument('edited'));
  await scope.updateDoc((doc) => ({ ...doc, nodes: [...doc.nodes, ...h.imageDocument('generated').nodes] }));
  assert.equal(await session.waitForPersistence(scope.projectId), true);
  assert.equal(core.history().past.length, 1);
  assert.equal(await session.save(core.document()), true);
  assert.deepEqual(h.storage.loadCanvasDocument('a').nodes.map((n) => n.id), ['edited', 'generated']);
});

test('captured task reads the latest Core draft before autosave or selection projection', async () => {
  const h = await fixture();
  const { scope, core } = capturedTask(h);
  core.apply({ id: 'draft', label: 'draft', apply: () => h.imageDocument('requested-node') });
  assert.equal(scope.readDocument(), core.document());
  assert.equal(scope.readDocument().nodes[0].id, 'requested-node');
  assert.equal(h.storage.loadCanvasDocument('a').nodes.length, 0);
});

test('late tasks never recreate deleted canvases or touch a same-ID node in a different canvas', async () => {
  const h = await fixture();
  await h.storage.saveCanvasDocument('a', h.imageDocument('same-node'), h.empty);
  const { scope, core, open } = capturedTask(h);
  await h.storage.createCanvasProject(h.project('b'), h.imageDocument('same-node'));
  open('b');
  await h.storage.deleteCanvasProject('a');
  assert.equal(await scope.updateDoc(() => h.imageDocument('late-result')), false);
  assert.equal(core.document().nodes[0].id, 'same-node');
  assert.equal((await h.canvasEntries()).some((entry) => entry.key === 'canvas:document:a'), false);
});

test('failed legacy migration retains its original images and retries without publishing partial canvases', async () => {
  globalThis.window = Object.assign(new EventTarget(), { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
  globalThis.indexedDB = new MemoryIndexedDB();
  globalThis.BroadcastChannel = undefined;
  const load = createTsRequire(path.join(process.cwd(), 'lib'));
  const storage = load('./canvas/storage');
  const clientHistory = load('./client-history');
  const model = load('./canvas/model');
  const original = model.normalizeDocument({ nodes: [model.createMedia('image', '/legacy.png', '原图', { x: 1, y: 2 })] });
  window.localStorage.setItem('nova.v1.projects', JSON.stringify([{ id: 'legacy', name: '旧画布', createdAt: 1, updatedAt: 1 }]));
  window.localStorage.setItem('nova.v1.project.legacy', JSON.stringify(original));
  const before = { ...window.localStorage };
  globalThis.indexedDB.database.failWrite = ({ key }) => key === 'canvas:projects' ? new Error('write failed') : null;
  await assert.rejects(storage.ensureCanvasStorage(), /write failed/);
  assert.equal(window.localStorage.getItem('nova.v1.projects'), before['nova.v1.projects']);
  assert.equal(window.localStorage.getItem('nova.v1.project.legacy'), before['nova.v1.project.legacy']);
  assert.notEqual(window.localStorage.getItem('sanmao.canvas.nova-backup'), null);
  globalThis.indexedDB.database.failWrite = null;
  assert.equal((await storage.ensureCanvasStorage()).migrated, true);
  assert.equal(storage.loadCanvasDocument('legacy').nodes[0].data.url, '/legacy.png');
});

test('Nova migration completes from IndexedDB when the localStorage backup projection is full', async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = Object.assign(new EventTarget(), { localStorage, sessionStorage: new MemoryStorage() });
  globalThis.indexedDB = new MemoryIndexedDB();
  globalThis.BroadcastChannel = undefined;
  const load = createTsRequire(path.join(process.cwd(), 'lib'));
  const storage = load('./canvas/storage');
  const clientHistory = load('./client-history');
  const model = load('./canvas/model');
  /*
  const original = model.normalizeDocument({ nodes: [model.createMedia('image', '/legacy.png', '鍘熷浘', { x: 1, y: 2 })] });
  */
  const original = model.normalizeDocument({ nodes: [model.createMedia('image', '/legacy.png', 'original', { x: 1, y: 2 })] });
  localStorage.setItem('nova.v1.projects', JSON.stringify([{ id: 'legacy', name: 'legacy-canvas', createdAt: 1, updatedAt: 1 }]));
  localStorage.setItem('nova.v1.active', JSON.stringify('legacy'));
  localStorage.setItem('nova.v1.project.legacy', JSON.stringify(original));
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (key.startsWith('sanmao.canvas.')) {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    originalSetItem(key, value);
  };

  const result = await storage.ensureCanvasStorage();

  assert.equal(result.migrated, true);
  assert.equal(storage.loadCanvasDocument('legacy').nodes[0].data.url, '/legacy.png');
  assert.equal(localStorage.getItem('nova.v1.projects'), null);
  assert.equal(localStorage.getItem('nova.v1.project.legacy'), null);
  assert.equal((await clientHistory.listCanvasStorageEntries()).some((entry) => entry.key === 'canvas:nova-backup'), true);
});
