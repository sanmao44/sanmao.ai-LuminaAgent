import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/activity-log.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const activityLog = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("generation log status labels describe each task state", () => {
  assert.equal(activityLog.generationLogStatusLabel("pending"), "进行中");
  assert.equal(activityLog.generationLogStatusLabel("success"), "成功");
  assert.equal(activityLog.generationLogStatusLabel("error"), "失败");
});

test("generation log kind labels describe each output type", () => {
  assert.equal(activityLog.generationLogKindLabel({ mode: "generate" }), "图片");
  assert.equal(activityLog.generationLogKindLabel({ mode: "generate", mediaKind: "video" }), "视频");
  assert.equal(activityLog.generationLogKindLabel({ mode: "generate", mediaKind: "audio" }), "音频");
  assert.equal(activityLog.generationLogKindLabel({ mode: "llm", taskKind: "llm" }), "LLM");
});

test("generation log duration distinguishes active, missing, and recorded time", () => {
  assert.equal(activityLog.generationLogDuration({ status: "pending" }), "计时中");
  assert.equal(activityLog.generationLogDuration({ status: "success" }), "未记录");
  assert.equal(activityLog.generationLogDuration({ status: "error", durationMs: 0 }), "0.0s");
  assert.equal(activityLog.generationLogDuration({ status: "success", durationMs: 1250 }), "1.3s");
});
