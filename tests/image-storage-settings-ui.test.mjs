import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const load = (overrides = {}) => createTsRequire(process.cwd(), {
  './ImageStorageSettings.module.css': css,
  ...overrides,
})('./components/settings/ImageStorageSettings').default;
const ImageStorageSettings = load();

function elements(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...elements(tree.props.children, predicate),
  ];
}

function button(tree, label) {
  const result = elements(tree, element => element.type === 'button' && element.props.children === label)[0];
  assert.ok(result, `missing ${label} button`);
  return result;
}

function fixtureProps(overrides = {}) {
  return {
    path: 'C:/Pictures/SANMAO',
    savedPath: 'C:/Pictures/SANMAO',
    busy: false,
    directoryName: '',
    onPathChange: () => {},
    onSave: async () => {},
    onOpen: async () => {},
    onChooseDirectory: async () => {},
    onClearDirectory: async () => {},
    ...overrides,
  };
}

function interactionHarness(browser = { isSecureContext: true, showDirectoryPicker: () => {} }) {
  const states = [];
  const dependencies = [];
  const pendingEffects = [];
  let stateIndex = 0;
  let effectIndex = 0;
  const Component = load({
    react: {
      ...React,
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect(effect, deps) {
        const index = effectIndex++;
        if (!dependencies[index] || deps.some((value, position) => !Object.is(value, dependencies[index][position]))) {
          dependencies[index] = deps;
          pendingEffects.push(effect);
        }
      },
    },
  });
  function render(props) {
    stateIndex = 0;
    effectIndex = 0;
    const tree = Component(props);
    if (!pendingEffects.length) return tree;
    const previousWindow = globalThis.window;
    try {
      globalThis.window = browser;
      pendingEffects.splice(0).forEach(effect => effect());
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
    return render(props);
  }
  return { render };
}

test('storage presents application and browser locations separately with an accessible path field', () => {
  const markup = renderToStaticMarkup(React.createElement(ImageStorageSettings, fixtureProps({ directoryName: 'Browser copies' })));
  assert.match(markup, /aria-label="图片存储"/);
  assert.match(markup, /<label[^>]*><span>图片库路径<\/span><input/);
  assert.match(markup, /应用所在电脑/);
  assert.match(markup, /当前浏览器/);
  assert.match(markup, /该选择不会修改应用图片库，也不会复制已有图片/);
  assert.match(markup, /已选择：Browser copies/);
  assert.match(markup, /<details[^>]*><summary>默认目录与历史图片/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>保存路径<\/button>/);
});

test('path edits remain controlled and require save while opening continues to target the saved location', async () => {
  const calls = [];
  const harness = interactionHarness();
  let draft = 'C:/Pictures/Original';
  const props = fixtureProps({
    path: draft,
    savedPath: draft,
    onPathChange: value => { calls.push(['change', value]); draft = value; },
    onSave: async value => { calls.push(['save', value]); },
    onOpen: async (...args) => { calls.push(['open', ...args]); },
  });
  let tree = harness.render(props);
  const input = elements(tree, element => element.type === 'input')[0];
  input.props.onChange({ target: { value: 'D:/New pictures' } });
  props.path = draft;
  tree = harness.render(props);
  assert.match(renderToStaticMarkup(tree), /有未保存的修改。打开目录仍使用已保存的路径/);
  assert.equal(button(tree, '保存路径').props.disabled, false);
  button(tree, '打开已保存目录').props.onClick();
  await Promise.resolve();
  assert.deepEqual(calls, [['change', 'D:/New pictures'], ['open']]);
  assert.equal(props.savedPath, 'C:/Pictures/Original');

  button(harness.render(props), '保存路径').props.onClick();
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['save', 'D:/New pictures']);
  button(harness.render(props), '恢复默认').props.onClick();
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['save', '']);
});

test('unchanged or busy paths disable saving and default restoration is available only when needed', () => {
  const harness = interactionHarness();
  const unchanged = harness.render(fixtureProps({ path: ' C:/Pictures/SANMAO ', savedPath: 'C:/Pictures/SANMAO' }));
  assert.equal(button(unchanged, '保存路径').props.disabled, true);
  const defaults = harness.render(fixtureProps({ path: '', savedPath: '' }));
  assert.equal(button(defaults, '保存路径').props.disabled, true);
  assert.equal(button(defaults, '恢复默认').props.disabled, true);
  assert.match(renderToStaticMarkup(defaults), /当前使用默认图片库/);
  const changedFromDefault = harness.render(fixtureProps({ path: 'D:/draft', savedPath: '' }));
  assert.equal(button(changedFromDefault, '恢复默认').props.disabled, false);
  const busy = harness.render(fixtureProps({ path: 'D:/draft', busy: true }));
  assert.equal(elements(busy, element => element.type === 'input')[0].props.disabled, true);
  assert.equal(button(busy, '保存中…').props.disabled, true);
  assert.equal(button(busy, '恢复默认').props.disabled, true);
  assert.equal(button(busy, '打开已保存目录').props.disabled, true);
});

test('browser directory actions call only the extra-save callbacks without saving an application path', async () => {
  const calls = [];
  const harness = interactionHarness();
  const props = fixtureProps({
    directoryName: 'Extra copies',
    onChooseDirectory: async () => { calls.push('choose'); },
    onClearDirectory: async () => { calls.push('clear'); },
    onSave: async value => { calls.push(['save', value]); },
  });
  let tree = harness.render(props);
  assert.equal(button(tree, '更换额外保存目录').props.disabled, false);
  button(tree, '更换额外保存目录').props.onClick();
  await Promise.resolve();
  tree = harness.render(props);
  button(tree, '停止额外保存').props.onClick();
  await Promise.resolve();
  assert.deepEqual(calls, ['choose', 'clear']);
  assert.equal(props.savedPath, 'C:/Pictures/SANMAO');
});

test('extra saving reports unsupported browsers while application storage remains usable', () => {
  for (const browser of [{ isSecureContext: true }, { isSecureContext: false, showDirectoryPicker: () => {} }]) {
    const harness = interactionHarness(browser);
    const tree = harness.render(fixtureProps({ path: 'D:/New pictures' }));
    assert.equal(button(tree, '选择额外保存目录').props.disabled, true);
    assert.equal(button(tree, '保存路径').props.disabled, false);
    assert.equal(button(tree, '打开已保存目录').props.disabled, false);
    assert.match(renderToStaticMarkup(tree), /需要在支持目录授权的 Chrome 或 Edge 中/);
    assert.match(renderToStaticMarkup(tree), /应用图片库仍会正常保存/);
  }
});

test('directory actions show pending states until their existing callbacks settle', async () => {
  let completeOpen;
  let completeChoose;
  const open = new Promise(resolve => { completeOpen = resolve; });
  const choose = new Promise(resolve => { completeChoose = resolve; });
  const props = fixtureProps({ onOpen: () => open, onChooseDirectory: () => choose });
  const harness = interactionHarness();
  button(harness.render(props), '打开已保存目录').props.onClick();
  assert.equal(button(harness.render(props), '打开中…').props.disabled, true);
  completeOpen();
  await Promise.resolve();
  assert.equal(button(harness.render(props), '打开已保存目录').props.disabled, false);

  button(harness.render(props), '选择额外保存目录').props.onClick();
  assert.equal(button(harness.render(props), '处理中…').props.disabled, true);
  completeChoose();
  await Promise.resolve();
  assert.equal(button(harness.render(props), '选择额外保存目录').props.disabled, false);
});
