import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function harness({ width = 390, height = 844, visualHeight = height, contentHeight = 600, minHeight = 58 } = {}) {
  const effects = [];
  const react = { useEffect: (effect) => effects.push(effect) };
  const module = createTsRequire(process.cwd(), { react })('./components/useAgentInputAutosize');
  const viewport = Object.assign(new EventTarget(), { height: visualHeight });
  const browser = Object.assign(new EventTarget(), { innerWidth: width, innerHeight: height, visualViewport: viewport });
  const style = { height: '', overflowY: '' };
  const editor = {
    style,
    get offsetHeight() {
      const requested = !style.height || style.height === 'auto' ? contentHeight + 2 : Number.parseFloat(style.height);
      return Math.max(minHeight, Math.min(320, requested));
    },
    get clientHeight() { return this.offsetHeight - 2; },
    get scrollHeight() { return Math.max(contentHeight, this.clientHeight); },
  };
  const ref = { current: editor };
  const withWindow = (callback) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
    try { return callback(); }
    finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else delete globalThis.window;
    }
  };
  return {
    ...module, browser, viewport, style, editor, ref, withWindow,
    mount(active = true, value = '') {
      module.useAgentInputAutosize(ref, value, active);
      return withWindow(() => effects.shift()());
    },
  };
}

test('desktop retains its 320px limit while narrow screens reserve conversation space', () => {
  const { agentInputMaxHeight } = harness();
  assert.equal(agentInputMaxHeight(1440, 900, 400), 320);
  assert.equal(agentInputMaxHeight(780, 844), 190);
  assert.equal(agentInputMaxHeight(390, 844, 350), 105);
  assert.equal(agentInputMaxHeight(390, 100), 58);
  assert.equal(agentInputMaxHeight(390, 400, 800), 120);
  assert.equal(agentInputMaxHeight(390, 0, Number.NaN), 190);
});

test('long mobile input caps its height and enables internal scrolling', () => {
  const fixture = harness();
  const cleanup = fixture.mount();
  assert.equal(fixture.style.height, '190px');
  assert.equal(fixture.style.overflowY, 'auto');
  fixture.withWindow(cleanup);
});

test('wrapped placeholder keeps its natural height without hiding its last line', () => {
  const fixture = harness({ contentHeight: 92 });
  const cleanup = fixture.mount();
  assert.equal(fixture.style.height, '94px');
  assert.equal(fixture.style.overflowY, 'hidden');
  fixture.withWindow(cleanup);
});

test('scrolling uses the actual visible height when CSS has a larger minimum', () => {
  const fixture = harness({ contentHeight: 92, height: 200, minHeight: 94 });
  const cleanup = fixture.mount();
  assert.equal(fixture.style.height, '60px');
  assert.equal(fixture.editor.offsetHeight, 94);
  assert.equal(fixture.style.overflowY, 'hidden');
  fixture.withWindow(cleanup);
});

test('keyboard and window resizing recalculate height and cleanup removes both listeners', () => {
  const fixture = harness();
  const cleanup = fixture.mount();
  fixture.viewport.height = 350;
  fixture.withWindow(() => fixture.viewport.dispatchEvent(new Event('resize')));
  assert.equal(fixture.style.height, '105px');
  fixture.browser.innerWidth = 1024;
  fixture.withWindow(() => fixture.browser.dispatchEvent(new Event('resize')));
  assert.equal(fixture.style.height, '320px');
  fixture.withWindow(cleanup);
  fixture.browser.innerWidth = 390;
  fixture.viewport.height = 200;
  fixture.withWindow(() => {
    fixture.viewport.dispatchEvent(new Event('resize'));
    fixture.browser.dispatchEvent(new Event('resize'));
  });
  assert.equal(fixture.style.height, '320px');
});

test('entering the Agent workspace sizes an editor that was absent on initial render', () => {
  const fixture = harness();
  fixture.ref.current = null;
  assert.equal(fixture.mount(false), undefined);
  assert.equal(fixture.style.height, '');
  fixture.ref.current = fixture.editor;
  const cleanup = fixture.mount(true);
  assert.equal(fixture.style.height, '190px');
  fixture.withWindow(cleanup);
});

test('a shorter edited value restores natural height and removes internal scrolling', () => {
  const fixture = harness({ contentHeight: 36 });
  fixture.style.height = '190px';
  fixture.style.overflowY = 'auto';
  const cleanup = fixture.mount(true, '短内容');
  assert.equal(fixture.style.height, '58px');
  assert.equal(fixture.style.overflowY, 'hidden');
  fixture.withWindow(cleanup);
});
