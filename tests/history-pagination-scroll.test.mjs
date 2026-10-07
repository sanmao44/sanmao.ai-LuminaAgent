import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('scrolls paged creation records to the top after page changes', () => {
  assert.match(page, /function scrollPaginationToTop\(\)[\s\S]*?window\.scrollTo\(\{[\s\S]*?top: 0,[\s\S]*?left: 0,[\s\S]*?behavior: 'auto'/);
  assert.match(page, /const isPagedRecordsView = section === 'history' && recordTab === 'works' \|\| section === 'logs' && recordTab === 'tasks';/);
  assert.match(page, /scrollPaginationToTop\(\);/);
  assert.match(page, /section,[\s\S]*?recordTab,[\s\S]*?page,[\s\S]*?videoPage,[\s\S]*?logPage/);
});
