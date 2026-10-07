import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const layout = createTsRequire(process.cwd())('./lib/image-editor/local-image-layout');

test('local image crop layout preserves original and free modes', () => {
  assert.deepEqual(layout.cropSourceRect(1600, 900, layout.LOCAL_IMAGE_ORIGINAL), { x: 0, y: 0, width: 1600, height: 900 });
  assert.deepEqual(layout.cropSourceRect(1600, 900, layout.LOCAL_IMAGE_FREE), { x: 0, y: 0, width: 1600, height: 900 });
});

test('local image crop layout delegates ratio math to the shared image operations', () => {
  assert.deepEqual(layout.cropSourceRect(1600, 900, '1:1'), { x: 350, y: 0, width: 900, height: 900 });
  assert.deepEqual(layout.cropSourceRect(900, 1600, '4:5'), { x: 0, y: 237, width: 900, height: 1125 });
});

test('local image canvas layout expands the shorter edge for canvas mode', () => {
  assert.deepEqual(layout.canvasRectForRatio(1600, 900, '1:1'), { width: 1600, height: 1600 });
  assert.deepEqual(layout.canvasRectForRatio(900, 1600, '16:9'), { width: 2844, height: 1600 });
  assert.deepEqual(layout.canvasRectForRatio(900, 1600, layout.LOCAL_IMAGE_ORIGINAL), { width: 900, height: 1600 });
});
