import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createTsRequire } from './ts-require.mjs';
const loadTs = createTsRequire(path.resolve('lib'));
const { discoverMcpForRequest } = loadTs('./mcp/discovery');
const { mcpServersForTurn, lazyMcpGroupKeywords } = loadTs('./mcp/tools');
const { selectToolsForTurn } = loadTs('./tools/selector');
const { toolOutcomeText } = loadTs('./agent/tool-outcome');
const servers = [
  { id: 'custom-a', name: 'Desktop', enabled: true, lazy: true, allowWrite: false },
  { id: 'custom-b', name: 'Inventory', enabled: true, lazy: true, allowWrite: true },
  { id: 'disabled', name: 'Disabled', enabled: false },
];
const definitions = servers.slice(0, 2).map((server) => ({
  id: `mcp:${server.id}:action`, name: `${server.id}__action`, description: server.id === 'custom-a' ? 'Launch applications and manage windows' : 'Query warehouse inventory',
  source: 'mcp', gating: () => true, schema: { type: 'object' },
  mcp: { serverId: server.id, toolName: 'action', serverName: server.name, readOnly: false, blocked: !server.allowWrite },
}));
const load = async ({ servers: selected }) => ({
  servers: selected, tools: definitions.filter((tool) => selected.some((server) => server.id === tool.mcp.serverId)),
});

test('discovers every enabled lazy server by actual capabilities without executing tools', async () => {
  let selections = 0;
  const result = await discoverMcpForRequest({ servers, load, select: async (capabilities) => {
    selections++;
    assert.equal(capabilities.length, 2);
    assert.equal(capabilities[0].tools[0].blocked, true);
    assert.match(capabilities[1].tools[0].description, /inventory/);
    return ['custom-a'];
  } });
  assert.equal(selections, 1);
  const selected = mcpServersForTurn(servers, '打开设备管理器', result.serverIds);
  assert.deepEqual(selected.map((server) => server.id), ['custom-a']);
  const tools = selectToolsForTurn({
    context: {}, availableTools: definitions.filter((tool) => tool.mcp.serverId === 'custom-a'),
    userText: `打开设备管理器 ${result.serverIds.join(' ')}`,
    groupKeywords: lazyMcpGroupKeywords(selected, definitions),
  });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].mcp.blocked, true, 'discovery must not grant write permission');
});

test('selection validates IDs, empty selection, and unavailable services', async () => {
  for (const result of [['disabled'], ['invented'], 'custom-a', [1]]) {
    await assert.rejects(discoverMcpForRequest({ servers, load, select: async () => result }), /无效/);
  }
  assert.deepEqual((await discoverMcpForRequest({ servers, load, select: async () => [] })).serverIds, []);
  const unavailable = await discoverMcpForRequest({
    servers, load: async ({ servers }) => ({ servers, tools: [] }),
    select: async () => { throw new Error('should not select'); },
  });
  assert.deepEqual(unavailable.unavailable, ['Desktop', 'Inventory']);
});

test('a failed connector is treated as unavailable while healthy connectors remain discoverable', async () => {
  const result = await discoverMcpForRequest({
    servers,
    load: async ({ servers: selected }) => {
      if (selected[0].id === 'custom-a') throw new Error('connector offline');
      return { servers: selected, tools: definitions.filter((tool) => tool.mcp.serverId === selected[0].id) };
    },
    select: async (capabilities) => capabilities.map((item) => item.id),
  });
  assert.deepEqual(result.serverIds, ['custom-b']);
  assert.deepEqual(result.unavailable, ['Desktop']);
});

test('cancelled discovery does not select or authorize a service', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverMcpForRequest({
    servers, load, signal: controller.signal, select: async () => { throw new Error('should not select'); },
  }), /abort/i);
});

test('an alternate successful call stays visible without falsely declaring task completion', () => {
  const text = toolOutcomeText('完成', [
    { name: 'App', ok: false, error: 'Executable does not exist' },
    { name: 'PowerShell', ok: true },
  ]);
  assert.match(text, /Executable does not exist/);
  assert.match(text, /后续调用已返回成功：PowerShell/);
  assert.match(text, /最终效果仍需核验/);
  assert.doesNotMatch(text, /^任务尚未全部完成/);
});

test('发现结果只选择已发现的服务，并保留不可用服务提示', async () => {
  const result = await discoverMcpForRequest({
    servers,
    load: async ({ servers: selected }) => ({
      servers: selected,
      tools: selected[0].id === 'custom-b' ? definitions.filter((tool) => tool.mcp.serverId === 'custom-b') : [],
    }),
    select: async (capabilities) => capabilities.map((capability) => capability.id),
  });
  assert.deepEqual(result.serverIds, ['custom-b']);
  assert.deepEqual(result.unavailable, ['Desktop']);
});
