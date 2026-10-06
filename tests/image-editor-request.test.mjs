import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/image-editor/editor-request.ts", import.meta.url);
let source = await readFile(sourceUrl, "utf8");
source = source
  .replace(/import \{ editorRatio, presetDimensions \} from "@\/lib\/generation-log-presentation";/, `
const editorRatio = (editor) => editor.ratio === "自动" ? "1:1" : editor.ratio;
const presetDimensions = (ratio, tier) => ({ width: ratio === "16:9" ? 1920 : tier === "2k" ? 2048 : 1024, height: ratio === "16:9" ? 1088 : tier === "2k" ? 2048 : 1024 });`)
  .replace(/import \{ isCloudUpscaleModel \} from "@\/lib\/image-editor\/editor-options";/, `const isCloudUpscaleModel = (model) => model?.provider === "tencent-ci" || model?.provider === "aliyun-viapi";`)
  .replace(/import \{ upscaleTargetDimensions \} from "@\/lib\/canvas\/upscale";/, `const upscaleTargetDimensions = (source, scale, model, target) => model?.provider === "tencent-ci" ? { width: source.width * scale, height: source.height * scale } : { width: target === "2K" ? 2048 : source.width * scale, height: target === "2K" ? 2048 : source.height * scale };`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const editorRequest = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const baseEditor = {
  item: { id: "source-123456", url: "https://example.test/source.png", prompt: "source prompt" },
  prompt: "  make it warmer  ", modelId: "auto", ratio: "16:9", count: 1,
  quality: "自动", fidelity: "high", sizeMode: "system", sizeTier: "1k",
  customWidth: 1000, customHeight: 700, mask: null, scale: 2, targetSize: "auto",
  seed: 42, colorCorrection: "wavelet", algorithm: "lanczos", upscaleOutputFormat: "png", upscaleOutputQuality: 95,
};

test("edit requests keep the existing dimensions and reference contract", () => {
  const result = editorRequest.buildEditorRequest({ ...baseEditor, mode: "edit" }, "task-1", null, null);
  assert.equal(result.endpoint, "/api/edit");
  assert.equal(result.body.prompt, "make it warmer");
  assert.equal(result.body.aspectRatio, "16:9");
  assert.equal(result.body.width, 1920);
  assert.equal(result.body.height, 1088);
  assert.deepEqual(result.body.references, ["https://example.test/source.png"]);
  assert.equal(result.body.referenceImages[0].name, "上一版-123456");
});

test("cloud upscale requests use only supported cloud output fields", () => {
  const result = editorRequest.buildEditorRequest({ ...baseEditor, mode: "upscale", prompt: "optional", upscaleOutputFormat: "jpg" }, "task-2", { width: 800, height: 600 }, {
    id: "cloud", provider: "tencent-ci", outputFormats: ["png", "jpg"],
  });
  assert.equal(result.endpoint, "/api/upscale");
  assert.equal(result.cloudUpscale, true);
  assert.equal(result.cloudOutputFormat, "jpg");
  assert.equal(result.body.outputFormat, "jpg");
  assert.equal(result.body.outputQuality, 95);
  assert.equal("resizeMethod" in result.body, false);
});

test("local upscale requests retain target size and algorithm fields", () => {
  const result = editorRequest.buildEditorRequest({ ...baseEditor, mode: "upscale", targetSize: "2K", algorithm: "bicubic" }, "task-3", { width: 800, height: 600 }, {
    id: "local", provider: "local", outputFormats: [],
  });
  assert.equal(result.cloudUpscale, false);
  assert.equal(result.body.size, "2048x2048");
  assert.equal(result.body.resizeMethod, "bicubic");
  assert.equal("outputFormat" in result.body, false);
});

