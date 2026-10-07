import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextBudgetModule } from './tools-build.mjs';

const budget = await buildContextBudgetModule();

test('context budget keeps assistant tool calls paired with their results', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', function: { name: 'read' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'large result' },
    { role: 'user', content: 'new' },
  ];
  const bounded = budget.boundAgentContext(messages, 24);
  const assistantIndex = bounded.findIndex((message) => message.role === 'assistant');
  assert.ok(assistantIndex >= 0);
  assert.equal(bounded[assistantIndex + 1]?.role, 'tool');
  assert.equal(bounded[assistantIndex + 1]?.tool_call_id, 'call-1');
});

test('model budget reserves output and remains conservative', () => {
  assert.equal(budget.modelInputCharBudget(32768, undefined, 4096), 86016);
  assert.ok(budget.modelInputCharBudget(undefined, undefined, undefined) <= 600000);
});
