import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { deriveCanvasTaskPrimaryAction } = createTsRequire(process.cwd())('./lib/canvas/task-log-actions');

const action = (overrides = {}) => deriveCanvasTaskPrimaryAction({
  kind: 'image',
  needsRecordCheck: false,
  canPreserveAudio: false,
  canRestoreTaskContext: false,
  canRetryTask: false,
  canContinueTask: false,
  hasMediaResult: false,
  ...overrides,
});

test('task-card primary action prioritizes read-only confirmation and local draft recovery', () => {
  assert.equal(action({ needsRecordCheck: true, canRetryTask: true }), 'check');
  assert.equal(action({ kind: 'audio', canPreserveAudio: true, canRetryTask: true }), 'preserve-audio');
});

test('task-card primary action prefers recovery, retry, then continuing a successful result', () => {
  assert.equal(action({ canRestoreTaskContext: true, canRetryTask: true }), 'restore');
  assert.equal(action({ canRetryTask: true }), 'retry');
  assert.equal(action({ canContinueTask: true, hasMediaResult: true }), 'continue');
});

test('task-card makes an explicitly retryable video failure actionable before context recovery', () => {
  assert.equal(action({ kind: 'video', canRestoreTaskContext: true, canRetryTask: true }), 'retry');
});

test('task-card primary action opens media, focuses an empty media node, and omits an empty LLM action', () => {
  assert.equal(action({ hasMediaResult: true }), 'open');
  assert.equal(action(), 'focus');
  assert.equal(action({ kind: 'llm' }), null);
});
