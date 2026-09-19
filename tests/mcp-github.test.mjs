import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildApprovalModule, buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const approval = await buildApprovalModule();

async function withDataDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-mcp-github-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 假 GitHub 远端：实现握手、tools/list 和 get_me，并把每次请求的头记下来。 */
function fakeRemote({ tools = [], login = 'sanmao-user' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const payload = JSON.parse(String(init.body || '{}'));
    calls.push({ url, method: payload.method, headers: init.headers || {}, toolName: payload.params?.name || '' });
    if (payload.method === 'notifications/initialized') return new Response('', { status: 202 });
    const result = payload.method === 'tools/list'
      ? { tools }
      : payload.method === 'tools/call'
        ? { content: [{ type: 'text', text: JSON.stringify({ login }) }] }
        : { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake-github', version: '1' } };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

/** 服务公布的工具：只读的带 readOnlyHint，写工具（上游也是这么标的）不带。 */
const GITHUB_TOOLS = [
  { name: 'get_me', annotations: { readOnlyHint: true } },
  { name: 'list_issues', annotations: { readOnlyHint: true } },
  { name: 'create_issue' },
  { name: 'merge_pull_request' },
  { name: 'delete_repository' },
  { name: 'upload_something_new' },
];

function githubServer(overrides = {}) {
  return {
    id: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    enabled: true,
    allowWrite: false,
    catalogId: 'github',
    ...overrides,
  };
}

function defOf(definitions, toolName) {
  const found = definitions.find((definition) => definition.mcp?.toolName === toolName);
  assert.ok(found, `工具表里应当有 ${toolName}`);
  return found;
}

test('能力组默认只放四组：Actions 要用户自己打开', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    assert.deepEqual(entry.toolsets.map((toolset) => toolset.id), ['context', 'repos', 'issues', 'pull_requests', 'actions']);
    assert.deepEqual(mcp.catalogEntryToolsets('github', { dataDir }), ['context', 'repos', 'issues', 'pull_requests']);

    const { fetchImpl, calls } = fakeRemote();
    const result = await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'ghp_secret', fetchImpl });
    assert.equal(result.state, 'connected');
    const initialize = calls.find((call) => call.method === 'initialize');
    assert.equal(initialize.headers['x-mcp-toolsets'], 'context,repos,issues,pull_requests');
  });
});

test('改能力组会重连并改写请求头；至少留一组', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'ghp_secret', fetchImpl: fakeRemote().fetchImpl });

    const off = fakeRemote();
    await mcp.setRemoteCatalogToolset(entry, 'pull_requests', false, { dataDir, fetchImpl: off.fetchImpl });
    assert.deepEqual(mcp.catalogEntryToolsets('github', { dataDir }), ['context', 'repos', 'issues']);
    const initialize = off.calls.find((call) => call.method === 'initialize');
    assert.equal(initialize.headers['x-mcp-toolsets'], 'context,repos,issues', '服务端要按新的组公布工具');
    assert.equal(initialize.headers['x-mcp-readonly'], 'true');
    assert.equal(initialize.headers['x-mcp-lockdown'], 'true');

    const on = fakeRemote();
    await mcp.setRemoteCatalogToolset(entry, 'actions', true, { dataDir, fetchImpl: on.fetchImpl });
    assert.equal(on.calls.find((call) => call.method === 'initialize').headers['x-mcp-toolsets'], 'context,repos,issues,actions');

    // 只留一组时不许再关：全关等于让服务端把全部组打开，和用户想表达的正好相反。
    await mcp.setRemoteCatalogToolset(entry, 'context', false, { dataDir, fetchImpl: fakeRemote().fetchImpl });
    await mcp.setRemoteCatalogToolset(entry, 'repos', false, { dataDir, fetchImpl: fakeRemote().fetchImpl });
    await mcp.setRemoteCatalogToolset(entry, 'actions', false, { dataDir, fetchImpl: fakeRemote().fetchImpl });
    assert.deepEqual(mcp.catalogEntryToolsets('github', { dataDir }), ['issues']);
    assert.throws(() => mcp.setCatalogEntryToolset('github', 'issues', false, { dataDir }), /至少要留一组/);
    assert.throws(() => mcp.setCatalogEntryToolset('github', 'nope', true, { dataDir }), /未知的能力组/);
  });
});

test('写工具默认全部挡下，只读工具不受影响', async () => {
  await withDataDir(async (dataDir) => {
    const definitions = mcp.mcpToolDefinitions(githubServer(), GITHUB_TOOLS, { dataDir });
    const create = defOf(definitions, 'create_issue');
    assert.equal(create.mcp.readOnly, false);
    assert.equal(create.mcp.blocked, true);
    assert.match(create.mcp.blockedReason, /打开「允许写入」/);
    assert.equal(defOf(definitions, 'list_issues').mcp.blocked, false, '只读工具不该被写权限影响');
    assert.equal(defOf(definitions, 'get_me').mcp.blocked, false);
  });
});

test('打开允许写入但没逐项授权：写工具仍然挡着，理由指到具体那一项', async () => {
  await withDataDir(async (dataDir) => {
    const definitions = mcp.mcpToolDefinitions(githubServer({ allowWrite: true }), GITHUB_TOOLS, { dataDir });
    assert.match(defOf(definitions, 'create_issue').mcp.blockedReason, /「创建 \/ 修改 Issue」/);
    assert.match(defOf(definitions, 'merge_pull_request').mcp.blockedReason, /「Merge PR」/);
  });
});

test('逐项放开后写工具才放行，而且每一次调用仍然要确认', async () => {
  await withDataDir(async (dataDir) => {
    mcp.setCatalogEntryWriteGate('github', 'issues:create', true, { dataDir });
    const definitions = mcp.mcpToolDefinitions(githubServer({ allowWrite: true }), GITHUB_TOOLS, { dataDir });
    const create = defOf(definitions, 'create_issue');
    assert.equal(create.mcp.blocked, false);
    assert.match(defOf(definitions, 'merge_pull_request').mcp.blockedReason, /「Merge PR」/);
    assert.equal(create.risk, 'external_side_effect');
    assert.equal(approval.assessToolApproval({ definition: create, args: { title: 'x' } }).required, true);
    assert.equal(approval.assessToolApproval({ definition: defOf(definitions, 'list_issues'), args: {} }).required, false);
  });
});

test('不开放的操作和上游新增的写工具都没开关可用', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    for (const toolset of entry.toolsets) {
      for (const gate of toolset.writes || []) mcp.setCatalogEntryWriteGate('github', gate.id, true, { dataDir });
    }
    const definitions = mcp.mcpToolDefinitions(githubServer({ allowWrite: true }), GITHUB_TOOLS, { dataDir });
    const del = defOf(definitions, 'delete_repository');
    assert.equal(del.mcp.blocked, true, '删仓库这类操作没有开关能打开');
    assert.match(del.mcp.blockedReason, /不开放/);
    const unknown = defOf(definitions, 'upload_something_new');
    assert.equal(unknown.mcp.blocked, true);
    assert.match(unknown.mcp.blockedReason, /不在已开放的写操作清单里/);
  });
});

test('连上之后问一次账号：面板显示连的是谁，断开就清掉', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    const remote = fakeRemote();
    await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'ghp_secret', fetchImpl: remote.fetchImpl });
    const call = remote.calls.find((item) => item.method === 'tools/call');
    assert.ok(call, '连接时要顺手调一次 get_me');
    assert.equal(call.toolName, 'get_me');
    assert.equal(mcp.catalogEntryAccount('github', { dataDir }), 'sanmao-user');

    // 拿不到账号名（工具没开、返回不对）只是不显示，不该影响连接本身。
    const anonymous = await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'ghp_secret', fetchImpl: fakeRemote({ login: '不是用户名' }).fetchImpl });
    assert.equal(anonymous.state, 'connected');
    assert.equal(mcp.catalogEntryAccount('github', { dataDir }), 'sanmao-user', '问不到就留着上一次的名字');

    mcp.disconnectRemoteCatalogEntry(entry, { dataDir });
    assert.equal(mcp.catalogEntryAccount('github', { dataDir }), '');
  });
});
test('助手侧的 mcp_manage 碰不到连接器：权限、白名单、断开都只能走面板', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'ghp_secret', fetchImpl: fakeRemote().fetchImpl });

    await assert.rejects(
      mcp.runMcpManageAction({ action: 'update', id: 'github', allowWrite: true }, { dataDir, instruction: '这个服务我允许写入' }),
      /面板/,
    );
    await assert.rejects(
      mcp.runMcpManageAction({ action: 'update', id: 'github', enabledTools: ['create_issue'] }, { dataDir, instruction: '只留 create_issue' }),
      /内置目录维护/,
    );
    await assert.rejects(
      mcp.runMcpManageAction({ action: 'remove', id: 'github' }, { dataDir, instruction: '断开 github 吧' }),
      /面板/,
    );
    await assert.rejects(
      mcp.runMcpManageAction({ action: 'add', id: 'GitHub', name: 'GitHub', url: 'https://evil.example.com/mcp' }, { dataDir, instruction: '帮我加一个 GitHub' }),
      /内置连接器/,
    );
    // 连接和凭据都还在：上面几次尝试一个都不该生效。
    const server = mcp.findRemoteCatalogServer(entry, { dataDir });
    assert.equal(Boolean(server), true);
    assert.equal(server.allowWrite, false);
    assert.equal(server.headers.authorization, 'Bearer ghp_secret', '凭据和只读开关都还在');
    assert.equal(server.headers['x-mcp-readonly'], 'true');
    assert.equal(mcp.redactMcpServer(server).catalogId, 'github');
  });
});

test('远端写权限：本机放行和服务端请求头一起改，断开时收回写权限', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'ghp_secret', fetchImpl: fakeRemote().fetchImpl });

    const opened = fakeRemote();
    await mcp.configureRemoteCatalogEntry(entry, { allowWrite: true }, { dataDir, fetchImpl: opened.fetchImpl });
    const initialize = opened.calls.find((call) => call.method === 'initialize');
    assert.equal(initialize.headers['x-mcp-readonly'], 'false', '服务端也要放开写工具');
    assert.equal(initialize.headers['x-mcp-lockdown'], 'true');
    assert.equal(mcp.findRemoteCatalogServer(entry, { dataDir }).allowWrite, true);

    mcp.setCatalogEntryWriteGate('github', 'pulls:merge', true, { dataDir });
    assert.deepEqual(mcp.catalogEntryWriteGates('github', { dataDir }), ['pulls:merge']);

    mcp.disconnectRemoteCatalogEntry(entry, { dataDir });
    assert.deepEqual(mcp.catalogEntryWriteGates('github', { dataDir }), [], '断开后写权限要收回，重新连接必须重新逐项打开');
    assert.deepEqual(mcp.catalogEntryToolsets('github', { dataDir }), ['context', 'repos', 'issues', 'pull_requests']);
  });
});