import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();

async function withDataDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-mcp-catalog-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 造出「已经装好」的假安装目录：真正被检查的只有 bin 文件在不在。 */
async function fakeInstall(dataDir, id = 'playwright') {
  const bin = path.join(dataDir, 'mcp', id, 'node_modules', '@playwright', 'mcp', 'cli.js');
  await mkdir(path.dirname(bin), { recursive: true });
  await writeFile(bin, '// fake\n');
  return bin;
}

function fakeUvSpawn(runCommand) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(async () => {
      try {
        const result = await runCommand({ command, args, options });
        if (result?.stdout) child.stdout.write(result.stdout);
        if (result?.stderr) child.stderr.write(result.stderr);
        child.stdout.end();
        child.stderr.end();
        child.emit('exit', result?.code ?? 0);
      } catch (error) {
        child.stderr.end(error instanceof Error ? error.message : String(error));
        child.stdout.end();
        child.emit('exit', 1);
      }
    });
    return child;
  };
  return { calls, spawnProcess };
}

test('目录里只有写死的条目，版本固定不用 latest', () => {
  const ids = mcp.MCP_CATALOG_ENTRIES.map((entry) => entry.id);
  assert.deepEqual(ids, ['windows-mcp', 'playwright', 'filesystem', 'github', 'context7']);
  for (const entry of mcp.MCP_CATALOG_ENTRIES) {
    assert.ok(entry.name.length > 0, '面板要有中文名');
    assert.ok(entry.publisher.length > 0, '要写清楚是谁维护的');
    assert.match(entry.homepage, /^https:\/\//, '要能点回上游项目');
    assert.ok(entry.permissions.length > 0, '每个条目都要声明权限');
    assert.ok(entry.capabilities.length > 0, '面板要有一句话能力摘要');
    if (entry.transport === 'stdio') {
      assert.match(entry.pkg, /^@?[a-z0-9-]+(\/[a-z0-9-]+)?$/);
      assert.match(entry.version, /^\d+\.\d+\.\d+(\.\d+)?$/, '版本必须写死，不能是 latest 或 ^ 范围');
      assert.ok(entry.installNote.length > 4, '要提前告诉用户安装要等多久');
    } else {
      assert.match(entry.url, /^https:\/\//, '远端条目必须是 https');
      assert.equal(entry.pkg, undefined, '远端条目不下载任何东西');
      assert.equal(entry.installMode, 'remote');
    }
  }
  // 远端凭据只描述写法，值永远不写进代码。
  const github = mcp.findCatalogEntry('github');
  assert.equal(github.auth.headerName, 'Authorization');
  assert.equal(github.auth.headerPrefix, 'Bearer ');
  assert.equal(github.setup.requiresAuth, true);
  assert.equal(github.defaultReadOnly, true, 'GitHub 第一版默认只读');
  assert.ok(mcp.findCatalogEntry('context7').auth.optional, 'Context7 允许匿名连接');
});

test('Windows-MCP 目录项固定版本、平台和安全白名单', async () => {
  const entry = mcp.findCatalogEntry('windows-mcp');
  assert.equal(entry.installMode, 'optional-uv');
  assert.equal(entry.pkg, 'windows-mcp');
  assert.equal(entry.version, '0.8.8');
  assert.deepEqual(entry.platforms, ['win32']);
  assert.equal(entry.defaultReadOnly, true);
  assert.ok(entry.allowedTools.includes('Screenshot'));
  assert.ok(!entry.allowedTools.includes('PowerShell'));
  assert.ok(!entry.allowedTools.includes('Registry'));
  assert.equal(mcp.catalogEntryAvailable(entry, 'linux'), false);
  assert.equal(mcp.catalogEntryAvailable(entry, 'win32'), true);
  await withDataDir(async (dataDir) => {
    const server = mcp.catalogServerConfig(entry, { dataDir, enabled: true });
    assert.equal(server.transport, 'stdio');
    assert.equal(server.command, mcp.resolveCatalogUvExecutable(dataDir));
    assert.deepEqual(server.args, ['--directory', path.join(dataDir, 'mcp', 'windows-mcp'), 'run', '--no-project', '--python', path.join(dataDir, 'mcp', 'windows-mcp', '.venv', 'Scripts', 'python.exe'), 'windows-mcp', 'serve']);
    assert.equal(server.cwd, mcp.resolveCatalogWorkspace('windows-mcp', { dataDir }));
    const definitions = mcp.mcpToolDefinitions(server, [
      { name: 'Screenshot', annotations: { readOnlyHint: true } },
      { name: 'Click', annotations: { readOnlyHint: false } },
      { name: 'PowerShell', annotations: { readOnlyHint: false } },
    ]);
    assert.deepEqual(definitions.map((tool) => tool.mcp.toolName), ['Screenshot']);
    const writable = { ...server, allowWrite: true };
    const writableDefinitions = mcp.mcpToolDefinitions(writable, [
      { name: 'Screenshot', annotations: { readOnlyHint: true } },
      { name: 'Click', annotations: { readOnlyHint: false } },
      { name: 'PowerShell', annotations: { readOnlyHint: false } },
      { name: 'Registry', annotations: { readOnlyHint: false } },
    ]);
    assert.deepEqual(writableDefinitions.map((tool) => tool.mcp.toolName), ['Screenshot', 'Click']);
  });
});

test('Windows-MCP uv 安装会复用已有 Python 并补装固定包', { skip: process.platform !== 'win32' }, async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('windows-mcp');
    const installRoot = mcp.resolveCatalogInstallRoot(entry.id, { dataDir });
    const pythonPath = path.join(installRoot, '.venv', 'Scripts', 'python.exe');
    await mkdir(path.dirname(pythonPath), { recursive: true });
    await writeFile(pythonPath, 'python');
    const { calls, spawnProcess } = fakeUvSpawn(async ({ args }) => {
      assert.equal(args[0], 'pip', '已有 Python 环境不应再次运行 uv venv');
      const executable = path.join(installRoot, '.venv', 'Scripts', 'windows-mcp.exe');
      await writeFile(executable, 'entry point');
      return {};
    });

    const status = await mcp.installCatalogServer(entry.id, { dataDir }, { prepareUv: async () => {}, spawnProcess });
    assert.equal(status.installed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, mcp.resolveCatalogUvExecutable(dataDir));
    assert.deepEqual(calls[0].args, ['pip', 'install', '--python', pythonPath, 'windows-mcp==0.8.8']);
    assert.equal(calls[0].options.cwd, installRoot);
    assert.equal(calls[0].options.shell, false);
  });
});

test('Windows-MCP uv 安装会清理并重建缺少 Python 的半成品环境', { skip: process.platform !== 'win32' }, async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('windows-mcp');
    const installRoot = mcp.resolveCatalogInstallRoot(entry.id, { dataDir });
    const venvRoot = path.join(installRoot, '.venv');
    await mkdir(venvRoot, { recursive: true });
    const { calls, spawnProcess } = fakeUvSpawn(async ({ args }) => {
      if (args[0] === 'venv') {
        assert.ok(args.includes('--clear'));
        const pythonPath = path.join(venvRoot, 'Scripts', 'python.exe');
        await mkdir(path.dirname(pythonPath), { recursive: true });
        await writeFile(pythonPath, 'python');
        return {};
      }
      const executable = path.join(venvRoot, 'Scripts', 'windows-mcp.exe');
      await writeFile(executable, 'entry point');
      return {};
    });

    const status = await mcp.installCatalogServer(entry.id, { dataDir }, { prepareUv: async () => {}, spawnProcess });
    assert.equal(status.installed, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args.slice(0, 4), ['venv', '--clear', '--python', '3.14']);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[1].args.at(-1), 'windows-mcp==0.8.8');
    assert.ok(calls.every((call) => call.options.cwd === installRoot));
  });
});

test('Windows-MCP uv 安装失败会保留可读错误状态和日志', { skip: process.platform !== 'win32' }, async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('windows-mcp');
    const installRoot = mcp.resolveCatalogInstallRoot(entry.id, { dataDir });
    const pythonPath = path.join(installRoot, '.venv', 'Scripts', 'python.exe');
    await mkdir(path.dirname(pythonPath), { recursive: true });
    await writeFile(pythonPath, 'python');
    const { spawnProcess } = fakeUvSpawn(async () => ({ code: 1, stderr: 'No matching distribution found' }));

    await assert.rejects(
      () => mcp.installCatalogServer(entry.id, { dataDir }, { prepareUv: async () => {}, spawnProcess }),
      /uv 包安装失败（退出码 1）/,
    );
    const status = mcp.catalogRuntimeStatus(entry.id, { dataDir });
    assert.equal(status.state, 'error');
    assert.match(status.error, /uv 包安装失败（退出码 1）/);
    assert.match(status.logTail, /No matching distribution found/);
  });
});

test('启动参数是固定形态：独立 profile、受控输出目录、不开高权限 caps', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('playwright');
    const args = entry.args({ installRoot: path.join(dataDir, 'mcp', 'playwright'), dataDir, browser: 'chrome' });
    assert.deepEqual(args.filter((arg) => arg === '--browser'), ['--browser']);
    assert.ok(args.includes('chrome'));
    assert.ok(args.includes('--user-data-dir'));
    assert.ok(args.includes(path.join(dataDir, 'browser', 'profiles', 'default')));
    assert.ok(args.includes('--output-dir'));
    assert.ok(args.includes(path.join(dataDir, 'browser', 'downloads')));
    assert.ok(!args.includes('--caps'), '默认不开 vision / pdf / devtools（含 run-code）');
    assert.ok(!args.includes('--no-sandbox'));
    // 没探测到浏览器时不硬塞 --browser，让服务端自己报错，而不是悄悄去下一份 Chromium。
    const withoutBrowser = entry.args({ installRoot: 'x', dataDir, browser: null });
    assert.ok(!withoutBrowser.includes('--browser'));
  });
});

test('系统浏览器探测：找到 Chrome 就不必再下一份 Chromium', async () => {
  await withDataDir(async (dir) => {
    const chrome = path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe');
    await mkdir(path.dirname(chrome), { recursive: true });
    await writeFile(chrome, '// fake chrome\n');
    const found = mcp.detectSystemBrowser('win32', { ProgramFiles: dir, 'ProgramFiles(x86)': path.join(dir, 'nope'), LOCALAPPDATA: path.join(dir, 'nope') });
    assert.equal(found.channel, 'chrome');
    assert.equal(found.path, chrome);
    const missing = mcp.detectSystemBrowser('win32', { ProgramFiles: path.join(dir, 'nope'), 'ProgramFiles(x86)': path.join(dir, 'nope'), LOCALAPPDATA: path.join(dir, 'nope') });
    assert.equal(missing.channel, null);
    assert.equal(mcp.detectSystemBrowser('plan9').channel, null, '不认识的平台直接当作没有');
  });
});

test('没装好就不出现在服务列表里，避免面板摆一个点不动的入口', async () => {
  await withDataDir(async (dataDir) => {
    assert.equal(mcp.catalogEntryEnabled('playwright', { dataDir }), false);
    mcp.setCatalogEntryEnabled('playwright', true, { dataDir });
    assert.equal(mcp.catalogEntryEnabled('playwright', { dataDir }), true);
    assert.deepEqual(mcp.listCatalogServers({ dataDir }), [], '没装好时即使开了开关也不返回');
    assert.equal(mcp.isCatalogInstalled(mcp.findCatalogEntry('playwright'), { dataDir }), false);
    assert.equal(mcp.catalogRuntimeStatus('playwright', { dataDir }).state, 'not_installed');
  });
});

test('装好并开启后，服务配置由代码生成：Node + 固定脚本 + 受控工作目录', async () => {
  await withDataDir(async (dataDir) => {
    const bin = await fakeInstall(dataDir);
    mcp.setCatalogEntryEnabled('playwright', true, { dataDir });
    const servers = mcp.listCatalogServers({ dataDir });
    assert.equal(servers.length, 1);
    const server = servers[0];
    assert.equal(server.id, 'playwright');
    assert.equal(server.transport, 'stdio');
    assert.equal(server.url, 'stdio://playwright');
    assert.equal(server.catalogId, 'playwright');
    assert.equal(server.command, process.execPath, '只能启动 Node 自己，不是用户能改的命令');
    assert.equal(server.args[0], bin);
    assert.equal(server.cwd, mcp.resolveCatalogWorkspace('playwright', { dataDir }));
    assert.equal(server.enabled, true);
    const idle = mcp.catalogRuntimeStatus('playwright', { dataDir });
    assert.equal(idle.state, 'installed');
    // 没在跑就谈不上「参数过期」：面板不能凭这个给一个不存在的进程挂警告。
    assert.equal(idle.argsStale, false);
    assert.equal(idle.startedBrowserPath, null);
  });
});

test('服务 id 必须能拼出合法的 function name', async () => {
  await withDataDir(async (dataDir) => {
    const server = mcp.catalogServerConfig(mcp.findCatalogEntry('playwright'), { dataDir, enabled: true, browser: { channel: 'chrome' } });
    const definitions = mcp.mcpToolDefinitions(server, [{ name: 'browser_navigate' }]);
    assert.deepEqual(definitions.map((tool) => tool.name), ['playwright__browser_navigate']);
    assert.equal(definitions[0].id, 'mcp:playwright:browser_navigate');
  });
});

test('白名单挡掉在服务进程里跑任意代码的工具', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('playwright');
    assert.ok(!entry.allowedTools.includes('browser_run_code_unsafe'), 'run_code_unsafe 等于把整台机器交出去，必须排除');
    assert.ok(entry.allowedTools.includes('browser_click'));
    const server = mcp.catalogServerConfig(entry, { dataDir, enabled: true, browser: { channel: 'chrome' } });
    assert.deepEqual(server.enabledTools, [...entry.allowedTools], '白名单要落到服务配置里，不能只是写在目录上');
    // 上游多公布的工具默认不放行：上游升级不会自动新增能力。
    const definitions = mcp.mcpToolDefinitions(server, [
      { name: 'browser_click' },
      { name: 'browser_run_code_unsafe' },
      { name: 'browser_something_new' },
    ]);
    assert.deepEqual(definitions.map((tool) => tool.name), ['playwright__browser_click']);
  });
});

test('手动 MCP 连接也永远不下发 PowerShell 或 Registry 原始系统工具', () => {
  const server = {
    id: 'cursortouch-windows-mcp',
    name: 'Windows MCP',
    url: 'http://127.0.0.1:8080',
    enabled: true,
    allowWrite: true,
    enabledTools: ['Screenshot', 'Click', 'PowerShell', 'Run_PowerShell', 'Registry', 'read_registry_key'],
  };
  const definitions = mcp.mcpToolDefinitions(server, server.enabledTools.map((name) => ({
    name,
    annotations: { readOnlyHint: name === 'Screenshot' },
  })));
  assert.deepEqual(definitions.map((tool) => tool.mcp.toolName), ['Screenshot', 'Click']);

  const unrelatedServer = { ...server, id: 'registry-reference', name: 'Reference MCP' };
  const unrelated = mcp.mcpToolDefinitions(unrelatedServer, [{ name: 'Registry', annotations: { readOnlyHint: true } }]);
  assert.deepEqual(unrelated.map((tool) => tool.mcp.toolName), ['Registry']);
});

test('Windows-MCP routes Device Manager requests and documents the safe App launch modes', () => {
  const server = {
    id: 'windows-mcp', name: 'Windows Desktop', catalogId: 'windows-mcp',
    url: 'stdio://windows-mcp', enabled: true, allowWrite: true, lazy: true, enabledTools: ['App'],
  };
  assert.deepEqual(mcp.mcpServersForTurn([server], '打开设备管理器'), [server]);
  assert.deepEqual(mcp.mcpServersForTurn([server], '今天天气怎么样'), []);

  const [app] = mcp.mcpToolDefinitions(server, [{
    name: 'App', description: 'Open/start/launch applications and manage windows.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false },
  }]);
  assert.match(app.description, /mode="launch_executable"/);
  assert.match(app.description, /\.msc and \.cpl files are not executable paths/);
  assert.match(app.description, /mmc\.exe/);
  assert.match(app.description, /devmgmt\.msc/);
  assert.match(app.description, /Device Manager/);
  const [type] = mcp.mcpToolDefinitions({ ...server, enabledTools: ['Type'] }, [{ name: 'Type', description: 'Type text into an application.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } }]);
  assert.match(type.description, /requires text and either loc=\[x,y\] or label from a fresh Snapshot/);
});

test('旧版 Windows-MCP 手动副本不会与内置连接器并行运行', async () => {
  await withDataDir(async (dataDir) => {
    const storeFile = path.join(dataDir, 'mcp', 'servers.json');
    await mkdir(path.dirname(storeFile), { recursive: true });
    await writeFile(storeFile, JSON.stringify({
      version: 1,
      servers: [
        { id: 'cursortouch-windows-mcp', name: 'windows-mcp', url: 'http://127.0.0.1:8080', enabled: true, allowWrite: true },
        { id: 'my-service', name: 'My service', url: 'https://example.com/mcp', enabled: true, allowWrite: false },
      ],
    }));
    const installRoot = mcp.resolveCatalogInstallRoot('windows-mcp', { dataDir });
    const pythonBin = path.join(installRoot, '.venv', 'Scripts', 'python.exe');
    const windowsBin = path.join(installRoot, '.venv', 'Scripts', 'windows-mcp.exe');
    await mkdir(path.dirname(windowsBin), { recursive: true });
    await writeFile(pythonBin, 'fake');
    await writeFile(windowsBin, 'fake');
    mcp.setCatalogEntryEnabled('windows-mcp', true, { dataDir });

    const servers = mcp.listMcpServers({ dataDir });
    const expectedIds = ['my-service', ...(process.platform === 'win32' ? ['windows-mcp'] : [])];
    assert.deepEqual(servers.map((server) => server.id), expectedIds);
    assert.equal(servers.filter((server) => server.catalogId === 'windows-mcp').length, process.platform === 'win32' ? 1 : 0);
  });
});

test('开关是分开存的：读不到、写坏了都不影响用户自己配的服务', async () => {
  await withDataDir(async (dataDir) => {
    assert.deepEqual(mcp.readCatalogState({ dataDir }), {});
    assert.throws(() => mcp.setCatalogEntryEnabled('not-a-service', true, { dataDir }), /未知的本地服务/);
    mcp.setCatalogEntryEnabled('playwright', true, { dataDir });
    mcp.setCatalogEntryEnabled('playwright', false, { dataDir });
    assert.equal(mcp.catalogEntryEnabled('playwright', { dataDir }), false);
    const stateFile = mcp.resolveCatalogStateFile({ dataDir });
    assert.ok(stateFile.endsWith(path.join('mcp', 'catalog.json')));
  });
});

test('未安装就启动会直接说清楚，不会偷偷去装', async () => {
  await withDataDir(async (dataDir) => {
    await assert.rejects(() => mcp.startCatalogServer('playwright', { dataDir }), /还没安装/);
    await assert.rejects(() => mcp.installCatalogServer('unknown'), /未知的本地服务/);
    assert.throws(() => mcp.catalogRuntimeStatus('unknown'), /未知的本地服务/);
  });
});

test('停止服务会先落开关，再收进程', async () => {
  await withDataDir(async (dataDir) => {
    await fakeInstall(dataDir);
    mcp.setCatalogEntryEnabled('playwright', true, { dataDir });
    const status = mcp.stopCatalogServer('playwright', { dataDir });
    assert.equal(status.enabled, false);
    assert.equal(status.running, false);
    assert.deepEqual(mcp.listCatalogServers({ dataDir }), []);
  });
});

test('npm 路径来自 Node 自己的安装目录，找不到就返回 null', () => {
  const resolved = mcp.resolveNpmCliPath(process.execPath);
  assert.ok(resolved === null || path.isAbsolute(resolved));
  assert.equal(mcp.resolveNpmCliPath(path.join(os.tmpdir(), 'no-node-here', 'node')), null);
});

test('安装日志写在数据目录里，方便失败时回看', async () => {
  await withDataDir(async (dataDir) => {
    const file = mcp.resolveCatalogInstallLogFile('playwright', { dataDir });
    assert.ok(file.includes(path.join('mcp', 'logs')));
    assert.ok(file.endsWith('playwright-install.log'));
  });
});

test('接日常浏览器：扩展模式与内置模式互斥，模式存得住也进得了启动参数', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('playwright');
    const installRoot = path.join(dataDir, 'mcp', 'playwright');
    const managed = entry.args({ installRoot, dataDir, browser: 'chrome', browserMode: 'managed' });
    assert.ok(managed.includes('--browser'));
    assert.ok(managed.includes('--user-data-dir'), '内置模式用独立 profile，不碰用户日常浏览器');
    assert.ok(!managed.includes('--extension'));
    const extension = entry.args({ installRoot, dataDir, browser: 'chrome', browserMode: 'extension' });
    assert.ok(extension.includes('--extension'));
    assert.ok(!extension.includes('--browser'), '--extension 会忽略 --browser，传了只会让人以为还能选浏览器');
    assert.ok(!extension.includes('--user-data-dir'), '接的是用户自己开着的浏览器，不能去动他的 profile');
    assert.deepEqual(extension.filter((arg) => arg === '--output-dir').length, 1, '两种模式都要把产物收进受控目录');
    // Playwright 默认接入系统默认浏览器；明确选择 managed 后仍可使用独立浏览器。
    assert.equal(mcp.catalogEntryBrowserMode('playwright', { dataDir }), 'extension');
    assert.equal(mcp.catalogEntryBrowserMode('filesystem', { dataDir }), 'managed', '非浏览器条目也有默认值，面板不用额外判断');
    mcp.setCatalogEntryBrowserMode('playwright', 'managed', { dataDir });
    assert.equal(mcp.catalogEntryBrowserMode('playwright', { dataDir }), 'managed');
    mcp.setCatalogEntryBrowserMode('playwright', 'extension', { dataDir });
    assert.equal(mcp.catalogEntryBrowserMode('playwright', { dataDir }), 'extension');
    assert.throws(() => mcp.setCatalogEntryBrowserMode('not-a-service', 'extension', { dataDir }), /未知的本地服务/);
    const config = mcp.catalogServerConfig(entry, { dataDir, enabled: true, browser: { channel: 'chrome' } });
    assert.ok(config.args.includes('--extension'), '切过模式之后，代码生成的启动参数要跟着变');
    // 引导信息要能直接渲染：商店地址和官方 id 对得上，权限说明不能是空的。
    assert.ok(entry.browserExtension.storeUrl.includes(entry.browserExtension.storeId));
    assert.equal(entry.browserExtension.storeId, 'mmlmfjhmonkocbjadbfplnigmagldckm', '必须是微软官方那份扩展');
    assert.ok(entry.browserExtension.note.includes('debugger') || entry.browserExtension.note.includes('调试器'));
  });
});

test('servers.json 里的同名旧副本不算数，也不会让内置条目出现两份', async () => {
  await withDataDir(async (dataDir) => {
    // 模拟早期版本遗留的副本：带 catalogId，白名单里还留着代码已经排除的 browser_run_code_unsafe。
    const storeFile = path.join(dataDir, 'mcp', 'servers.json');
    await mkdir(path.dirname(storeFile), { recursive: true });
    await writeFile(storeFile, JSON.stringify({
      version: 1,
      servers: [
        { id: 'playwright', name: '浏览器控制', url: 'https://example.com/old-copy', catalogId: 'playwright', enabled: true, allowWrite: true, enabledTools: ['browser_click', 'browser_run_code_unsafe'] },
        { id: 'my-github', name: '我的 GitHub', url: 'https://example.com/mcp', enabled: true },
      ],
    }, null, 2));
    await fakeInstall(dataDir);
    mcp.setCatalogEntryEnabled('playwright', true, { dataDir });
    const servers = mcp.listMcpServers({ dataDir });
    const ids = servers.map((server) => server.id);
    assert.deepEqual(ids, ['my-github', 'playwright'], '用户自己的服务照旧，内置条目只留代码这一份');
    assert.equal(new Set(ids).size, ids.length, '同一个 id 不能出现两条');
    const playwright = servers.find((server) => server.id === 'playwright');
    assert.equal(playwright.command, process.execPath, '命令来自代码，不来自旧副本');
    assert.equal(playwright.url, 'stdio://playwright');
    assert.ok(!playwright.enabledTools.includes('browser_run_code_unsafe'), '旧副本的白名单不许生效');
    assert.deepEqual(playwright.enabledTools, [...mcp.findCatalogEntry('playwright').allowedTools]);
    // 再兜一道：就算有人把服务配置里的白名单改成放行，工具表也不下发它。
    const definitions = mcp.mcpToolDefinitions({ ...playwright, enabledTools: ['browser_click', 'browser_run_code_unsafe'] }, [
      { name: 'browser_click' },
      { name: 'browser_run_code_unsafe' },
    ]);
    assert.deepEqual(definitions.map((tool) => tool.name), ['playwright__browser_click']);
  });
});

test('站点名单：空着不传参，填了才追加，写法放宽但拒绝乱填', async () => {
  await withDataDir(async (dataDir) => {
    await fakeInstall(dataDir);
    const entry = mcp.findCatalogEntry('playwright');

    // 不填 = 不限制：启动参数里不该出现这两个开关，默认行为和以前一模一样。
    const plain = mcp.catalogServerConfig(entry, { dataDir, enabled: true, browser: { channel: 'chrome' } });
    assert.equal(plain.args.some((arg) => String(arg).startsWith('--allowed-origins')), false);
    assert.equal(plain.args.some((arg) => String(arg).startsWith('--blocked-origins')), false);
    assert.deepEqual(mcp.catalogEntryOrigins('playwright', { dataDir }), { allowed: [], blocked: [] });

    mcp.setCatalogEntryOrigins(
      'playwright',
      { allowed: ['https://example.com', ' *.trusted.com ', 'https://example.com'], blocked: 'evil.com\nbad.example' },
      { dataDir },
    );
    assert.deepEqual(mcp.catalogEntryOrigins('playwright', { dataDir }), {
      allowed: ['https://example.com', '*.trusted.com'],
      blocked: ['evil.com', 'bad.example'],
    });

    const config = mcp.catalogServerConfig(entry, { dataDir, enabled: true, browser: { channel: 'chrome' } });
    const allowedAt = config.args.indexOf('--allowed-origins');
    const blockedAt = config.args.indexOf('--blocked-origins');
    assert.notEqual(allowedAt, -1);
    assert.equal(config.args[allowedAt + 1], 'https://example.com;*.trusted.com', '服务端按分号分隔解析');
    assert.equal(config.args[blockedAt + 1], 'evil.com;bad.example');

    // 扩展模式同样带名单：换的是浏览器，不是要不要限制站点。
    mcp.setCatalogEntryBrowserMode('playwright', 'extension', { dataDir });
    const extension = mcp.catalogServerConfig(entry, { dataDir, enabled: true, browser: { channel: 'chrome' } });
    assert.ok(extension.args.includes('--extension'));
    assert.equal(extension.args[extension.args.indexOf('--allowed-origins') + 1], 'https://example.com;*.trusted.com');

    // 填错一项就整次拒绝，并说清是哪一项：静默丢掉会让人以为限制生效了。
    assert.throws(() => mcp.setCatalogEntryOrigins('playwright', { allowed: ['http://exa mple.com'] }, { dataDir }), /不能含空格或分号/);
    assert.throws(() => mcp.setCatalogEntryOrigins('playwright', { allowed: ['???'] }, { dataDir }), /既不像网址也不像域名/);
    assert.throws(() => mcp.setCatalogEntryOrigins('playwright', { allowed: [`https://${'a'.repeat(220)}.com`] }, { dataDir }), /太长了/);
    assert.throws(() => mcp.setCatalogEntryOrigins('not-a-service', { allowed: ['a.com'] }, { dataDir }), /未知的本地服务/);
    assert.deepEqual(mcp.catalogEntryOrigins('playwright', { dataDir }).allowed, ['https://example.com', '*.trusted.com'], '被拒的那次不能改动已存的名单');

    // 条数封顶：再多就不是「限制几个站点」，而是抄一份导航站清单。
    const many = mcp.normalizeCatalogOrigins(Array.from({ length: mcp.MCP_CATALOG_MAX_ORIGINS + 10 }, (_, index) => `site${index}.example`));
    assert.equal(many.length, mcp.MCP_CATALOG_MAX_ORIGINS);
    mcp.setCatalogEntryOrigins('playwright', { allowed: many, blocked: [] }, { dataDir });
    assert.equal(mcp.catalogEntryOrigins('playwright', { dataDir }).allowed.length, mcp.MCP_CATALOG_MAX_ORIGINS);
  });
});
