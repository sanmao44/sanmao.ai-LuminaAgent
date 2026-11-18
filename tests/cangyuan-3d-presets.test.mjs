import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const presets = createTsRequire(process.cwd())('./components/cangyuan/three-d-presets');

test('Tripo scenario presets follow documented texture and PBR use cases', () => {
  const scenarios = presets.cangyuanThreeDScenarios('tripo3d');
  assert.deepEqual(scenarios.map(({ id }) => id), ['game', 'product', 'ar', 'concept']);
  assert.deepEqual(presets.findCangyuanThreeDScenario('tripo3d', 'product').tripo, { texture: 'no', pbr: false });
  assert.deepEqual(presets.findCangyuanThreeDScenario('tripo3d', 'ar').tripo, { texture: 'standard', pbr: true });
});

test('Trellis scenario presets only set supported image-to-3D controls', () => {
  assert.deepEqual(presets.findCangyuanThreeDScenario('trellis', 'game').trellis, { meshSimplify: 0.98 });
  assert.deepEqual(presets.findCangyuanThreeDScenario('trellis', 'ar').trellis, { textureSize: '2048' });
  assert.deepEqual(presets.findCangyuanThreeDScenario('trellis', 'concept').trellis, {});
  assert.deepEqual(presets.cangyuanThreeDScenarios('unsupported'), []);
});
