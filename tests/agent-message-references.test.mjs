import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const component = await readFile(new URL('../components/AgentMessageReferences.tsx', import.meta.url), 'utf8');

test('message reference strip delegates URL resolution and preview selection to the page', () => {
  assert.match(page, /import AgentMessageReferences from '@\/components\/AgentMessageReferences';/);
  assert.match(page, /resolveUrl: creativeReferenceUrl/);
  assert.match(component, /className="message-refs"/);
  assert.match(component, /message-ref-index/);
});
