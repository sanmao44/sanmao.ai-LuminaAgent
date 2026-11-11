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

test("activity empty state links to current project task history when available", () => {
  assert.deepEqual(activityLog.deriveCanvasActivityEmptyState(3, 8), {
    title: "本次会话暂无独立画布操作",
    detail: "当前项目有 3 条创作任务记录，可在任务视图查看结果与恢复操作。",
    taskScope: "project",
  });
});

test("activity empty state offers all-project task history when current scope is empty", () => {
  assert.deepEqual(activityLog.deriveCanvasActivityEmptyState(0, 4), {
    title: "本项目暂无画布操作记录",
    detail: "其他项目有 4 条创作任务记录，可切换范围查看。",
    taskScope: "all",
  });
});

test("activity empty state stays informational when there is no task history", () => {
  assert.deepEqual(activityLog.deriveCanvasActivityEmptyState(0, 0), {
    title: "暂无活动记录",
    detail: "生成历史会显示在任务视图；导入素材或整理画布后的操作会记录在这里。",
    taskScope: null,
  });
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

test("long-running records need attention and show elapsed time instead of an endless timer", () => {
  const now = Date.parse("2026-11-09T00:00:00.000Z");
  const stale = { status: "pending", createdAt: new Date(now - 65 * 60_000).toISOString() };
  const recent = { status: "pending", createdAt: new Date(now - 5 * 60_000).toISOString() };
  assert.equal(activityLog.generationLogNeedsAttention(stale, now), true);
  assert.equal(activityLog.generationLogNeedsAttention(recent, now), false);
  assert.equal(activityLog.generationLogDuration(stale, now), "等待 1:05:00");
  assert.equal(activityLog.generationLogNeedsAttention({ ...stale, status: "success" }, now), false);
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

test("canvas task scope falls back to the log id when taskId is absent", () => {
  const scope = { taskIds: new Set(["canvas-task-1"]) };
  assert.equal(activityLog.canvasTaskBelongsToProject({ id: "canvas-task-1" }, scope), true);
  assert.equal(activityLog.canvasTaskBelongsToProject({ id: "other-task", projectId: "other-project" }, scope), false);
});

test("persisted canvas failures fill missing task logs and participate in the project failure filter", () => {
  const nodes = [
    {
      id: "failed-image-node",
      type: "media",
      data: {
        kind: "image",
        status: "failed",
        statusLabel: "服务商额度不足",
        jobId: "failed-image-task",
        generation: { kind: "image", taskId: "failed-image-task", prompt: "red fox", createdAt: Date.parse("2026-11-10T00:00:00.000Z") },
      },
    },
    { id: "stopped-node", type: "media", data: { kind: "image", status: "failed", taskTracking: "stopped", generation: { taskId: "stopped-task" } } },
    { id: "stale-node", type: "media", data: { kind: "image", status: "failed", taskTracking: "stale", generation: { taskId: "stale-task" } } },
    { id: "completed-node", type: "media", data: { kind: "image", status: "failed", url: "/image.png", generation: { taskId: "completed-task" } } },
  ];
  const log = {
    id: "failed-image-task",
    taskId: "failed-image-task",
    createdAt: "2026-11-10T00:00:00.000Z",
    status: "error",
    mode: "generate",
    prompt: "red fox",
  };
  const fallback = activityLog.canvasFailureTaskLogs([log], nodes, { projectId: "project-1", canvasId: "canvas-1" });
  assert.equal(fallback.length, 0, "an existing task log remains authoritative");

  const missing = activityLog.canvasFailureTaskLogs([], nodes, { projectId: "project-1", canvasId: "canvas-1" });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, "failed-image-task");
  assert.equal(missing[0].error, "服务商额度不足");
  assert.equal(missing[0].projectId, "project-1");
  assert.deepEqual(
    activityLog.filterCanvasGenerationLogs(missing, { status: "error" }).map((task) => task.id),
    ["failed-image-task"],
  );
});

test("task log filters apply media and search before status counts", () => {
  const tasks = [
    { id: "image-1", mode: "generate", mediaKind: "image", status: "success", prompt: "blue village" },
    { id: "video-1", mode: "video", mediaKind: "video", status: "success", prompt: "blue village flythrough" },
    { id: "video-2", mode: "video", mediaKind: "video", status: "error", prompt: "night highway" },
  ];
  const matching = activityLog.filterCanvasGenerationLogs(tasks, { media: "video", query: "blue" });
  assert.deepEqual(matching.map((task) => task.id), ["video-1"]);
  assert.deepEqual(
    activityLog.filterCanvasGenerationLogs(tasks, { media: "video", status: "success" }).map((task) => task.id),
    ["video-1"],
  );
  assert.deepEqual(
    activityLog.filterCanvasGenerationLogs(tasks, { status: "recoverable", recoverableTaskIds: new Set(["video-2"]) }).map((task) => task.id),
    ["video-2"],
  );
});

test("task attention filter separates old pending requests from active work", () => {
  const now = Date.now();
  const tasks = [
    { id: "old", mode: "generate", status: "pending", createdAt: new Date(now - 60 * 60_000).toISOString() },
    { id: "recent", mode: "generate", status: "pending", createdAt: new Date(now - 60_000).toISOString() },
  ];
  assert.deepEqual(activityLog.filterCanvasGenerationLogs(tasks, { status: "attention" }).map((task) => task.id), ["old"]);
  assert.deepEqual(activityLog.filterCanvasGenerationLogs(tasks, { status: "pending" }).map((task) => task.id), ["recent"]);
});
