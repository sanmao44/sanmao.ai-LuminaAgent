import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const avatar = await readFile(new URL('../components/AgentMessageAvatar.tsx', import.meta.url), 'utf8');

test('message avatar presentation stays behind a small component boundary', () => {
  assert.match(page, /AgentMessageAvatar, \{/);
  assert.match(avatar, /role: 'assistant' \| 'user'/);
  assert.match(avatar, /<AgentOrb state=\{orbState\} size=\{26\}/);
});
