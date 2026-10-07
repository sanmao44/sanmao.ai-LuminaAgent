import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/image-editor/editor-task.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const editorTask = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const baseEditor = {
  item: { id: "source-123456", url: "https://example.test/source.png", prompt: "source prompt" },
  prompt: "  make it warmer  ", modelId: "auto", ratio: "16:9", count: 1,
  quality: "自动", fidelity: "high", sizeMode: "system", sizeTier: "1k",
  customWidth: 1000, customHeight: 700, mask: null, scale: 2, targetSize: "auto",
  seed: 42, colorCorrection: "wavelet", algorithm: "lanczos", upscaleOutputFormat: "png", upscaleOutputQuality: 95,
};

test("edit task drafts preserve the existing retry request fields", () => {
  const task = editorTask.buildEditorTaskDraft({
    ...baseEditor,
    mode: "edit",
    mask: "data:image/png;base64,MASK",
    annotations: [{ id: "annotation" }],
    feather: 72,
    sourceImageDataUrl: "data:image/png;base64,MOVE",
  }, "task-1", 123);

  assert.deepEqual(task, {
    id: "task-1", status: "pending", mode: "edit", prompt: "make it warmer", expectedCount: 1,
    startedAt: 123, info: "图片修改 · 后台处理中", items: [], itemIds: [],
    request: {
      modelId: "auto", ratio: "16:9", count: 1, quality: "自动", fidelity: "high",
      sizeMode: "system", sizeTier: "1k", customWidth: 1000, customHeight: 700,
      references: [{ id: "source-123456", kind: "image", name: "上一版-123456", dataUrl: "https://example.test/source.png" }],
      mask: {
        dataUrl: "data:image/png;base64,MASK", referenceId: "source-123456", annotations: [{ id: "annotation" }],
        feather: 48, sourceImageDataUrl: "data:image/png;base64,MOVE",
      },
    },
  });
});

test("upscale task drafts keep the source and upscale fields", () => {
  const task = editorTask.buildEditorTaskDraft({ ...baseEditor, mode: "upscale", prompt: "" }, "task-2", 456);
  assert.equal(task.prompt, "source prompt");
  assert.deepEqual(task.request, {
    sourceImageId: "source-123456", upscaleScale: 2, upscaleOutputFormat: "png", upscaleOutputQuality: 95,
    modelId: "auto", references: [{ id: "source-123456", kind: "image", name: "上一版-123456", dataUrl: "https://example.test/source.png" }],
  });
});

