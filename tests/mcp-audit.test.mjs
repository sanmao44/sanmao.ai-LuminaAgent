/**
 * MCP 调用审计：按天滚动、保留期、摘要遮蔽。
 *
 * 这份日志要回答的是「助手到底动了什么」，不是「怎么复现这次请求」，
 * 所以测试盯的是「落盘的内容里有什么、没有什么」，而不是只测有没有写成功。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();

async function withDataDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-mcp-audit-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function baseRecord(overrides = {}) {
  return {
    serverId: 'playwright',
    serverName: '浏览器控制',
    tool: 'browser_click',
    risk: 'write',
    allowed: true,
    decision: 'call',
    ok: true,
    durationMs: 12,
    summary: '点击成功',
    ...overrides,
  };
}

/** 造一个「已经有 5MB 那么大」的分片，不用真的写 5MB 数据。 */
async function growFile(file, bytes) {
  const handle = await open(file, 'w');
  await handle.truncate(bytes);
  await handle.close();
}

test('按本地日期追加，字段固定，能按时间倒序读回来', async () => {
  await withDataDir(async (dataDir) => {
    // 本地 2026-03-04 09:00：东八区下 UTC 还停在 3 月 3 日，日志必须落在用户看到的那天。
    const at = new Date(2026, 2, 4, 9, 0, 0).getTime();
    mcp.recordMcpCall(baseRecord({ summary: '第一次' }), { dataDir, now: () => at });
    mcp.recordMcpCall(baseRecord({ tool: 'browser_navigate', summary: '第二次' }), { dataDir, now: () => at + 1000 });

    const dir = mcp.resolveMcpCallsDir({ dataDir });
    assert.deepEqual(await readdir(dir), ['2026-03-04.jsonl'], '一天只开一个文件');

    const lines = (await readFile(path.join(dir, '2026-03-04.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.deepEqual(
      Object.keys(first).sort(),
      ['allowed', 'at', 'decision', 'durationMs', 'ok', 'risk', 'serverId', 'serverName', 'summary', 'tool'],
      '字段集合固定，多出来的东西一律不落盘',
    );
    assert.equal(first.at, at);
    assert.equal(first.summary, '第一次');
    assert.equal(first.allowed, true);

    assert.deepEqual(mcp.recentMcpCalls(10, { dataDir }).map((entry) => entry.summary), ['第二次', '第一次']);
    assert.deepEqual(mcp.recentMcpCalls(1, { dataDir }).map((entry) => entry.summary), ['第二次']);
  });
});

test('超过保留期的按天文件删掉，保留期内的不动', async () => {
  await withDataDir(async (dataDir) => {
    const dir = mcp.resolveMcpCallsDir({ dataDir });
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '2026-01-01.jsonl'), '{}\n');
    await writeFile(path.join(dir, '2026-03-01.jsonl'), '{}\n');
    await writeFile(path.join(dir, '2026-03-03.jsonl'), '{}\n');
    await writeFile(path.join(dir, '2026-02-25.jsonl'), '{}\n');
    // 保留 7 天，基准 03-04：02-25 是第 7 天，还在；更早的删。
    const at = new Date(2026, 2, 4, 9, 0, 0).getTime();
    mcp.recordMcpCall(baseRecord(), { dataDir, now: () => at });

    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['2026-02-25.jsonl', '2026-03-01.jsonl', '2026-03-03.jsonl', '2026-03-04.jsonl']);
    assert.equal(mcp.MCP_AUDIT_RETENTION_DAYS, 7);
  });
});

test('摘要把换行折平、超长截断、凭据样式遮蔽', () => {
  const text = 'Bearer abcdef1234567890 调用失败 api_key=sk-live-abcdefghijklmnop token: ghp_0123456789abcdefghij';
  const summary = mcp.summarizeMcpAuditText(text);
  assert.equal(summary.includes('abcdef1234567890'), false, 'Bearer 里的凭据不能留');
  assert.equal(summary.includes('sk-live'), false, 'sk- 开头的凭据不能留');
  assert.equal(summary.includes('ghp_'), false, 'GitHub token 不能留');
  assert.ok(summary.includes('***'), '遮蔽后要看得出来这里原本有东西');
  assert.equal(summary.includes('\n'), false);

  assert.equal(mcp.summarizeMcpAuditText('a\n\n  b   c '), 'a b c');
  assert.equal(mcp.summarizeMcpAuditText(null), '');
  assert.equal(mcp.summarizeMcpAuditText('字'.repeat(400)).length, mcp.MCP_AUDIT_MAX_SUMMARY_CHARS);
});

test('落盘的是摘要，不是参数；结果太长也只留前 200 字', async () => {
  await withDataDir(async (dataDir) => {
    mcp.recordMcpCall(
      {
        ...baseRecord(),
        summary: `token=sk-secret-value ${'结果'.repeat(300)}`,
        // 下面这些是调用方可能顺手多传的：审计只认白名单字段，绝不能顺手写全。
        args: { path: 'C:/private/note.txt' },
        result: 'RAW_RESULT',
        messages: [{ role: 'user', content: '别写我' }],
      },
      { dataDir, now: () => Date.now() },
    );

    const dir = mcp.resolveMcpCallsDir({ dataDir });
    const [file] = await readdir(dir);
    const raw = await readFile(path.join(dir, file), 'utf8');
    assert.equal(raw.includes('C:/private/note.txt'), false, '参数不落盘');
    assert.equal(raw.includes('RAW_RESULT'), false);
    assert.equal(raw.includes('别写我'), false);
    assert.equal(raw.includes('sk-secret-value'), false);
    const entry = JSON.parse(raw.trim());
    assert.ok(entry.summary.length <= mcp.MCP_AUDIT_MAX_SUMMARY_CHARS);
  });
});

test('判定来源与放行结果原样落盘，时长归一到非负整数', async () => {
  await withDataDir(async (dataDir) => {
    const at = Date.now();
    const decisions = ['policy', 'block', 'guard', 'approval', 'rejected', 'call'];
    for (const decision of decisions) {
      mcp.recordMcpCall(
        baseRecord({ decision, allowed: decision === 'call' || decision === 'approval', ok: decision === 'call', durationMs: -5 }),
        { dataDir, now: () => at },
      );
    }
    const recent = mcp.recentMcpCalls(20, { dataDir });
    assert.deepEqual(recent.map((entry) => entry.decision), [...decisions].reverse());
    assert.equal(recent[0].allowed, true);
    assert.equal(recent.at(-1).allowed, false);
    assert.deepEqual(recent.map((entry) => entry.durationMs), [0, 0, 0, 0, 0, 0]);
  });
});

test('坏行跳过，不影响后面的记录读出来', async () => {
  await withDataDir(async (dataDir) => {
    mcp.recordMcpCall(baseRecord({ summary: '好行' }), { dataDir, now: () => Date.now() });
    const dir = mcp.resolveMcpCallsDir({ dataDir });
    const [file] = await readdir(dir);
    await writeFile(path.join(dir, file), '这行坏了\n{"half":', { flag: 'a' });
    assert.deepEqual(mcp.recentMcpCalls(5, { dataDir }).map((entry) => entry.summary), ['好行']);
  });
});

test('单文件写满 5MB 就换分片，全写满则本轮不再写', async () => {
  await withDataDir(async (dataDir) => {
    const dir = mcp.resolveMcpCallsDir({ dataDir });
    await mkdir(dir, { recursive: true });
    const stamp = '2026-03-04';
    const at = new Date(2026, 2, 4, 9, 0, 0).getTime();

    await growFile(path.join(dir, `${stamp}.jsonl`), mcp.MCP_AUDIT_MAX_FILE_BYTES);
    mcp.recordMcpCall(baseRecord(), { dataDir, now: () => at });
    assert.deepEqual((await readdir(dir)).sort(), [`${stamp}.2.jsonl`, `${stamp}.jsonl`]);

    for (let part = 2; part <= 9; part += 1) {
      await growFile(path.join(dir, `${stamp}.${part}.jsonl`), mcp.MCP_AUDIT_MAX_FILE_BYTES);
    }
    const before = (await readdir(dir)).sort();
    mcp.recordMcpCall(baseRecord({ summary: '写不下了' }), { dataDir, now: () => at });
    assert.deepEqual((await readdir(dir)).sort(), before, '满 9 个分片就不再写，审计不能变成磁盘黑洞');
    assert.equal(mcp.recentMcpCalls(50, { dataDir }).some((entry) => entry.summary === '写不下了'), false);
  });
});

test('审计写不进去也不能影响调用本身', async () => {
  await withDataDir(async (dataDir) => {
    // 把父路径占成文件：mkdir 必然失败，但 recordMcpCall 必须静默吞掉。
    const blocked = path.join(dataDir, 'blocked');
    await writeFile(blocked, 'not a dir\n');
    const entry = mcp.recordMcpCall(baseRecord(), { dataDir: blocked });
    assert.equal(entry.tool, 'browser_click');
    assert.equal(entry.decision, 'call');
    assert.deepEqual(mcp.recentMcpCalls(5, { dataDir: blocked }), []);
  });
});

const agentRoute = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const resume = await readFile(new URL('../lib/agent/resume.ts', import.meta.url), 'utf8');
const toolsRoute = await readFile(new URL('../app/api/tools/route.ts', import.meta.url), 'utf8');

test('每一道判定和执行点都留痕：请求侧与续跑侧都要接上', () => {
  for (const decision of ['policy', 'guard', 'block', 'call']) {
    assert.match(agentRoute, new RegExp(`decision: '${decision}'`), `请求侧缺了 ${decision} 的痕迹`);
  }
  assert.ok((agentRoute.match(/auditMcpCall\(/g) || []).length >= 5, '一处定义 + 至少四个判定点');
  assert.match(agentRoute, /let stalledMcpReason = '';/);
  assert.match(agentRoute, /trackMcpRepeat\(mcpRepeatTracker, mcpCallSignature\(meta\.serverId, meta\.toolName, args\), result\.text\)/);
  assert.match(agentRoute, /if \(repeats >= TOOL_LOOP_MCP_REPEAT_LIMIT\)/);
  // 停下来那一轮必须把没执行的 tool_call_id 也补上结果，否则服务商侧会报缺少工具结果。
  assert.match(agentRoute, /for \(const rest of executionCalls\.slice\(callIndex \+ 1\)\)/);
  assert.match(agentRoute, /toolResults\.push\(\{ role: 'tool', tool_call_id: rest\.id,/);

  assert.match(resume, /function auditResumeCall\(/);
  for (const decision of ['guard', 'block', 'rejected', 'approval']) {
    assert.match(resume, new RegExp(`decision: '${decision}'`), `续跑侧缺了 ${decision} 的痕迹`);
  }

  assert.match(toolsRoute, /recentCalls: recentMcpCalls\(MCP_AUDIT_RECENT_LIMIT\)/);
  assert.match(toolsRoute, /toolPolicies: readToolApprovalPolicies\(\)/);
  assert.match(toolsRoute, /rootEntries,/);
});
