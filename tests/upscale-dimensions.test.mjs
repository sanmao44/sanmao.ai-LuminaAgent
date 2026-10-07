import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const upscale = createTsRequire(process.cwd())('./lib/canvas/upscale');

test('upscale target dimensions keep cloud and SeedVR projections compatible', () => {
  const source = { width: 1600, height: 900 };
  assert.deepEqual(upscale.upscaleTargetDimensions(source, 2, { provider: 'tencent-ci' }, '4K'), { width: 3200, height: 1800 });
  assert.deepEqual(upscale.upscaleTargetDimensions(source, 2, { provider: 'local' }, '2K'), { width: 2048, height: 1152 });
  assert.deepEqual(upscale.upscaleTargetDimensions(source, 2, undefined, 'auto'), { width: 3200, height: 1800 });
});
