import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const component = await readFile(new URL('../components/AgentMessageError.tsx', import.meta.url), 'utf8');

test('failed Agent reply offers the same retry choices through page callbacks', () => {
  assert.match(page, /import AgentMessageError from '@\/components\/AgentMessageError';/);
  assert.match(page, /onRetryAutomatic: \(\)=>\{/);
  assert.match(component, /切换自动并重试/);
  assert.match(component, /重试当前模型/);
});
