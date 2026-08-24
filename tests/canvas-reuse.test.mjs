import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadReuse() {
  const sourceUrl = new URL("../lib/canvas/reuse.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const reuse = await loadReuse();

function reference(id, url = `data:image/png;base64,${id}`) {
  return { id, kind: "image", url, name: id, origin: "node", nodeId: id };
}

test("adds, deduplicates, removes and reorders draft references without mutating the source array", () => {
  const initial = [reference("one"), reference("two")];
  const result = reuse.addReferenceDrafts(initial, [reference("two"), reference("three")]);
  assert.deepEqual(result.added.map((item) => item.id), ["three"]);
  assert.deepEqual(result.references.map((item) => item.id), ["one", "two", "three"]);
  assert.deepEqual(initial.map((item) => item.id), ["one", "two"]);
  assert.deepEqual(reuse.removeReferenceDraft(result.references, "two").map((item) => item.id), ["one", "three"]);
  assert.deepEqual(reuse.reorderReferenceDrafts(result.references, 2, 0).map((item) => item.id), ["three", "one", "two"]);
});

test("caps new references at sixteen and keeps existing order", () => {
  const initial = Array.from({ length: 15 }, (_, index) => reference(`old-${index}`));
  const result = reuse.addReferenceDrafts(initial, [reference("new-1"), reference("new-2")]);
  assert.equal(result.references.length, 16);
  assert.deepEqual(result.references.slice(-1).map((item) => item.id), ["new-1"]);
  assert.deepEqual(result.rejected.map((item) => item.id), ["new-2"]);
});

test("clones a reuse draft including all parameter fields and reference metadata", () => {
  const draft = {
    sourceNodeId: "output-1",
    kind: "image",
    prompt: "保持主体，替换背景",
    params: {
      kind: "image",
      model: "image-model",
      aspect: "16:9",
      customAspectWidth: 16,
      customAspectHeight: 9,
      sizeMode: "custom",
      resolution: "4K",
      width: 1920,
      height: 1080,
      count: 3,
      quality: "high",
      outputFormat: "png",
      backgroundMode: "auto",
      upscaleScale: 2,
      upscaleTarget: "auto",
      upscaleSeed: 42,
      upscaleColorCorrection: "wavelet",
      upscaleAlgorithm: "lanczos",
      mask: { assetId: "mask-1", url: "data:image/png;base64,mask" },
    },
    references: [reference("one")],
    operation: "generate",
    dirty: false,
  };
  const copy = reuse.cloneReuseDraft(draft);
  assert.deepEqual(copy, draft);
  assert.notEqual(copy, draft);
  assert.notEqual(copy.params, draft.params);
  assert.notEqual(copy.references, draft.references);
  copy.references[0].name = "changed";
  assert.equal(draft.references[0].name, "one");
});

test("creates a reuse draft from a completed media node using saved generation parameters", () => {
  const node = {
    id: "output-1",
    type: "media",
    x: 0,
    y: 0,
    data: {
      kind: "video",
      url: "/video.mp4",
      generation: {
        kind: "video",
        prompt: "夜晚沙漠中的骆驼",
        params: { kind: "video", model: "video-model", operation: "extend", inputMode: "reference", duration: 5, aspect: "16:9", resolution: "720p", audio: true },
      },
    },
  };
  const draft = reuse.reuseDraftFromNode(node, [reference("ref-1")]);
  assert.equal(draft.sourceNodeId, "output-1");
  assert.equal(draft.prompt, "夜晚沙漠中的骆驼");
  assert.equal(draft.operation, "extend");
  assert.equal(draft.params.audio, true);
  assert.equal(draft.references[0].nodeId, "ref-1");
});

test("ignores invalid source nodes instead of creating a destructive partial draft", () => {
  assert.equal(reuse.reuseDraftFromNode({ id: "prompt", type: "prompt", x: 0, y: 0, data: { text: "hello" } }, []), null);
  assert.equal(reuse.reuseDraftFromNode({ id: "media", type: "media", x: 0, y: 0, data: { kind: "image", url: "/image.png" } }, []), null);
});
