import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

class MemoryStorage {
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
}

function fixture() {
  globalThis.window = Object.assign(new EventTarget(), { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
  const load = createTsRequire(path.join(process.cwd(), 'lib'));
  const storage = load('./canvas/storage');
  const model = load('./canvas/model');
  const { CanvasProjectSession } = load('./canvas/project-session');
  const { CanvasCore } = load('../packages/canvas-core/runtime');
  const empty = model.normalizeDocument(null);
  const project = (id) => ({ id, name: id, createdAt: 100, updatedAt: 100 });
  const imageDocument = (...ids) => model.normalizeDocument({ ...empty, nodes: ids.map((id) => ({ id, type: 'media', x: 0, y: 0, data: { kind: 'image', url: `/api/storage/file?name=${id}.png` } })) });
  assert.equal(storage.createCanvasProject(project('a'), empty), true);
  return { storage, model, CanvasProjectSession, CanvasCore, empty, project, imageDocument };
}

test('a stale project list cannot remove a newly created canvas or its image nodes', () => {
  const { storage, project, imageDocument } = fixture();
  const stale = storage.readCanvasProjects();
  assert.equal(storage.createCanvasProject(project('b'), imageDocument('b-image')), true);
  assert.equal(storage.saveCanvasProjects(stale, 'a'), true);
  assert.deepEqual(storage.readCanvasProjects().map((p) => p.id), ['b', 'a']);
  assert.equal(storage.loadCanvasDocument('b').nodes[0].id, 'b-image');
});

test('snapshot reads and storage-event refreshes never write back an established project index', () => {
  const { storage, CanvasProjectSession, empty } = fixture();
  const session = new CanvasProjectSession();
  session.open('a');
  const writes = [];
  const setItem = window.localStorage.setItem;
  window.localStorage.setItem = function (key, value) {
    writes.push(key);
    setItem.call(this, key, value);
  };
  storage.readCanvasWorkspace();
  storage.ensureCanvasStorage();
  session.refresh(empty);
  assert.deepEqual(writes, []);
});

test('startup selection survives reload after another tab changes the shared default', () => {
  const { storage, project, empty } = fixture();
  const firstTab = window.sessionStorage;
  firstTab.removeItem('sanmao.canvas.tab-active');
  assert.equal(storage.ensureCanvasStorage().activeId, 'a');
  window.sessionStorage = new MemoryStorage();
  storage.createCanvasProject(project('b'), empty);
  assert.equal(storage.ensureCanvasStorage().activeId, 'b');
  window.sessionStorage = firstTab;
  assert.equal(storage.ensureCanvasStorage().activeId, 'a');
});

test('autosave touches only the latest project row, preserving concurrent rename and creation', () => {
  const { storage, project, imageDocument, empty } = fixture();
  storage.createCanvasProject(project('b'), empty);
  storage.renameCanvasProject('a', '新名称');
  assert.equal(storage.saveCanvasDocument('a', imageDocument('generated'), empty), true);
  assert.equal(storage.readCanvasProjects().find((p) => p.id === 'a').name, '新名称');
  assert.equal(storage.readCanvasProjects().length, 2);
});

test('an old editor cannot erase images saved by another editor of the same canvas', () => {
  const { storage, CanvasProjectSession, empty, imageDocument } = fixture();
  const old = new CanvasProjectSession();
  const fresh = new CanvasProjectSession();
  old.open('a'); fresh.open('a');
  assert.equal(fresh.save(imageDocument('one', 'two', 'three')), true);
  assert.equal(old.save(empty), false);
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((n) => n.id), ['one', 'two', 'three']);
  assert.match(storage.describeCanvasSaveFailure(), /其他页面/);
});

test('background refresh retains this editor selection and unchanged undo history', () => {
  const { storage, CanvasProjectSession, CanvasCore, empty, imageDocument, project } = fixture();
  const session = new CanvasProjectSession();
  const core = new CanvasCore(session.open('a'));
  core.apply({ id: 'generate', label: 'generate', apply: () => imageDocument('one') });
  assert.equal(session.save(core.document()), true);
  const history = core.history();
  storage.createCanvasProject(project('b'), empty);
  const refreshed = session.refresh(core.document());
  assert.equal(refreshed.activeId, 'a');
  assert.equal(refreshed.document, undefined);
  assert.deepEqual(core.history(), history);
  assert.equal(core.history().past.length, 1);
  assert.equal(storage.ensureCanvasStorage().activeId, 'b');
});

test('refresh preserves generated unsaved nodes and rejects a conflicting subsequent save', () => {
  const { storage, CanvasProjectSession, imageDocument, empty } = fixture();
  const session = new CanvasProjectSession();
  session.open('a');
  const generated = imageDocument('one', 'two', 'three');
  assert.equal(storage.saveCanvasDocument('a', imageDocument('remote'), empty), true);
  const refreshed = session.refresh(generated);
  assert.equal(refreshed.activeId, 'a');
  assert.equal(refreshed.document, undefined);
  assert.equal(session.hasUnsavedChanges(generated), true);
  assert.equal(session.save(generated), false);
  assert.equal(generated.nodes.length, 3);
  assert.equal(storage.loadCanvasDocument('a').nodes[0].id, 'remote');
});

test('deleted rename targets and delayed autosave never affect another project or resurrect documents', () => {
  const { storage, CanvasProjectSession, empty, project } = fixture();
  storage.createCanvasProject(project('b'), empty);
  const session = new CanvasProjectSession();
  session.open('a');
  assert.equal(storage.deleteCanvasProject('a'), true);
  assert.equal(storage.renameCanvasProject('a', '误改'), false);
  assert.equal(session.save(empty), false);
  assert.equal(storage.readCanvasProjects()[0].name, 'b');
  assert.equal(window.localStorage.getItem(`${storage.CANVAS_PROJECT_PREFIX}a`), null);
  assert.equal(session.refresh(empty).activeId, 'b');
});

test('explicit backup restore keeps replacement semantics', () => {
  const { storage, project, imageDocument, empty } = fixture();
  storage.createCanvasProject(project('b'), imageDocument('new-image'));
  assert.equal(storage.restoreCanvasWorkspace({ projects: [project('a')], documents: { a: empty }, activeId: 'a' }), true);
  assert.deepEqual(storage.readCanvasProjects().map((p) => p.id), ['a']);
  assert.equal(window.localStorage.getItem(`${storage.CANVAS_PROJECT_PREFIX}b`), null);
});

test('quota failure while creating a canvas does not publish an empty replacement', () => {
  const { storage, project, imageDocument } = fixture();
  const setItem = window.localStorage.setItem;
  window.localStorage.setItem = function (key, value) {
    if (key === `${storage.CANVAS_PROJECT_PREFIX}b`) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    setItem.call(this, key, value);
  };
  assert.equal(storage.createCanvasProject(project('b'), imageDocument('new-image')), false);
  assert.deepEqual(storage.readCanvasProjects().map((p) => p.id), ['a']);
  assert.match(storage.describeCanvasSaveFailure(), /存储已满/);
});

test('failed snapshot replacement preserves original canvas documents and removes partial writes', () => {
  const { storage, project, imageDocument, empty } = fixture();
  storage.saveCanvasDocument('a', imageDocument('existing-image'), empty);
  const before = storage.readCanvasWorkspace();
  const setItem = window.localStorage.setItem;
  window.localStorage.setItem = function (key, value) {
    if (key === `${storage.CANVAS_PROJECT_PREFIX}c`) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    setItem.call(this, key, value);
  };
  assert.equal(storage.restoreCanvasWorkspace({ projects: [project('b'), project('c')], documents: { b: imageDocument('remote-image'), c: empty }, activeId: 'b' }), false);
  assert.deepEqual(storage.readCanvasWorkspace(), before);
  assert.equal(window.localStorage.getItem(`${storage.CANVAS_PROJECT_PREFIX}b`), null);
  assert.deepEqual(storage.loadCanvasDocument('a').nodes.map((node) => node.id), ['existing-image']);
});

test('a partial overwrite of an existing document rolls back if a later restore write fails', () => {
  const { storage, project, imageDocument, empty } = fixture();
  storage.saveCanvasDocument('a', imageDocument('existing-image'), empty);
  const before = storage.readCanvasWorkspace();
  const setItem = window.localStorage.setItem;
  window.localStorage.setItem = function (key, value) {
    if (key === storage.CANVAS_UI_KEY && value !== JSON.stringify(before.ui)) throw new Error('write failed');
    setItem.call(this, key, value);
  };
  assert.equal(storage.restoreCanvasWorkspace({ projects: [project('a')], documents: { a: empty }, activeId: 'a', ui: { replacement: true } }), false);
  assert.deepEqual(storage.readCanvasWorkspace(), before);
});
