import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const preparedCalls = [];
const load = createTsRequire(process.cwd(), {
  "@/lib/canvas/api": {
    prepareCanvasAgentReferences: async (references) => {
      preparedCalls.push(references);
      return references.map((reference) => ({ ...reference, url: `prepared:${reference.url}` }));
    },
  },
});
const agent = load("./lib/creation/agent");

async function withFetch(handler, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

test("prompt optimization uses the shared Agent task boundary", async () => {
  preparedCalls.length = 0;
  let request;
  const result = await withFetch(async (input, options) => {
    request = { input, options };
    return new Response(JSON.stringify({ message: "  polished copy  " }), {
      headers: { "content-type": "application/json" },
    });
  }, () => agent.requestPromptOptimization(
    "original copy",
    [{ url: "image.png", name: "Reference" }],
    "chat-model",
    "polish_text",
  ));

  assert.equal(result, "polished copy");
  assert.deepEqual(preparedCalls, [[{ url: "image.png", name: "Reference" }]]);
  assert.equal(request.input, "/api/agent");
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, "chat-model");
  assert.equal(payload.task, "polish_text");
  assert.equal(payload.stream, true);
  assert.deepEqual(payload.messages[0].references, [{
    id: "polish_text-1", kind: "image", name: "Reference", url: "prepared:image.png",
  }]);
  assert.match(payload.messages[0].content, /\[原文\]\noriginal copy$/u);
});

test("prompt optimization keeps the original prompt for the default task", async () => {
  let request;
  const result = await withFetch(async (_input, options) => {
    request = options;
    return new Response(JSON.stringify({ message: "optimized" }), {
      headers: { "content-type": "application/json" },
    });
  }, () => agent.requestPromptOptimization("image prompt", [], undefined));

  assert.equal(result, "optimized");
  const payload = JSON.parse(request.body);
  assert.equal(payload.task, "optimize_prompt");
  assert.equal(payload.messages[0].content, "image prompt");
});

test("prompt optimization rejects blank input and empty Agent output", async () => {
  await assert.rejects(() => agent.requestPromptOptimization("   "), /请输入需要优化的提示词/u);
  await withFetch(async () => new Response(JSON.stringify({ message: "" }), {
    headers: { "content-type": "application/json" },
  }), async () => {
    await assert.rejects(() => agent.requestPromptOptimization("prompt"), /助手没有返回有效结果/u);
  });
});
