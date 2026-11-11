import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const memory = createTsRequire(process.cwd())('./lib/canvas/agent-dock-memory');

test('Agent dock drafts keep meaningful text and reject empty values', () => {
  assert.equal(memory.normalizeCanvasAgentDockDraft('   '), undefined);
  assert.equal(memory.normalizeCanvasAgentDockDraft('继续整理这张画布'), '继续整理这张画布');
  assert.equal(memory.normalizeCanvasAgentDockDraft(null), undefined);
});

test('Agent dock drafts are bounded before they enter local storage', () => {
  const value = 'x'.repeat(memory.CANVAS_AGENT_DOCK_MAX_DRAFT_LENGTH + 200);
  const normalized = memory.normalizeCanvasAgentDockDraft(value);
  assert.equal(normalized?.length, memory.CANVAS_AGENT_DOCK_MAX_DRAFT_LENGTH);
});
