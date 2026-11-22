import assert from 'node:assert/strict';
import { createElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

let menu;
let input;
const loader = createTsRequire(process.cwd(), {
  './VideoDurationField.css': {},
  './SelectMenu': {
    __esModule: true,
    default: (props) => {
      menu = props;
      return createElement('button', { type: 'button', 'aria-label': props.ariaLabel },
        props.options.find((option) => option.value === props.value)?.label);
    },
  },
  'react/jsx-runtime': {
    ...jsxRuntime,
    jsx: (type, props, key) => {
      if (type === 'input') input = props;
      return jsxRuntime.jsx(type, props, key);
    },
  },
});
const VideoDurationField = loader('./components/VideoDurationField').default;
const longValues = Array.from({ length: 1771 }, (_, index) => index + 30);
function renderField(overrides = {}) {
  menu = undefined;
  input = undefined;
  return renderToStaticMarkup(createElement(VideoDurationField, {
    value: 125, values: longValues, onChange: () => undefined, ...overrides,
  }));
}

test('ordinary video durations preserve the shared picker without a custom input', () => {
  const markup = renderField({ value: 5, values: [3, 4, 5, 6, 8, 10, 12, 15], disabled: true, portalZIndex: 123 });
  assert.deepEqual(menu.options.map((option) => option.value), [3, 4, 5, 6, 8, 10, 12, 15]);
  assert.equal(menu.options[0].label, '3 秒');
  assert.equal(menu.disabled, true);
  assert.equal(menu.portalZIndex, 123);
  assert.equal(input, undefined);
  assert.doesNotMatch(markup, /<select/u);
});

test('long duration ranges show compact Chinese presets and an editable seconds field', () => {
  const markup = renderField();
  assert.ok(menu.options.length <= 11);
  assert.equal(menu.value, 'custom');
  assert.ok(menu.options.some((option) => option.label === '1 分钟'));
  assert.ok(menu.options.some((option) => option.label === '30 分钟'));
  assert.equal(input.value, '125');
  assert.equal(input.type, 'text');
  assert.equal(input.inputMode, 'numeric');
  assert.match(markup, /30 秒–30 分钟 · 当前 2 分 5 秒/u);
  assert.doesNotMatch(markup, /<select|type="number"/u);
});

test('all legal integer durations can be committed without adding every second to the menu', () => {
  const changed = [];
  renderField({ onChange: (value) => changed.push(value) });
  for (const value of [30, 61, 125, 1799, 1800]) input.onBlur({ currentTarget: { value: String(value) } });
  assert.deepEqual(changed, [30, 61, 125, 1799, 1800]);
  menu.onChange('600');
  assert.equal(changed.at(-1), 600);
});

test('invalid or unavailable durations never reach generation settings', () => {
  const changed = [];
  renderField({ onChange: (value) => changed.push(value) });
  for (const value of ['', '29', '1801', '45.5', '-30', 'word']) input.onBlur({ currentTarget: { value } });
  assert.deepEqual(changed, []);

  renderField({ value: 120, values: [30, 60, 120, 1800], onChange: (value) => changed.push(value) });
  input.onBlur({ currentTarget: { value: '61' } });
  assert.deepEqual(changed, []);
});

test('enter commits the custom duration while preventing form submission', () => {
  let changed;
  let prevented = false;
  let stopped = false;
  renderField({ onChange: (value) => { changed = value; } });
  input.onKeyDown({
    key: 'Enter', currentTarget: { value: '745' },
    preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; },
  });
  assert.equal(changed, 745);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});
