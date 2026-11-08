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

test("activity navigation prefers an explicit node target", () => {
  const result = activityLog.resolveCanvasActivityNavigation(
    { nodeId: "node-7", taskId: "task-7" },
    [{ id: "task-7", taskId: "task-7", status: "success" }],
  );
  assert.deepEqual(result, { kind: "node", nodeId: "node-7" });
});

test("activity navigation falls back to the matching task record", () => {
  const log = { id: "log-8", taskId: "task-8", status: "error" };
  const result = activityLog.resolveCanvasActivityNavigation({ taskId: "task-8" }, [log]);
  assert.deepEqual(result, { kind: "task", log });
});

test("activity navigation reports no target when the record is stale", () => {
  assert.deepEqual(
    activityLog.resolveCanvasActivityNavigation({ taskId: "missing" }, []),
    { kind: "none" },
  );
});

test("unconfirmed provider receipts display as pending instead of failed", () => {
  assert.equal(activityLog.generationLogDisplayStatus({ status: "error", errorCode: "provider_result_unconfirmed" }), "pending");
  assert.equal(activityLog.generationLogDisplayStatus({ status: "error", errorCode: "provider_rejected" }), "error");
  assert.equal(activityLog.generationLogDisplayStatus({ status: "success" }), "success");
});

test("generation log kind labels describe each output type", () => {
  assert.equal(activityLog.generationLogKindLabel({ mode: "generate" }), "图片");
  assert.equal(activityLog.generationLogKindLabel({ mode: "generate", mediaKind: "video" }), "视频");
  assert.equal(activityLog.generationLogKindLabel({ mode: "generate", mediaKind: "audio" }), "音频");
  assert.equal(activityLog.generationLogKindLabel({ mode: "llm", taskKind: "llm" }), "LLM");
});

test("audio task logs do not pretend to have image output URLs", () => {
  assert.deepEqual(activityLog.generationLogOutputUrls({ mode: "audio", mediaKind: "audio", imageUrls: ["wrong-image.png"] }), []);
});

test("generation log duration distinguishes active, missing, and recorded time", () => {
  assert.equal(activityLog.generationLogDuration({ status: "pending" }), "计时中");
  assert.equal(activityLog.generationLogDuration({ status: "error", errorCode: "provider_result_unconfirmed", durationMs: 1200 }), "计时中");
  assert.equal(activityLog.generationLogDuration({ status: "success" }), "未记录");
  assert.equal(activityLog.generationLogDuration({ status: "error", durationMs: 0 }), "0.0s");
  assert.equal(activityLog.generationLogDuration({ status: "success", durationMs: 1250 }), "1.3s");
});

test("canvas task scope matches project, canvas, node, or task lineage", () => {
  const scope = {
    projectId: "project-1",
    canvasId: "canvas-1",
    nodeIds: new Set(["node-1"]),
    taskIds: new Set(["task-1"]),
  };
  assert.equal(activityLog.canvasTaskBelongsToProject({ projectId: "project-1" }, scope), true);
  assert.equal(activityLog.canvasTaskBelongsToProject({ canvasId: "canvas-1" }, scope), true);
  assert.equal(activityLog.canvasTaskBelongsToProject({ nodeId: "node-1" }, scope), true);
  assert.equal(activityLog.canvasTaskBelongsToProject({ taskId: "task-1" }, scope), true);
});

test("canvas task scope does not match unrelated or empty lineage", () => {
  const scope = {
    projectId: "project-1",
    canvasId: "canvas-1",
    nodeIds: new Set(["node-1"]),
    taskIds: new Set(["task-1"]),
  };
  assert.equal(activityLog.canvasTaskBelongsToProject({ projectId: "project-2", canvasId: "canvas-2", nodeId: "node-2", taskId: "task-2" }, scope), false);
  assert.equal(activityLog.canvasTaskBelongsToProject({ projectId: "project-1" }, {}), false);
  assert.equal(activityLog.canvasTaskBelongsToProject({ nodeId: "node-1" }, { nodeIds: new Set() }), false);
});
