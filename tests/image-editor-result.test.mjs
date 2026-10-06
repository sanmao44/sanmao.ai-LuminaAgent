import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/image-editor/editor-result.ts", import.meta.url);
let source = await readFile(sourceUrl, "utf8");
source = source.replace('import { editorMaskProjection } from "./editor-task";', `const editorMaskProjection = (editor) => editor.mask ? { dataUrl: editor.mask, annotations: editor.annotations || [], feather: Math.max(0, Math.min(48, Math.round(Number(editor.feather) || 0))), ...(editor.sourceImageDataUrl ? { sourceImageDataUrl: editor.sourceImageDataUrl } : {}) } : null;`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const editorResult = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const editor = {
  mode: "edit", item: { id: "source-1", url: "https://example.test/source.png", prompt: "source prompt" },
  prompt: "change background", modelId: "edit-model", ratio: "16:9", count: 1, quality: "自动", fidelity: "high",
  sizeMode: "system", sizeTier: "1k", customWidth: 1024, customHeight: 1024, mask: "MASK", annotations: [{ id: "a" }], feather: 3,
  scale: 2, targetSize: "auto", seed: 42, colorCorrection: "wavelet", algorithm: "lanczos", upscaleOutputFormat: "png", upscaleOutputQuality: 95,
};
const reference = { id: "source-1", name: "上一版-source-1", url: editor.item.url };

test("model call projection keeps manual model and edit parameters", () => {
  assert.deepEqual(editorResult.buildEditorModelCallInput(editor, { model: { id: "actual", name: "Actual" } }, [{ id: "edit-model", providerId: "provider-1" }], false, undefined), {
    context: "edit", mode: "manual", providerId: "provider-1", modelId: "edit-model",
    params: { ratio: "16:9", count: 1, quality: "自动", fidelity: "high", sizeMode: "system", sizeTier: "1k", customWidth: 1024, customHeight: 1024 },
  });
});

test("history projection preserves mask, references and result metadata", () => {
  const meta = editorResult.buildEditorHistoryMeta(editor, { model: { id: "actual", name: "Actual", provider: "Provider" }, taskId: "task-1" }, 1250, reference, undefined);
  assert.equal(meta.source, "edit");
  assert.equal(meta.generationMs, 1250);
  assert.equal(meta.mask.feather, 3);
  assert.equal(meta.references[0].url, editor.item.url);
  assert.equal(editorResult.editorCompletionInfo(editor, { model: { name: "Actual" } }, 1250, 2), "图片修改 · Actual · 1.3s · 2 张");
});

test("cloud upscale history uses the provider format and quality parameters", () => {
  const upscale = { ...editor, mode: "upscale", modelId: "cloud", mask: null, prompt: "", scale: 4, upscaleOutputFormat: "jpg" };
  const call = editorResult.buildEditorModelCallInput(upscale, { model: { id: "cloud", name: "Cloud" } }, [{ id: "cloud", providerId: "cloud-provider" }], true, "jpg");
  assert.deepEqual(call.params, { upscaleScale: 4, upscaleOutputFormat: "jpg", upscaleOutputQuality: 95 });
  const meta = editorResult.buildEditorHistoryMeta(upscale, { model: { id: "cloud", provider: "tencent-ci" }, taskId: "task-2" }, 2000, reference, "jpg");
  assert.equal(meta.outputFormat, "jpeg");
  assert.equal(meta.upscaleTaskId, "task-2");
});

