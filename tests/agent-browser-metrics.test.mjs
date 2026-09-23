import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBrowserMetricsModule } from './tools-build.mjs';

const { createBrowserMetricsCollector } = await buildBrowserMetricsModule();

test('browser metrics record safe counters without retaining page content', () => {
  const collector = createBrowserMetricsCollector();
  collector.record('browser_snapshot', true, '### Snapshot\n- button [ref=e1]: Search', 12);
  collector.record('browser_click', true, '{"ok":true}', 20);
  collector.record('browser_snapshot', true, '### Snapshot\n- button [ref=e9]: Search', 15);
  collector.record('browser_type', false, 'target not found', 8);

  assert.deepEqual(collector.snapshot(), {
    browserToolCallCount: 4,
    browserToolSuccessCount: 3,
    browserToolFailureCount: 1,
    browserToolDurationMs: 55,
    browserToolResultChars: 103,
    browserSnapshotCount: 2,
    browserSnapshotChars: 76,
    browserSnapshotTruncationCount: 0,
    browserSnapshotStateChanges: 0,
    browserSnapshotUnchangedCount: 1,
  });
  assert.equal(collector.hasActivity(), true);
  assert.equal(Object.values(collector.snapshot()).some((value) => value === 'Search'), false);
});

test('browser metrics flag failures, truncation markers, and state changes', () => {
  const collector = createBrowserMetricsCollector();
  collector.record('browser_snapshot', true, '### Snapshot\n- textbox: first', 1);
  collector.record('browser_snapshot', true, '### Snapshot\n- textbox: second [truncated]', 1);
  const metrics = collector.snapshot();
  assert.equal(metrics.browserSnapshotStateChanges, 1);
  assert.equal(metrics.browserSnapshotUnchangedCount, 0);
  assert.equal(metrics.browserSnapshotTruncationCount, 1);
});
