#!/usr/bin/env node
/**
 * 真实 GitHub 官方 MCP 服务的冒烟测试（任务书 §52）。
 *
 * 只有设了令牌才跑；没设就打印一句「跳过」并正常退出，所以不会拖累 npm test。
 * 这里连的是真服务，能验证日常测不到的三件事：
 * 1. 三个官方请求头（toolsets / readonly / lockdown）服务端确实认；
 * 2. 只读模式下服务端真的不公布写工具（这是我们「默认只读」承诺的底）；
 * 3. 上游公布的写工具，有多少能被内置目录里的写权限项对上——对不上的会照旧被拒绝，
 *    但说明上游改了工具名，需要回去更新 lib/mcp/catalog.ts。
 *
 * 用法（在项目根目录）：
 *   GITHUB_MCP_TOKEN=github_pat_xxx npm run smoke:github
 * 或 PowerShell：
 *   $env:GITHUB_MCP_TOKEN='github_pat_xxx'; npm run smoke:github
 *
 * 只用只读调用：整个脚本不会创建、修改或删除任何 GitHub 上的东西。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const token = String(process.env.GITHUB_MCP_TOKEN || process.env.GITHUB_TOKEN || '').trim();
if (!token) {
  console.log('跳过 GitHub 冒烟测试：没有设置 GITHUB_MCP_TOKEN（或 GITHUB_TOKEN）。');
  console.log('设置一个有 repo 读权限的 fine-grained token 后再跑：npm run smoke:github');
  process.exit(0);
}

// 用真实的目录定义，而不是在这里再抄一份工具名：抄一份的话，本文件永远「通过」也说明不了任何事。
const { buildMcpModule } = await import(new URL('../tests/tools-build.mjs', import.meta.url));
const mcp = await buildMcpModule();

const TIMEOUTS = { init: 20_000, list: 20_000, call: 20_000 };
const failures = [];
const warnings = [];

function pass(message) {
  console.log(`  ✓ ${message}`);
}
function fail(message) {
  failures.push(message);
  console.log(`  ✗ ${message}`);
}
function warn(message) {
  warnings.push(message);
  console.log(`  ! ${message}`);
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-smoke-github-'));
try {
  const entry = mcp.findCatalogEntry('github');
  if (!entry) throw new Error('内置目录里没有 github 条目，检查 lib/mcp/catalog.ts。');
  // 自测用：把地址指向本地假服务，脚本自己的检查逻辑才有办法被测到（见 tests/mcp-github-smoke.test.mjs）。
  const target = String(process.env.SANMAO_SMOKE_GITHUB_URL || '').trim() || entry.url;

  const server = (allowWrite) => ({
    id: 'github',
    name: entry.name,
    url: target,
    enabled: true,
    allowWrite,
    // 和线上连接流程完全同一套请求头：这里发出的就是面板连接时发出的。
    headers: {
      authorization: `Bearer ${token}`,
      ...mcp.remoteCatalogDefaultHeaders(entry, allowWrite, entry.toolSelection.defaultToolsets),
    },
    catalogId: entry.id,
  });

  console.log(`GitHub MCP 冒烟测试：${target}（令牌长度 ${token.length}，内容不会打印）`);

  console.log('\n[1/3] 只读模式：服务端应当只公布只读工具');
  let readTools = [];
  try {
    const probe = await mcp.probeMcpServer(server(false), { retry: true, timeouts: TIMEOUTS });
    readTools = probe.tools;
    pass(`连通，公布 ${readTools.length} 个工具（其中只读 ${probe.readOnly} 个）`);
    const leaked = readTools.filter((tool) => tool.annotations?.readOnlyHint !== true);
    if (leaked.length) fail(`只读模式下仍公布了写工具：${leaked.map((tool) => tool.name).join(', ')}`);
    else pass('没有写工具泄漏出来（x-mcp-readonly 生效）');
    const hasGetMe = readTools.some((tool) => tool.name === 'get_me');
    if (!hasGetMe) warn('没看到 get_me（context 能力组可能被上游改名或移除）');
  } catch (error) {
    fail(`连不上：${error instanceof Error ? error.message : String(error)}`);
    fail('如果提示 401/403，先确认令牌没过期、且带 repo 读权限。');
  }

  console.log('\n[2/3] 只读调用：get_me');
  if (!readTools.length) {
    warn('上一步没拿到工具表，跳过这一步。');
  } else if (!readTools.some((tool) => tool.name === 'get_me')) {
    warn('工具表里没有 get_me，跳过这一步。');
  } else {
    try {
      const result = await mcp.callMcpTool(server(false), 'get_me', {}, { timeouts: TIMEOUTS });
      const login = String(JSON.parse(result.text)?.login || '').trim();
      if (result.isError) fail(`get_me 返回错误：${result.text.slice(0, 200)}`);
      else if (login) pass(`当前账号 @${login}`);
      else warn('get_me 返回的内容里没有 login 字段（面板的「账号」显示会为空，不影响使用）。');
    } catch (error) {
      fail(`get_me 调用失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n[3/3] 上游写工具与内置写权限项的对应关系');
  try {
    const probe = await mcp.probeMcpServer(server(true), { retry: true, timeouts: TIMEOUTS });
    const writeTools = probe.tools.filter((tool) => tool.annotations?.readOnlyHint !== true);
    pass(`放开写入后公布 ${probe.tools.length} 个工具，其中写工具 ${writeTools.length} 个`);
    if (!writeTools.length) warn('一个写工具都没看到，权限可能不足（只读 token 属于正常情况）。');
    const policy = mcp.catalogWritePolicy('github', { dataDir });
    for (const tool of writeTools) {
      const problem = mcp.catalogWriteToolProblem(policy, tool.name, true);
      if (!problem) {
        // 理论上不会进这里：写权限项默认全关，放行说明分类逻辑有问题。
        fail(`${tool.name}：默认关闭状态下也被判为放行，检查 catalogWriteToolProblem。`);
        continue;
      }
      const gate = problem.match(/打开写权限里的「(.+?)」/);
      if (gate) console.log(`    · ${tool.name} → ${gate[1]}`);
      else if (problem.includes('不开放')) console.log(`    · ${tool.name} → 不开放（没有开关）`);
      else warn(`${tool.name}：没有对应的写权限项，会一直被拒绝；需要的话更新 lib/mcp/catalog.ts 里的写权限 match。`);
    }
  } catch (error) {
    fail(`放开写入后再探测失败：${error instanceof Error ? error.message : String(error)}`);
  }
} finally {
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
}

console.log('');
if (failures.length) {
  console.log(`结论：失败（${failures.length} 项）`);
  // 用 exitCode 而不是 process.exit()：Windows 上管道里还有没写完的输出时强退会崩掉进程。
  process.exitCode = 1;
} else {
  console.log(warnings.length ? `结论：通过，另有 ${warnings.length} 条提醒` : '结论：通过');
}