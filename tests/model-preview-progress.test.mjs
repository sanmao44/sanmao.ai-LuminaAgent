import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const progress = createTsRequire(process.cwd())('./components/cangyuan/three-d-preview-progress');

test('model preview progress reports bounded download percentage and byte counts', () => {
  assert.deepEqual(progress.modelPreviewDownloadProgress(512, 1024), {
    loadedBytes: 512, totalBytes: 1024, percentage: 50,
  });
  assert.deepEqual(progress.modelPreviewDownloadProgress(2048, 1024), {
    loadedBytes: 2048, totalBytes: 1024, percentage: 100,
  });
  assert.deepEqual(progress.modelPreviewDownloadProgress(-1, 0), {
    loadedBytes: 0, totalBytes: null, percentage: null,
  });
});

test('model preview labels loaded bytes in readable MiB units', () => {
  assert.equal(progress.modelPreviewBytesLabel(1024 * 1024), '1.0 MiB');
});
