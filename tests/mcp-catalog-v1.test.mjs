import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();

async function withDataDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-catalog-v1-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 假远端服务：只实现握手与 tools/list，并把看到的请求头记下来。 */
function fakeRemote({ tools = [{ name: 'query-docs', annotations: { readOnlyHint: true } }], status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const payload = JSON.parse(String(init.body || '{}'));
    calls.push({ url, method: payload.method, headers: init.headers || {} });
    if (status !== 200) {
      return new Response(JSON.stringify({ error: 'nope' }), { status, headers: { 'content-type': 'application/json' } });
    }
    if (payload.method === 'notifications/initialized') return new Response('', { status: 202 });
    const result = payload.method === 'tools/list'
      ? { tools }
      : { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '1' } };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

/** 造出「已经装好」的假安装目录。 */
async function fakeInstall(dataDir, id, pkgParts, entryFile) {
  const file = path.join(dataDir, 'mcp', id, 'node_modules', ...pkgParts, ...entryFile);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '// fake\n');
  return file;
}

test('GitHub 连接：官方只读/lockdown/toolsets 三个头都要带上，凭据只回键名', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    assert.equal(entry.installMode, 'remote');
    const { fetchImpl, calls } = fakeRemote({ tools: [{ name: 'get_file_contents', annotations: { readOnlyHint: true } }] });
    const result = await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'ghp_secret', fetchImpl });
    assert.equal(result.state, 'connected');
    const initialize = calls.find((call) => call.method === 'initialize');
    assert.equal(initialize.url, 'https://api.githubcopilot.com/mcp/');
    // 请求头名不分大小写，落盘时会统一转小写，这里按小写断言实际发出的名字。
    assert.equal(initialize.headers.authorization, 'Bearer ghp_secret');
    assert.equal(initialize.headers['x-mcp-readonly'], 'true', '默认只读要在服务端也关掉写工具');
    assert.equal(initialize.headers['x-mcp-lockdown'], 'true');
    assert.equal(initialize.headers['x-mcp-toolsets'], 'context,repos,issues,pull_requests');
    const [server] = mcp.listMcpServers({ dataDir }).map(mcp.redactMcpServer);
    assert.equal(server.catalogId, 'github');
    // 请求头顺序不影响语义，只比较集合。
    assert.deepEqual([...server.headerNames].sort(), ['authorization', 'x-mcp-lockdown', 'x-mcp-readonly', 'x-mcp-toolsets']);
    assert.equal(JSON.stringify(server).includes('ghp_secret'), false, '凭据值不能出现在面板数据里');
    assert.equal(mcp.catalogEntryState(entry, { dataDir }), 'connected');
  });
});

test('凭据失效：状态变「需要重新连接」，换 token 后恢复', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('github');
    const failing = fakeRemote({ status: 401 });
    const failed = await mcp.connectRemoteCatalogEntry(entry, { dataDir, token: 'bad', fetchImpl: failing.fetchImpl });
    assert.equal(failed.state, 'auth_required');
    assert.match(failed.error, /请求头里的凭据/);
    assert.equal(mcp.catalogEntryState(entry, { dataDir }), 'auth_required');
    assert.ok(mcp.listMcpServers({ dataDir }).length, '探测失败也要留着配置，用户只是要换个 token');

    const ok = fakeRemote();
    const fixed = await mcp.configureRemoteCatalogEntry(entry, { token: 'good' }, { dataDir, fetchImpl: ok.fetchImpl });
    assert.equal(fixed.state, 'connected');
    assert.equal(mcp.catalogEntryState(entry, { dataDir }), 'connected');
  });
});

test('Context7 可以匿名连接，工具白名单写死两个', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('context7');
    assert.equal(entry.auth.optional, true);
    assert.deepEqual([...entry.allowedTools], ['resolve-library-id', 'query-docs']);
    const { fetchImpl } = fakeRemote();
    const result = await mcp.connectRemoteCatalogEntry(entry, { dataDir, fetchImpl });
    assert.equal(result.state, 'connected');
    const server = mcp.listMcpServers({ dataDir })[0];
    assert.deepEqual(server.enabledTools, ['resolve-library-id', 'query-docs']);
    assert.equal(server.lazy, true, '开发文档默认按需下发，普通聊天不该挂上它');
  });
});

test('断开连接：配置、状态、失败记录一起清掉', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('context7');
    const { fetchImpl } = fakeRemote();
    await mcp.connectRemoteCatalogEntry(entry, { dataDir, fetchImpl });
    assert.equal(mcp.listMcpServers({ dataDir }).length, 1);
    const removed = mcp.disconnectRemoteCatalogEntry(entry, { dataDir });
    assert.equal(removed.removed, true);
    assert.equal(mcp.listMcpServers({ dataDir }).length, 0);
    assert.equal(mcp.catalogEntryState(entry, { dataDir }), 'not_installed');
    assert.equal(mcp.catalogEntryError(entry.id, { dataDir }), null);
  });
});

test('catalogId 只能由目录自己的连接流程写入，接口层传了不算数', async () => {
  await withDataDir(async (dataDir) => {
    const saved = mcp.upsertMcpServer({ id: 'fake-github', name: '假 GitHub', url: 'https://example.com/mcp', catalogId: 'github' }, { dataDir });
    assert.equal(saved.catalogId, undefined);
    assert.equal(mcp.redactMcpServer(saved).catalogId, '');
  });
});

test('Filesystem：没有授权目录就不进工具表，启动时也要说清楚缺什么', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('filesystem');
    assert.equal(entry.transport, 'stdio');
    assert.equal(entry.defaultReadOnly, true, '本地文件默认只读');
    assert.equal(entry.requiresRoots, true);
    await fakeInstall(dataDir, 'filesystem', ['@modelcontextprotocol', 'server-filesystem'], ['dist', 'index.js']);
    mcp.setCatalogEntryEnabled('filesystem', true, { dataDir });
    assert.equal(mcp.listCatalogServers({ dataDir }).length, 0, '没授权目录时不该出现在服务列表里');

    const root = path.join(dataDir, 'work');
    await mkdir(root, { recursive: true });
    const servers = mcp.listCatalogServers({ dataDir, roots: [root] });
    assert.equal(servers.length, 1);
    assert.equal(servers[0].catalogId, 'filesystem');
    assert.equal(servers[0].allowWrite, false, '默认只读：写工具不下发');
    assert.deepEqual(servers[0].args.slice(-1), [root]);
    assert.ok(servers[0].enabledTools.includes('read_text_file'));
    await assert.rejects(() => mcp.startCatalogServer('filesystem', { dataDir }), /至少一个授权文件夹/);
  });
});

test('状态映射：没装 / 装好没开 / 开着在跑，分别是三件事', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('playwright');
    assert.equal(mcp.catalogEntryState(entry, { dataDir, runtime: { state: 'not_installed', installed: false } }), 'not_installed');
    assert.equal(mcp.catalogEntryState(entry, { dataDir, runtime: { state: 'installing' } }), 'installing');
    // 装好了但总开关没打开：不是'未安装'，而是'已安装未启用'。
    assert.equal(mcp.catalogEntryState(entry, { dataDir, runtime: { state: 'installed', installed: true } }), 'disabled');
    mcp.setCatalogEntryEnabled('playwright', true, { dataDir });
    assert.equal(mcp.catalogEntryState(entry, { dataDir, runtime: { state: 'installed', installed: true } }), 'installed');
    assert.equal(mcp.catalogEntryState(entry, { dataDir, runtime: { state: 'running', installed: true } }), 'connected');
    assert.equal(mcp.catalogEntryState(entry, { dataDir, runtime: { state: 'error' } }), 'error');
  });
});

test('写权限开关落在条目状态里，浏览器条目默认仍是放行写入', async () => {
  await withDataDir(async (dataDir) => {
    assert.equal(mcp.catalogEntryAllowWrite('playwright', { dataDir }), true);
    assert.equal(mcp.catalogEntryAllowWrite('filesystem', { dataDir }), false);
    mcp.setCatalogEntryAllowWrite('filesystem', true, { dataDir });
    assert.equal(mcp.catalogEntryAllowWrite('filesystem', { dataDir }), true);
    const entry = mcp.requireStdioCatalogEntry('filesystem');
    const config = mcp.catalogServerConfig(entry, { dataDir, enabled: true, roots: [dataDir] });
    assert.equal(config.allowWrite, true);
    assert.throws(() => mcp.requireStdioCatalogEntry('github'), /远端连接器/);
  });
});

test('Context7 限流（429）算一般错误，不是凭据问题：配置留着，等一下再连', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('context7');
    const { fetchImpl } = fakeRemote({ status: 429 });
    const limited = await mcp.connectRemoteCatalogEntry(entry, { dataDir, fetchImpl });
    assert.equal(limited.state, 'error', '429 是服务端限流：让用户重试，而不是去换 Key');
    assert.match(String(limited.error), /429/);
    assert.equal(mcp.catalogEntryState(entry, { dataDir }), 'error');
    assert.equal(mcp.catalogEntryAuthRequired(entry, { dataDir }), false);
    assert.ok(mcp.listMcpServers({ dataDir }).length, '限流也要留着配置');

    const ok = fakeRemote();
    const retried = await mcp.connectRemoteCatalogEntry(entry, { dataDir, fetchImpl: ok.fetchImpl });
    assert.equal(retried.state, 'connected');
    assert.equal(mcp.catalogEntryError(entry, { dataDir }), null, '连上就把上一次的失败记录清掉');
  });
});

test('Context7 网络不通：报错但不删配置，也不当成凭据失效', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('context7');
    const offline = async () => { throw new Error('fetch failed'); };
    const failed = await mcp.connectRemoteCatalogEntry(entry, { dataDir, fetchImpl: offline });
    assert.equal(failed.state, 'error');
    assert.equal(mcp.catalogEntryAuthRequired(entry, { dataDir }), false);
    assert.ok(mcp.listMcpServers({ dataDir }).length);
  });
});

test('Context7 填错 Key：401 归到「需要重新连接」，换回匿名也还能连', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('context7');
    const { fetchImpl } = fakeRemote({ status: 401 });
    const bad = await mcp.connectRemoteCatalogEntry(entry, { dataDir, fetchImpl, token: 'c7-bad' });
    assert.equal(bad.state, 'auth_required');
    const ok = fakeRemote();
    const fixed = await mcp.connectRemoteCatalogEntry(entry, { dataDir, fetchImpl: ok.fetchImpl, token: '' });
    assert.equal(fixed.state, 'connected', 'Context7 允许匿名：清掉 Key 也该能连上');
  });
});