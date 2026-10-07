import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/image-storage-client.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const storage = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("image storage client sends the existing payload and returns validated records", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({ ok: true, images: [{ url: "/api/storage/file?name=one.png" }, { invalid: true }] }), { status: 200 });
  };
  try {
    const result = await storage.storeImages([{ url: "https://example.test/one.png" }]);
    assert.deepEqual(result, { ok: true, images: [{ url: "/api/storage/file?name=one.png" }] });
    assert.equal(request.input, "/api/storage/images");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(request.init.body), { images: [{ url: "https://example.test/one.png" }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image storage client keeps non-ok responses as a fallback result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
  try {
    assert.deepEqual(await storage.storeImages([{ url: "data:image/png;base64,abc" }]), { ok: false, images: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
