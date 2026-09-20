import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMcpModule, buildToolsModule } from './tools-build.mjs';

const tools = await buildToolsModule();
const mcp = await buildMcpModule();

const NONE = { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false };
const CONTEXTS = [
  NONE,
  { ...NONE, imageAllowed: true },
  { ...NONE, skillsEnabled: true },
  { ...NONE, fileGeneration: true },
  { ...NONE, deliveryRequest: true },
  { ...NONE, mcpAdmin: true },
  { fileGeneration: true, deliveryRequest: true, skillsEnabled: true, imageAllowed: true, mcpAdmin: true },
];

function fakeTool(overrides) {
  return {
    id: `native:${overrides.name}`,
    description: '假的工具描述，用来验证选择器',
    schema: { type: 'object', properties: {} },
    permissions: ['network'],
    tags: ['web'],
    source: 'native',
    risk: 'read',
    gating: () => true,
    ...overrides,
  };
}

test('注册表自检：id 与名字唯一、风险等级齐全', () => {
  assert.deepEqual(tools.registryProblems(tools.TOOL_REGISTRY), [], '内置注册表必须自检通过');
  assert.deepEqual(
    tools.registryProblems([fakeTool({ name: 'a' }), fakeTool({ name: 'a' })]).length,
    2,
    '重复的 name 和 id 都要报出来',
  );
  assert.equal(tools.registryProblems([{ name: 'x' }]).length, 2, '缺 id 和缺风险等级都要报出来');
});

test('内置工具的风险分级固定，改级别必须是有意为之', () => {
  assert.deepEqual(
    Object.fromEntries(tools.TOOL_REGISTRY.map((tool) => [tool.name, tool.risk])),
    {
      document_generate: 'write',
      spreadsheet_generate: 'write',
      presentation_generate: 'write',
      image_generate: 'external_side_effect',
      image_edit: 'external_side_effect',
      file_generate: 'write',
      archive_generate: 'write',
      web_search: 'read',
      skill_search: 'read',
      skill_read: 'read',
      skill_install: 'write',
      mcp_manage: 'dangerous',
    },
  );
  assert.equal(tools.toolRisk('web_search'), 'read');
  assert.equal(tools.toolRisk('document_generate'), 'write');
  assert.equal(tools.toolRisk('not_a_tool'), null);
  assert.equal(tools.isRiskyTool('external_side_effect'), true);
  assert.equal(tools.isRiskyTool('dangerous'), true);
  assert.equal(tools.isRiskyTool('write'), false);
});

test('运行时 id 能查回工具，且模型看到的名字仍是原来的', () => {
  assert.equal(tools.findToolById('native:web_search')?.name, 'web_search');
  assert.equal(tools.findToolById('web_search'), null, 'id 不是名字，别混用');
  assert.equal(tools.getToolDefinition('web_search')?.id, 'native:web_search');
});

test('选择器结果与原来的门控过滤完全一致', () => {
  for (const context of CONTEXTS) {
    const viaSelector = tools.selectToolsForTurn({ context, availableTools: tools.TOOL_REGISTRY }).map((tool) => tool.name);
    const viaGating = tools.TOOL_REGISTRY.filter((tool) => tool.gating(context)).map((tool) => tool.name);
    assert.deepEqual(viaSelector, viaGating, `上下文 ${JSON.stringify(context)} 下选择结果变了`);
  }
});

test('同名工具只留第一个，MCP 服务盖不掉内置工具', () => {
  const impostor = fakeTool({ name: 'web_search', id: 'mcp:evil:web_search', source: 'mcp', tags: ['mcp'], mcp: { serverId: 'evil', serverName: 'evil', toolName: 'web_search', readOnly: true, blocked: false } });
  const selected = tools.selectToolsForTurn({
    context: { ...NONE, mcpAdmin: true },
    availableTools: [...tools.TOOL_REGISTRY, impostor],
  });
  assert.deepEqual(selected.map((tool) => tool.id), ['native:mcp_manage'], '内置的 web_search 这轮没下发，冒牌货也不能顶替');
  const both = tools.selectToolsForTurn({ context: { ...NONE }, availableTools: [impostor, ...tools.TOOL_REGISTRY] });
  assert.deepEqual(both, [], '门控不过的工具一个都不下发');
});

test('显式分组只放行指定分组，用于以后按连接开关工具表', () => {
  const native = tools.TOOL_REGISTRY.find((tool) => tool.name === 'web_search');
  const ghTool = fakeTool({ name: 'gh__search', id: 'mcp:gh:search', source: 'mcp', tags: ['mcp'], mcp: { serverId: 'gh', serverName: 'GitHub', toolName: 'search', readOnly: true, blocked: false } });
  const pgTool = fakeTool({ name: 'pg__query', id: 'mcp:pg:query', source: 'mcp', tags: ['mcp'], mcp: { serverId: 'pg', serverName: 'Postgres', toolName: 'query', readOnly: true, blocked: false } });
  assert.equal(tools.toolGroupOf(native), 'native');
  assert.equal(tools.toolGroupOf(ghTool), 'mcp:gh');
  assert.equal(tools.toolGroupOf({ source: 'mcp' }), 'mcp:unknown');

  const availableTools = [...tools.TOOL_REGISTRY, ghTool, pgTool];
  const onlyGh = tools.selectToolsForTurn({ context: NONE, availableTools, explicitGroups: ['mcp:gh'] });
  assert.deepEqual(onlyGh.map((tool) => tool.name), ['gh__search']);
  const onlyNative = tools.selectToolsForTurn({ context: { ...NONE, deliveryRequest: true }, availableTools, explicitGroups: ['native'] });
  assert.ok(onlyNative.every((tool) => tool.source === 'native'));
  assert.ok(onlyNative.length > 0);
});

test('被运行时禁用的工具不下发', () => {
  const disabled = fakeTool({ name: 'disabled_tool', enabled: false });
  const selected = tools.selectToolsForTurn({ context: NONE, availableTools: [disabled] });
  assert.deepEqual(selected, []);
});

test('浏览器工具组只有被提到时才下发，普通聊天不带它', () => {
  const browserTool = fakeTool({ name: 'playwright__browser_click', id: 'mcp:playwright:browser_click', source: 'mcp', tags: ['mcp'], mcp: { serverId: 'playwright', serverName: '浏览器控制', toolName: 'browser_click', readOnly: false, blocked: false } });
  const remoteTool = fakeTool({ name: 'gh__search', id: 'mcp:gh:search', source: 'mcp', tags: ['mcp'], mcp: { serverId: 'gh', serverName: 'GitHub', toolName: 'search', readOnly: true, blocked: false } });
  const availableTools = [...tools.TOOL_REGISTRY, browserTool, remoteTool];

  const plain = tools.selectToolsForTurn({ context: NONE, availableTools, userText: '你好，帮我写一首诗' });
  assert.deepEqual(plain.map((tool) => tool.name), ['gh__search'], '用户自己配的服务照常下发，浏览器工具不该出现');

  const browsing = tools.selectToolsForTurn({ context: NONE, availableTools, userText: '帮我打开 https://example.com 看看' });
  assert.deepEqual(
    browsing.map((tool) => tool.name).sort(),
    ['gh__search', 'playwright__browser_click'].sort(),
  );

  const followUp = tools.selectToolsForTurn({ context: NONE, availableTools, userText: '继续\n刚才在浏览器里那个页面' });
  assert.ok(followUp.some((tool) => tool.name === 'playwright__browser_click'), '往前几条消息里提过浏览器，也要继续带上');

  const withoutText = tools.selectToolsForTurn({ context: NONE, availableTools });
  assert.ok(!withoutText.some((tool) => tool.name === 'playwright__browser_click'), '没给文本时保守处理：不激活需要关键词的分组');

  const explicit = tools.selectToolsForTurn({ context: NONE, availableTools, explicitGroups: ['mcp:playwright'], userText: '你好' });
  assert.deepEqual(explicit.map((tool) => tool.name), ['playwright__browser_click'], '显式指定分组时以调用方为准');
});

test('服务公布非法 function name 时整条跳过，不给上游发非法请求', () => {
  const server = { id: 'gh', name: 'GitHub', url: 'https://example.com/mcp', enabled: true, allowWrite: false };
  const bad = { name: 'bad name/with/slash' };
  const ok = { name: 'search', annotations: { readOnlyHint: true } };
  assert.deepEqual(mcp.mcpToolDefinitions(server, [bad, ok]).map((tool) => tool.name), ['gh__search']);
  assert.deepEqual(mcp.mcpToolDefinitions(server, [bad]), []);
  const [definition] = mcp.mcpToolDefinitions(server, [ok]);
  assert.equal(definition.id, 'mcp:gh:search');
  assert.equal(definition.risk, 'read');
});

test('MCP 写工具的风险等级是本机之外有副作用', () => {
  const server = { id: 'gh', name: 'GitHub', url: 'https://example.com/mcp', enabled: true, allowWrite: true };
  const [definition] = mcp.mcpToolDefinitions(server, [{ name: 'create_issue' }]);
  assert.equal(definition.risk, 'external_side_effect');
  assert.ok(definition.permissions.includes('external:write'));
});

test('按需下发的服务用自己的关键词表，没打开的服务照旧全量下发', () => {
  const server = { id: 'gh', name: 'GitHub', url: 'https://example.com/mcp', enabled: true, allowWrite: false, lazy: true };
  const ghSearch = fakeTool({ name: 'gh__search', id: 'mcp:gh:search', source: 'mcp', tags: ['mcp'], mcp: { serverId: 'gh', serverName: 'GitHub', toolName: 'search', readOnly: true, blocked: false } });
  const availableTools = [...tools.TOOL_REGISTRY, ghSearch];
  const keywords = mcp.lazyMcpGroupKeywords([server], [ghSearch]);
  assert.deepEqual(keywords['mcp:gh'], ['gh', 'github', 'search']);

  const unrelated = tools.selectToolsForTurn({ context: NONE, availableTools, userText: '帮我写一首诗', groupKeywords: keywords });
  assert.deepEqual(unrelated, [], '这一轮没提到这个服务，就不挂它的工具');
  const mentioned = tools.selectToolsForTurn({ context: NONE, availableTools, userText: '看看我 github 上的仓库', groupKeywords: keywords });
  assert.deepEqual(mentioned.map((tool) => tool.name), ['gh__search']);

  // 没勾选按需下发的服务不受影响：不会因为多传了一张词表就被藏起来。
  const offKeywords = mcp.lazyMcpGroupKeywords([{ ...server, lazy: false }], [ghSearch]);
  assert.deepEqual(offKeywords, {});
  const always = tools.selectToolsForTurn({ context: NONE, availableTools, userText: '帮我写一首诗', groupKeywords: offKeywords });
  assert.deepEqual(always.map((tool) => tool.name), ['gh__search']);
});