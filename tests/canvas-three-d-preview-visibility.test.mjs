import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const visibility = createTsRequire(process.cwd())('./components/canvas/three-d-preview-visibility');

test('canvas 3D preview waits until its stage enters the prefetch viewport and disconnects cleanly', () => {
  const originalObserver = globalThis.IntersectionObserver;
  let callback;
  let options;
  let observedTarget;
  let disconnected = false;
  globalThis.IntersectionObserver = class {
    constructor(onChange, observerOptions) {
      callback = onChange;
      options = observerOptions;
    }
    observe(target) { observedTarget = target; }
    disconnect() { disconnected = true; }
  };

  try {
    const target = {};
    const changes = [];
    const cleanup = visibility.observeCanvasThreeDPreview(target, (visible) => changes.push(visible));
    assert.equal(observedTarget, target);
    assert.equal(options.rootMargin, '280px');
    callback([{ isIntersecting: false }]);
    callback([{ isIntersecting: true }]);
    assert.deepEqual(changes, [false, true]);
    cleanup();
    assert.equal(disconnected, true);
  } finally {
    globalThis.IntersectionObserver = originalObserver;
  }
});

test('canvas 3D preview remains available where IntersectionObserver is unsupported', () => {
  const originalObserver = globalThis.IntersectionObserver;
  delete globalThis.IntersectionObserver;
  try {
    const changes = [];
    const cleanup = visibility.observeCanvasThreeDPreview({}, (visible) => changes.push(visible));
    assert.deepEqual(changes, [true]);
    cleanup();
  } finally {
    if (originalObserver !== undefined) globalThis.IntersectionObserver = originalObserver;
  }
});
