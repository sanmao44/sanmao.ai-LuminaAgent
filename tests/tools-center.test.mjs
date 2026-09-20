import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const toolsRoute = await readFile(new URL('../app/api/tools/route.ts', import.meta.url), 'utf8');
const probeRoute = await readFile(new URL('../app/api/mcp/[id]/probe/route.ts', import.meta.url), 'utf8');
const approvalSource = await readFile(new URL('../lib/agent/approval.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../components/McpManager.tsx', import.meta.url), 'utf8');
const panelCss = await readFile(new URL('../components/McpManager.module.css', import.meta.url), 'utf8');

test('工具中心面板接口要求管理员，并只接受白名单动作', () => {
  assert.match(toolsRoute, /if \(!isAdminRequest\(request\)\) return Response\.json\(\{ error: '需要管理员登录。' \}, \{ status: 401 \}\);/);
  assert.equal((toolsRoute.match(/isAdminRequest\(request\)/g) || []).length, 2, 'GET 和 POST 都要挡');
  assert.match(toolsRoute, /const TOOL_ACTIONS = \['install', 'start', 'stop', 'cancel', 'connect', 'disconnect', 'configure', 'allow-write', 'toolset', 'write-gate', 'roots-add', 'roots-write', 'roots-remove', 'roots-open', 'runtime-open', 'browser-mode', 'extension-open', 'origins', 'tool-policy', 'browser-exe', 'extension-token'\] as const;/);
  assert.match(toolsRoute, /if \(!\(TOOL_ACTIONS as readonly string\[\]\)\.includes\(action\)\) \{/);
});

test('命令、参数和安装路径都来自代码内置条目，请求体只能给 id', () => {
  // 路由只读取 action 和 id：没有任何字段能影响跑什么命令或装到哪里。
  assert.match(toolsRoute, /const data = \(await request\.json\(\)\.catch\(\(\) => \(\{\}\)\)\) as \{/);
  assert.doesNotMatch(toolsRoute, /data\?\.(command|args|cwd|url|env)/);
  assert.match(toolsRoute, /for \(const entry of MCP_CATALOG_ENTRIES\) \{/);
});

test('装完/停掉之后要丢掉工具缓存，否则模型还会拿着旧工具表', () => {
  // 八个入口：装/启停、开关写入权限、改能力组、改写权限分项、增删授权目录、
  // 切换浏览器接入方式、换浏览器可执行文件、存/清扩展连接码（后两个都改了启动参数）。
  assert.equal((toolsRoute.match(/clearMcpToolCache\(\);/g) || []).length, 8);
});

test('执行代码的工具不能被「以后直接允许」记住，接口和面板都拦一道', () => {
  // 判定层不认这条记忆（见 agent-approval.test.mjs），这里管的是「别让用户勾一个不生效的状态」。
  assert.match(approvalSource, /if \(next === 'always_allow' && unbypassable\) \{/);
  assert.match(approvalSource, /const unbypassable = unbypassableApprovalReason\(key\);/);
  assert.match(probeRoute, /unbypassableReason: unbypassableApprovalReason\(tool\.name\)/);
  assert.match(panel, /\{tool\.unbypassableReason/);
  assert.match(panel, /每次都问（不可记住）/);
});

test('面板状态只回脱敏配置', () => {
  // 先整体脱敏，再各挂一条协商结果：请求头只留键名，值永远不出服务端。
  assert.match(toolsRoute, /const servers = rawServers\.map\(\(server\) => \(\{ \.\.\.redactMcpServer\(server\), protocol: resolveMcpProtocolNegotiation\(server\) \}\)\);/);
  assert.doesNotMatch(toolsRoute, /headers:/);
});

test('授权文件夹有常用位置可选，不用用户自己拼绝对路径', () => {
  assert.match(panel, /rootSuggestions\.map\(/);
  assert.match(panel, /常用位置：/);
  assert.match(panel, /onClick=\{\(\) => void addRootPath\(suggestion\)\}/);
  // 建议只做建议：真正落盘还是走同一个 roots-add 动作，服务端照旧做完整校验。
  assert.match(panel, /action: 'roots-add', path \}/);
  assert.match(toolsRoute, /suggestFilesystemRoots\(\{ excluded: roots \}\)/);
  assert.doesNotMatch(toolsRoute, /data\?\.rootSuggestions/);
});
test('帮助说明跟上连接器：官方清单、凭据、逐项写权限都说清楚', () => {
  assert.match(panel, /官方连接器：<\/strong>浏览器控制、本地文件、GitHub、开发文档/);
  assert.match(panel, /点「断开」会把本机保存的那份凭据一起删掉/);
  assert.match(panel, /GitHub 建议用 fine-grained token/);
  assert.match(panel, /GitHub 还要逐项打开（创建 Issue、评论、创建 PR、改文件、Merge 等）/);
  assert.match(panel, /助手改不了它们的地址和权限，也断不开/);
});
test('面板把能力组和写权限分项摆出来，并且逐项提交', () => {
  assert.match(panel, /能力组：关掉的组不会交给助手/);
  assert.match(panel, /写权限：全部关闭（先打开上面的「允许写入」，再逐项放开）/);
  assert.match(panel, /action: 'toolset', id: item\.id, toolset: toolset\.id/);
  assert.match(panel, /action: 'write-gate', id: item\.id, gate: gate\.id/);
  assert.match(panel, /没有开关，Catalog 里不会执行/);
  assert.match(panel, /item\.auth\.note/);
});
test('面板给出安装/启动/停止/取消，并说明空闲回收与浏览器来源', () => {
  assert.match(panel, /本地工具运行时/);
  // 动作按钮在跑的时候会换成「启动中…」这类说法，两种写法都算这个动作在。
  for (const label of ['安装', '启动', '停止', '取消安装']) {
    assert.ok(panel.includes(`>${label}</button>`) || panel.includes(`: '${label}'}`), `missing ${label}`);
  }
  assert.ok(panel.includes("'刷新状态'"));
  assert.match(panel, /未检测到 Chrome 或 Edge，需要先装一个/);
  assert.match(panel, /分钟后自动关闭/);
  assert.match(panel, /styles\.logTail/);
  assert.match(panel, /body: JSON\.stringify\(\{ action, id: runtime\.id \}\),/);
  // 面板自己不能拼请求：安装与启动都走同一个白名单接口。
  assert.doesNotMatch(panel, /npx |npm install|exec\(/);
});

test('安装期间会轮询状态与日志，装完自动停止轮询', () => {
  assert.match(panel, /const installingRuntime = runtimes\.some\(\(runtime\) => runtime\.installing\);/);
  assert.match(panel, /\}, 2000\);/);
  assert.match(panel, /return \(\) => clearInterval\(timer\);/);
});

test('面板只有一个滚动区：官方连接器和运行时详情都在里面，不会被对话框裁掉', () => {
  const panelOpen = panel.indexOf('<div className={styles.panel}>');
  const lastSection = panel.lastIndexOf('</section>');
  const panelClose = panel.lastIndexOf('</div>');
  const footer = panel.indexOf('<footer className={styles.footer}>');
  assert.ok(panelOpen > -1 && lastSection > -1 && footer > -1, '面板、section、footer 都要在');
  // 之前这几个 section 是 .dialog 的直接子项，超出部分被对话框的 overflow: hidden 直接裁掉。
  assert.ok(panelOpen < lastSection && lastSection < panelClose && panelClose < footer, '所有 section 都要落在 .panel 里、footer 之外');
  assert.doesNotMatch(panelCss, /max-height: min\(56dvh, 520px\)/, '面板是唯一滚动区，自己再限高就会把下面的内容挤没');
  assert.match(panelCss, /\.panel \{[\s\S]*?flex: 1 1 auto; min-height: 0; overflow: auto;/);
  assert.match(panelCss, /\.helpPanel \{[\s\S]*?max-height: min\(46dvh, 420px\);[\s\S]*?overflow: auto;/, '展开帮助说明不能把面板挤成 0 高');
});

/** 假的 spawn：只记下「打算用什么命令、什么选项打开哪个目录」，测试不会真的弹资源管理器。 */
function fakeSpawn(calls, failWith = null) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return {
      once(event, handler) {
        if (event === 'error' && failWith) handler(failWith);
        if (event === 'spawn' && !failWith) handler();
      },
      unref() {},
    };
  };
}

test('「打开文件夹」只认已授权的目录和代码里的安装目录，路径不会进 shell', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-open-folder-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'sanmao-open-target-'));
  try {
    // 打开方式写死在代码里，路径是参数、不是命令的一部分。
    assert.deepEqual(mcp.folderOpenCommand(outside, 'win32'), { command: 'explorer.exe', args: [outside] });
    assert.deepEqual(mcp.folderOpenCommand(outside, 'darwin'), { command: 'open', args: [outside] });
    assert.deepEqual(mcp.folderOpenCommand(outside, 'linux'), { command: 'xdg-open', args: [outside] });

    // 没授权的目录一律拒绝：面板传什么都越不过白名单。
    await assert.rejects(mcp.openFilesystemRoot(outside, { dataDir, spawnImpl: fakeSpawn([]) }), /只能打开已经授权的文件夹/);

    mcp.addFilesystemRoot(outside, { dataDir });
    const [root] = mcp.listFilesystemRoots({ dataDir });
    const calls = [];
    assert.equal(await mcp.openFilesystemRoot(root, { dataDir, platform: 'win32', spawnImpl: fakeSpawn(calls) }), root);
    assert.deepEqual(calls.map((call) => ({ command: call.command, args: call.args })), [{ command: 'explorer.exe', args: [root] }]);
    // 只能用 detached + stdio ignore：加了 windowsHide 之后资源管理器会把窗口按隐藏创建，
    // 实测 IsWindowVisible=False——用户点了按钮只会觉得「什么都没发生」。
    assert.equal(calls[0].options.detached, true);
    assert.equal('windowsHide' in calls[0].options, false, 'windowsHide 会让资源管理器开出隐形窗口');

    // 运行时目录：id 必须是目录里的本机条目，没装就没有目录可打开。
    await assert.rejects(mcp.openCatalogFolder('not-a-real-entry', { dataDir }), /未知的本地服务/);
    await assert.rejects(mcp.openCatalogFolder('github', { dataDir }), /未知的本地服务/, '远端连接器没有安装目录');
    await assert.rejects(mcp.openCatalogFolder('playwright', { dataDir }), /还没安装/);
    mkdirSync(path.join(dataDir, 'mcp', 'playwright'), { recursive: true });
    const runtimeCalls = [];
    const runtimeRoot = mcp.resolveCatalogInstallRoot('playwright', { dataDir });
    assert.equal(await mcp.openCatalogFolder('playwright', { dataDir, platform: 'win32', spawnImpl: fakeSpawn(runtimeCalls) }), runtimeRoot);
    assert.deepEqual(runtimeCalls.map((call) => ({ command: call.command, args: call.args })), [{ command: 'explorer.exe', args: [runtimeRoot] }]);

    // 系统里没有这个命令（精简 Linux 没装 xdg-open）：要报出来，不能假装成功。
    const missing = Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' });
    await assert.rejects(
      mcp.openFilesystemRoot(root, { dataDir, platform: 'linux', spawnImpl: fakeSpawn([], missing) }),
      /ENOENT/,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('授权目录与安装目录都能一键在系统文件管理器里打开', () => {
  assert.match(panel, /action: 'roots-open', path \}/);
  assert.match(panel, /action: 'runtime-open', id: runtime\.id \}/);
  assert.ok(panel.includes('>打开文件夹</button>'), '授权目录这一行要有打开文件夹');
  assert.ok(panel.includes('>打开目录</button>'), '运行时详情里要有打开安装目录');
  // 面板自己不开命令：两个打开动作都走同一个白名单接口。
  assert.match(toolsRoute, /await openFilesystemRoot\(data\?\.path\) : await openCatalogFolder\(data\?\.id\)/);
  assert.doesNotMatch(panel, /explorer|xdg-open/);
});

test('本机运行时状态按真实实现计算：没装就是未安装，并带空闲上限', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-tools-center-'));
  try {
    const status = mcp.catalogRuntimeStatus('playwright', { dataDir });
    assert.equal(status.id, 'playwright');
    assert.equal(status.state, 'not_installed');
    assert.equal(status.installed, false);
    assert.equal(status.installing, false);
    assert.equal(status.running, false);
    assert.equal(status.pid, null);
    assert.equal(status.idleTimeoutMs, mcp.MCP_STDIO_IDLE_TIMEOUT_MS);
    assert.ok(status.installRoot.startsWith(dataDir), '依赖必须装在应用数据目录里，不能污染系统');
    assert.ok(status.installNote.length > 0);
    assert.equal(mcp.listCatalogServers({ dataDir }).length, 0, '没打开开关时不该出现在工具表里');
    assert.throws(() => mcp.catalogRuntimeStatus('not-a-real-entry', { dataDir }), /未知的本地服务/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('受控条目的工具白名单挡住任意代码执行', () => {
  const entry = mcp.MCP_CATALOG_ENTRIES.find((item) => item.id === 'playwright');
  assert.ok(entry);
  assert.ok(entry.allowedTools.includes('browser_snapshot'));
  assert.ok(!entry.allowedTools.includes('browser_run_code_unsafe'));
});
test('面板能给单个服务打开「按需下发」，并说清它的作用', () => {
  assert.match(panel, /updateServer\(server, \{ lazy: !server\.lazy \}\)/);
  assert.match(panel, /只有这一轮提到这个服务（服务名或工具名）才会把它的工具交给助手/);
  assert.match(panel, /\{server\.lazy && <span className=\{styles\.badgeMuted\}>按需下发<\/span>\}/);
});
