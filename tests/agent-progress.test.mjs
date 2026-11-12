import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentClientModule, buildAgentProgressModule } from "./tools-build.mjs";
import { createTsRequire } from "./ts-require.mjs";

/* 进度账本落盘在运行目录：测试必须先把它指到临时目录，绝不能碰真实数据。 */
const dataDir = mkdtempSync(path.join(os.tmpdir(), "sanmao-progress-"));
process.env.SANMAO_DATA_DIR = dataDir;

const progress = await buildAgentProgressModule();
const clientModule = await buildAgentClientModule();
const loadModule = createTsRequire(process.cwd());
const { streamAgentResult } = loadModule("./apps/api/agent-stream");

const progressFile = path.join(dataDir, "agent-progress.json");
const readRecords = () => JSON.parse(readFileSync(progressFile, "utf8"));

test("进度只用前端给的短 id 做键：空格、路径、超长都拒绝", () => {
  assert.equal(progress.normalizeAgentRunId("run-abc123"), "run-abc123");
  assert.equal(progress.normalizeAgentRunId("  run-abc123  "), "run-abc123");
  assert.equal(progress.normalizeAgentRunId("dock-m3k2j1-ab12cd"), "dock-m3k2j1-ab12cd");
  assert.equal(progress.normalizeAgentRunId("short"), null, "太短的 id 不像前端生成的");
  assert.equal(progress.normalizeAgentRunId("../../etc/passwd"), null);
  assert.equal(progress.normalizeAgentRunId("run id"), null);
  assert.equal(progress.normalizeAgentRunId("a".repeat(65)), null);
  assert.equal(progress.normalizeAgentRunId(undefined), null);
  assert.equal(progress.normalizeAgentRunId(42), null);
});

test("按 runId 记账：阶段与工具计数累计，收尾之后只读不回写", async () => {
  const begun = await progress.beginAgentRun("run-flow-1", 1000);
  assert.equal(begun.stage, "thinking");
  assert.equal(begun.toolCalls, 0);
  assert.equal(begun.done, false);

  assert.equal(
    await progress.reportAgentProgress("run-flow-1", { stage: "artifact", message: "正在生成PPT 演示文稿…", toolCalls: 3 }, 1010),
    true,
  );
  const mid = await progress.readAgentProgress("run-flow-1", 1020);
  assert.equal(mid.stage, "artifact");
  assert.equal(mid.message, "正在生成PPT 演示文稿…");
  assert.equal(mid.toolCalls, 3);
  assert.equal(mid.updatedAt, 1010);
  assert.equal(mid.startedAt, 1000);

  await progress.finishAgentRun("run-flow-1", 1030);
  assert.equal((await progress.readAgentProgress("run-flow-1", 1040)).done, true);
  assert.equal(
    await progress.reportAgentProgress("run-flow-1", { stage: "answering", message: "正在整理回复…" }, 1050),
    false,
    "收尾之后不该再写",
  );
  assert.equal((await progress.readAgentProgress("run-flow-1", 1060)).message, "正在生成PPT 演示文稿…");

  const copy = await progress.readAgentProgress("run-flow-1", 1070);
  copy.stage = "image";
  assert.equal((await progress.readAgentProgress("run-flow-1", 1080)).stage, "artifact", "读到的是快照，改不动账本");
});

test("快照只认固定字段：调用方多塞的东西不会进账本", async () => {
  await progress.beginAgentRun("run-shape-1", 2000);
  await progress.reportAgentProgress(
    "run-shape-1",
    { stage: "mcp", message: "正在调用外部工具 github · create_issue…", toolCalls: 1, args: '{"secret":"不该落盘"}', content: "用户原话" },
    2010,
  );
  const record = readRecords().find((item) => item.id === "run-shape-1");
  assert.deepEqual(Object.keys(record).sort(), ["createdAt", "done", "id", "message", "stage", "startedAt", "toolCalls", "updatedAt"]);
  assert.doesNotMatch(readFileSync(progressFile, "utf8"), /不该落盘|用户原话/);
});

test("换一个进程写进来的快照照样能读到", async () => {
  const external = {
    id: "run-other-proc",
    createdAt: new Date(4000).toISOString(),
    stage: "artifact",
    message: "正在生成Excel 表格…",
    toolCalls: 2,
    startedAt: 4000,
    updatedAt: 4010,
    done: false,
  };
  const records = readRecords().filter((item) => item.id !== "run-other-proc");
  records.unshift(external);
  writeFileSync(progressFile, `${JSON.stringify(records, null, 2)}\n`);
  const snapshot = await progress.readAgentProgress("run-other-proc", 4020);
  assert.equal(snapshot.stage, "artifact");
  assert.equal(snapshot.message, "正在生成Excel 表格…");
  assert.equal(snapshot.toolCalls, 2);
});

test("没登记过的 runId 读出来是空的，不会凭空造一条", async () => {
  assert.equal(await progress.readAgentProgress("run-never-started"), null);
  assert.equal(await progress.readAgentProgress("bad id"), null);
  assert.equal(await progress.reportAgentProgress("run-never-started", { stage: "tool", message: "x" }), false);
  assert.equal(await progress.finishAgentRun("run-never-started"), undefined);
  assert.equal(await progress.beginAgentRun("no"), null);
});

test("过期快照读不到，也不会一直堆在盘上", async () => {
  const t0 = 10_000;
  await progress.beginAgentRun("run-ttl-1", t0);
  assert.ok(await progress.readAgentProgress("run-ttl-1", t0 + 9 * 60 * 1000), "十分钟以内还算在跑");
  assert.equal(await progress.readAgentProgress("run-ttl-1", t0 + 11 * 60 * 1000), null, "十分钟没动静就当这轮结束了");
  assert.equal(readRecords().some((item) => item.id === "run-ttl-1"), false, "过期的记录要顺手删掉");
});

test("同时在跑的任务有上限：只保留最近的一批", async () => {
  const base = 1_000_000;
  for (let index = 0; index < 40; index += 1) await progress.beginAgentRun(`run-cap-${index}`, base + index * 1000);
  assert.equal(await progress.readAgentProgress("run-cap-0", base + 40_000), null, "最老的一批被淘汰");
  assert.equal((await progress.readAgentProgress("run-cap-39", base + 40_000)).stage, "thinking");
  assert.ok(readRecords().length <= 32, `账本最多 32 条，实际 ${readRecords().length}`);
});

test("工具类别翻成固定中文文案：只讲这一步在做什么", () => {
  assert.deepEqual(progress.agentToolProgress("artifact", "presentation_generate"), {
    stage: "artifact",
    message: "正在生成PPT 演示文稿…",
  });
  assert.equal(progress.agentToolProgress("artifact", "document_generate").message, "正在生成Word 文档…");
  assert.equal(progress.agentToolProgress("artifact", "spreadsheet_generate").message, "正在生成Excel 表格…");
  assert.equal(progress.agentToolProgress("artifact", "archive_generate").message, "正在生成压缩包…");
  assert.equal(progress.agentToolProgress("artifact", "unknown_generate").message, "正在生成文件…");
  assert.equal(progress.agentToolProgress("web", "web_search").stage, "web_search");
  assert.equal(progress.agentToolProgress("image", "image_generate").stage, "image");
  assert.equal(progress.agentToolProgress("skill", "skill_run").stage, "skill");
  assert.equal(progress.agentToolProgress("mcp", "github__create_issue").message, "正在调用外部工具 github · create_issue…");
  assert.equal(progress.agentToolProgress("mcp-manage", "mcp_install").stage, "mcp");
  assert.equal(progress.agentToolProgress(null, "x"), null, "说不清是哪一类的就不上报");
  assert.equal(progress.agentToolProgress("unknown-kind", "x"), null);
});

test("MCP 工具 id 显示成「服务 · 工具」", () => {
  assert.equal(progress.mcpProgressToolLabel("github__search_repos"), "github · search_repos");
  assert.equal(progress.mcpProgressToolLabel("github__a__b"), "github · a__b");
  assert.equal(progress.mcpProgressToolLabel("plain_tool"), "plain_tool");
  assert.equal(progress.mcpProgressToolLabel(undefined), "");
});

test("进度接口要求受信任请求，并返回不可缓存的单条快照", async () => {
  let trusted = false;
  let readCalls = 0;
  const snapshot = { runId: "run-route-1", stage: "artifact", message: "正在生成文件…", toolCalls: 1, startedAt: 1, updatedAt: 2, done: false };
  const loadRoute = createTsRequire(process.cwd(), {
    "@/lib/auth": { isTrustedAppRequest: () => trusted },
    "@/lib/agent/progress": { readAgentProgress: async (runId) => { readCalls += 1; assert.equal(runId, "run-route-1"); return snapshot; } },
  });
  const { GET } = loadRoute("./app/api/agent/progress/route");
  const request = new Request("http://localhost/api/agent/progress?runId=run-route-1");

  const rejected = await GET(request);
  assert.equal(rejected.status, 401);
  assert.equal(readCalls, 0);

  trusted = true;
  const accepted = await GET(request);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((await accepted.json()).progress, snapshot);
  assert.equal(readCalls, 1);
});

test("progress contract covers capability stages and closes after completion", async () => {
  const runId = "run-runtime-contract";
  const now = Date.now();
  await progress.beginAgentRun(runId, now);
  const skill = progress.agentToolProgress("skill", "skill_search");
  const artifact = progress.agentToolProgress("artifact", "document_generate");
  assert.equal(skill.stage, "skill");
  assert.equal(artifact.stage, "artifact");
  assert.equal(await progress.reportAgentProgress(runId, skill, now + 10), true);
  await progress.finishAgentRun(runId, now + 20);
  assert.equal(await progress.reportAgentProgress(runId, artifact, now + 30), false);
  assert.equal((await progress.readAgentProgress(runId, now + 40)).stage, "skill");
});

test("正文开始后进度仍持续更新，并在 done 快照后停止", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
  const snapshots = [
    { runId: "run-helper-2", stage: "artifact", message: "正在生成PPT 演示文稿…", toolCalls: 1, startedAt: Date.now() - 6000, updatedAt: 1, done: false },
    { runId: "run-helper-2", stage: "answering", message: "正在整理回复…", toolCalls: 1, startedAt: Date.now() - 6000, updatedAt: 2, done: false },
    { runId: "run-helper-2", stage: "answering", message: "正在整理回复…", toolCalls: 1, startedAt: Date.now() - 6000, updatedAt: 3, done: true },
  ];
  let calls = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ progress: snapshots[calls++] }) });
  const ticks = [];
  try {
    const stopTicking = clientModule.pollAgentProgress("run-helper-2", {
      intervalMs: 5,
      maxPolls: 10,
      onProgress: (item) => ticks.push(item),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stopTicking();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
  assert.equal(calls, 3, "读到 done 后不再发起下一次轮询");
  assert.ok(ticks.length >= 3, `正文期间至少应显示阶段变化和耗时，实际 ${ticks.length}`);
  assert.equal(ticks[0].message, "正在生成PPT 演示文稿…");
  assert.ok(ticks.some((tick) => tick.message === "正在整理回复…"));
  assert.equal(ticks[ticks.length - 1].stage, "answering");
});
test("Agent progress polling remains active beyond the old 400-poll cutoff", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const scheduled = [];
  globalThis.window = { setTimeout: (fn) => { scheduled.push(fn); return scheduled.length; } };
  let calls = 0;
  const updates = [];
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ progress: {
        runId: "run-long-progress",
        stage: calls > 400 ? "artifact" : "thinking",
        message: calls > 400 ? "Generating long-running output" : "Working on request",
        toolCalls: 1,
        startedAt: Date.now() - 650_000,
        updatedAt: calls > 400 ? 2 : 1,
        done: calls > 405,
      } }),
    };
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  try {
    clientModule.pollAgentProgress("run-long-progress", {
      intervalMs: 900,
      onProgress: (item) => updates.push(item),
    });
    await flush();
    while (calls < 406) {
      const next = scheduled.shift();
      assert.equal(typeof next, "function", `polling stopped after ${calls} calls`);
      next();
      await flush();
    }
    assert.ok(calls > 400, "the long run is still polled beyond the previous cutoff");
    assert.ok(updates.some((item) => item.stage === "artifact"), "a late stage update reaches the UI");
    assert.ok(updates.some((item) => item.message === "Generating long-running output"));
    assert.equal(scheduled.length, 0, "the final done snapshot stops future polling");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("用户取消后进度轮询停止读取快照", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
  const controller = new AbortController();
  let calls = 0;
  let resolveFirstProgress;
  const firstProgress = new Promise((resolve) => { resolveFirstProgress = resolve; });
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        progress: {
          runId: "run-cancel-poll",
          stage: "artifact",
          message: "正在生成文件…",
          toolCalls: 1,
          startedAt: Date.now(),
          updatedAt: calls,
          done: false,
        },
      }),
    };
  };
  try {
    clientModule.pollAgentProgress("run-cancel-poll", {
      signal: controller.signal,
      intervalMs: 5,
      onProgress: () => resolveFirstProgress(),
    });
    await firstProgress;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
  assert.equal(calls, 1);
});

test("流式请求只在完整输出结算后结束进度", async () => {
  const runId = "run-stream-settle";
  await progress.beginAgentRun(runId);
  const encoder = new TextEncoder();
  let finishUpstream;
  let resolveSettled;
  const settled = new Promise((resolve) => { resolveSettled = resolve; });
  const upstreamBody = new ReadableStream({
    start(controller) {
      const delta = "A".repeat(130);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
      finishUpstream = () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };
    },
  });
  let result;
  const response = streamAgentResult(
    { body: upstreamBody },
    { images: [], files: [], generations: [], model: "test", deliverable: "TEXT" },
    undefined,
    async (settlement) => {
      result = settlement;
      await progress.finishAgentRun(runId);
      resolveSettled();
    },
  );
  const reader = response.body.getReader();
  await reader.read();
  const firstDelta = await reader.read();
  assert.ok(firstDelta.value, "上游正文已经开始流出");
  assert.equal((await progress.readAgentProgress(runId)).done, false);

  finishUpstream();
  while (!(await reader.read()).done) {}
  await settled;
  assert.equal(result.status, "success");
  assert.equal((await progress.readAgentProgress(runId)).done, true);
});

test("流式取消也会结算进度并结束快照", async () => {
  const runId = "run-stream-abort";
  await progress.beginAgentRun(runId);
  const controller = new AbortController();
  let upstreamCancelled = false;
  let resolveSettled;
  const settled = new Promise((resolve) => { resolveSettled = resolve; });
  const upstreamBody = new ReadableStream({ cancel() { upstreamCancelled = true; } });
  const response = streamAgentResult(
    { body: upstreamBody },
    { images: [], files: [], generations: [], model: "test", deliverable: "TEXT" },
    controller.signal,
    async () => {
      await progress.finishAgentRun(runId);
      resolveSettled();
    },
  );
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await reader.read();
  await settled;
  assert.equal(upstreamCancelled, true);
  assert.equal((await progress.readAgentProgress(runId)).done, true);
});
