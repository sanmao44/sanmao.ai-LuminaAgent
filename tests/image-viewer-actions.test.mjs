import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('image viewer exposes a copy prompt action for the active item', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

  assert.match(page, /className: "copy-prompt-primary"/);
  assert.ok(page.includes('disabled: !viewerItem.prompt?.trim()'));
  assert.ok(page.includes("onClick: ()=>void copyPrompt(viewerItem.prompt || '')"));
  assert.match(page, /name: "copy"/);
  assert.match(page, /"复制提示词"/);
});
