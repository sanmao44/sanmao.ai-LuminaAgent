import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function headerHarness() {
  const require = createRequire(import.meta.url);
  const values = [];
  let index = 0;
  const react = { ...require('react'), useState(initial) {
    const slot = index++;
    if (!(slot in values)) values[slot] = initial;
    return [values[slot], (value) => { values[slot] = value; }];
  }, useRef(initial) { return { current: initial }; }, useEffect() {} };
  const load = createTsRequire(process.cwd(), { react, '@/components/AgentOrb': { default: () => null, busyOrbState: () => 'idle' } });
  const Header = load(path.join(process.cwd(), 'components/canvas/CanvasWorkspaceHeader.tsx')).default;
  const saved = [];
  const a = { id: 'a', name: '第一张画布', createdAt: 100, updatedAt: 100 };
  const b = { ...a, id: 'b', name: '第二张画布' };
  const props = { projects: [a, b], currentProject: a, activeProjectId: 'a', projectMenuOpen: true, projectVersions: [], onSaveProjectName: (...args) => { saved.push(args); return true; } };
  const render = (overrides = {}) => { index = 0; return Header({ ...props, ...overrides }); };
  const find = (tree, predicate) => {
    if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, predicate); if (result) return result; } }
    else if (tree && typeof tree === 'object') {
      if (predicate(tree)) return tree;
      return find(tree.props?.children, predicate);
    }
    return undefined;
  };
  return { a, b, saved, render, find };
}

test('rename saves to the ID captured when editing began even if current project changes', () => {
  const { b, saved, render, find } = headerHarness();
  find(render(), (el) => el.type === 'button' && el.props.children === '重命名').props.onClick();
  find(render(), (el) => el.type === 'input').props.onChange({ target: { value: '新的名字' } });
  find(render({ currentProject: b, activeProjectId: 'b' }), (el) => el.type === 'button' && el.props.children === '保存').props.onClick();
  assert.deepEqual(saved, [['a', '新的名字']]);
  assert.equal(find(render(), (el) => el.type === 'input'), undefined);
});

test('Chinese composition Enter does not save and a failed rename preserves the draft', () => {
  const { render, find, saved } = headerHarness();
  find(render(), (el) => el.type === 'button' && el.props.children === '重命名').props.onClick();
  find(render(), (el) => el.type === 'input').props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true } });
  assert.equal(saved.length, 0);
  find(render({ onSaveProjectName: () => false }), (el) => el.type === 'button' && el.props.children === '保存').props.onClick();
  assert.equal(find(render(), (el) => el.type === 'input').props.value, '第一张画布');
});
