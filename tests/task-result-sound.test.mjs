import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const sound = createTsRequire(process.cwd())('./lib/task-result-sound');

 test('task result statuses normalize success and failure across task families', () => {
  assert.equal(sound.taskResultOutcome({ status: 'success' }), 'success');
  assert.equal(sound.taskResultOutcome({ status: 'succeeded' }), 'success');
  assert.equal(sound.taskResultOutcome({ status: 'done' }), 'success');
  assert.equal(sound.taskResultOutcome({ status: 'error' }), 'failure');
  assert.equal(sound.taskResultOutcome({ status: 'failed' }), 'failure');
  assert.equal(sound.taskResultOutcome({ status: 'running' }), null);
  assert.equal(sound.taskResultOutcome({ status: 'cancelled' }), null);
  assert.equal(sound.taskResultOutcome({ status: 'error', errorCode: 'CANCELLED' }), null);
});

test('task result snapshots only announce newly terminal outcomes', () => {
  const previous = sound.taskResultOutcomes([
    { id: 'done-1', status: 'success' },
    { id: 'failed-1', status: 'error' },
  ]);
  const current = sound.taskResultOutcomes([
    { id: 'done-1', status: 'success' },
    { id: 'failed-1', status: 'error' },
    { id: 'new-1', status: 'done' },
    { id: 'new-2', status: 'failed' },
  ]);

  assert.deepEqual(sound.changedTaskResultOutcomes(previous, current), [
    { id: 'new-1', outcome: 'success' },
    { id: 'new-2', outcome: 'failure' },
  ]);
});
