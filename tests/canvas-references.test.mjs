import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadReferences() {
  const sourceUrl = new URL("../lib/canvas/references.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const references = await loadReferences();

function node(id, type, kind, value) {
  return {
    id,
    type,
    x: 0,
    y: 0,
    data: type === "media"
      ? { kind, url: `data:${kind}/${id}` , name: id }
      : { text: value || id },
  };
}

test("keeps prompt context separate from image and video inputs", () => {
  const result = references.resolveCanvasInputSemantics([
    node("img-1", "media", "image"),
    node("copy", "prompt", undefined, "保持主体"),
    node("vid-1", "media", "video"),
    node("img-2", "media", "image"),
  ], "video", "frames");

  assert.deepEqual(result.imageReferences.map((item) => item.id), ["img-1", "img-2"]);
  assert.deepEqual(result.videoReferences.map((item) => item.id), ["vid-1"]);
  assert.deepEqual(result.textContext.map((item) => item.id), ["copy"]);
  assert.equal(result.firstFrame?.id, "img-1");
  assert.equal(result.lastFrame?.id, "img-2");
  assert.equal(result.referenceVideo?.id, "vid-1");
});

test("agent mode accepts still images but never treats text or video as image references", () => {
  const result = references.resolveCanvasInputSemantics([
    node("text-1", "prompt", undefined, "描述这张图"),
    node("img-1", "media", "image"),
    { id: "upscale-1", type: "upscale", x: 0, y: 0, data: { kind: "image", url: "data:image/upscale-1", name: "超分结果" } },
    node("video-1", "media", "video"),
  ], "agent");

  assert.deepEqual(result.imageReferences.map((item) => item.id), ["img-1", "upscale-1"]);
  assert.deepEqual(result.textContext.map((item) => item.id), ["text-1"]);
  assert.deepEqual(result.videoReferences.map((item) => item.id), ["video-1"]);
});
