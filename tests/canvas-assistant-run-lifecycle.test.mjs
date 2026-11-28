import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const lifecycle = createTsRequire(process.cwd())("./lib/canvas/assistant-run-lifecycle");

function makeRun(overrides = {}) {
  return {
    runId: "run-1",
    scopeKey: "project-a:canvas-a",
    pendingId: "message-1",
    controller: new AbortController(),
    remoteRequestStarted: false,
    localExecutionSettled: false,
    cancelRequested: false,
    cancelRequestInFlight: false,
    ...overrides,
  };
}

const cancelledStatus = {
  runId: "run-1",
  state: "cancelling",
  completedToolCalls: 2,
  updatedAt: "2026-11-28T00:00:00.000Z",
};

test("stopping before remote submission aborts locally without asking the server", async () => {
  const run = makeRun();
  let cancelCalls = 0;

  const result = await lifecycle.requestCanvasAssistantRunCancellation(run, async () => {
    cancelCalls += 1;
    return cancelledStatus;
  });

  assert.deepEqual(result, { kind: "local" });
  assert.equal(cancelCalls, 0);
  assert.equal(run.controller.signal.aborted, true);
  assert.equal(run.cancelRequested, true);
});

test("stopping an active run requests server cancellation without aborting result observation", async () => {
  const run = makeRun({ remoteRequestStarted: true });
  let cancelCalls = 0;

  const result = await lifecycle.requestCanvasAssistantRunCancellation(run, async (runId) => {
    cancelCalls += 1;
    assert.equal(runId, "run-1");
    return cancelledStatus;
  });

  assert.deepEqual(result, { kind: "requested", status: cancelledStatus });
  assert.equal(cancelCalls, 1);
  assert.equal(run.controller.signal.aborted, false);
  assert.equal(run.cancelRequested, true);
});

test("stop retries a not-yet-created remote run and stops retrying after local submission settles", async () => {
  const run = makeRun({ remoteRequestStarted: true });
  let cancelCalls = 0;
  let waits = 0;
  const result = await lifecycle.requestCanvasAssistantRunCancellation(run, async () => {
    cancelCalls += 1;
    if (cancelCalls === 1) throw Object.assign(new Error("not registered yet"), { status: 404 });
    return cancelledStatus;
  }, async (milliseconds) => {
    assert.equal(milliseconds, 250);
    waits += 1;
  });

  assert.equal(result.kind, "requested");
  assert.equal(cancelCalls, 2);
  assert.equal(waits, 1);

  const settledRun = makeRun({ remoteRequestStarted: true, localExecutionSettled: true });
  let settledCalls = 0;
  const settledResult = await lifecycle.requestCanvasAssistantRunCancellation(settledRun, async () => {
    settledCalls += 1;
    throw Object.assign(new Error("missing"), { status: 404 });
  }, async () => assert.fail("settled submission must not retry"));
  assert.deepEqual(settledResult, { kind: "awaiting-run" });
  assert.equal(settledCalls, 1);
});

test("stopped messages clear persisted run markers while preserving partial text", () => {
  const pending = {
    id: "message-1",
    content: "server snapshot text",
    pending: true,
    activity: { stage: "cancelling", message: "正在停止…" },
    assistantRun: { runId: "run-1", scopeKey: "project-a:canvas-a" },
  };
  const stopped = lifecycle.finalizeCanvasAssistantRunMessage(pending, "partial answer");

  assert.equal(stopped.content, "partial answer");
  assert.equal(stopped.pending, undefined);
  assert.equal(stopped.activity, undefined);
  assert.equal(stopped.assistantRun, undefined);
  assert.equal(stopped.interrupted, true);
  assert.deepEqual(pending.assistantRun, { runId: "run-1", scopeKey: "project-a:canvas-a" });
});

test("a stale run cannot own or release another canvas run", () => {
  const current = makeRun({ runId: "run-2", scopeKey: "project-b:canvas-b", pendingId: "message-2" });
  assert.equal(lifecycle.isCurrentCanvasAssistantRun(current, makeRun()), false);
  assert.equal(lifecycle.isCurrentCanvasAssistantRun(current, current), true);
});
