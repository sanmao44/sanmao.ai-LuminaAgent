import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/cangyuan-media');

test('3D model changes preserve supported modes and fall back when needed', () => {
  assert.equal(contracts.reconcileCangyuan3DMode('tripo3d', 'multiview-to-3d'), 'image-to-3d');
  assert.equal(contracts.reconcileCangyuan3DMode('tripo3d', 'text-to-3d'), 'text-to-3d');
  assert.equal(contracts.reconcileCangyuan3DMode('tripo3d-p1', 'multiview-to-3d'), 'multiview-to-3d');
  assert.equal(contracts.reconcileCangyuan3DMode('unknown-model', 'multiview-to-3d'), 'multiview-to-3d');
});
