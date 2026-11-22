import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const groups = createTsRequire(process.cwd())('./components/model-library-group-expansion');
const all = { search: '', provider: 'all', kind: 'all', quick: 'all' };
const initial = () => ({ filterKey: '', overrides: new Map() });
const expanded = new Set();

test('unfiltered groups retain their collapsed default and imported providers open', () => {
  assert.equal(groups.isModelLibraryGroupExpanded('openai', all, expanded, initial()), false);
  assert.equal(groups.isModelLibraryGroupExpanded('openai', all, new Set(['openai']), initial()), true);
  assert.equal(groups.isModelLibraryGroupExpanded('other', all, new Set(['openai']), initial()), false);
});

test('search, quick and provider filters auto-open groups but allow collapsing and reopening', () => {
  for (const filters of [{ ...all, search: 'gpt' }, { ...all, quick: 'enabled' }, { ...all, provider: 'openai' }]) {
    assert.equal(groups.isModelLibraryGroupExpanded('openai', filters, expanded, initial()), true);
    const collapsed = groups.toggleModelLibraryGroupExpansion(initial(), 'openai', filters, expanded);
    assert.equal(groups.isModelLibraryGroupExpanded('openai', filters, expanded, collapsed), false);
    const reopened = groups.toggleModelLibraryGroupExpansion(collapsed, 'openai', filters, expanded);
    assert.equal(groups.isModelLibraryGroupExpanded('openai', filters, expanded, reopened), true);
    assert.equal(groups.isModelLibraryGroupExpanded('openai', filters, expanded, collapsed), false);
  }
});

test('group choices are independent within the same view', () => {
  const filters = { ...all, quick: 'favorite' };
  const collapsed = groups.toggleModelLibraryGroupExpansion(initial(), 'openai', filters, expanded);
  assert.equal(groups.isModelLibraryGroupExpanded('other', filters, expanded, collapsed), true);
  const bothCollapsed = groups.toggleModelLibraryGroupExpansion(collapsed, 'other', filters, expanded);
  assert.equal(groups.isModelLibraryGroupExpanded('openai', filters, expanded, bothCollapsed), false);
  assert.equal(groups.isModelLibraryGroupExpanded('other', filters, expanded, bothCollapsed), false);
});

test('changing any filter restores the new view defaults instead of carrying a collapsed override', () => {
  const filters = { ...all, search: 'gpt' };
  const collapsed = groups.toggleModelLibraryGroupExpansion(initial(), 'openai', filters, expanded);
  for (const next of [
    { ...filters, search: 'claude' },
    { ...filters, provider: 'openai' },
    { ...filters, kind: 'image' },
    { ...filters, quick: 'enabled' },
  ]) {
    assert.equal(groups.isModelLibraryGroupExpanded('openai', next, expanded, collapsed), true);
    const reset = groups.resetModelLibraryGroupExpansion(collapsed, next);
    const returned = groups.resetModelLibraryGroupExpansion(reset, filters);
    assert.equal(groups.isModelLibraryGroupExpanded('openai', filters, expanded, returned), true);
  }
  assert.equal(groups.isModelLibraryGroupExpanded('openai', all, expanded, collapsed), false);
});

test('equivalent search text keeps the explicit choice and kind-only filtering keeps its previous default', () => {
  const filters = { ...all, search: ' GPT ' };
  const collapsed = groups.toggleModelLibraryGroupExpansion(initial(), 'openai', filters, expanded);
  const equivalent = { ...all, search: 'gpt' };
  assert.equal(groups.isModelLibraryGroupExpanded('openai', equivalent, expanded, collapsed), false);
  assert.equal(groups.resetModelLibraryGroupExpansion(collapsed, equivalent), collapsed);
  assert.equal(groups.isModelLibraryGroupExpanded('openai', { ...all, kind: 'image' }, expanded, initial()), false);
});

test('an explicit unfiltered expansion can be collapsed without changing programmatic defaults', () => {
  const imported = new Set(['openai']);
  const opened = groups.toggleModelLibraryGroupExpansion(initial(), 'other', all, imported);
  assert.equal(groups.isModelLibraryGroupExpanded('other', all, imported, opened), true);
  const collapsed = groups.toggleModelLibraryGroupExpansion(opened, 'openai', all, imported);
  assert.equal(groups.isModelLibraryGroupExpanded('openai', all, imported, collapsed), false);
  assert.deepEqual(imported, new Set(['openai']));
});
