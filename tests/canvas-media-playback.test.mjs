import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function playbackHarness() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useState(initial) {
      const index = cursor++;
      const state = slots[index] ||= { value: initial };
      return [state.value, (next) => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useCallback(callback) { return callback; },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { dependencies, cleanup: callback() };
      });
    },
  };
  const { useCanvasMediaPlayback } = createTsRequire(process.cwd(), { react })('./components/canvas/useCanvasMediaPlayback');
  return {
    render(url = '/missing') {
      cursor = 0;
      effects = [];
      const result = useCanvasMediaPlayback({ url });
      effects.forEach((effect) => effect());
      return result;
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

function beginProbe(harness, context) {
  let playback = harness.render();
  playback.handleMediaError();
  context.mock.timers.tick(500);
  playback = harness.render();
  playback.handleMediaError();
  context.mock.timers.tick(1000);
  playback = harness.render();
  playback.handleMediaError();
}

for (const [status, message] of [[404, 'missing'], [400, 'missing'], [503, 'temporary']]) {
  test(`media load status ${status} shows the appropriate recovery state`, async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    context.mock.method(globalThis, 'fetch', async () => ({ status }));
    const harness = playbackHarness();
    beginProbe(harness, context);
    await Promise.resolve();
    await Promise.resolve();
    const playback = harness.render();
    assert.equal(playback.mediaUnavailable, true);
    assert.equal(playback.mediaLoadMessage, message);
    harness.unmount();
  });
}

test('a late missing-file probe cannot hide a newly replaced media source', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveProbe;
  let signal;
  context.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return new Promise((resolve) => { resolveProbe = resolve; });
  });
  const harness = playbackHarness();
  beginProbe(harness, context);
  harness.render('/replacement');
  assert.equal(signal.aborted, true);
  resolveProbe({ status: 404 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.render('/replacement').mediaUnavailable, false);
  harness.unmount();
});

test('manual retry cancels an outstanding probe and does not restore its obsolete error', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let rejectProbe;
  let signal;
  context.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => { rejectProbe = reject; });
  });
  const harness = playbackHarness();
  beginProbe(harness, context);
  let stopped = false;
  harness.render().retryMediaLoad({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(signal.aborted, true);
  rejectProbe(new Error('aborted'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.render().mediaUnavailable, false);
  harness.unmount();
});
