import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SidebarNavigation declares the stable navigation surfaces', async () => {
  const source = await readFile(new URL('../components/SidebarNavigation.tsx', import.meta.url), 'utf8');
  assert.match(source, /image-tools-nav/);
  assert.match(source, /sidebar-management-nav/);
  assert.match(source, /history-priority/);
});
