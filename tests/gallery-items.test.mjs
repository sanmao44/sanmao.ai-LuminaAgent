import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/creation/gallery-items.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const gallery = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("gallery projection preserves generation metadata and reference fallback", () => {
  const items = gallery.buildGalleryItems(
    [{ url: "https://example.test/output.png", localFileName: "local.png", revisedPrompt: "revised" }],
    {
      prompt: "original prompt",
      modelId: "model-1",
      modelName: "Model",
      providerName: "Provider",
      source: "edit",
      compareReference: { id: "ref-1", name: "Reference", url: "https://example.test/ref.png" },
      annotations: [{ id: "annotation-1" }],
      mask: { dataUrl: "data:image/png;base64,mask", feather: 3 },
    },
    { createdAt: 100, createId: () => "gallery-1", includeCompareReference: true },
  );

  assert.equal(items[0].id, "gallery-1");
  assert.equal(items[0].prompt, "local.png");
  assert.equal(items[0].revisedPrompt, "revised");
  assert.equal(items[0].source, "edit");
  assert.equal(items[0].createdAt, 100);
  assert.deepEqual(items[0].references, [{ id: "ref-1", name: "Reference", url: "https://example.test/ref.png" }]);
  assert.equal(items[0].compareReferenceUrl, "https://example.test/ref.png");
  assert.equal(items[0].compareReferenceName, "Reference");
  assert.deepEqual(items[0].annotations, [{ id: "annotation-1" }]);
  assert.deepEqual(items[0].mask, { dataUrl: "data:image/png;base64,mask", feather: 3 });
});

test("gallery projection keeps per-image model overrides and provenance", () => {
  const [item] = gallery.buildGalleryItems(
    [{ url: "output", modelId: "actual-model" }],
    {
      prompt: "prompt",
      modelId: "fallback-model",
      references: [{ id: "ref", name: "Ref", url: "reference" }],
      provenance: [{ relation: "derived-from", fromId: "source" }],
    },
    {
      createdAt: 200,
      createId: () => "gallery-2",
      includeProvenance: true,
    },
  );

  assert.equal(item.modelId, "actual-model");
  assert.equal(item.source, "edit");
  assert.deepEqual(item.provenance, [{ relation: "derived-from", fromId: "source", id: "provenance:derived-from:source:gallery-2", toId: "gallery-2" }]);
});
