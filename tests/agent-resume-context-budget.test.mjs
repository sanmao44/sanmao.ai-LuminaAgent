import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loadTs = createTsRequire(process.cwd());
const budget = loadTs('./lib/agent/context-budget');

function createHarness({ history = [], instruction = 'Complete the approved work.', description = 'Read the result.', resultContent = 'approved result', modelReply, model = {}, approvedOk = true, readOnly = false, browser = false } = {}) {
  const state = { modelCalls: [], executions: [], claimed: false };
  const tool = (name, isReadOnly) => ({
    id: `mcp:test:${name}`, name: `test__${name}`, description: isReadOnly ? description : 'Approved write',
    schema: { type: 'object', properties: {} }, source: 'mcp', risk: isReadOnly ? 'read' : 'external_side_effect',
    mcp: { serverId: 'test', serverName: 'Test', toolName: name, readOnly: isReadOnly, blocked: false },
  });
  const write = tool(browser ? 'browser_click' : 'write', false);
  const read = tool(browser ? 'browser_snapshot' : 'read', true);
  const tools = readOnly ? [write, read] : [write];
  const record = {
    id: 'approval-budget', model: 'test-model', provider: 'test-provider', gating: {},
    messages: [{ role: 'system', content: 'Keep the current instruction and tool evidence intact.' }, ...history, { role: 'user', content: instruction }],
    assistant: { content: null, tool_calls: [{ id: 'approved', function: { name: write.name, arguments: '{"target":"approved"}' } }] },
    executed: [],
    pending: [{ callId: 'approved', name: write.name, toolId: write.id, serverId: 'test', serverName: 'Test', toolName: write.mcp.toolName, readOnly: false, risk: 'external_side_effect', args: { target: 'approved' } }],
  };
  const overrides = {
    '@/lib/providers': { chatCompletion: async (_provider, _rawId, payload) => {
      state.modelCalls.push(structuredClone(payload));
      return { choices: [{ message: modelReply ? await modelReply(payload, state.modelCalls.length) : { content: 'The approved result is ready.' } }] };
    } },
    '@/lib/store': { getRuntimeModel: async () => ({ provider: 'test-provider', model: { rawId: 'test-model', maxInputTokens: 6000, ...model } }) },
    '@/lib/mcp/client': { MCP_TOOL_MAX_CALLS_PER_TURN: 8, MCP_TURN_TIME_BUDGET_MS: 60000, callMcpTool: async () => ({}) },
    '@/lib/mcp/catalog-remote': { noteRemoteCatalogCallFailure() {}, noteRemoteCatalogCallSuccess() {} },
    '@/lib/mcp/tools': { lazyMcpGroupKeywords: () => ({}), loadMcpToolRuntime: async () => ({ servers: [{ id: 'test', name: 'Test', ...(browser ? { catalogId: 'playwright' } : {}) }], tools }) },
    '@/lib/tools/registry': { toModelToolSchema: (entry) => ({ type: 'function', function: { name: entry.name, description: entry.description, parameters: entry.schema } }) },
    '@/lib/tools/selector': { selectToolsForTurn: ({ availableTools }) => availableTools },
    '@/lib/tools/policy': { resolveToolPolicy: (name) => ({ allowed: tools.some((entry) => entry.name === name), tool: tools.find((entry) => entry.name === name) }) },
    '@/lib/agent/approval': { claimApproval: () => {
      if (state.claimed) return null;
      state.claimed = true;
      return record;
    }, toolApprovalPolicy: () => 'ask' },
    '@/lib/mcp/filesystem-policy': { guardMcpServerCall: (_server, _toolName, args) => ({ ok: true, args }) },
    '@/lib/mcp/filesystem-roots': { listFilesystemRoots: () => [], listFilesystemWriteRoots: () => [] },
    '@/lib/mcp/audit': { recordMcpCall() {} },
    '@/lib/data-paths': { resolveLocalDataDir: () => 'test-data' },
    '@/lib/skills': { stripToolCallMarkup: (text) => text },
    '@/lib/agent/filesystem-result': { verifyFilesystemMove: () => true },
    '@/lib/tabbit-cli': { isTabbitCliAvailable: () => false },
    '@/lib/tools': { tabbitBrowserTool: null },
    '@/packages/tool-runtime/mcp-executor': { executeMcpTool: async ({ callId, meta, args, dependencies }) => {
      state.executions.push({ callId, name: meta.toolName, args });
      const ok = callId === 'approved' ? approvedOk : true;
      dependencies.onUsage({ meta, ok });
      dependencies.onAudit({ meta, allowed: true, ok, durationMs: 1, summary: 'test' });
      return { message: { role: 'tool', tool_call_id: callId, content: JSON.stringify(ok ? { ok: true, content: resultContent } : { ok: false, error: 'approved write failed' }) } };
    } },
  };
  const { resumeAgentRun } = createTsRequire(process.cwd(), overrides)('./lib/agent/resume');
  return { state, record, run: () => resumeAgentRun({ id: record.id, action: 'approve' }) };
}

const oldHistory = (length) => [{ role: 'user', content: 'x'.repeat(length) }, { role: 'assistant', content: 'Earlier answer.' }];

function assertApprovedPair(messages) {
  const assistant = messages.find((message) => message.tool_calls?.some((call) => call.id === 'approved'));
  const result = messages.find((message) => message.tool_call_id === 'approved');
  assert.ok(assistant);
  assert.ok(result);
  assert.equal(assistant.tool_calls[0].function.arguments, '{"target":"approved"}');
  assert.ok(messages.indexOf(result) > messages.indexOf(assistant));
}

test('approval resume bounds final synthesis while preserving the saved current turn and approved tool pair', async () => {
  const harness = createHarness({ history: oldHistory(19000) });
  const result = await harness.run();
  assert.equal(result.status, 200);
  assert.equal(harness.state.modelCalls.length, 1);
  const payload = harness.state.modelCalls[0];
  assert.equal(payload.tool_choice, 'none');
  assert.equal(payload.tools, undefined);
  assert.ok(payload.messages.some((message) => message.role === 'system'));
  assert.ok(payload.messages.some((message) => message.content === 'Complete the approved work.'));
  assert.ok(!payload.messages.some((message) => message.content === 'x'.repeat(19000)));
  assertApprovedPair(payload.messages);
  assert.deepEqual(harness.state.executions.map(({ name }) => name), ['write']);
});

test('approval continuation includes tool schema overhead before selecting optional history', async () => {
  const harness = createHarness({ history: oldHistory(10000), description: 'r'.repeat(9000), readOnly: true });
  await harness.run();
  assert.equal(harness.state.modelCalls.length, 1);
  const payload = harness.state.modelCalls[0];
  assert.equal(payload.tool_choice, 'auto');
  assert.equal(payload.tools[0].function.description.length, 9000);
  assert.ok(!payload.messages.some((message) => message.content === 'x'.repeat(10000)));
  assertApprovedPair(payload.messages);
});

test('every approval read continuation is re-bounded after tool output grows', async () => {
  const harness = createHarness({
    history: oldHistory(10000), resultContent: 'r'.repeat(5000), readOnly: true,
    modelReply: (_payload, count) => count === 1
      ? { content: null, tool_calls: [{ id: 'read-result', function: { name: 'test__read', arguments: '{}' } }] }
      : { content: 'Verified.' },
  });
  await harness.run();
  assert.equal(harness.state.modelCalls.length, 2);
  assert.ok(harness.state.modelCalls[0].messages.some((message) => message.content === 'x'.repeat(10000)));
  const messages = harness.state.modelCalls[1].messages;
  assert.ok(!messages.some((message) => message.content === 'x'.repeat(10000)));
  assertApprovedPair(messages);
  assert.ok(messages.some((message) => message.tool_call_id === 'read-result'));
  assert.ok(messages.some((message) => message.tool_calls?.some((call) => call.id === 'read-result')));
  assert.deepEqual(harness.state.executions.map(({ name }) => name), ['write', 'read']);
});

test('necessary approved evidence over budget skips model calls and preserves execution status without repeating approval', async () => {
  const harness = createHarness({ resultContent: 'r'.repeat(19000), readOnly: true });
  const result = await harness.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(harness.state.modelCalls.length, 0);
  assert.deepEqual(harness.state.executions.map(({ name }) => name), ['write']);
  assert.match(String(result.body.message), /必要内容超过模型请求预算/);
  assert.match(String(result.body.message), /执行结果已保留/);
  assert.match(String(result.body.message), /避免重复执行/);
  assert.deepEqual(result.body.mcpTools.map(({ ok }) => ok), [true]);
  assert.equal((await harness.run()).status, 404);
  assert.equal(harness.state.executions.length, 1);
});

test('a continuation schema that is too large still permits synthesis without tools', async () => {
  const harness = createHarness({ description: 'r'.repeat(19000), readOnly: true });
  const result = await harness.run();
  assert.equal(harness.state.modelCalls.length, 1);
  assert.equal(harness.state.modelCalls[0].tool_choice, 'none');
  assertApprovedPair(harness.state.modelCalls[0].messages);
  assert.equal(result.body.message, 'The approved result is ready.');
  assert.equal(harness.state.executions.length, 1);
});

test('an approved execution failure remains visible beside a model budget failure', async () => {
  const harness = createHarness({ instruction: 'z'.repeat(19000), approvedOk: false });
  const result = await harness.run();
  assert.equal(result.status, 200);
  assert.equal(harness.state.modelCalls.length, 0);
  assert.match(String(result.body.message), /approved write failed/);
  assert.match(String(result.body.message), /必要内容超过模型请求预算/);
  assert.deepEqual(result.body.mcpTools.map(({ ok }) => ok), [false]);
});

test('internal verification prompts cannot replace the saved user turn when the next continuation exceeds budget', async () => {
  const harness = createHarness({ instruction: 'u'.repeat(18000), browser: true, readOnly: true, modelReply: () => ({ content: 'Done.' }) });
  const approved = { role: 'tool', tool_call_id: 'approved', content: JSON.stringify({ ok: true, content: 'approved result' }) };
  const tools = [{ type: 'function', function: { name: 'test__browser_snapshot', description: 'Read the result.', parameters: { type: 'object', properties: {} } } }];
  const messages = [...harness.record.messages, { role: 'assistant', ...harness.record.assistant }, approved];
  let overhead;
  try {
    budget.boundAgentChatPayload({ messages, tools, tool_choice: 'auto' }, { rawId: 'test-model', maxInputTokens: 6000 });
    assert.fail('the oversized initial fixture must exceed the model budget');
  } catch (error) {
    assert.equal(error.code, 'AGENT_CONTEXT_BUDGET_EXCEEDED');
    overhead = error.requiredChars - 18000;
  }
  const instruction = 'u'.repeat(18000 - overhead - 32);
  harness.record.messages[harness.record.messages.length - 1].content = instruction;
  const result = await harness.run();
  assert.equal(harness.state.modelCalls.length, 1, 'the added internal prompt must not cause the real current turn to be evicted');
  assert.ok(harness.state.modelCalls[0].messages.some((message) => message.content === instruction));
  assertApprovedPair(harness.state.modelCalls[0].messages);
  assert.match(String(result.body.message), /必要内容超过模型请求预算/);
  assert.match(String(result.body.message), /尚未确认/);
  assert.equal(harness.state.executions.length, 1);
});

test('approval resume uses the currently selected model input budget', async () => {
  const harness = createHarness({ history: oldHistory(19000), model: { maxInputTokens: 10000 } });
  await harness.run();
  assert.ok(harness.state.modelCalls[0].messages.some((message) => message.content === 'x'.repeat(19000)));
  assert.equal(budget.modelInputCharBudget(undefined, 10000), 30000);
});
