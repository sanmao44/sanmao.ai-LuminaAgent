import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('hides ordinary Agent deliverable notices from the composer', () => {
  assert.ok(page.includes("activeAgentIntent.deliverable === 'CLARIFY' && agentInput.trim()"));
  assert.ok(page.includes('className: "agent-intent-card clarify-only"'));
  assert.equal(page.includes('Agent 判断 ·'), false);
});

test('keeps the compact clarification choices available', () => {
  assert.ok(page.includes('children: [\n                                                                [\'IMAGE\', \'直接出图\']'));
  assert.ok(page.includes("onClick: ()=>void sendAgent(agentInput, undefined, undefined, value)"));
  assert.ok(page.includes('children: "请确认交付形式"'));
});
