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
