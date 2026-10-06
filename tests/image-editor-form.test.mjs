import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/image-editor/editor-form.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const editorForm = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("edit model changes only replace the selected model", () => {
  assert.deepEqual(editorForm.editorModelSelectionPatch(
    "edit", "edit-model", 4, "png", [{ id: "edit-model", scales: [1] }], [1, 2, 3, 4],
  ), { modelId: "edit-model" });
});

test("upscale model changes preserve supported values", () => {
  assert.deepEqual(editorForm.editorModelSelectionPatch(
    "upscale", "cloud-model", 2, "jpg",
    [{ id: "cloud-model", scales: [1, 2, 4], outputFormats: ["png", "jpg"] }], [1, 2, 3, 4],
  ), { modelId: "cloud-model", scale: 2, upscaleOutputFormat: "jpg" });
});

test("upscale settings are shared with the generation picker", () => {
  assert.deepEqual(editorForm.upscaleEditorSettingsPatch(
    3,
    "bmp",
    { id: "cloud-model", scales: [1, 2, 4], outputFormats: ["png", "jpg"] },
    [1, 2, 3, 4],
  ), { scale: 2, upscaleOutputFormat: "png" });
});

test("upscale model changes choose the existing fallback order", () => {
  assert.deepEqual(editorForm.editorModelSelectionPatch(
    "upscale", "limited-model", 3, "bmp",
    [{ id: "limited-model", scales: [1, 4], outputFormats: ["png"] }], [1, 2, 3, 4],
  ), { modelId: "limited-model", scale: 1, upscaleOutputFormat: "png" });
  assert.deepEqual(editorForm.editorModelSelectionPatch(
    "upscale", "missing-model", 3, "bmp", [], [1, 2, 3, 4],
  ), { modelId: "missing-model", scale: 3, upscaleOutputFormat: "bmp" });
});

