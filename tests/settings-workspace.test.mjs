import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const load = (overrides = {}) => createTsRequire(process.cwd(), {
  './SettingsWorkspace.module.css': css,
  ...overrides,
})('./components/settings/SettingsWorkspace').default;
const SettingsWorkspace = load();
const labels = ['偏好', '联网', '存储', '备份', '维护'];

function elements(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...elements(tree.props.children, predicate),
  ];
}

function fixtureSlots() {
  return Object.fromEntries(['preferences', 'network', 'storage', 'backup', 'maintenance'].map(id => [
    id,
    React.createElement('textarea', { 'aria-label': `${id} draft`, defaultValue: `${id} unsaved draft` }),
  ]));
}

function interactionHarness() {
  let state;
  const Component = load({
    react: {
      ...React,
      useId: () => 'settings-fixture',
      useState(initial) {
        if (state === undefined) state = typeof initial === 'function' ? initial() : initial;
        return [state, value => { state = typeof value === 'function' ? value(state) : value; }];
      },
    },
  });
  const props = fixtureSlots();
  return { props, render: () => Component(props) };
}

test('settings initially shows preferences and links every category to its retained section', () => {
  const markup = renderToStaticMarkup(React.createElement(SettingsWorkspace, fixtureSlots()));
  assert.match(markup, /<nav[^>]*aria-label="设置分类"/);
  assert.equal([...markup.matchAll(/aria-pressed="true"/g)].length, 1);
  assert.equal([...markup.matchAll(/<section[^>]*hidden=""/g)].length, 4);
  assert.equal([...markup.matchAll(/<textarea\b/g)].length, 5);
  assert.match(markup, />界面与通知<\/h2>/);
  assert.match(markup, /更改后即时生效/);

  const controlledIds = [...markup.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  const sectionIds = [...markup.matchAll(/<section[^>]*id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(controlledIds, sectionIds);
  assert.equal(new Set(sectionIds).size, 5);
  for (const id of sectionIds) {
    assert.ok(markup.includes(`aria-labelledby="${id}-title"`));
    assert.ok(markup.includes(`<h2 id="${id}-title">`));
  }
});

test('settings instances have independent section identifiers', () => {
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(SettingsWorkspace, fixtureSlots()),
    React.createElement(SettingsWorkspace, fixtureSlots()),
  ));
  const controlledIds = [...markup.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  assert.equal(controlledIds.length, 10);
  assert.equal(new Set(controlledIds).size, 10);
});

test('each navigation click updates the pressed control and reveals only its associated section', () => {
  const harness = interactionHarness();
  for (const label of [...labels.slice(1), labels[0]]) {
    const before = harness.render();
    const button = elements(before, element => element.type === 'button')
      .find(element => element.props.children[0].props.children === label);
    assert.ok(button, `missing ${label} navigation`);
    assert.equal(button.props.type, 'button');
    button.props.onClick();

    const after = harness.render();
    const pressed = elements(after, element => element.type === 'button' && element.props['aria-pressed']);
    const sections = elements(after, element => element.type === 'section');
    const visible = sections.filter(element => !element.props.hidden);
    assert.equal(pressed.length, 1);
    assert.equal(visible.length, 1);
    assert.equal(pressed[0].props.children[0].props.children, label);
    assert.equal(visible[0].props.id, pressed[0].props['aria-controls']);
    assert.equal(sections.length, 5);
  }
});

test('category changes retain draft-bearing slots in stable sections rather than replacing their children', () => {
  const harness = interactionHarness();
  const before = harness.render();
  const originalSections = elements(before, element => element.type === 'section');
  const originalDrafts = elements(before, element => element.type === 'textarea');

  for (const label of labels.slice(1)) {
    const button = elements(harness.render(), element => element.type === 'button')
      .find(element => element.props.children[0].props.children === label);
    button.props.onClick();
    const after = harness.render();
    const sections = elements(after, element => element.type === 'section');
    const drafts = elements(after, element => element.type === 'textarea');
    assert.deepEqual(sections.map(section => [section.key, section.props.id]),
      originalSections.map(section => [section.key, section.props.id]));
    assert.equal(drafts.length, originalDrafts.length);
    drafts.forEach((draft, index) => {
      assert.equal(draft, originalDrafts[index]);
      assert.match(draft.props.defaultValue, /unsaved draft$/);
    });
  }
});
