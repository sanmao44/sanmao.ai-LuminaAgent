import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createTsRequire } from "./ts-require.mjs";

async function loadReferences() {
  const sourceUrl = new URL("../lib/canvas/references.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

async function loadVideoInputValidation() {
  const sourceUrl = new URL("../lib/canvas/video-input-validation.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const references = await loadReferences();
const videoInputValidation = await loadVideoInputValidation();
const inputRoles = createTsRequire(process.cwd())("./lib/canvas/input-roles");

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

test("resolves reference, first-frame, and first/last-frame slots without deleting connected inputs", () => {
  const images = [node("img-1", "media", "image"), node("img-2", "media", "image"), node("img-3", "media", "image")];
  const reference = references.resolveCanvasVideoInputs(images, "reference", undefined, { maxReferenceImages: 2 });
  assert.deepEqual(reference.referenceImages.map((item) => item.id), ["img-1", "img-2"]);
  assert.deepEqual(reference.unusedInputs.map((item) => item.id), ["img-3"]);

  const first = references.resolveCanvasVideoInputs(images, "first-frame");
  assert.equal(first.firstFrame?.id, "img-1");
  assert.deepEqual(first.unused.map((item) => item.id), ["img-2", "img-3"]);

  const frames = references.resolveCanvasVideoInputs(images, "frames");
  assert.equal(frames.firstFrame?.id, "img-1");
  assert.equal(frames.lastFrame?.id, "img-2");
  assert.deepEqual(frames.unused.map((item) => item.id), ["img-3"]);
});

test("keeps grouped image references and video inputs separate", () => {
  const result = references.resolveCanvasVideoInputs([
    node("img-1", "media", "image"),
    node("img-2", "media", "image"),
    node("img-3", "media", "image"),
    node("video-1", "media", "video"),
  ], "reference", undefined, { maxReferenceImages: 16 });

  assert.deepEqual(result.referenceImages.map((item) => item.id), ["img-1", "img-2", "img-3"]);
  assert.equal(result.referenceVideo?.id, "video-1");
  assert.deepEqual(result.unusedInputs, []);
});

test("preserves explicit frame roles while legacy reference roles fill the next available slot", () => {
  const images = [node("img-a", "media", "image"), node("img-b", "media", "image"), node("img-c", "media", "image")];
  const roles = new Map([
    ["img-a", "reference-image"],
    ["img-b", "last-frame"],
  ]);
  const result = references.resolveCanvasVideoInputs(images, "frames", roles);
  assert.equal(result.firstFrame?.id, "img-a");
  assert.equal(result.lastFrame?.id, "img-b");
  assert.deepEqual(result.unused.map((item) => item.id), ["img-c"]);
});

test("selects reference mode before first-frame mode and infers typed edge roles", () => {
  assert.equal(references.preferredCanvasVideoInputMode(["video-generate", "video-reference"]), "reference");
  assert.equal(references.preferredCanvasVideoInputMode(["video-generate", "video-first-frame"]), "first-frame");
  assert.equal(references.preferredCanvasVideoInputMode(["video-generate"]), undefined);

  const source = node("image", "media", "image");
  const target = { id: "video", type: "media", x: 0, y: 0, data: { kind: "video", url: "video:url", params: { kind: "video", inputMode: "frames" } } };
  assert.equal(references.inferCanvasInputRole(source, target, "frames", 0), "first-frame");
  assert.equal(references.inferCanvasInputRole(source, target, "frames", 1), "last-frame");
  assert.equal(references.inferCanvasInputRole(source, target, "reference", 0), "reference-image");
});

test("projects persisted canvas edge roles using stored reference order", () => {
  const first = node("first", "media", "image");
  const second = node("second", "media", "image");
  const target = {
    id: "target",
    type: "media",
    x: 0,
    y: 0,
    data: {
      kind: "video",
      url: "video:target",
      params: { kind: "video", inputMode: "frames" },
      referenceOrder: [second.id, first.id],
    },
  };
  const document = {
    version: "1",
    nodes: [first, second, target],
    groups: [],
    edges: [
      { id: "generated", source: first.id, target: target.id, kind: "generated" },
      { id: "second-edge", source: second.id, target: target.id },
      { id: "first-edge", source: first.id, target: target.id, inputRole: "reference-image", order: 1 },
    ],
    camera: { x: 0, y: 0, zoom: 1 },
  };

  const roles = inputRoles.canvasInputRolesForTarget(document, target.id);
  assert.equal(roles.get(second.id), "first-frame");
  assert.equal(roles.get(first.id), "reference-image");
  assert.equal(roles.has("generated"), false);
});

test("automatically selects video mode from connected image count with capability fallback", () => {
  const full = { supportsFirstFrame: true, supportsFrames: true, supportsReference: true };
  assert.equal(references.preferredCanvasVideoInputModeForImageCount(0, full), undefined);
  assert.equal(references.preferredCanvasVideoInputModeForImageCount(1, full), "first-frame");
  assert.equal(references.preferredCanvasVideoInputModeForImageCount(2, full), "frames");
  assert.equal(references.preferredCanvasVideoInputModeForImageCount(3, full), "reference");

  assert.equal(references.preferredCanvasVideoInputModeForImageCount(1, { supportsReference: true }), "reference");
  assert.equal(references.preferredCanvasVideoInputModeForImageCount(2, { supportsReference: true }), "reference");
  assert.equal(references.preferredCanvasVideoInputModeForImageCount(3, { supportsFirstFrame: true }), undefined);
  assert.equal(references.preferredCanvasVideoInputModeForImageCount(2, ["video-first-frame", "video-reference"]), "frames");
});

test("uses a connected still image as an in-place video generation target", () => {
  const image = node("image", "media", "image");
  const video = node("video", "media", "video");
  assert.equal(references.shouldGenerateVideoInPlace(video, [image]), true);
  assert.equal(references.shouldGenerateVideoInPlace(video, []), false);
  assert.equal(references.shouldGenerateVideoInPlace(video, [node("video-ref", "media", "video")]), false);
  assert.equal(references.shouldGenerateVideoInPlace({ ...image, data: { ...image.data, url: "" } }, [image]), false);
  assert.equal(references.shouldGenerateVideoInPlace({ ...video, type: "generator" }, [image]), false);
});

test("explains invalid video input modes without mutating the resolved inputs", () => {
  const image = node("image", "media", "image");
  const video = node("video", "media", "video");
  const limits = { maxReferenceImages: 2, maxReferenceVideos: 1 };
  const textInputs = references.resolveCanvasVideoInputs([image], "text");
  assert.match(videoInputValidation.canvasVideoInputError(textInputs, "text", limits), /文生视频模式/);

  const frameInputs = references.resolveCanvasVideoInputs([image], "frames");
  assert.match(videoInputValidation.canvasVideoInputError(frameInputs, "frames", limits), /首尾帧模式请先连接/);

  const referenceInputs = references.resolveCanvasVideoInputs([video], "reference");
  assert.match(videoInputValidation.canvasVideoInputError(referenceInputs, "reference", { ...limits, maxReferenceVideos: 0 }), /不支持参考视频/);
  assert.deepEqual(referenceInputs.media.map((item) => item.id), ["video"]);
});
