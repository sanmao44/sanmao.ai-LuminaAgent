import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBrowserMetricsModule } from './tools-build.mjs';

const { createBrowserMetricsCollector } = await buildBrowserMetricsModule();

test('browser metrics record safe counters without retaining page content', () => {
  const collector = createBrowserMetricsCollector();
  collector.record('browser_snapshot', true, '### Snapshot\n- button [ref=e1]: Search', 12);
  collector.record('browser_click', true, '{"ok":true}', 20);
  collector.record('browser_type', false, 'target not found', 8);

  assert.deepEqual(collector.snapshot(), {
    browserToolCallCount: 3,
    browserToolSuccessCount: 2,
    browserToolFailureCount: 1,
    browserToolDurationMs: 40,
    browserToolResultChars: 65,
    browserToolContextChars: 65,
    browserSnapshotCount: 1,
    browserSnapshotChars: 38,
    browserSnapshotTruncationCount: 0,
    browserSnapshotDuplicateCount: 0,
    browserSnapshotStateChanges: 0,
    browserSnapshotUnchangedCount: 0,
  });
  assert.equal(collector.hasActivity(), true);
  assert.equal(Object.values(collector.snapshot()).some((value) => value === 'Search'), false);
});

test('browser metrics compact identical snapshots while retaining current refs', () => {
  const collector = createBrowserMetricsCollector();
  const first = '### Snapshot\n- textbox [ref=e1]: first\n' + 'unrelated page content '.repeat(20);
  const second = '### Snapshot\n- textbox [ref=e2]: first [truncated]\n' + 'unrelated page content '.repeat(20);
  collector.record('browser_snapshot', true, first, 1);
  const compact = collector.record('browser_snapshot', true, second, 1);
  const metrics = collector.snapshot();
  assert.equal(metrics.browserSnapshotStateChanges, 0);
  assert.equal(metrics.browserSnapshotUnchangedCount, 1);
  assert.equal(metrics.browserSnapshotTruncationCount, 1);
  assert.equal(metrics.browserSnapshotDuplicateCount, 1);
  assert.ok(metrics.browserToolContextChars < metrics.browserToolResultChars);
  assert.match(compact, /ref=e2/);
});
