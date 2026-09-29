import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const component = await readFile(new URL('../components/AgentQuickActions.tsx', import.meta.url), 'utf8');

test('Agent composer quick actions keep reference and prompt callbacks at the page boundary', () => {
  assert.match(page, /import AgentQuickActions from '@\/components\/AgentQuickActions';/);
  assert.match(page, /onReversePrompt: \(\)=>void reversePromptFromReferences\(\)/);
  assert.match(component, /one-take-duration-control/);
  assert.match(component, /prompt-undo/);
  assert.match(component, /onOptimizePrompt/);
});
