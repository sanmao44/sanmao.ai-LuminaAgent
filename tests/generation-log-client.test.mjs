import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const { cleanupGenerationLogs, listGenerationLogs, previewGenerationLogCleanup } = createTsRequire(process.cwd())(
  "./lib/generation-log-client",
);

const originalFetch = globalThis.fetch;

function mockResponse(body, ok = true) {
  return { ok, json: async () => body };
}

test.afterEach(() => { globalThis.fetch = originalFetch; });

test("generation log client preserves list endpoint and no-store behavior", async () => {
  let request;
  globalThis.fetch = async (input, init) => { request = { input, init }; return mockResponse({ logs: [{ id: "one" }] }); };
  assert.deepEqual(await listGenerationLogs(12), [{ id: "one" }]);
  assert.equal(request.input, "/api/generation-logs?limit=12");
  assert.deepEqual(request.init, { cache: "no-store" });
});

test("generation log client preserves cleanup payloads", async () => {
  const requests = [];
  globalThis.fetch = async (input, init) => { requests.push({ input, init }); return mockResponse({ removedLogs: 2, deletedImages: 1 }); };
  await cleanupGenerationLogs(90, true);
  await previewGenerationLogCleanup(undefined, false);
  assert.equal(requests[0].input, "/api/generation-logs");
  assert.equal(JSON.parse(requests[0].init.body).days, 90);
  assert.equal(JSON.parse(requests[0].init.body).deleteImages, true);
  assert.equal(JSON.parse(requests[1].init.body).dryRun, true);
});
