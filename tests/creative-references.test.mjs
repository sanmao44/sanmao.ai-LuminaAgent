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

async function loadImageReferenceRequest() {
  const referencesUrl = new URL("../lib/creative-references.ts", import.meta.url);
  const referencesSource = await readFile(referencesUrl, "utf8");
  const referencesCompiled = ts.transpileModule(referencesSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: referencesUrl.pathname,
  }).outputText;
  const referencesModuleUrl = `data:text/javascript;base64,${Buffer.from(referencesCompiled).toString("base64")}`;
  const requestUrl = new URL("../lib/canvas/image-reference-request.ts", import.meta.url);
  const requestSource = await readFile(requestUrl, "utf8");
  const requestCompiled = ts.transpileModule(requestSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: requestUrl.pathname,
  }).outputText.replace('from "../creative-references"', `from "${referencesModuleUrl}"`);
  return import(`data:text/javascript;base64,${Buffer.from(requestCompiled).toString("base64")}`);
}

const refs = await loadReferences();
const imageRequest = await loadImageReferenceRequest();

const available = [
  { id: "image-1", kind: "image", name: "图片一", url: "data:image/png;base64,one" },
  { id: "video-1", kind: "video", name: "转场视频", url: "data:video/mp4;base64,two" },
  { id: "text-1", kind: "text", name: "脚本.txt", text: "真实文本内容", mimeType: "text/plain" },
];

test("keeps numeric @ tokens as prompt text when no references are available", () => {
  const result = refs.selectCreativeReferences("把@1@2@3变成图一图二图三", []);
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.invalidNumbers, []);
  assert.equal(result.hasMentions, true);
});

test("inserts a numbered mention at the active cursor and replaces the active query", () => {
  const inserted = refs.insertReferenceMention("前景 @图", 6, 1);
  assert.equal(inserted.value, "前景 @2 ");
  assert.equal(inserted.cursor, inserted.value.length);

  const middle = refs.insertReferenceMention("A @ B", 3, 0, "");
  assert.equal(middle.value, "A @1 B");
});

test("opens and inserts mentions after any text character", () => {
  assert.deepEqual(refs.referenceMentionRange("主体@图", 4), {
    start: 2,
    end: 4,
    query: "图",
  });
  assert.deepEqual(refs.referenceMentionRange("look@ref", 8), {
    start: 4,
    end: 8,
    query: "ref",
  });

  const inserted = refs.insertReferenceMention("主体@图之后", 4, 1);
  assert.equal(inserted.value, "主体@2 之后");
  assert.equal(inserted.cursor, 5);
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

test("recognizes mentions embedded in text when selecting references", () => {
  const result = refs.selectCreativeReferences("请让主体@1参考风格@3", available);
  assert.deepEqual(result.references.map((item) => item.id), ["image-1", "text-1"]);
  assert.equal(refs.hasReferenceMentions("主体@1参考"), true);
  assert.deepEqual(refs.referenceMentionNumbers("主体@1参考风格@3"), [1, 3]);
});

test("turns natural image and video labels into real numbered mentions", () => {
  const result = refs.replaceNaturalReferenceLabels("图片1转场到图片2，最后转场到文本3", available);
  assert.equal(result.value, "@1转场到@2，最后转场到文本3");
  assert.equal(result.replaced, true);

  const chinese = refs.replaceNaturalReferenceLabels("图一接图二", available);
  assert.equal(chinese.value, "@1接@2");
});

test("keeps model names and unresolved natural labels as ordinary prompt text", () => {
  const result = refs.replaceNaturalReferenceLabels("## GPT Image 2 提示词\nImage 2.0 风格\nImage 4", available);
  assert.equal(result.value, "## GPT Image 2 提示词\nImage 2.0 风格\nImage 4");
  assert.deepEqual(result.unresolved, ["Image 4"]);
});

test("treats an aspect-ratio mention as layout-only and keeps visual references separate", () => {
  const images = [
    { id: "henan", kind: "image", name: "河南版本", url: "data:image/png;base64,henan", width: 2429, height: 432 },
    { id: "shandong", kind: "image", name: "山东参考", url: "data:image/png;base64,shandong", width: 1920, height: 1080 },
  ];
  const result = refs.resolveCreativeReferenceRoles("保持和 @1 一样的比例，来个类似 @2 山东版本", images);
  assert.deepEqual(result.layoutOnlyNumbers, [1]);
  assert.deepEqual(result.layoutOnlyReferences.map((reference) => reference.id), ["henan"]);
  assert.deepEqual(result.references.map((reference) => reference.id), ["shandong"]);
  assert.doesNotMatch(result.prompt, /@1/);
  assert.match(result.prompt, /2429:432/);
  assert.match(result.prompt, /视觉参考图1/);
  assert.match(result.prompt, /不是视觉参考/);
});

test("keeps a reference visual when the same mention is used for style", () => {
  const result = refs.resolveCreativeReferenceRoles("使用 @1 风格，保持画幅比例为 16:9", [
    { id: "style", kind: "image", name: "风格图", url: "data:image/png;base64,style", width: 1600, height: 900 },
  ]);
  assert.deepEqual(result.layoutOnlyNumbers, []);
  assert.deepEqual(result.references.map((reference) => reference.id), ["style"]);
  assert.equal(result.prompt, "使用 视觉参考图1 风格，保持画幅比例为 16:9");
});

test("does not drop a reference when one mention uses both layout and visual roles", () => {
  const result = refs.resolveCreativeReferenceRoles("保持 @1 比例，同时使用 @1 风格", [
    { id: "mixed", kind: "image", name: "混合参考", url: "data:image/png;base64,mixed", width: 1600, height: 900 },
  ]);
  assert.deepEqual(result.layoutOnlyNumbers, []);
  assert.deepEqual(result.references.map((reference) => reference.id), ["mixed"]);
  assert.equal(result.prompt, "保持 16:9（约 1.778:1） 比例，同时使用 视觉参考图1 风格");
});

test("replaces numeric labels so a sparse mention cannot be misread as reference two", () => {
  const result = refs.resolveCreativeReferenceRoles("只使用 @2 的主体", [
    { id: "old", kind: "image", name: "旧参考", url: "data:image/png;base64,old" },
    { id: "target", kind: "image", name: "目标参考", url: "data:image/png;base64,target" },
  ]);
  assert.deepEqual(result.references.map((reference) => reference.id), ["target"]);
  assert.equal(result.prompt, "只使用 视觉参考图1 的主体");
  assert.doesNotMatch(result.prompt, /@2/);
});

test("prepares the screenshot reference roles as a new-image request without leaking source labels", () => {
  const prompt = "保持和 @1 一样的比例，来个类似 @2 山东版本，画面元素全要换成山东元素，任何元素都不能和广东那张图的元素一样";
  const result = imageRequest.prepareCanvasImageReferenceRequest({
    prompt,
    references: [
      { id: "guangdong", kind: "image", name: "广东版本", url: "/guangdong.png", width: 2429, height: 432 },
      { id: "henan", kind: "image", name: "河南版本", url: "/henan.png", width: 2429, height: 432 },
    ],
    params: {
      kind: "image",
      model: "image-model",
      aspect: "自动",
      customAspectWidth: 16,
      customAspectHeight: 9,
      sizeMode: "system",
      resolution: "2K",
      width: 1024,
      height: 1024,
      count: 1,
      quality: "自动",
      outputFormat: "png",
      backgroundMode: "auto",
      upscaleScale: 2,
      upscaleTarget: "auto",
      upscaleSeed: 1,
      upscaleColorCorrection: "wavelet",
      upscaleAlgorithm: "lanczos",
    },
    imageOperation: "generate",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.imageOperation, "generate");
  assert.deepEqual(result.resolution.layoutOnlyReferences.map((reference) => reference.id), ["guangdong"]);
  assert.deepEqual(result.references.map((reference) => reference.id), ["henan"]);
  assert.deepEqual(result.imageReferences.map((reference) => reference.url), ["/henan.png"]);
  assert.equal(result.params.aspect, "自定义");
  assert.ok(Math.abs(result.params.customAspectWidth / result.params.customAspectHeight - 2429 / 432) / (2429 / 432) < 0.005);
  assert.doesNotMatch(result.prompt, /@1|@2|广东版本|河南版本/);
  assert.match(result.prompt, /山东版本/);
  assert.match(result.prompt, /必须替换/);
});

test("uses connected references by default without sending unrelated candidates", () => {
  const result = imageRequest.prepareCanvasImageReferenceRequest({
    prompt: "生成一张新的山东主题图片",
    references: [
      { id: "connected", kind: "image", name: "已连接风格图", url: "/style.png", origin: "node" },
      { id: "unrelated", kind: "image", name: "未连接图片", url: "/unrelated.png", origin: "node" },
      { id: "unrelated-pending", kind: "image", name: "未连接待处理图片", url: "/pending.png", pending: true, origin: "node" },
      { id: "unrelated-video", kind: "video", name: "未连接视频", url: "/unrelated.mp4", origin: "node" },
    ],
    defaultReferences: [
      { id: "connected", kind: "image", name: "已连接风格图", url: "/style.png", origin: "node" },
    ],
    params: { sizeMode: "system", aspect: "自动", customAspectWidth: 1, customAspectHeight: 1 },
    imageOperation: "generate",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.references.map((reference) => reference.id), ["connected"]);
  assert.deepEqual(result.imageReferences.map((reference) => reference.url), ["/style.png"]);
});

test("blocks a missing or conflicting ratio reference before Canvas submits the request", () => {
  const common = {
    prompt: "保持 @1 比例",
    references: [{ id: "ratio", kind: "image", name: "尺寸参考", url: "/ratio.png", width: 2429, height: 432 }],
    imageOperation: "generate",
    params: {
      kind: "image",
      model: "image-model",
      aspect: "1:1",
      customAspectWidth: 1,
      customAspectHeight: 1,
      sizeMode: "system",
      resolution: "2K",
      width: 1024,
      height: 1024,
      count: 1,
      quality: "自动",
      outputFormat: "png",
      backgroundMode: "auto",
      upscaleScale: 2,
      upscaleTarget: "auto",
      upscaleSeed: 1,
      upscaleColorCorrection: "wavelet",
      upscaleAlgorithm: "lanczos",
    },
  };
  const conflict = imageRequest.prepareCanvasImageReferenceRequest(common);
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.match(conflict.message, /比例.*冲突/);

  const missing = imageRequest.prepareCanvasImageReferenceRequest({
    ...common,
    params: { ...common.params, aspect: "自动" },
    references: [{ id: "ratio", kind: "image", name: "尺寸参考", url: "/ratio.png" }],
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.match(missing.message, /无法读取.*尺寸/);
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
