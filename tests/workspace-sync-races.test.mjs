import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTsRequire } from './ts-require.mjs';

const lib = fileURLToPath(new URL('../lib/', import.meta.url));
const metaKey = 'sanmao.workspace.sync.meta.v1';
const copy = (value) => structuredClone(value);
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => copy(data) });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 30 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), 'the requested asynchronous sync step completed');
}

function snapshot(id = 'old', updatedAt = 100) {
  return {
    schemaVersion: 1, updatedAt, clientId: 'remote-browser',
    canvas: {
      projects: [{ id, name: id, createdAt: 1, updatedAt }], activeId: id,
      documents: { [id]: { version: 2, nodes: [], edges: [], groups: [], camera: { x: 0, y: 0, zoom: 1 } } }, ui: {},
    },
    gallery: [], chatSessions: [], assetIndex: [], assetCollections: [], preferences: {},
  };
}

class MemoryStorage {
  constructor(stored = new Map()) { Object.defineProperty(this, 'stored', { value: stored }); }
  getItem(key) { return this.stored.get(key) ?? null; }
  setItem(key, value) { this.stored.set(key, String(value)); this[key] = String(value); }
  removeItem(key) { this.stored.delete(key); delete this[key]; }
}

function harness(t, { remote = snapshot(), revision = 1, realCanvas = false } = {}) {
  const stored = new Map();
  const timers = new Map();
  const intervals = new Map();
  const requests = [];
  const statuses = [];
  let timerId = 0;
  let stop;
  let restoreCount = 0;
  let restoredCallbacks = 0;
  let remoteWorkspace = copy(remote);
  let remoteRevision = revision;
  let localCanvas = copy(snapshot().canvas);
  let localGallery = [];
  let galleryRestore;
  let galleryRead;
  let fetchHook;
  let canvasStorage;
  const window = Object.assign(new EventTarget(), {
    localStorage: new MemoryStorage(stored),
    sessionStorage: new MemoryStorage(),
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval: (id) => intervals.delete(id),
  });
  t.mock.method(Date, 'now', () => 1000);
  const previousGlobals = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = window;
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  t.after(() => {
    stop?.();
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const load = createTsRequire(path.resolve(lib), {
    './client-history': {
      DEFAULT_ASSET_COLLECTIONS: [], listChatSessions: async () => [],
      replaceChatSessions: async () => events.emitWorkspaceChange(),
    },
    './canvas/storage': {
      readCanvasWorkspace: () => realCanvas ? canvasStorage.readCanvasWorkspace() : copy(localCanvas),
      restoreCanvasWorkspace: (canvas) => {
        restoreCount += 1;
        if (realCanvas) return canvasStorage.restoreCanvasWorkspace(canvas);
        localCanvas = copy(canvas);
        events.emitWorkspaceChange();
        return true;
      },
    },
    './workspace-context': { readWorkspaceContext: () => ({ creativeProjectId: 'project' }) },
    './repositories/asset-repository': {
      assetRepository: {
        listGallery: async () => { if (galleryRead) await galleryRead(); return copy(localGallery); },
        listIndex: async () => [], listCollections: async () => [],
        replaceGallery: async (items, canWrite) => {
          if (galleryRestore) await galleryRestore();
          if (canWrite && !canWrite()) return;
          localGallery = copy(items);
          events.emitWorkspaceChange();
        },
        replaceIndex: async () => events.emitWorkspaceChange(),
        saveCollections: async () => events.emitWorkspaceChange(),
      },
    },
  });
  const events = load('./workspace-events');
  if (realCanvas) canvasStorage = load(path.join(lib, 'canvas/storage'));
  const format = load('./workspace-format');
  const workspace = load('./workspace');
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method || 'GET', payload: init.body ? JSON.parse(init.body) : null, keepalive: init.keepalive };
    requests.push(request);
    if (fetchHook) {
      const custom = await fetchHook(request);
      if (custom) return custom;
    }
    if (request.url.includes('?meta=1')) return response({ updatedAt: remoteWorkspace?.updatedAt || 0, revision: remoteRevision });
    if (request.method === 'PUT') {
      if (request.payload.expectedRevision !== remoteRevision) return response({ code: 'WORKSPACE_CONFLICT' }, 409);
      remoteWorkspace = copy(request.payload.workspace);
      remoteRevision += 1;
      return response({ updatedAt: remoteWorkspace.updatedAt, revision: remoteRevision, contentHash: `hash-${remoteRevision}` });
    }
    return response({ workspace: remoteWorkspace, updatedAt: remoteWorkspace?.updatedAt || 0, revision: remoteRevision, contentHash: `hash-${remoteRevision}` });
  };
  return {
    workspace, events, requests, statuses, timers, load, canvasStorage,
    get canvas() { return realCanvas ? canvasStorage.readCanvasWorkspace() : localCanvas; },
    get remote() { return remoteWorkspace; },
    get restoreCount() { return restoreCount; },
    get restoredCallbacks() { return restoredCallbacks; },
    get meta() { return JSON.parse(stored.get(metaKey) || 'null'); },
    seedBaseline(value = remoteWorkspace, baselineRevision = remoteRevision, pending = false) {
      localCanvas = copy(value.canvas);
      if (realCanvas) assert.equal(canvasStorage.restoreCanvasWorkspace(value.canvas), true);
      localGallery = copy(value.gallery);
      const baseline = realCanvas ? { ...value, canvas: canvasStorage.readCanvasWorkspace() } : value;
      stored.set(metaKey, JSON.stringify({ clientId: 'local', localUpdatedAt: value.updatedAt, serverUpdatedAt: value.updatedAt, revision: baselineRevision, pending, contentSignature: format.workspaceContentSignature(baseline) }));
    },
    writeMeta(value) { stored.set(metaKey, JSON.stringify(value)); },
    mutateCanvas(signal = true) {
      const project = { id: 'new', name: 'new', createdAt: 1000, updatedAt: 1000 };
      localCanvas.projects.push(project);
      localCanvas.documents.new = { ...copy(snapshot().canvas.documents.old), nodes: [{ id: 'generated-image', type: 'image', url: '/stored/image.png' }] };
      localCanvas.activeId = 'new';
      if (signal) events.emitWorkspaceMutation();
    },
    preferenceWithoutEvent() { stored.set('sanmao-theme', 'dark'); },
    setRemote(value, nextRevision) { remoteWorkspace = copy(value); remoteRevision = nextRevision; },
    setFetchHook(value) { fetchHook = value; },
    setGalleryRestore(value) { galleryRestore = value; },
    setGalleryRead(value) { galleryRead = value; },
    get gallery() { return copy(localGallery); },
    mutateGallery(item) { localGallery.push(item); events.emitWorkspaceMutation(); },
    start() { stop = workspace.startWorkspaceSync({ onStatus: (status) => statuses.push(status), onRestored: () => { restoredCallbacks += 1; } }); },
    stop() { stop?.(); },
    runDebounce() {
      const ready = [...timers.entries()].filter(([, timer]) => timer.delay === 700);
      for (const [id, timer] of ready) { timers.delete(id); timer.callback(); }
    },
    poll() { for (const timer of intervals.values()) timer.callback(); },
  };
}

test('bootstrap rejects a deferred stale GET after creating a canvas and generated image', async (t) => {
  const h = harness(t);
  const get = deferred();
  h.setFetchHook((request) => request.url === '/api/workspace' && request.method === 'GET' ? get.promise : undefined);
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => h.requests.some((request) => request.url === '/api/workspace'));
  h.mutateCanvas();
  get.resolve(response({ workspace: snapshot(), updatedAt: 100, revision: 1 }));
  assert.deepEqual(await boot, { offline: false });
  assert.equal(h.restoreCount, 0);
  assert.equal(h.canvas.activeId, 'new');
  assert.equal(h.canvas.documents.new.nodes[0].id, 'generated-image');
  assert.equal(h.meta.pending, true);
  assert.equal(h.meta.revision, 0);
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
});

test('reconcile rejects a deferred GET after a same-timestamp local mutation', async (t) => {
  const h = harness(t);
  h.seedBaseline(snapshot(), 1);
  h.setRemote(snapshot('remote-new', 200), 2);
  const get = deferred();
  h.setFetchHook((request) => request.url === '/api/workspace' && request.method === 'GET' ? get.promise : undefined);
  h.start();
  await waitFor(() => h.requests.some((request) => request.url === '/api/workspace'));
  h.mutateCanvas();
  get.resolve(response({ workspace: snapshot('remote-new', 200), revision: 2 }));
  await waitFor(() => h.statuses.at(-1) === 'idle');
  assert.equal(h.restoreCount, 0);
  assert.equal(h.restoredCallbacks, 0);
  assert.equal(h.canvas.documents.new.nodes.length, 1);
  assert.equal(h.meta.pending, true);
  assert.equal(h.meta.revision, 1);
});

test('preexisting unsaved Core drafts block GET, restore and PUT before sync mounts', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  const editor = h.events.registerWorkspaceDraft();
  editor.markDirty(); // Core has changed; persisted canvas is intentionally still old.
  await h.workspace.bootstrapWorkspace();
  h.start();
  await waitFor(() => h.statuses.at(-1) === 'idle');
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(h.requests.length, 0);
  assert.equal(h.restoreCount, 0);
  assert.equal(h.meta.pending, true);
  h.mutateCanvas();
  editor.markSaved();
  h.runDebounce();
  await waitFor(() => h.meta.pending === false);
  assert.equal(h.remote.canvas.documents.new.nodes[0].id, 'generated-image');
});

test('draft ownership cannot be cleared by a different editor or a disposed token', (t) => {
  const h = harness(t);
  const first = h.events.registerWorkspaceDraft();
  const second = h.events.registerWorkspaceDraft();
  first.markDirty();
  const generation = h.events.getWorkspaceMutationGeneration();
  first.markDirty();
  assert.ok(h.events.getWorkspaceMutationGeneration() > generation);
  second.markDirty();
  first.markSaved();
  first.dispose();
  assert.equal(h.events.hasWorkspaceDraftPending(), true);
  second.markSaved();
  assert.equal(h.events.hasWorkspaceDraftPending(), false);
  first.markDirty();
  assert.equal(h.events.hasWorkspaceDraftPending(), false);
});

test('edits before startup are tracked and uploaded only against the known revision', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.mutateCanvas();
  h.start();
  await waitFor(() => h.statuses.at(-1) === 'synced');
  assert.equal(h.requests.find((request) => request.method === 'PUT').payload.expectedRevision, 1);
  assert.equal(h.restoreCount, 0);
  assert.equal(h.remote.canvas.activeId, 'new');
});

test('PUT acknowledgement keeps same-timestamp edits pending and reschedules a consumed debounce', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.start();
  await waitFor(() => h.statuses.at(-1) === 'synced');
  const put = deferred();
  let firstPut;
  h.setFetchHook((request) => {
    if (request.method === 'PUT' && !firstPut) { firstPut = request; return put.promise; }
  });
  h.mutateCanvas();
  h.runDebounce();
  await waitFor(() => Boolean(firstPut));
  const sentTimestamp = firstPut.payload.workspace.updatedAt;
  h.canvas.documents.new.nodes.push({ id: 'second-generated-image', type: 'image', url: '/stored/second.png' });
  h.events.emitWorkspaceMutation();
  assert.equal(h.meta.localUpdatedAt, sentTimestamp);
  h.runDebounce(); // Timer fires while PUT is still awaiting its response.
  h.setRemote(firstPut.payload.workspace, 2);
  put.resolve(response({ updatedAt: sentTimestamp, revision: 2 }));
  await waitFor(() => h.meta.revision === 2);
  assert.equal(h.meta.pending, true);
  assert.equal(h.statuses.at(-1), 'idle');
  assert.ok([...h.timers.values()].some((timer) => timer.delay === 700));
  h.runDebounce();
  await waitFor(() => h.meta.pending === false);
  const puts = h.requests.filter((request) => request.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[1].payload.expectedRevision, 2);
  assert.equal(h.remote.canvas.documents.new.nodes.length, 2);
});

test('a draft created during PUT remains guarded until Core autosave succeeds', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  const put = deferred();
  h.setFetchHook((request) => request.method === 'PUT' ? put.promise : undefined);
  h.mutateCanvas();
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => h.requests.some((request) => request.method === 'PUT'));
  const editor = h.events.registerWorkspaceDraft();
  editor.markDirty();
  put.resolve(response({ revision: 2, updatedAt: 1000 }));
  await boot;
  assert.equal(h.meta.pending, true);
  assert.equal(h.events.hasWorkspaceDraftPending(), true);
});

for (const entry of ['bootstrap', 'reconcile']) {
  test(`${entry} rebases a dirty browser without dropping another browser's workspace`, async (t) => {
    const h = harness(t);
    h.seedBaseline(snapshot(), 1);
    const newer = snapshot('other-browser', 500);
    h.setRemote(newer, 8);
    h.mutateCanvas();
    if (entry === 'bootstrap') assert.deepEqual(await h.workspace.bootstrapWorkspace(), { offline: false });
    else { h.start(); await waitFor(() => h.statuses.at(-1) === 'synced'); }
    assert.equal(h.requests.filter((request) => request.method === 'PUT')[0].payload.expectedRevision, 1);
    assert.equal(h.requests.filter((request) => request.method === 'PUT').at(-1).payload.expectedRevision, 8);
    assert.equal(h.remote.canvas.projects.some((project) => project.id === 'other-browser'), true);
    assert.equal(h.remote.canvas.projects.some((project) => project.id === 'new'), true);
    assert.equal(h.restoreCount, 1);
    assert.equal(h.meta.revision, 9);
    assert.equal(h.meta.pending, false);
  });
}

test('clean first startup restores the actual GET revision rather than metadata revision', async (t) => {
  const h = harness(t, { revision: 8 });
  h.setFetchHook((request) => request.url.includes('?meta=1') ? response({ updatedAt: 100, revision: 7 }) : undefined);
  await h.workspace.bootstrapWorkspace();
  assert.equal(h.restoreCount, 1);
  assert.equal(h.meta.pending, false);
  assert.equal(h.meta.revision, 8);
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
});

test('a fresh canvas created during LAN startup does not replace the saved workspace', async (t) => {
  const remote = snapshot('shared-canvas', 200);
  remote.canvas.documents['shared-canvas'].nodes = [{
    id: 'shared-image', type: 'media', x: 24, y: 48,
    data: { kind: 'image', url: '/api/storage/file?name=shared.png' },
  }];
  const h = harness(t, { remote, revision: 3, realCanvas: true });

  h.canvasStorage.ensureCanvasStorage();
  assert.equal(h.events.getWorkspaceMutationGeneration(), 0, 'initial empty canvas setup is not a user edit');

  assert.deepEqual(await h.workspace.bootstrapWorkspace(), { offline: false });
  assert.equal(h.canvas.activeId, 'shared-canvas');
  assert.deepEqual(h.canvas.documents['shared-canvas'].nodes.map((node) => node.id), ['shared-image']);
  assert.equal(h.restoreCount, 1);
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
});

test('an old LAN placeholder pending at revision zero is recovered from the server', async (t) => {
  const remote = snapshot('shared-canvas', 200);
  remote.canvas.documents['shared-canvas'].nodes = [{
    id: 'shared-image', type: 'media', x: 24, y: 48,
    data: { kind: 'image', url: '/api/storage/file?name=shared.png' },
  }];
  const h = harness(t, { remote, revision: 3, realCanvas: true });
  h.canvasStorage.ensureCanvasStorage();
  h.writeMeta({ clientId: 'old-browser', localUpdatedAt: 150, serverUpdatedAt: 0, revision: 0, pending: true });

  assert.deepEqual(await h.workspace.bootstrapWorkspace(), { offline: false });
  assert.equal(h.canvas.activeId, 'shared-canvas');
  assert.deepEqual(h.canvas.documents['shared-canvas'].nodes.map((node) => node.id), ['shared-image']);
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
  assert.equal(h.meta.pending, false);
  assert.equal(h.meta.revision, 3);
});

test('default canvas UI settings do not block recovery of a pending LAN placeholder', async (t) => {
  const remote = snapshot('shared-canvas', 200);
  remote.canvas.documents['shared-canvas'].nodes = [{
    id: 'shared-image', type: 'media', x: 24, y: 48,
    data: { kind: 'image', url: '/api/storage/file?name=shared.png' },
  }];
  const h = harness(t, { remote, revision: 3, realCanvas: true });
  h.canvasStorage.ensureCanvasStorage();
  window.localStorage.setItem('sanmao.canvas.settings', JSON.stringify({
    connectionStyle: 'curve', edgesVisible: true, snapEnabled: true, depthQuality: 'medium',
  }));
  h.writeMeta({ clientId: 'browser-with-defaults', localUpdatedAt: 150, serverUpdatedAt: 0, revision: 0, pending: true });

  assert.deepEqual(await h.workspace.bootstrapWorkspace(), { offline: false });
  assert.equal(h.canvas.activeId, 'shared-canvas');
  assert.deepEqual(h.canvas.documents['shared-canvas'].nodes.map((node) => node.id), ['shared-image']);
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
  assert.equal(h.meta.pending, false);
  assert.equal(h.meta.revision, 3);
});

test('ordinary browser preferences do not block recovery of a pending LAN placeholder', async (t) => {
  const remote = snapshot('shared-canvas', 200);
  remote.canvas.documents['shared-canvas'].nodes = [{
    id: 'shared-image', type: 'media', x: 24, y: 48,
    data: { kind: 'image', url: '/api/storage/file?name=shared.png' },
  }];
  const h = harness(t, { remote, revision: 3, realCanvas: true });
  h.canvasStorage.ensureCanvasStorage();
  window.localStorage.setItem('sanmao-theme', 'dark');
  window.localStorage.setItem('sanmao-generate-settings', JSON.stringify({ modelId: 'auto', ratio: '16:9' }));
  window.localStorage.setItem('sanmao-model-preferences', JSON.stringify({ favorites: ['image-model'] }));
  h.writeMeta({ clientId: 'browser-with-preferences', localUpdatedAt: 150, serverUpdatedAt: 0, revision: 0, pending: true });

  assert.deepEqual(await h.workspace.bootstrapWorkspace(), { offline: false });
  assert.equal(h.canvas.activeId, 'shared-canvas');
  assert.deepEqual(h.canvas.documents['shared-canvas'].nodes.map((node) => node.id), ['shared-image']);
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
  assert.equal(h.meta.pending, false);
  assert.equal(h.meta.revision, 3);
});

test('a stale LAN browser rebases its newer canvas onto the shared workspace without dropping other projects', async (t) => {
  const remote = snapshot('remote-project', 300);
  remote.canvas.documents['remote-project'].nodes = [{
    id: 'remote-image', type: 'media', x: 80, y: 90,
    data: { kind: 'image', url: '/api/storage/file?name=remote.png' },
  }];
  const h = harness(t, { remote, revision: 5 });
  h.seedBaseline(snapshot('local-project', 200), 1);
  h.mutateCanvas();
  h.start();

  await waitFor(() => h.statuses.at(-1) === 'synced');
  assert.equal(h.remote.canvas.projects.some((project) => project.id === 'remote-project'), true);
  assert.equal(h.remote.canvas.projects.some((project) => project.id === 'new'), true);
  assert.equal(h.remote.canvas.documents['remote-project'].nodes[0].id, 'remote-image');
  assert.equal(h.remote.canvas.documents.new.nodes[0].id, 'generated-image');
  assert.equal(h.remote.canvas.activeId, 'new');
  assert.equal(h.meta.pending, false);
  assert.equal(h.meta.revision, 6);
});

test('project timestamps choose the newer same-id canvas during a LAN rebase', async (t) => {
  const base = snapshot('shared-project', 200);
  const h = harness(t, { remote: base, revision: 1 });
  h.seedBaseline(base, 1);
  h.canvas.projects[0].updatedAt = 400;
  h.canvas.documents['shared-project'].nodes = [{
    id: 'shared-image', type: 'media', x: 12, y: 18,
    data: { kind: 'image', url: '/api/storage/file?name=local.png' },
  }];
  h.events.emitWorkspaceMutation();
  const remote = snapshot('shared-project', 300);
  remote.canvas.projects[0].updatedAt = 350;
  remote.canvas.documents['shared-project'].nodes = [{
    id: 'shared-image', type: 'media', x: 30, y: 40,
    data: { kind: 'image', url: '/api/storage/file?name=remote.png' },
  }];
  h.setRemote(remote, 5);
  h.start();

  await waitFor(() => h.statuses.at(-1) === 'synced');
  assert.deepEqual(h.remote.canvas.documents['shared-project'].nodes.map((node) => node.id), ['shared-image']);
  assert.equal(h.remote.canvas.documents['shared-project'].nodes[0].data.url, '/api/storage/file?name=local.png');
  assert.equal(h.meta.revision, 6);
});

test('metadata fast path still detects persisted changes and preferences without a local event', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.mutateCanvas(false);
  h.preferenceWithoutEvent();
  h.start();
  await waitFor(() => h.statuses.at(-1) === 'synced');
  assert.equal(h.remote.canvas.activeId, 'new');
  assert.equal(h.remote.preferences['sanmao-theme'], 'dark');
  assert.equal(h.restoreCount, 0);
});

test('local mutation during snapshot collection aborts a mixed PUT', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.mutateCanvas();
  const read = deferred();
  let reading = false;
  h.setGalleryRead(() => { reading = true; return read.promise; });
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => reading);
  h.canvas.documents.new.nodes.push({ id: 'latest-image' });
  h.events.emitWorkspaceMutation();
  read.resolve();
  await boot;
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
  assert.equal(h.meta.pending, true);
});

test('async restore suppresses repository echoes but preserves real Core and persisted canvas edits', async (t) => {
  const h = harness(t);
  h.seedBaseline(snapshot(), 1);
  h.setRemote(snapshot('remote-new', 200), 2);
  const history = deferred();
  let restoringHistory = false;
  h.setGalleryRestore(() => { restoringHistory = true; return history.promise; });
  h.start();
  await waitFor(() => restoringHistory);
  assert.equal(h.restoreCount, 0);
  assert.equal(h.events.isWorkspaceRestoreInProgress(), false);
  assert.equal(h.events.getWorkspaceMutationGeneration(), 0);
  const editor = h.events.registerWorkspaceDraft();
  editor.markDirty();
  h.mutateCanvas();
  editor.markSaved();
  const editedGeneration = h.events.getWorkspaceMutationGeneration();
  history.resolve();
  await waitFor(() => h.statuses.at(-1) === 'idle');
  assert.equal(h.events.getWorkspaceMutationGeneration(), editedGeneration);
  assert.equal(h.meta.pending, true);
  assert.equal(h.meta.revision, 1);
  assert.equal(h.restoreCount, 0);
  assert.equal(h.canvas.documents.new.nodes.length, 1);
  assert.equal(h.restoredCallbacks, 0);
});

test('async restore completion never rolls back a baseline advanced by another tab', async (t) => {
  const h = harness(t);
  const history = deferred();
  let restoringHistory = false;
  h.setGalleryRestore(() => { restoringHistory = true; return history.promise; });
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => restoringHistory);
  const advanced = { clientId: 'other-tab', localUpdatedAt: 2000, serverUpdatedAt: 2000, revision: 9, pending: false, contentSignature: 'advanced' };
  h.writeMeta(advanced);
  history.resolve();
  await boot;
  assert.deepEqual(h.meta, advanced);
  assert.equal(h.restoreCount, 0);
  assert.equal(h.canvas.activeId, 'old');
});

test('images generated during automatic async restore save against the unchanged baseline and survive reload', async (t) => {
  const h = harness(t, { realCanvas: true });
  h.seedBaseline(snapshot(), 1);
  const { CanvasProjectSession } = h.load('./canvas/project-session');
  const { CanvasCore } = h.load('../packages/canvas-core/runtime');
  const { normalizeDocument } = h.load('./canvas/model');
  const session = new CanvasProjectSession();
  const core = new CanvasCore(session.open('old'));
  const editor = h.events.registerWorkspaceDraft();
  const unsubscribe = core.subscribe(() => {
    if (session.hasUnsavedChanges(core.document())) editor.markDirty();
  });
  t.after(() => { unsubscribe(); editor.dispose(); });
  const remote = snapshot('old', 200);
  remote.canvas.documents.old = normalizeDocument({ ...core.document(), nodes: [{ id: 'remote-image', type: 'media', x: 0, y: 0, data: { kind: 'image', url: '/stored/remote.png' } }] });
  h.setRemote(remote, 2);
  const history = deferred();
  let restoringHistory = false;
  h.setGalleryRestore(() => { restoringHistory = true; return history.promise; });
  h.start();
  await waitFor(() => restoringHistory);
  const persistedBeforeGeneration = h.canvasStorage.loadCanvasDocument('old');
  assert.equal(persistedBeforeGeneration.nodes.length, 0);
  core.apply({ id: 'generate-images', label: 'generate images', apply: (document) => normalizeDocument({
    ...document,
    nodes: ['one', 'two', 'three'].map((id) => ({ id, type: 'media', x: 0, y: 0, data: { kind: 'image', url: `/api/storage/file?name=${id}.png` } })),
  }) });
  assert.equal(h.events.hasWorkspaceDraftPending(), true);
  history.resolve();
  await waitFor(() => h.statuses.at(-1) === 'idle');
  assert.deepEqual(h.canvasStorage.loadCanvasDocument('old'), persistedBeforeGeneration);
  assert.equal(h.restoreCount, 0);
  assert.equal(h.restoredCallbacks, 0);
  assert.equal(h.meta.revision, 1);
  assert.equal(session.save(core.document()), true);
  editor.markSaved();
  assert.equal(h.events.hasWorkspaceDraftPending(), false);
  const reloaded = new CanvasProjectSession();
  assert.deepEqual(reloaded.open('old').nodes.map((node) => node.id), ['one', 'two', 'three']);
  assert.equal(h.meta.pending, true);
  h.runDebounce();
  await waitFor(() => h.statuses.at(-1) === 'synced');
  assert.equal(h.requests.find((request) => request.method === 'PUT').payload.expectedRevision, 1);
  assert.equal(h.requests.filter((request) => request.method === 'PUT').at(-1).payload.expectedRevision, 2);
  assert.deepEqual(h.remote.canvas.documents.old.nodes.map((node) => node.id).sort(), ['one', 'remote-image', 'three', 'two']);
  assert.equal(h.meta.revision, 3);
});

test('stopping sync during async restore cancels the pending canvas commit', async (t) => {
  const h = harness(t);
  h.seedBaseline(snapshot(), 1);
  h.setRemote(snapshot('remote-new', 200), 2);
  const history = deferred();
  let restoringHistory = false;
  h.setGalleryRestore(() => { restoringHistory = true; return history.promise; });
  h.start();
  await waitFor(() => restoringHistory);
  h.stop();
  history.resolve();
  await waitFor(() => h.statuses.at(-1) === 'idle');
  assert.equal(h.restoreCount, 0);
  assert.equal(h.canvas.activeId, 'old');
  assert.equal(h.meta.revision, 1);
});

test('silent persisted edits during deferred GET invalidate the snapshot without advancing the CAS revision', async (t) => {
  const h = harness(t);
  h.seedBaseline(snapshot(), 1);
  h.setRemote(snapshot('remote-new', 200), 2);
  const get = deferred();
  h.setFetchHook((request) => request.url === '/api/workspace' ? get.promise : undefined);
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => h.requests.some((request) => request.url === '/api/workspace'));
  h.mutateCanvas(false);
  get.resolve(response({ workspace: snapshot('remote-new', 200), revision: 2 }));
  await boot;
  assert.equal(h.restoreCount, 0);
  assert.equal(h.meta.pending, true);
  assert.equal(h.meta.revision, 1);
  assert.equal(h.canvas.documents.new.nodes.length, 1);
});

test('history read failure aborts snapshot upload instead of uploading an empty gallery', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.mutateCanvas();
  h.setGalleryRead(() => { throw new Error('database unavailable'); });
  await assert.rejects(h.workspace.collectWorkspaceSnapshot(), /database unavailable/);
  assert.deepEqual(await h.workspace.bootstrapWorkspace(), { offline: true });
  assert.equal(h.requests.filter((request) => request.method === 'PUT').length, 0);
  assert.equal(h.meta.pending, true);
});

test('a generation record written during automatic restore survives the delayed replacement', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.setRemote(snapshot('remote-new', 200), 2);
  const history = deferred();
  let started = false;
  h.setGalleryRestore(() => { started = true; return history.promise; });
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => started);
  const generated = { id: 'fresh-image', url: '/stored/fresh.png', createdAt: 1000 };
  h.mutateGallery(generated);
  history.resolve();
  await boot;
  assert.deepEqual(h.gallery, [generated]);
  assert.equal(h.canvas.activeId, 'old');
  assert.equal(h.restoreCount, 0);
  assert.equal(h.meta.revision, 1);
  assert.equal(h.meta.pending, true);
});

test('explicit backup restore remains replacement and invalidates an older automatic GET', async (t) => {
  const h = harness(t);
  const get = deferred();
  h.setFetchHook((request) => request.url === '/api/workspace' ? get.promise : undefined);
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => h.requests.some((request) => request.url === '/api/workspace'));
  h.mutateCanvas();
  const backup = snapshot('backup', 300);
  await h.workspace.restoreWorkspaceSnapshot(backup);
  assert.deepEqual(h.canvas, backup.canvas);
  assert.equal(h.meta.pending, false);
  get.resolve(response({ workspace: snapshot(), revision: 1 }));
  await boot;
  assert.equal(h.restoreCount, 1);
  assert.deepEqual(h.canvas, backup.canvas);
  assert.equal(h.meta.serverUpdatedAt, 300);
});

test('an older in-flight PUT cannot acknowledge over an explicit backup restore baseline', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.mutateCanvas();
  const put = deferred();
  h.setFetchHook((request) => request.method === 'PUT' ? put.promise : undefined);
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => h.requests.some((request) => request.method === 'PUT'));
  await h.workspace.restoreWorkspaceSnapshot(snapshot('backup', 300));
  const baseline = copy(h.meta);
  put.resolve(response({ updatedAt: 1000, revision: 2 }));
  await boot;
  assert.deepEqual(h.meta, baseline);
  assert.equal(h.canvas.activeId, 'backup');
});

test('a failed deferred GET preserves the latest dirty metadata', async (t) => {
  const h = harness(t);
  h.seedBaseline();
  h.setRemote(snapshot('remote-new', 200), 2);
  const get = deferred();
  h.setFetchHook((request) => request.url === '/api/workspace' ? get.promise : undefined);
  const boot = h.workspace.bootstrapWorkspace();
  await waitFor(() => h.requests.some((request) => request.url === '/api/workspace'));
  h.mutateCanvas();
  const editor = h.events.registerWorkspaceDraft();
  editor.markDirty();
  get.reject(new Error('network failed'));
  assert.deepEqual(await boot, { offline: true });
  assert.equal(h.meta.pending, true);
  assert.equal(h.meta.revision, 1);
  assert.equal(h.canvas.documents.new.nodes.length, 1);
});
