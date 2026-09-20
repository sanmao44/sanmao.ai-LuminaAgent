import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentClientModule, buildAgentProgressModule } from "./tools-build.mjs";

/* 进度账本落盘在运行目录：测试必须先把它指到临时目录，绝不能碰真实数据。 */
const dataDir = mkdtempSync(path.join(os.tmpdir(), "sanmao-progress-"));
process.env.SANMAO_DATA_DIR = dataDir;

const progress = await buildAgentProgressModule();
const clientModule = await buildAgentClientModule();

const progressFile = path.join(dataDir, "agent-progress.json");
const readRecords = () => JSON.parse(readFileSync(progressFile, "utf8"));

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [source, route, agentRoute, page, dock, client, styles] = await Promise.all([
  read("lib/agent/progress.ts"),
  read("app/api/agent/progress/route.ts"),
  read("app/api/agent/route.ts"),
  read("app/page.tsx"),
  read("components/CanvasAgentDock.tsx"),
  read("lib/agent-client.ts"),
  read("app/globals.css"),
]);

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

test("进度账本不碰用户内容：没有序列化、没有直接读写文件", () => {
  assert.doesNotMatch(source, /JSON\.stringify/);
  assert.doesNotMatch(source, /node:fs|readFile|writeFile/);
  assert.doesNotMatch(source, /process\.env/);
});

test("进度接口要管理员身份、不缓存，且只回一条快照", () => {
  assert.match(route, /import \{ isTrustedAppRequest \} from "@\/lib\/auth";/);
  assert.match(route, /if \(!isTrustedAppRequest\(request\)\) return Response\.json\(\{ error: "需要管理员登录。" \}, \{ status: 401 \}\);/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /progress: await readAgentProgress\(runId\)/);
  assert.match(route, /new URL\(request\.url\)\.searchParams\.get\("runId"\)/);
});

test("主管线在真正耗时的节点写进度，收尾时关掉", () => {
  assert.match(agentRoute, /agentRunId = \(await beginAgentRun\(\(body as \{ runId\?: unknown \}\)\.runId\)\)\?\.runId \|\| null;/);
  assert.match(agentRoute, /reportToolProgress\(agentToolProgress\(kind, String\(call\?\.function\?\.name \|\| ''\)\)\)/);
  assert.match(agentRoute, /reportToolProgress\(agentToolProgress\('skill'/);
  assert.match(agentRoute, /reportToolProgress\(agentToolProgress\('artifact'/);
  assert.match(agentRoute, /reportProgress\(\{ stage: 'tool', message: '正在准备可用工具…' \}\);/);
  assert.match(agentRoute, /reportProgress\(\{ stage: 'thinking'/);
  assert.match(agentRoute, /reportProgress\(\{ stage: 'answering'/);
  assert.match(agentRoute, /await finishAgentRun\(agentRunId\);/);
  assert.match(agentRoute, /void reportAgentProgress\(agentRunId/);
  assert.doesNotMatch(agentRoute, /reportProgress\([^)]*args/, "进度不能带上工具参数");
  assert.doesNotMatch(agentRoute, /reportProgress\([^)]*latest/, "进度不能带上模型原话");
});

test("共用轮询：正文一到就让位，单次模型调用有秒表", async () => {
  assert.match(client, /export function pollAgentProgress\(/);
  assert.match(client, /if \(seconds >= 3 && seconds !== elapsed\)/);
  const seen = [];
  const stop = clientModule.pollAgentProgress("run-helper-1", {
    isSettled: () => true,
    onProgress: (item) => seen.push(item),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(seen, [], "已经拿到正文时一次都不该上报");
  stop();

  /* 真跑一轮：window.setTimeout 在 node 里不存在，用等价的定时器顶上。 */
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
  const snapshot = {
    runId: "run-helper-2",
    stage: "artifact",
    message: "正在生成PPT 演示文稿…",
    toolCalls: 1,
    startedAt: Date.now() - 6000,
    updatedAt: 1,
    done: false,
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ progress: snapshot }) });
  const ticks = [];
  try {
    const stopTicking = clientModule.pollAgentProgress("run-helper-2", {
      intervalMs: 5,
      maxPolls: 4,
      onProgress: (item) => ticks.push(item),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stopTicking();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
  assert.ok(ticks.length >= 2, `至少要有一次阶段文案和一次秒表，实际 ${ticks.length}`);
  assert.equal(ticks[0].message, "正在生成PPT 演示文稿…");
  assert.match(ticks[ticks.length - 1].message, /^正在生成PPT 演示文稿…（已 \d+s）$/);
  assert.equal(ticks[ticks.length - 1].stage, "artifact");
});

test("三个入口都按 runId 轮询，收尾都会停", () => {
  assert.match(client, /export async function readAgentProgress\(/);
  assert.match(client, /if \(!response\.ok\) return null;/);

  // 主对话：轮询把手必须在 try 之前声明——写在 try 里、却从 finally 里调用会直接 ReferenceError，
  // 而 app/page.tsx 顶上带着 @ts-nocheck，类型检查兜不住这一层，只能在这里钉住。
  assert.match(page, /const progressRunId = uid\('run'\);/);
  assert.match(page, /let stopAgentProgress = \(\)=>\{\};\n\s+try \{/);
  assert.match(page, /stopAgentProgress = pollAgentProgress\(progressRunId, \{/);
  assert.match(page, /isSettled: \(\)=>Boolean\(streamedText\)/);
  assert.match(page, /runId: progressRunId/);
  assert.match(page, /\} finally\{\r?\n            stopAgentProgress\(\);/);

  // 重新生成：挂在被重试的消息上，操作栏里显示
  assert.match(page, /const retryRunId = uid\('run'\);/);
  assert.match(page, /let stopRetryProgress = \(\)=>\{\};\n\s+try \{/);
  assert.match(page, /stopRetryProgress = pollAgentProgress\(retryRunId, \{/);
  assert.match(page, /runId: retryRunId/);
  assert.match(page, /\} finally\{\r?\n            stopRetryProgress\(\);/);
  assert.match(page, /message\.retrying && message\.activity\?\.message \? \/\*#__PURE__\*\/ _jsx\("span", \{\r?\n\s+className: "message-retry-activity",/);
  assert.match(page, /applyMessageVersion\(\{ \.\.\.item, activity: undefined \}/);
  assert.match(styles, /\.message-tools \.message-retry-activity\{[^}]*color:var\(--accent-text\)/);

  // 画布助手
  assert.match(dock, /const progressRunId = createId\(\);/);
  assert.match(dock, /const stopAgentProgress = pollAgentProgress\(progressRunId, \{/);
  assert.match(dock, /isSettled: \(\) => Boolean\(streamTextRef\.current\)/);
  assert.match(dock, /runId: progressRunId,/);
  assert.match(dock, /\{streamText \|\| progressDetail \|\| "正在思考…"\}/);
});