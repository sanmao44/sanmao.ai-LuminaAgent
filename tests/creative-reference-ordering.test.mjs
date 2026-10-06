import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const references = createTsRequire(process.cwd())('./lib/creative-references');

test('creative reference reorder preserves invalid moves and moves one item immutably', () => {
  const items = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  assert.equal(references.reorderCreativeReferences(items, 1, 1), items);
  assert.equal(references.reorderCreativeReferences(items, -1, 0), items);
  assert.deepEqual(references.reorderCreativeReferences(items, 2, 0).map((item) => item.id), ['three', 'one', 'two']);
  assert.deepEqual(items.map((item) => item.id), ['one', 'two', 'three']);
});
