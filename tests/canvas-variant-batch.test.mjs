import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/variant-batch.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8"))
  .replace('import type { CanvasVariantState } from "./types";\n', "")
  .replace('import { canvasVariantBatchStatus } from "./variant-status";\n', `
function canvasVariantBatchStatus(states) {
  if (states.some((state) => state.status === "running")) return "running";
  if (states.some((state) => state.status === "failed")) return "failed";
  if (states.length && states.every((state) => state.status === "completed")) return "completed";
  return "queued";
}
`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const batch = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("patches one variant while preserving its canonical requirement and aggregate status", () => {
  const result = batch.applyCanvasVariantStatePatch(
    [
      { id: "variant-1", instruction: "old", status: "pending", resultIds: [] },
      { id: "variant-2", instruction: "old 2", status: "completed", resultIds: ["image-2"] },
    ],
    ["canonical one", "canonical two"],
    0,
    { status: "failed", error: "provider error" },
    123,
  );

  assert.deepEqual(result.states, [
    {
      id: "variant-1",
      instruction: "canonical one",
      status: "failed",
      resultIds: [],
      error: "provider error",
      updatedAt: 123,
    },
    { id: "variant-2", instruction: "old 2", status: "completed", resultIds: ["image-2"] },
  ]);
  assert.equal(result.status, "failed");
});

test("normalizes pending, failed, done, and returned video task results", () => {
  assert.deepEqual(batch.canvasVideoTaskProgress({ status: "processing", progress: 42 }), {
    hasVideoResult: false,
    terminal: false,
    status: "running",
    progress: 42,
    url: undefined,
  });
  assert.deepEqual(batch.canvasVideoTaskProgress({ status: "failed", error: "provider" }), {
    hasVideoResult: false,
    terminal: true,
    status: "failed",
    progress: 0,
    url: undefined,
  });
  assert.deepEqual(batch.canvasVideoTaskProgress({ status: "done", videoUrls: ["/video.mp4"] }), {
    hasVideoResult: true,
    terminal: true,
    status: "completed",
    progress: 100,
    url: "/video.mp4",
  });
});

test("prepares only requested failed variants and preserves retry results", () => {
  const retained = { id: "variant-1", instruction: "one", status: "completed", resultIds: ["image-1"] };
  const failed = { id: "variant-2", instruction: "old", status: "failed", resultIds: ["image-2"], taskIds: ["task-2"] };
  const result = batch.prepareCanvasVariantBatch(
    ["canonical one", "canonical two", "canonical three"],
    [retained, failed],
    [1, 1, 9, -1],
    "failed",
    789,
  );

  assert.deepEqual(result.requested, [1]);
  assert.equal(result.isRetry, true);
  assert.equal(result.isResume, false);
  assert.equal(result.initialStates[0], retained);
  assert.deepEqual(result.initialStates[1], {
    id: "variant-2",
    instruction: "canonical two",
    status: "pending",
    resultIds: ["image-2"],
    taskIds: ["task-2"],
    progress: 0,
    error: undefined,
    updatedAt: 789,
  });
});

test("an all-mode batch resets outputs for every requirement", () => {
  const result = batch.prepareCanvasVariantBatch(
    ["one", "two"],
    [
      { id: "variant-1", instruction: "old", status: "completed", resultIds: ["image-1"], taskIds: ["task-1"] },
      { id: "variant-2", instruction: "old 2", status: "failed", resultIds: ["image-2"], error: "old error" },
    ],
    undefined,
    "all",
    987,
  );

  assert.deepEqual(result.requested, [0, 1]);
  assert.deepEqual(result.initialStates.map((state) => ({
    instruction: state.instruction,
    status: state.status,
    resultIds: state.resultIds,
    taskIds: state.taskIds,
    progress: state.progress,
    error: state.error,
    updatedAt: state.updatedAt,
  })), [
    { instruction: "one", status: "pending", resultIds: [], taskIds: undefined, progress: 0, error: undefined, updatedAt: 987 },
    { instruction: "two", status: "pending", resultIds: [], taskIds: undefined, progress: 0, error: undefined, updatedAt: 987 },
  ]);
});

test("returns a fresh state array and marks all completed variants as completed", () => {
  const states = [
    { id: "variant-1", instruction: "one", status: "pending", resultIds: [] },
  ];
  const result = batch.applyCanvasVariantStatePatch(
    states,
    ["one"],
    0,
    { status: "completed", progress: 100 },
    456,
  );

  assert.notEqual(result.states, states);
  assert.equal(result.states[0].status, "completed");
  assert.equal(result.states[0].progress, 100);
  assert.equal(result.status, "completed");
});
