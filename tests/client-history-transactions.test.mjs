import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function harness(t) {
  const previous = globalThis.indexedDB;
  const transactions = [];
  let mutations = 0;
  let closed = 0;
  const db = {
    close() { closed += 1; },
    transaction(name) {
      const requests = [];
      const operations = [];
      const request = (operation, value) => {
        operations.push({ operation, value });
        const pending = { result: operation === 'count' ? 1 : value?.id, error: null };
        requests.push(pending);
        return pending;
      };
      const tx = {
        name, requests, operations, error: null,
        objectStore: () => ({
          put: (value) => request('put', value), delete: (id) => request('delete', id),
          clear: () => request('clear'), count: () => request('count'),
        }),
        abort() { queueMicrotask(() => tx.onabort?.()); },
      };
      transactions.push(tx);
      return tx;
    },
  };
  globalThis.indexedDB = { open() {
    const request = { result: db };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  t.after(() => { if (previous === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous; });
  const load = createTsRequire(path.join(process.cwd(), 'lib'), {
    './workspace-events': { emitWorkspaceMutation() { mutations += 1; }, emitWorkspaceChange() { mutations += 1; } },
  });
  return { history: load('./client-history'), transactions, get mutations() { return mutations; }, get closed() { return closed; } };
}

const writes = [
  ['gallery image', (h) => h.saveGalleryItem({ id: 'image' })],
  ['chat session', (h) => h.saveChatSession({ id: 'chat' })],
  ['asset index', (h) => h.saveAssetIndexItem({ id: 'asset' })],
  ['gallery batch', (h) => h.saveGalleryItems([{ id: 'one' }, { id: 'two' }])],
  ['gallery deletion batch', (h) => h.removeGalleryItems(['one', 'two'])],
  ['asset batch', (h) => h.saveAssetIndexItems([{ id: 'one' }, { id: 'two' }])],
];

for (const [name, write] of writes) {
  test(`${name} is acknowledged only after transaction commit`, async (t) => {
    const h = harness(t);
    let settled = false;
    const saving = write(h.history).then(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    const tx = h.transactions[0];
    for (const request of tx.requests) request.onsuccess?.();
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(h.mutations, 0);
    tx.oncomplete();
    await saving;
    assert.equal(settled, true);
    assert.equal(h.mutations, 1);
    assert.equal(h.closed, 1);
  });

  test(`${name} rejects an abort after provisional request success without reporting a save`, async (t) => {
    const h = harness(t);
    const saving = write(h.history);
    const rejected = assert.rejects(saving, /取消/);
    await new Promise((resolve) => setImmediate(resolve));
    const tx = h.transactions[0];
    for (const request of tx.requests) request.onsuccess?.();
    tx.abort();
    await rejected;
    assert.equal(h.mutations, 0);
    assert.equal(h.closed, 1);
  });
}

test('automatic history replacement evaluates the guard when its queued transaction runs', async (t) => {
  const h = harness(t);
  let allowed = true;
  let checks = 0;
  const restoring = h.history.replaceGalleryItems([{ id: 'old' }], () => { checks += 1; return allowed; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 0);
  allowed = false;
  const tx = h.transactions[0];
  tx.requests[0].onsuccess();
  tx.oncomplete();
  await restoring;
  assert.equal(checks, 1);
  assert.deepEqual(tx.operations.map((item) => item.operation), ['count']);
});

test('a rejected restore guard aborts and rejects instead of hanging', async (t) => {
  const h = harness(t);
  const restoring = h.history.replaceGalleryItems([{ id: 'old' }], () => { throw new Error('guard failure'); });
  const rejected = assert.rejects(restoring, /取消/);
  await new Promise((resolve) => setImmediate(resolve));
  h.transactions[0].requests[0].onsuccess();
  await rejected;
  assert.equal(h.mutations, 0);
});
