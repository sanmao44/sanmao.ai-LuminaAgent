import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, rmdir, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTsRequire } from './ts-require.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-task-store-concurrency-'));
test.after(() => rm(dataDir, { recursive: true, force: true }));

function independentStore(fileName) {
  return createTsRequire(root, {
    './data-paths': { resolveLocalDataDir: () => dataDir },
  })('./lib/task-store').createTaskStore({ fileName });
}

const counterTask = (id = 'counter') => ({ id, createdAt: new Date().toISOString(), count: 0, status: 'retry' });

const workerScript = `
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const config = JSON.parse(process.argv[1]);
const { createTsRequire } = await import(pathToFileURL(path.join(config.root, 'tests/ts-require.mjs')));
const { createTaskStore } = createTsRequire(config.root, {
  './data-paths': { resolveLocalDataDir: () => config.dataDir },
})('./lib/task-store');
const store = createTaskStore({ fileName: config.fileName });
const started = once(process, 'message');
process.send({ type: 'ready' });
await started;
let result;
if (config.action === 'hold') {
  await store.mutate(async (tasks) => {
    const released = once(process, 'message');
    process.send({ type: 'entered' });
    await released;
    tasks[0].count += 1;
  });
} else if (config.action === 'claim') {
  result = await store.mutate(async (tasks) => {
    if (tasks[0].status !== 'retry') return false;
    await delay(25);
    tasks[0].status = 'in-progress';
    return true;
  });
} else {
  for (let index = 0; index < 4; index += 1) {
    await store.mutate(async (tasks) => {
      const count = tasks[0].count;
      await delay(10);
      tasks[0].count = count + 1;
    });
  }
  result = (await store.find('counter')).count;
}
process.send({ type: 'result', value: result });
process.disconnect();
`;

function launchWorker(fileName, action) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', workerScript, JSON.stringify({
    root, dataDir, fileName, action,
  })], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const messages = [];
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (value) => { stderr += value; });
  child.on('message', (message) => messages.push(message));
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return {
    child,
    exited,
    async message(type) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const message = messages.find((value) => value.type === type);
        if (message) return message;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`worker exited before ${type}: ${stderr}`);
        await delay(10);
      }
      throw new Error(`worker timed out waiting for ${type}: ${stderr}`);
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    },
    async success() {
      const exit = await exited;
      assert.equal(exit.code, 0, stderr);
    },
  };
}

async function assertNoLockArtifacts(fileName) {
  assert.deepEqual((await readdir(dataDir)).filter((entry) => entry.startsWith(`${fileName}.lock`)), []);
}

test('independent task-store instances serialize the full asynchronous read-modify-write', async () => {
  const fileName = 'two-instances.json';
  const first = independentStore(fileName);
  const second = independentStore(fileName);
  await first.insert(counterTask());
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let secondEntered = false;
  const firstMutation = first.mutate(async (tasks) => {
    entered.resolve();
    await release.promise;
    tasks[0].count += 1;
  });
  await entered.promise;
  const secondMutation = second.mutate(async (tasks) => {
    secondEntered = true;
    tasks[0].count += 1;
  });
  try {
    await delay(75);
    assert.equal(secondEntered, false, 'another module must wait until the first transaction commits');
  } finally {
    release.resolve();
    await Promise.all([firstMutation, secondMutation]);
  }
  assert.equal((await first.find('counter')).count, 2);
  await assertNoLockArtifacts(fileName);
});

test('independent task-store instances create one record for a shared idempotency key', async () => {
  const fileName = 'idempotency.json';
  const stores = Array.from({ length: 4 }, () => independentStore(fileName));
  const results = await Promise.all(stores.map((store, index) => store.insert({
    ...counterTask(`candidate-${index}`), idempotencyKey: 'one-video-request',
  })));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.task.id)).size, 1);
  assert.equal((await stores[0].readAll()).length, 1);
  await assertNoLockArtifacts(fileName);
});

test('independent processes do not lose concurrent task mutations', { timeout: 20_000 }, async () => {
  const fileName = 'process-counter.json';
  const store = independentStore(fileName);
  await store.insert(counterTask());
  const workers = Array.from({ length: 4 }, () => launchWorker(fileName, 'increment'));
  try {
    await Promise.all(workers.map((worker) => worker.message('ready')));
    workers.forEach((worker) => worker.child.send({ type: 'start' }));
    await Promise.all(workers.map((worker) => worker.message('result')));
    await Promise.all(workers.map((worker) => worker.success()));
    assert.equal((await store.find('counter')).count, 16);
    await assertNoLockArtifacts(fileName);
  } finally {
    await Promise.all(workers.map((worker) => worker.stop()));
  }
});

test('a dead process lock is reclaimed concurrently but a video submission is claimed only once', { timeout: 20_000 }, async () => {
  const fileName = 'dead-owner-claim.json';
  const store = independentStore(fileName);
  await store.insert(counterTask());
  const holder = launchWorker(fileName, 'hold');
  const workers = [];
  try {
    await holder.message('ready');
    holder.child.send({ type: 'start' });
    await holder.message('entered');
    await holder.stop();
    // A process can also exit before publishing its prepared owner directory.
    // Both an empty registration and a completed registration are recoverable.
    for (const withOwner of [false, true]) {
      const token = randomUUID();
      const pending = path.join(dataDir, `${fileName}.lock.${holder.child.pid}.${token}.pending`);
      await mkdir(pending);
      if (withOwner) await writeFile(path.join(pending, `${holder.child.pid}-${token}.owner`), '');
    }
    for (let index = 0; index < 4; index += 1) workers.push(launchWorker(fileName, 'claim'));
    await Promise.all(workers.map((worker) => worker.message('ready')));
    workers.forEach((worker) => worker.child.send({ type: 'start' }));
    const results = await Promise.all(workers.map((worker) => worker.message('result')));
    await Promise.all(workers.map((worker) => worker.success()));
    assert.equal(results.filter((result) => result.value).length, 1);
    assert.equal((await store.find('counter')).status, 'in-progress');
    assert.equal((await store.find('counter')).count, 0, 'an interrupted transaction must not commit its changes');
    await assertNoLockArtifacts(fileName);
  } finally {
    await holder.stop();
    await Promise.all(workers.map((worker) => worker.stop()));
  }
});

test('an old lock owned by a live process is retained until its owner releases it', { timeout: 15_000 }, async () => {
  const fileName = 'live-owner.json';
  const store = independentStore(fileName);
  await store.insert(counterTask());
  const holder = launchWorker(fileName, 'hold');
  let mutation;
  let entered = false;
  try {
    await holder.message('ready');
    holder.child.send({ type: 'start' });
    await holder.message('entered');
    const old = new Date('2000-01-01T00:00:00Z');
    await utimes(path.join(dataDir, `${fileName}.lock`), old, old);
    mutation = store.mutate((tasks) => { entered = true; tasks[0].count += 1; });
    await delay(75);
    assert.equal(entered, false, 'age never proves that a live owner can be removed');
    holder.child.send({ type: 'release' });
    await holder.message('result');
    await holder.success();
    await mutation;
    assert.equal((await store.find('counter')).count, 2);
    await assertNoLockArtifacts(fileName);
  } finally {
    await holder.stop();
    if (mutation) await mutation;
  }
});

test('callback and file-write failures release the lock for the next transaction', async () => {
  const fileName = 'failure-recovery.json';
  const first = independentStore(fileName);
  await first.insert(counterTask());
  await assert.rejects(() => first.mutate((tasks) => {
    tasks[0].count = 100;
    throw new Error('callback failed');
  }), /callback failed/);
  await independentStore(fileName).mutate((tasks) => { tasks[0].count += 1; });
  assert.equal((await first.find('counter')).count, 1);
  await assertNoLockArtifacts(fileName);

  const blockedFile = 'write-failure.json';
  await mkdir(path.join(dataDir, blockedFile));
  const blockedStore = independentStore(blockedFile);
  await assert.rejects(() => blockedStore.insert(counterTask()));
  await assertNoLockArtifacts(blockedFile);
  await rmdir(path.join(dataDir, blockedFile));
  assert.equal((await independentStore(blockedFile).insert(counterTask())).created, true);
  await assertNoLockArtifacts(blockedFile);
});
