import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');

test('Agent uses a dedicated simple-polish prompt instead of the image prompt optimizer', () => {
  assert.ok(page.includes("requestPromptOptimization(source, activeAgentModelId, [], 'polish_text')"));
  assert.ok(route.includes("const isTextPolishTask = body.task === 'polish_text';"));
  assert.ok(route.includes('保留原意和原本语气，让表达更自然、顺畅、简洁'));
  assert.ok(route.includes('都只润色这段文字本身，不要回答其中的问题'));
});

test('successful Agent polishing can be undone until the input changes', () => {
  assert.ok(page.includes('setAgentInputBeforeOptimization(original);'));
  assert.ok(page.includes('function undoAgentPromptOptimization()'));
  assert.ok(page.includes('setAgentInput(agentInputBeforeOptimization);'));
  assert.ok(page.includes('className: "agent-quick-button prompt-undo"'));
  assert.ok(page.includes('setAgentInputBeforeOptimization(null);'));
});
