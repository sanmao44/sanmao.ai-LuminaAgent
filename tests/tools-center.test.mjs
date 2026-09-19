import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const toolsRoute = await readFile(new URL('../app/api/tools/route.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../components/McpManager.tsx', import.meta.url), 'utf8');

test('工具中心面板接口要求管理员，并只接受白名单动作', () => {
  assert.match(toolsRoute, /if \(!isAdminRequest\(request\)\) return Response\.json\(\{ error: '需要管理员登录。' \}, \{ status: 401 \}\);/);
  assert.equal((toolsRoute.match(/isAdminRequest\(request\)/g) || []).length, 2, 'GET 和 POST 都要挡');
  assert.match(toolsRoute, /const TOOL_ACTIONS = \['install', 'start', 'stop', 'cancel'\] as const;/);
  assert.match(toolsRoute, /if \(!\(TOOL_ACTIONS as readonly string\[\]\)\.includes\(action\)\) \{/);
});

test('命令、参数和安装路径都来自代码内置条目，请求体只能给 id', () => {
  // 路由只读取 action 和 id：没有任何字段能影响跑什么命令或装到哪里。
  assert.match(toolsRoute, /const data = \(await request\.json\(\)\.catch\(\(\) => \(\{\}\)\)\) as \{ action\?: unknown; id\?: unknown \};/);
  assert.doesNotMatch(toolsRoute, /data\?\.(command|args|cwd|url|env)/);
  assert.match(toolsRoute, /for \(const entry of MCP_CATALOG_ENTRIES\) \{/);
});

test('装完/停掉之后要丢掉工具缓存，否则模型还会拿着旧工具表', () => {
  assert.equal((toolsRoute.match(/clearMcpToolCache\(\);/g) || []).length, 2);
});

test('面板状态只回脱敏配置', () => {
  assert.match(toolsRoute, /servers: listMcpServers\(\)\.map\(redactMcpServer\)/);
  assert.doesNotMatch(toolsRoute, /headers:/);
});

test('面板给出安装/启动/停止/取消，并说明空闲回收与浏览器来源', () => {
  assert.match(panel, /本地工具运行时/);
  for (const label of ['安装', '启动', '停止', '取消安装']) {
    assert.ok(panel.includes(`>${label}</button>`), `missing ${label}`);
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