import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const store = await loadTypeScript('../lib/generate-tasks-storage.ts');

function buildTask(index, referenceChars) {
  return {
    id: `task-${index}`,
    status: 'error',
    prompt: `prompt ${index}`,
    items: [{ id: `item-${index}` }],
    request: { prompt: `prompt ${index}`, references: [{ dataUrl: 'x'.repeat(referenceChars) }], mask: null },
  };
}

function recordingStorage() {
  const writes = [];
  const removed = [];
  return {
    writes,
    removed,
    setItem: (key, value) => { writes.push([key, value]); },
    removeItem: (key) => { removed.push(key); },
  };
}

test('小型生成任务历史保留参考图', () => {
  const tasks = [buildTask(1, 500), buildTask(2, 500)];
  const stored = JSON.parse(store.generateTasksStoragePayload(tasks));
  assert.equal(stored.length, 2);
  assert.equal(stored[0].request.references.length, 1);
  assert.equal(stored[0].request.referencesOmitted, undefined);
  assert.equal(stored[0].itemIds[0], 'item-1');
  assert.deepEqual(stored[0].items, []);
});

test('超出预算时只为最近的任务保留参考图', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => buildTask(index, 400000));
  assert.ok(store.generateTasksStoragePayload(tasks).length > store.GENERATE_TASKS_STORAGE_BUDGET);
  const storage = recordingStorage();
  assert.equal(store.persistGenerateTasks(tasks, storage), true);
  assert.equal(storage.writes.length, 1);
  const [key, payload] = storage.writes[0];
  assert.equal(key, 'sanmao-generate-tasks');
  assert.ok(payload.length <= store.GENERATE_TASKS_STORAGE_BUDGET);
  const stored = JSON.parse(payload);
  assert.equal(stored.length, 12);
  assert.equal(stored[0].request.references.length, 1);
  assert.equal(stored[1].request.references.length, 1);
  assert.equal(stored[2].request.references.length, 0);
  assert.equal(stored[2].request.referencesOmitted, true);
  assert.equal(stored[11].id, 'task-11');
  assert.deepEqual(storage.removed, []);
});

test('参考图仍然超出预算时全部丢弃', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => buildTask(index, 1500000));
  const storage = recordingStorage();
  assert.equal(store.persistGenerateTasks(tasks, storage), true);
  const payload = storage.writes[0][1];
  const stored = JSON.parse(payload);
  assert.equal(stored.length, 12);
  assert.equal(stored[0].request.references.length, 0);
  assert.ok(payload.length <= store.GENERATE_TASKS_STORAGE_BUDGET);
});

test('单个任务的超大参考图被丢弃', () => {
  const storage = recordingStorage();
  assert.equal(store.persistGenerateTasks([buildTask(1, 2600000)], storage), true);
  const stored = JSON.parse(storage.writes[0][1]);
  assert.equal(stored[0].request.references.length, 0);
  assert.equal(stored[0].request.referencesOmitted, true);
});

test('存储写满时清空任务键并报告失败', () => {
  const full = {
    setItem: () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); },
    removeItem: (key) => { full.removed.push(key); },
    removed: [],
  };
  assert.equal(store.persistGenerateTasks([buildTask(1, 10)], full), false);
  assert.deepEqual(full.removed, ['sanmao-generate-tasks']);
});
