import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/image-editor/editor-task-recovery.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const recovery = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("editor result recovery restores saved image URLs without invoking the provider", async () => {
  const result = await recovery.waitForEditorTaskLog(
    "edit-1",
    async () => ({ mode: "edit", status: "success", imageUrls: ["https://example.test/result.png"] }),
    { maxAttempts: 1, pollIntervalMs: 0 },
  );

  assert.equal(result.kind, "completed");
  assert.deepEqual(result.images, [{ url: "https://example.test/result.png" }]);
});

test("a success log without usable images remains unsafe to resubmit", async () => {
  const result = await recovery.waitForEditorTaskLog(
    "edit-empty",
    async () => ({ mode: "edit", status: "success", imageUrls: [] }),
    { maxAttempts: 1, pollIntervalMs: 0 },
  );

  assert.equal(result.kind, "failed");
  assert.equal(result.errorCode, "provider_result_unconfirmed");
  assert.equal(result.providerPossiblyAccepted, true);
  assert.equal(result.providerResultWithheld, false);
});

test("unconfirmed provider errors stay guarded after task recovery", async () => {
  const result = await recovery.waitForEditorTaskLog(
    "edit-uncertain",
    async () => ({
      mode: "edit",
      status: "error",
      error: "服务商响应不完整",
      errorCode: "provider_result_unconfirmed",
    }),
    { maxAttempts: 1, pollIntervalMs: 0 },
  );

  assert.equal(result.kind, "failed");
  assert.equal(result.providerPossiblyAccepted, true);
});

test("an explicit mask-safety rejection is distinguished from an ordinary provider failure", async () => {
  const result = await recovery.waitForEditorTaskLog(
    "edit-withheld",
    async () => ({
      mode: "edit",
      status: "error",
      error: "蒙版保护处理失败",
      errorCode: "edit_result_withheld",
    }),
    { maxAttempts: 1, pollIntervalMs: 0 },
  );

  assert.equal(result.kind, "failed");
  assert.equal(result.providerPossiblyAccepted, true);
  assert.equal(result.providerResultWithheld, true);
});

test("a missing log is safe only after bounded confirmation; read failures remain pending", async () => {
  let waits = 0;
  const missing = await recovery.waitForEditorTaskLog("edit-missing", async () => null, {
    maxAttempts: 3,
    maxMissingAttempts: 2,
    pollIntervalMs: 0,
    wait: async () => { waits += 1; },
  });
  assert.equal(missing.kind, "not-found");
  assert.equal(waits, 1);

  const unavailable = await recovery.waitForEditorTaskLog("edit-unavailable", async () => {
    throw new Error("offline");
  }, { maxAttempts: 2, maxMissingAttempts: 1, pollIntervalMs: 0, wait: async () => {} });
  assert.equal(unavailable.kind, "pending");
  assert.match(unavailable.message, /offline/);
});
