import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const polling = createTsRequire(process.cwd())('./lib/cangyuan-media-task-polling');

test('music and 3D task polling use their documented intervals', () => {
  assert.equal(polling.CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS, 5_000);
  assert.equal(polling.CANGYUAN_3D_TASK_POLL_INTERVAL_MS, 3_000);
  assert.equal(polling.cangyuanMediaTaskPollIntervalMs('music'), 5_000);
  assert.equal(polling.cangyuanMediaTaskPollIntervalMs('3d'), 3_000);
});

test('Cangyuan task polling rotates bounded batches so later active tasks are not starved', () => {
  const tasks = Array.from({ length: 7 }, (_, index) => ({ id: `task-${index + 1}`, status: 'running' }));
  const first = polling.nextCangyuanTaskPollBatch(tasks, null, 4);
  const second = polling.nextCangyuanTaskPollBatch(tasks, first.lastTaskId, 4);

  assert.deepEqual(first.tasks.map((task) => task.id), ['task-1', 'task-2', 'task-3', 'task-4']);
  assert.deepEqual(second.tasks.map((task) => task.id), ['task-5', 'task-6', 'task-7', 'task-1']);
});

test('Cangyuan task polling skips terminal tasks and handles an empty active set', () => {
  const tasks = [
    { id: 'done', status: 'succeeded' },
    { id: 'active-a', status: 'pending' },
    { id: 'failed', status: 'failed' },
    { id: 'active-b', status: 'waiting' },
  ];

  assert.deepEqual(polling.nextCangyuanTaskPollBatch(tasks, null, 4).tasks.map((task) => task.id), ['active-a', 'active-b']);
  assert.deepEqual(polling.nextCangyuanTaskPollBatch([{ id: 'done', status: 'succeeded' }], null), { tasks: [], lastTaskId: null });
});
