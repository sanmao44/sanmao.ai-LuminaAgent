import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: application } = await buildLibModules(
  ['apps/api/image-intent-application'],
  'image-intent-application',
);

test('auto image operation bypasses JEV when references do not affect the decision', async () => {
  let calls = 0;
  const judge = async () => { calls += 1; return null; };
  const plain = await application.resolveCanvasImageIntent({
    requestedMode: 'auto', isCanvasRequest: true, prompt: 'A landscape', imageReferenceCount: 0, hasMask: false,
  }, judge);
  const masked = await application.resolveCanvasImageIntent({
    requestedMode: 'auto', isCanvasRequest: true, prompt: 'Edit the marked region', imageReferenceCount: 1, hasMask: true,
  }, judge);
  assert.equal(plain.operation, 'generate');
  assert.equal(masked.operation, 'edit');
  assert.equal(calls, 0);
});

test('high-confidence JEV decision distinguishes reference generation from editing', async () => {
  const results = [];
  for (const operation of ['reference-generate', 'edit']) {
    const result = await application.resolveCanvasImageIntent({
      requestedMode: 'auto', isCanvasRequest: true, prompt: 'Use this source image', imageReferenceCount: 1, hasMask: false,
    }, async (input, signal) => {
      assert.equal(input.prompt, 'Use this source image');
      assert.equal(input.imageReferenceCount, 1);
      assert.equal(signal.aborted, false);
      return { operation, confidence: 'high', modelId: 'jev-runtime' };
    });
    results.push(result);
  }
  assert.deepEqual(results.map(result => result.operation), ['reference-generate', 'edit']);
  assert.ok(results.every(result => result.classifierStatus === 'used' && result.classifierModelId === 'jev-runtime'));
});

test('uncertain, invalid, or unavailable JEV decisions preserve the connected image as a reference', async () => {
  const uncertain = await application.resolveCanvasImageIntent({
    requestedMode: 'auto', isCanvasRequest: true, prompt: 'Make a poster', imageReferenceCount: 2, hasMask: false,
  }, async () => ({ operation: 'edit', confidence: 'low', modelId: 'jev-runtime' }));
  const failed = await application.resolveCanvasImageIntent({
    requestedMode: 'auto', isCanvasRequest: true, prompt: 'Make a poster', imageReferenceCount: 1, hasMask: false,
  }, async () => { throw new Error('classification unavailable'); });
  const nonCanvas = await application.resolveCanvasImageIntent({
    requestedMode: 'auto', isCanvasRequest: false, prompt: 'Make a poster', imageReferenceCount: 1, hasMask: false,
  }, async () => assert.fail('Non-Canvas requests must not invoke the Canvas judge'));
  assert.equal(uncertain.operation, 'reference-generate');
  assert.equal(uncertain.classifierStatus, 'fallback');
  assert.equal(failed.operation, 'reference-generate');
  assert.equal(failed.classifierStatus, 'fallback');
  assert.equal(nonCanvas.operation, 'reference-generate');
  assert.equal(nonCanvas.classifierStatus, 'unavailable');
});

test('explicit operations bypass semantic classification', async () => {
  const judge = () => assert.fail('Explicit operations must bypass JEV');
  for (const operation of ['generate', 'edit', 'reference-generate']) {
    const result = await application.resolveCanvasImageIntent({
      requestedMode: operation, isCanvasRequest: true, prompt: 'A landscape', imageReferenceCount: 1, hasMask: false,
    }, judge);
    assert.equal(result.operation, operation);
  }
});
