import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { buildMcpModule } from './tools-build.mjs';
import { createTsRequire } from './ts-require.mjs';

const mcp = await buildMcpModule();
const updateRoute = createTsRequire(process.cwd())('./app/api/mcp/[id]/update/route');
const OLD_COMMIT = 'a'.repeat(40);
const NEW_COMMIT = 'b'.repeat(40);
const OLD_FIXTURE = await readFile(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url), 'utf8');

async function withDataDir(run) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-mcp-update-'));
  try {
    return await run(dataDir);
  } finally {
    mcp.closeStdioServer();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function serverFixture(dataDir, overrides = {}) {
  const id = 'demo-mcp';
  const cwd = path.join(dataDir, 'mcp', 'repos', id, 'project');
  mkdirSync(cwd, { recursive: true });
  const entry = path.join(cwd, 'index.js');
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'demo-mcp', version: '1.0.0', type: 'module', bin: 'index.js' }));
  writeFileSync(entry, OLD_FIXTURE);
  const server = {
    id,
    name: 'Demo MCP',
    url: `stdio://${id}`,
    transport: 'stdio',
    enabled: true,
    allowWrite: false,
    enabledTools: ['ping'],
    lazy: true,
    command: process.execPath,
    args: [entry],
    cwd,
    managedRepo: {
      owner: 'demo',
      repo: 'demo-mcp',
      ref: 'main',
      url: 'https://github.com/demo/demo-mcp',
      kind: 'node',
      packageName: 'demo-mcp',
      packageVersion: '1.0.0',
      commit: OLD_COMMIT,
      installedAt: Date.now() - 86_400_000,
      lastCheckedAt: 0,
      lastUpdatedAt: Date.now() - 86_400_000,
      autoUpdate: true,
    },
    ...overrides,
  };
  mcp.saveMcpServers([server], { dataDir });
  return mcp.listMcpServers({ dataDir })[0];
}

function githubResponse(fetchCalls, latestCommit = NEW_COMMIT) {
  return async (url) => {
    const parsed = new URL(String(url));
    fetchCalls.push(parsed.href);
    if (parsed.pathname === '/repos/demo/demo-mcp') {
      return Response.json({ full_name: 'demo/demo-mcp', default_branch: 'main' });
    }
    if (parsed.pathname === '/repos/demo/demo-mcp/commits') {
      return Response.json([{ sha: latestCommit }]);
    }
    throw new Error(`Unexpected GitHub URL: ${parsed.href}`);
  };
}

function archiveFor({ name = 'demo-mcp', version = '2.0.0' } = {}) {
  return zipSync({
    'demo-mcp-main/package.json': Buffer.from(JSON.stringify({ name, version, type: 'module', bin: 'index.js' })),
    'demo-mcp-main/index.js': Buffer.from(OLD_FIXTURE),
  });
}

function dependencies(archive, overrides = {}) {
  return {
    downloadArchive: async () => ({ data: archive }),
    installNode: async (root) => {
      assert.equal(existsSync(path.join(root, 'package.json')), true);
    },
    probe: async (candidate) => ({ tools: [{ name: 'ping' }], candidateId: candidate.id }),
    ...overrides,
  };
}

test('GitHub 更新读取分支最新提交，暂存自检后切换版本并保留用户配置', async () => {
  await withDataDir(async (dataDir) => {
    const server = serverFixture(dataDir, { enabled: false, allowWrite: true, enabledTools: ['ping', 'echo'], lazy: false });
    const calls = [];
    const options = {
      dataDir,
      force: true,
      fetchImpl: githubResponse(calls),
      dependencies: dependencies(archiveFor()),
    };

    const result = await mcp.updateGithubMcpFromRepo(server, options);
    const saved = mcp.listMcpServers({ dataDir })[0];
    assert.equal(result.updated, true);
    assert.equal(result.latestCommit, NEW_COMMIT);
    assert.equal(calls.length, 2);
    assert.equal(saved.managedRepo.commit, NEW_COMMIT);
    assert.equal(saved.managedRepo.packageVersion, '2.0.0');
    assert.notEqual(saved.cwd, server.cwd);
    assert.equal(readFileSync(path.join(saved.cwd, 'package.json'), 'utf8').includes('2.0.0'), true);
    assert.equal(saved.enabled, false);
    assert.equal(saved.allowWrite, true);
    assert.deepEqual(saved.enabledTools, ['ping', 'echo']);
    assert.equal(saved.lazy, undefined);
    assert.equal(saved.managedRepo.autoUpdate, true);
    assert.equal(saved.managedRepo.lastUpdateError, '');
  });
});

test('GitHub Python MCP 更新使用 uv 环境并记录 pyproject 版本', async () => {
  await withDataDir(async (dataDir) => {
    const id = 'python-mcp';
    const cwd = path.join(dataDir, 'mcp', 'repos', id, 'project');
    mkdirSync(cwd, { recursive: true });
    const project = (version) => `[project]\nname = "demo-python-mcp"\nversion = "${version}"\ndependencies = ["mcp>=1"]\n\n[project.scripts]\ndemo-python-mcp = "demo.main:main"\n`;
    writeFileSync(path.join(cwd, 'pyproject.toml'), project('1.0.0'));
    writeFileSync(path.join(cwd, 'main.py'), 'def main(): pass\n');
    const server = {
      id,
      name: 'Python MCP',
      url: `stdio://${id}`,
      transport: 'stdio',
      enabled: true,
      allowWrite: false,
      command: process.execPath,
      args: [path.join(cwd, 'main.py')],
      cwd,
      managedRepo: {
        owner: 'demo', repo: 'demo-mcp', ref: 'main', url: 'https://github.com/demo/demo-mcp',
        kind: 'python', packageName: 'demo-python-mcp', packageVersion: '1.0.0', commit: OLD_COMMIT,
        lastCheckedAt: 0, autoUpdate: true,
      },
    };
    mcp.saveMcpServers([server], { dataDir });
    const saved = mcp.listMcpServers({ dataDir })[0];
    const archive = zipSync({
      'demo-mcp-main/pyproject.toml': Buffer.from(project('2.0.0')),
      'demo-mcp-main/main.py': Buffer.from('def main(): pass\n'),
    });
    let candidate;
    const result = await mcp.updateGithubMcpFromRepo(saved, {
      dataDir,
      force: true,
      fetchImpl: githubResponse([]),
      dependencies: dependencies(archive, {
        installPython: async (root) => {
          assert.equal(existsSync(path.join(root, 'pyproject.toml')), true);
          return process.execPath;
        },
        probe: async (serverConfig) => {
          candidate = serverConfig;
          return { tools: [{ name: 'ping' }] };
        },
      }),
    });
    const updated = mcp.listMcpServers({ dataDir })[0];
    assert.equal(result.updated, true);
    assert.equal(updated.managedRepo.packageVersion, '2.0.0');
    assert.equal(updated.managedRepo.commit, NEW_COMMIT);
    assert.equal(updated.command, process.execPath);
    assert.deepEqual(updated.args, ['--directory', updated.cwd, 'run', 'demo-python-mcp', 'serve']);
    assert.equal(candidate.id.startsWith('mcp-update-'), true);
  });
});

test('GitHub 新提交更换包名时拒绝应用并保留旧版本', async () => {
  await withDataDir(async (dataDir) => {
    const server = serverFixture(dataDir);
    let installs = 0;
    await assert.rejects(mcp.updateGithubMcpFromRepo(server, {
      dataDir,
      force: true,
      fetchImpl: githubResponse([]),
      dependencies: dependencies(archiveFor({ name: 'different-mcp' }), { installNode: async () => { installs += 1; } }),
    }), /包名或运行时类型/);
    const saved = mcp.listMcpServers({ dataDir })[0];
    assert.equal(installs, 0);
    assert.equal(saved.cwd, server.cwd);
    assert.equal(saved.managedRepo.commit, OLD_COMMIT);
    assert.match(saved.managedRepo.lastUpdateError, /包名或运行时类型/);
  });
});

test('候选版本自检失败时旧进程、配置和版本仍可用', async () => {
  await withDataDir(async (dataDir) => {
    const server = serverFixture(dataDir);
    await mcp.probeMcpServer(server, { retry: true });
    assert.equal(mcp.stdioServerStatus(server.id).running, true);

    await assert.rejects(mcp.updateGithubMcpFromRepo(server, {
      dataDir,
      force: true,
      fetchImpl: githubResponse([]),
      dependencies: dependencies(archiveFor(), { probe: async () => ({ tools: [] }) }),
    }), /没有公布可用工具/);

    const saved = mcp.listMcpServers({ dataDir })[0];
    assert.equal(saved.cwd, server.cwd);
    assert.equal(saved.managedRepo.commit, OLD_COMMIT);
    assert.equal(existsSync(server.cwd), true);
    assert.equal(mcp.stdioServerStatus(server.id).running, true);
    assert.match(saved.managedRepo.lastUpdateError, /没有公布可用工具/);
  });
});

test('更新前校验本地清单和来源记录，不能用伪造元数据接管其他项目', async () => {
  await withDataDir(async (dataDir) => {
    const server = serverFixture(dataDir);
    writeFileSync(path.join(server.cwd, 'package.json'), JSON.stringify({ name: 'other-package', version: '1.0.0', bin: 'index.js' }));
    let requests = 0;
    await assert.rejects(mcp.updateGithubMcpFromRepo(server, {
      dataDir,
      force: true,
      fetchImpl: async () => { requests += 1; throw new Error('should not fetch'); },
    }), /包名与来源记录不一致/);
    assert.equal(requests, 0);
    const saved = mcp.listMcpServers({ dataDir })[0];
    assert.equal(saved.managedRepo.commit, OLD_COMMIT);
    assert.match(saved.managedRepo.lastUpdateError, /包名与来源记录不一致/);
  });
});

test('自动更新关闭或六小时检查间隔未到时不请求 GitHub', async () => {
  await withDataDir(async (dataDir) => {
    const server = serverFixture(dataDir);
    mcp.saveMcpServers([{ ...server, managedRepo: { ...server.managedRepo, autoUpdate: false } }], { dataDir });
    const disabled = mcp.listMcpServers({ dataDir })[0];
    let requests = 0;
    const fetchImpl = async () => { requests += 1; throw new Error('should not fetch'); };
    const stopped = await mcp.updateGithubMcpFromRepo(disabled, { dataDir, fetchImpl });
    assert.equal(stopped.updated, false);

    const recentlyChecked = {
      ...disabled,
      managedRepo: { ...disabled.managedRepo, autoUpdate: true, lastCheckedAt: Date.now() },
    };
    mcp.saveMcpServers([recentlyChecked], { dataDir });
    const throttled = await mcp.updateGithubMcpFromRepo(recentlyChecked, {
      dataDir,
      fetchImpl,
      dependencies: dependencies(archiveFor()),
    });
    assert.equal(throttled.updated, false);
    assert.equal(requests, 0);
  });
});

test('更新器不接受用户手动连接配置注入 managedRepo 元数据', () => {
  const normalized = mcp.normalizeMcpServerInput({
    name: 'Fake managed server',
    url: 'https://example.com/mcp',
    managedRepo: { owner: 'attacker', repo: 'repo', ref: 'main' },
    transport: 'stdio',
    command: process.execPath,
    args: [],
    cwd: process.cwd(),
  });
  assert.equal(normalized.transport, undefined);
  assert.equal(normalized.managedRepo, undefined);
});

test('能力发现触发自动检查但不等待，并跳过停用和未登记来源的服务', async () => {
  const checked = [];
  const makeServer = (id, overrides = {}) => ({
    id,
    name: id,
    enabled: true,
    transport: 'stdio',
    managedRepo: { owner: 'demo', repo: id, ref: 'main', url: `https://github.com/demo/${id}`, autoUpdate: true },
    ...overrides,
  });
  const scheduled = mcp.scheduleManagedGithubMcpUpdates([
    makeServer('managed'),
    makeServer('paused', { enabled: false }),
    makeServer('manual', { managedRepo: { owner: 'demo', repo: 'manual', ref: 'main', url: 'https://github.com/demo/manual', autoUpdate: false } }),
    makeServer('remote', { transport: 'http', managedRepo: undefined }),
  ], {
    update: async (server) => {
      checked.push(server.id);
      return { server, updated: false, latestCommit: '', checkedAt: Date.now() };
    },
  });
  await Promise.all(scheduled);
  assert.deepEqual(checked, ['managed']);
});

test('手动更新接口拒绝没有管理员身份的远程请求', async () => {
  const response = await updateRoute.POST(
    new Request('http://example.com/api/mcp/demo-mcp/update', { method: 'POST' }),
    { params: Promise.resolve({ id: 'demo-mcp' }) },
  );
  assert.equal(response.status, 401);
});
