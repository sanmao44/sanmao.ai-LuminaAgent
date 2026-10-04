import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());

test('tool runtime leaves image execution disabled when the capability gate is false', async () => {
  const { createToolExecutionAdapter } = load('./packages/tool-runtime/adapter');
  const state = { generatedFiles: [], mcpToolCallCount: 0, mcpTurnBudget: 1000, usedMcpTools: [], browserUses: [], browserRecoveryNeeded: false, generated: [], browserDownloadCount: 0, stalledMcpReason: '', batchItems: [], generations: [], recentPageText: '', skillToolCalls: 0, skillInstalls: 0, generatedArtifactCount: 0, usedSkills: [] };
  const execute = createToolExecutionAdapter({ state, imageToolsAllowed: false, toolExecutionKind: () => 'image', agentToolProgress: () => null, reportToolProgress: () => {} });
  const result = await execute({ call: { id: 'image-1', function: { name: 'image_generate', arguments: '{}' } }, policy: { allowed: true }, args: {} });
  assert.deepEqual(result.results, []);
  assert.deepEqual(state.generated, []);
});
