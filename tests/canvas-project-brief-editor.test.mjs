import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function editorHarness(brief) {
  const require = createRequire(import.meta.url);
  const hookValues = [];
  let hookIndex = 0;
  const react = {
    ...require('react'),
    useEffect() {},
    useState(initialValue) {
      const slot = hookIndex++;
      if (!(slot in hookValues)) hookValues[slot] = initialValue;
      return [hookValues[slot], (nextValue) => {
        hookValues[slot] = typeof nextValue === 'function' ? nextValue(hookValues[slot]) : nextValue;
      }];
    },
  };
  const SelectMenu = () => null;
  const load = createTsRequire(process.cwd(), {
    react,
    '@/components/SelectMenu': { __esModule: true, default: SelectMenu },
  });
  const Editor = load('./components/canvas/CanvasProjectBriefEditor').default;
  const saved = [];
  const render = () => {
    hookIndex = 0;
    return Editor({ brief, onSave: (value) => { saved.push(value); return true; } });
  };
  const find = (tree, predicate) => {
    if (Array.isArray(tree)) {
      for (const child of tree) {
        const result = find(child, predicate);
        if (result) return result;
      }
    } else if (tree && typeof tree === 'object') {
      if (predicate(tree)) return tree;
      return find(tree.props?.children, predicate);
    }
    return undefined;
  };
  const findAll = (tree, predicate) => {
    if (Array.isArray(tree)) return tree.flatMap((child) => findAll(child, predicate));
    if (!tree || typeof tree !== 'object') return [];
    return [ ...(predicate(tree) ? [tree] : []), ...findAll(tree.props?.children, predicate) ];
  };
  return { Editor, SelectMenu, find, findAll, render, saved };
}

test('project brief fields accept and save text longer than 500 characters', () => {
  const { find, findAll, render, saved } = editorHarness({
    intent: '', style: '', audience: '', constraints: '', deliverable: 'auto',
  });
  const fields = findAll(render(), (element) => element.type === 'textarea');
  const longText = '风'.repeat(1200);

  assert.equal(fields.length, 4);
  assert.ok(fields.every((field) => field.props.maxLength === undefined));
  fields.forEach((field) => field.props.onChange({ target: { value: longText } }));
  find(render(), (element) => element.type === 'form').props.onSubmit({ preventDefault() {} });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].intent.length, longText.length);
  assert.equal(saved[0].style.length, longText.length);
  assert.equal(saved[0].audience.length, longText.length);
  assert.equal(saved[0].constraints.length, longText.length);
});

test('project brief deliverable selection updates the saved project settings', () => {
  const { SelectMenu, find, render, saved } = editorHarness({
    intent: 'spring key visual',
    style: 'natural light',
    audience: 'outdoor users',
    constraints: 'preserve the product appearance',
    deliverable: 'auto',
  });

  const select = find(render(), (element) => element.type === SelectMenu);
  assert.equal(select.props.ariaLabel, '\u4ea4\u4ed8\u76ee\u6807');
  assert.equal(select.props.value, 'auto');
  assert.equal(select.props.options.length, 6);
  assert.equal(select.props.options.find((option) => option.value === 'video').description, '\u4f18\u5148\u4e32\u8054\u811a\u672c\u3001\u753b\u9762\u3001\u914d\u97f3\u548c\u526a\u8f91');

  select.props.onChange('video');
  const updatedTree = render();
  assert.equal(find(updatedTree, (element) => element.type === 'button' && element.props.type === 'submit').props.disabled, false);
  find(updatedTree, (element) => element.type === 'form').props.onSubmit({ preventDefault() {} });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].deliverable, 'video');
});
