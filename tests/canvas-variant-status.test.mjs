import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/variant-status.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(`type CanvasVariantStatus = "pending" | "running" | "completed" | "failed";
type CanvasVariantState = { status: CanvasVariantStatus };
type CanvasNodeData = { status?: "idle" | "draft" | "queued" | "running" | "completed" | "failed" };
${source.replace('import type { CanvasNodeData, CanvasVariantState } from "./types";', '')}`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const statuses = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const states = (...values) => values.map((status) => ({ status }));

test("running takes precedence over failed and queued states", () => {
  assert.equal(statuses.canvasVariantBatchStatus(states("pending", "failed", "running")), "running");
});

test("failed takes precedence over completed and queued states", () => {
  assert.equal(statuses.canvasVariantBatchStatus(states("pending", "completed", "failed")), "failed");
});

test("only a non-empty all-completed batch is completed", () => {
  assert.equal(statuses.canvasVariantBatchStatus(states("completed", "completed")), "completed");
  assert.equal(statuses.canvasVariantBatchStatus(states()), "queued");
  assert.equal(statuses.canvasVariantBatchStatus(states("pending")), "queued");
});
