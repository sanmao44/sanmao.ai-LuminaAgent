import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const component = await readFile(new URL('../components/AgentMessageVersionSwitch.tsx', import.meta.url), 'utf8');

test('message version switch keeps version selection at the page boundary', () => {
  assert.match(page, /import AgentMessageVersionSwitch from '@\/components\/AgentMessageVersionSwitch';/);
  assert.match(page, /onPrevious: \(\)=>switchAgentMessageVersion/);
  assert.match(component, /className="message-version-switch"/);
  assert.match(component, /查看上一版/);
  assert.match(component, /查看下一版/);
});
