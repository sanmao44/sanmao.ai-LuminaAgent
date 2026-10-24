import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMcpModule, buildToolLoopModule, buildToolPolicyModule, buildToolsModule } from './tools-build.mjs';

const tools = await buildToolsModule();
const mcp = await buildMcpModule();
const policy = await buildToolPolicyModule();
const loop = await buildToolLoopModule();
const GATING = { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false, videoDownload: false };

test('执行类别由注册表标签推导，MCP 按来源归类', () => {
  assert.equal(tools.toolExecutionKind('web_search'), 'web');
  assert.equal(tools.toolExecutionKind('file_generate'), 'file');
  assert.equal(tools.toolExecutionKind('document_generate'), 'artifact');
  assert.equal(tools.toolExecutionKind('archive_generate'), 'artifact');
  assert.equal(tools.toolExecutionKind('image_edit'), 'image');
  assert.equal(tools.toolExecutionKind('skill_search'), 'skill');
  assert.equal(tools.toolExecutionKind('gh__search', [{ name: 'gh__search', tags: ['mcp'], source: 'mcp' }]), 'mcp');
  assert.equal(tools.toolExecutionKind('gh__search'), null);
  assert.equal(tools.kindForTool({ tags: ['artifact', 'mcp'], source: 'mcp' }), 'mcp');
  assert.equal(tools.kindForTool({ tags: [], source: 'native' }), null);
});

test('MCP 写工具执行前由统一策略拒绝，读工具可继续执行', () => {
  const readTool = mcp.mcpToolDefinitions({ id: 'gh', name: 'GitHub', url: 'https://example.com/mcp', enabled: true, allowWrite: false }, [{ name: 'search', annotations: { readOnlyHint: true } }]);
  const writeTool = mcp.mcpToolDefinitions({ id: 'gh', name: 'GitHub', url: 'https://example.com/mcp', enabled: true, allowWrite: false }, [{ name: 'create_issue' }]);
  assert.equal(policy.resolveToolPolicy('gh__search', GATING, readTool).allowed, true);
  assert.equal(policy.resolveToolPolicy('gh__create_issue', GATING, writeTool).allowed, false);
});

test('取消时工具循环原样停止，不执行副作用', async () => {
  const controller = new AbortController();
  controller.abort(new Error('AGENT_CANCELLED'));
  let modelCalls = 0;
  let toolCalls = 0;
  const outcome = await loop.runToolLoop({
    messages: [], signal: controller.signal,
    callModel: async () => { modelCalls += 1; return { tool_calls: [{ function: { name: 'write' } }] }; },
    runCalls: async () => { toolCalls += 1; return []; },
  });
  assert.equal(outcome.stopReason, 'signal');
  assert.equal(modelCalls, 0);
  assert.equal(toolCalls, 0);
});

test('参数不是合法 JSON 时按空对象兜底，不打断整轮请求', () => {
  assert.deepEqual(tools.parseToolArguments(undefined), {});
  assert.deepEqual(tools.parseToolArguments(''), {});
  assert.deepEqual(tools.parseToolArguments('{bad json'), {});
  assert.deepEqual(tools.parseToolArguments('{"query":"hello"}'), { query: 'hello' });
});

test('未注册的工具名不会落到任何执行类别', () => {
  assert.equal(tools.toolExecutionKind('not_a_tool'), null);
  assert.equal(tools.toolExecutionKind('gh__search'), null);
});

test('工具循环补轮会把结果带回模型并保留 reasoning 字段', async () => {
  const messages = [];
  const seen = [];
  const outcome = await loop.runToolLoop({
    messages,
    callModel: async ({ step }) => step === 0
      ? { content: null, reasoning_content: '先查一下', tool_calls: [{ id: 'a', function: { name: 'search', arguments: '{}' } }] }
      : { content: '完成', tool_calls: [] },
    runCalls: async (calls) => { seen.push(...calls.map((call) => call.function.name)); return [{ role: 'tool', tool_call_id: 'a', content: '{"ok":true}' }]; },
  });
  assert.equal(outcome.text, '完成');
  assert.deepEqual(seen, ['search']);
  assert.equal(messages[0].reasoning_content, '先查一下');
  assert.equal(messages[1].tool_call_id, 'a');
});
