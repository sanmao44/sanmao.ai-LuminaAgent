import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

function createGenerateRoute(task) {
  const modules = {
    "@/lib/auth": { isTrustedAppRequest: () => true },
    "@/apps/worker/task-entry": { runVideoGeneration: async () => task },
    "@/lib/generation-source": { normalizeGenerationSource: (source, fallback) => source || fallback },
    "@/lib/runtime-operation": {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
  };
  return createTsRequire(process.cwd(), modules)("./app/api/video/generate/route");
}

function generateRequest() {
  return new Request("http://localhost:3210/api/video/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { prompt: "a test video" } }),
  });
}

test("video generate route exposes the failed task reason in its HTTP error", async () => {
  const task = {
    id: "video-task-failed",
    status: "failed",
    error: "图片暂时无法提交：应用的自动中转服务尚未连接。",
  };
  const { POST } = createGenerateRoute(task);

  const response = await POST(generateRequest());

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: task.error,
    task,
  });
});

test("video generate route still acknowledges a submitted task", async () => {
  const task = { id: "video-task-pending", status: "pending" };
  const { POST } = createGenerateRoute(task);

  const response = await POST(generateRequest());

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, task });
});
