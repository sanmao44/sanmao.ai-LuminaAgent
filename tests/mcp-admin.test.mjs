import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { buildMcpModule, buildToolPolicyModule, buildToolsModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const policy = await buildToolPolicyModule();
const tools = await buildToolsModule();

const GATING = { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false, mcpAdmin: false };
const tempDir = () => mkdtempSync(path.join(tmpdir(), 'sanmao-mcp-admin-'));
const toolNames = (list) => list.map((item) => item.function.name);

const READ_TOOL = { name: 'search', description: '搜索仓库', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } };
const WRITE_TOOL = { name: 'create_issue', description: '创建 issue' };
const HUGE_TOOL = { name: 'huge', description: '结构过大的工具', inputSchema: { type: 'object', properties: { blob: { type: 'string', description: 'x'.repeat(12_500) } } } };

/** 只会说 JSON-RPC 的假服务端，用来验证 probe 真的走了客户端协议。 */
function fakeFetch(toolList = [READ_TOOL, WRITE_TOOL]) {
  const seen = [];
  const fetchImpl = async (_url, init) => {
    const payload = JSON.parse(String(init.body));
    seen.push(payload.method);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess' } });
    if (payload.method === 'initialize') return reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'fake' } });
    if (payload.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (payload.method === 'tools/list') return reply({ tools: toolList });
    throw new Error(`unexpected method ${payload.method}`);
  };
  return { fetchImpl, seen };
}

test('mcp_manage 只在这一轮谈 MCP 服务时下发给模型', () => {
  assert.equal(tools.getToolDefinition('mcp_manage')?.source, 'native');
  assert.equal(toolNames(tools.toolSchemasFor(GATING)).includes('mcp_manage'), false);
  assert.equal(toolNames(tools.toolSchemasFor({ ...GATING, mcpAdmin: true })).includes('mcp_manage'), true);
  assert.equal(tools.toolExecutionKind('mcp_manage'), 'mcp-manage');
});

test('本轮没下发时的 mcp_manage 调用被统一执行点拒绝', () => {
  const decision = policy.resolveToolPolicy('mcp_manage', GATING);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /本轮没有下发工具/);
  assert.equal(policy.resolveToolPolicy('mcp_manage', { ...GATING, mcpAdmin: true }).allowed, true);
});

test('list 只回传脱敏快照，凭据不出服务端', async () => {
  const dataDir = tempDir();
  mcp.upsertMcpServer({ name: 'GitHub', url: 'https://a.com/mcp', headers: { authorization: 'Bearer secret' } }, { dataDir });
  const outcome = await mcp.runMcpManageAction({ action: 'list' }, { dataDir, instruction: '看看我接了哪些 MCP' });
  assert.equal(outcome.readOnly, true);
  assert.equal(outcome.result.servers.length, 1);
  assert.deepEqual(outcome.result.servers[0].headerNames, ['authorization']);
  assert.equal(JSON.stringify(outcome.result).includes('secret'), false);
});

test('添加与修改服务：没有用户明确同意就不打开写入权限', async () => {
  const dataDir = tempDir();
  const added = await mcp.runMcpManageAction(
    { action: 'add', name: 'GitHub', url: 'https://a.com/mcp', allowWrite: true, id: 'gh' },
    { dataDir, instruction: '帮我接一个 MCP 服务' },
  );
  assert.equal(added.result.server.allowWrite, false);
  assert.match(String(added.result.note), /没有打开/);

  const granted = await mcp.runMcpManageAction({ action: 'update', id: 'gh', allowWrite: true }, { dataDir, instruction: '这个服务我允许写入，issue 交给你建' });
  assert.equal(granted.result.server.allowWrite, true);

  const revoked = await mcp.runMcpManageAction({ action: 'update', id: 'gh', allowWrite: false, enabledTools: ['create_issue', 'create_issue'] }, { dataDir, instruction: '先关掉写入' });
  assert.equal(revoked.result.server.allowWrite, false);
  assert.deepEqual(revoked.result.server.enabledTools, ['create_issue']);
});

test('移除服务必须能在用户原话里找到依据', async () => {
  const dataDir = tempDir();
  mcp.upsertMcpServer({ name: 'GitHub', url: 'https://a.com/mcp' }, { dataDir });
  await assert.rejects(
    () => mcp.runMcpManageAction({ action: 'remove', id: 'github' }, { dataDir, instruction: '看看现在接了哪些服务' }),
    /没有明确要求移除/,
  );
  assert.equal(mcp.listMcpServers({ dataDir }).length, 1, '被拒绝时不能真的删掉');

  const removed = await mcp.runMcpManageAction({ action: 'remove', id: 'github' }, { dataDir, instruction: '把 GitHub 删掉吧' });
  assert.equal(removed.result.removed, true);
  assert.equal(mcp.listMcpServers({ dataDir }).length, 0);
});

test('probe 走真实客户端协议并标注只读与超限工具', async () => {
  mcp.resetMcpSessions();
  const dataDir = tempDir();
  mcp.upsertMcpServer({ name: 'GitHub', url: 'https://a.com/mcp' }, { dataDir });
  const { fetchImpl, seen } = fakeFetch([READ_TOOL, WRITE_TOOL, HUGE_TOOL]);
  const outcome = await mcp.runMcpManageAction({ action: 'probe', id: 'github' }, { dataDir, fetchImpl, instruction: '自检一下 GitHub 服务' });
  assert.equal(outcome.readOnly, true);
  assert.deepEqual(seen, ['initialize', 'notifications/initialized', 'tools/list']);
  assert.deepEqual(outcome.result.tools.map((tool) => tool.name), ['search', 'create_issue', 'huge']);
  assert.equal(outcome.result.tools[0].readOnly, true);
  assert.equal(outcome.result.tools[1].readOnly, false);
  assert.equal(outcome.result.tools[2].oversized, true);
  assert.equal(outcome.result.tools[2].enabled, false, 'schema 超限的工具不下发');
  assert.equal(outcome.result.readOnlyCount, 1);
});

test('动作名不合法或服务不存在时抛出可读错误', async () => {
  const dataDir = tempDir();
  mcp.upsertMcpServer({ name: 'GitHub', url: 'https://a.com/mcp' }, { dataDir });
  await assert.rejects(() => mcp.runMcpManageAction({ action: 'drop' }, { dataDir }), /不支持的动作/);
  await assert.rejects(() => mcp.runMcpManageAction({ action: 'probe' }, { dataDir }), /id 或名称/);
  await assert.rejects(() => mcp.runMcpManageAction({ action: 'probe', id: 'nope' }, { dataDir }), /没有找到/);
});

test('MCP 管理动作的结果带有稳定的只读/写入语义', async () => {
  const dataDir = tempDir();
  const listed = await mcp.runMcpManageAction({ action: 'list' }, { dataDir, instruction: '看看 MCP 服务' });
  assert.equal(listed.readOnly, true);
  assert.equal(listed.result.ok, true);
  await assert.rejects(
    () => mcp.runMcpManageAction({ action: 'remove', id: 'missing' }, { dataDir, instruction: '看看 MCP 服务' }),
    /没有明确要求移除|没有找到/,
  );
});

test('GitHub MCP 安装只接受用户原话里的同一个仓库地址', async () => {
  const dataDir = tempDir();
  await assert.rejects(
    () => mcp.runMcpManageAction(
      { action: 'install_from_repo', repo: 'https://github.com/evil/repo' },
      { dataDir, instruction: '帮我安装 https://github.com/owner/repo' },
    ),
    /只会安装你这次消息里提供的仓库/,
  );
});

test('已由服务端确认的 GitHub 地址可用于直接安装，但仍校验仓库一致性', async () => {
  const dataDir = tempDir();
  await assert.rejects(
    () => mcp.runMcpManageAction(
      { action: 'install_from_repo', repo: 'https://github.com/evil/repo' },
      {
        dataDir,
        instruction: '安装',
        authorizedGithubRepo: 'https://github.com/owner/repo',
      },
    ),
    /只会安装你这次消息里提供的仓库/,
  );
});

test('仓库身份按 owner/repo 归一化，完整地址不会被判成没给地址', () => {
  const identity = mcp.githubRepoIdentity;
  const repo = 'https://github.com/CursorTouch/Windows-MCP';
  assert.equal(identity(repo), 'cursortouch/windows-mcp');
  assert.equal(identity(repo), identity('cursortouch/windows-mcp'));
  assert.equal(identity(repo), identity('github.com/CursorTouch/Windows-MCP'));
  assert.equal(identity(repo), identity('https://github.com/CursorTouch/Windows-MCP.git'));
  assert.equal(identity(repo), identity('https://github.com/CursorTouch/Windows-MCP/tree/main'));
  assert.notEqual(identity(repo), identity('https://github.com/CursorTouch/Windows-MCP-other'));
  assert.equal(identity('Windows-MCP'), '', '拿不到 owner/repo 时不给过');
});

test('用户原话里的仓库地址能过授权校验，直接进入下载安装', async () => {
  const dataDir = tempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline-test'); };
  try {
    await assert.rejects(
      () => mcp.runMcpManageAction(
        { action: 'install_from_repo', repo: 'https://github.com/CursorTouch/Windows-MCP' },
        { dataDir, instruction: 'https://github.com/CursorTouch/Windows-MCP\n安装' },
      ),
      (error) => {
        assert.doesNotMatch(String(error?.message || ''), /只会安装你这次消息里提供的仓库/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/** codeload 的包就是多一层「仓库-分支」目录，这里按真实形状造归档。 */
function githubStyleArchive(prefix, files) {
  const entries = {};
  for (const [name, content] of Object.entries(files)) entries[`${prefix}/${name}`] = Buffer.from(content);
  return zipSync(entries);
}

test('仓库安装：归档的顶层目录不会被算成工作目录，装完能启动自检', async () => {
  const dataDir = tempDir();
  const originalFetch = globalThis.fetch;
  const fixture = await readFile(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url), 'utf8');
  const archive = githubStyleArchive('demo-mcp-main', {
    'package.json': JSON.stringify({ name: 'demo-mcp', version: '1.0.0', bin: { 'demo-mcp': 'index.js' } }),
    'index.js': fixture,
  });
  globalThis.fetch = async () => new Response(archive, { status: 200, headers: { 'content-type': 'application/zip' } });
  try {
    const installed = await mcp.installGithubMcpFromRepo('https://github.com/demo/demo-mcp', { dataDir });
    assert.equal(installed.server.cwd, installed.projectRoot, '启动工作目录必须是归档解出来的项目目录');
    assert.equal(existsSync(path.join(installed.projectRoot, 'package.json')), true);
    assert.equal(existsSync(path.join(installed.projectRoot, 'index.js')), true);
    assert.equal(existsSync(path.join(installed.projectRoot, 'demo-mcp-main')), false, '不该多出一层归档目录');
    const probed = await mcp.probeMcpServer(installed.server, { retry: true });
    assert.ok(probed.tools.length > 0, '装完要能真的把服务拉起来并列出工具');
    mcp.closeStdioServer(installed.server.id);
  } finally {
    globalThis.fetch = originalFetch;
    // Windows 上刚被 kill 的子进程和 npm 目录会短暂占住句柄，删除要重试。
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
    }
  }
});

test('管理工具能把某个服务改成按需下发，也能改回来', async () => {
  const dir = tempDir();
  try {
    // 名称不用 GitHub：那个 id 是内置连接器保留的，管理工具不允许占用（见 tests/mcp-github.test.mjs）。
    const added = await mcp.runMcpManageAction({ action: 'add', name: 'GitLab', url: 'https://example.com/mcp' }, { dataDir: dir });
    assert.equal(added.result.server.lazy, false, '默认每轮都下发');
    const updated = await mcp.runMcpManageAction({ action: 'update', id: 'gitlab', lazy: true }, { dataDir: dir });
    assert.equal(updated.result.server.lazy, true);
    assert.equal(mcp.listMcpServers({ dataDir: dir })[0].lazy, true);
    const restored = await mcp.runMcpManageAction({ action: 'update', id: 'gitlab', lazy: false }, { dataDir: dir });
    assert.equal(restored.result.server.lazy, false);
    assert.equal(mcp.listMcpServers({ dataDir: dir })[0].lazy, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
