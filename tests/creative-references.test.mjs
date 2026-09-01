import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadReferences() {
  const sourceUrl = new URL("../lib/creative-references.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const refs = await loadReferences();

const available = [
  { id: "image-1", kind: "image", name: "图片一", url: "data:image/png;base64,one" },
  { id: "video-1", kind: "video", name: "转场视频", url: "data:video/mp4;base64,two" },
  { id: "text-1", kind: "text", name: "脚本.txt", text: "真实文本内容", mimeType: "text/plain" },
];

test("inserts a numbered mention at the active cursor and replaces the active query", () => {
  const inserted = refs.insertReferenceMention("前景 @图", 6, 1);
  assert.equal(inserted.value, "前景 @2 ");
  assert.equal(inserted.cursor, inserted.value.length);

  const middle = refs.insertReferenceMention("A @ B", 3, 0, "");
  assert.equal(middle.value, "A @1 B");
});

test("selects exact references with mentions and all references without mentions", () => {
  assert.deepEqual(refs.selectCreativeReferences("请使用 @1 和 @3", available), {
    references: [available[0], available[2]],
    invalidNumbers: [],
    hasMentions: true,
  });
  assert.deepEqual(refs.selectCreativeReferences("请综合所有素材", available), {
    references: available,
    invalidNumbers: [],
    hasMentions: false,
  });
  assert.deepEqual(refs.selectCreativeReferences("错误 @4", available).invalidNumbers, [4]);
});

test("deduplicates repeated mentions while preserving mention order", () => {
  const result = refs.selectCreativeReferences("@2 @1 @2", available);
  assert.deepEqual(result.references.map((item) => item.id), ["video-1", "image-1"]);
});

test("turns natural image and video labels into real numbered mentions", () => {
  const result = refs.replaceNaturalReferenceLabels("图片1转场到图片2，最后转场到文本3", available);
  assert.equal(result.value, "@1转场到@2，最后转场到文本3");
  assert.equal(result.replaced, true);

  const chinese = refs.replaceNaturalReferenceLabels("图一接图二", available);
  assert.equal(chinese.value, "@1接@2");
});

test("appends text reference content instead of a placeholder", () => {
  const prompt = refs.appendTextReferenceContext("生成视频", available);
  assert.match(prompt, /\[引用文本：脚本\.txt\]/);
  assert.match(prompt, /真实文本内容/);
  assert.doesNotMatch(prompt, /文本上下文/);
});

test("normalizes legacy image URLs and typed video/text references", () => {
  assert.deepEqual(refs.normalizeCreativeReferences(["https://example.com/a.png", available[1], available[2]], 16).map((item) => item.kind), ["image", "video", "text"]);
  assert.equal(refs.normalizeCreativeReference({ id: "text", kind: "text", name: "x", content: "body" }).text, "body");
});
