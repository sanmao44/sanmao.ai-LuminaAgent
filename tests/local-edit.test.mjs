import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const raster = await loadTypeScript("../lib/local-edit.ts");
const editor = await readFile(new URL("../components/MaskEditor.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../lib/creation/settings.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const viewer = await readFile(new URL("../components/MediaViewer.tsx", import.meta.url), "utf8");
const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");

test("brush and eraser preserve the mask alpha contract and coverage", () => {
  const pixels = raster.createProtectedMask(10, 10);
  raster.applyBrushMask(pixels, 10, 10, 5, 5, 2, "edit");
  const editedCoverage = raster.calculateEditableCoverage(pixels);
  assert.ok(editedCoverage > 0 && editedCoverage < 1);
  raster.applyBrushMask(pixels, 10, 10, 5, 5, 2, "protect");
  assert.equal(raster.calculateEditableCoverage(pixels), 0);
});

test("rectangle and ellipse selections add editable ranges", () => {
  const rectangle = raster.createProtectedMask(8, 6);
  raster.applyRectangleMask(rectangle, 8, 6, 1, 1, 5, 4);
  assert.equal(raster.calculateEditableCoverage(rectangle), 12 / 48);

  const ellipse = raster.createProtectedMask(8, 6);
  raster.applyEllipseMask(ellipse, 8, 6, 1, 1, 7, 5);
  const ellipseCoverage = raster.calculateEditableCoverage(ellipse);
  assert.ok(ellipseCoverage > 0 && ellipseCoverage < 1);
  raster.applyEllipseMask(ellipse, 8, 6, 1, 1, 7, 5, "protect");
  assert.equal(raster.calculateEditableCoverage(ellipse), 0);
});

test("point selection uses the current brush radius and stays normalized", () => {
  const point = {
    id: "point-1",
    kind: "point",
    description: "修改鞋子",
    geometry: { kind: "point", x: 0.5, y: 0.5, radius: 0.2 },
    createdAt: 1,
  };
  const pixels = raster.createProtectedMask(10, 10);
  raster.applyLocalEditAnnotationMask(pixels, 10, 10, point);
  assert.equal(pixels[(5 * 10 + 5) * 4 + 3], 0);
  assert.equal(pixels[3], 255);
  assert.ok(raster.calculateEditableCoverage(pixels) > 0);
});

test("multiple annotation types merge into one mask and empty descriptions remain valid", () => {
  const annotations = [
    {
      id: "rect",
      kind: "rectangle",
      description: "",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 0.25, height: 0.25 },
      createdAt: 1,
    },
    {
      id: "ellipse",
      kind: "ellipse",
      description: "替换背景文字",
      geometry: { kind: "ellipse", x: 0.5, y: 0.5, width: 0.4, height: 0.3 },
      createdAt: 2,
    },
  ];
  const merged = raster.rasterizeLocalEditAnnotations(20, 20, annotations);
  assert.equal(merged[(1 * 20 + 1) * 4 + 3], 0);
  assert.equal(merged[(13 * 20 + 14) * 4 + 3], 0);
  assert.ok(raster.calculateEditableCoverage(merged) > 0);
  assert.equal(raster.rasterizeLocalEditAnnotations(20, 20, annotations.filter((item) => item.id !== "rect"))[(1 * 20 + 1) * 4 + 3], 255);
});

test("smart provider pixels merge as an editable subject mask", () => {
  const smartPixels = raster.createProtectedMask(4, 4);
  smartPixels[(1 * 4 + 2) * 4 + 3] = 0;
  const annotation = {
    id: "smart-1",
    kind: "smart",
    description: "保留主体轮廓",
    geometry: { kind: "smart", x: 0.25, y: 0.25, width: 0.5, height: 0.5, maskDataUrl: "data:image/png;base64,test" },
    createdAt: 3,
  };
  const merged = raster.rasterizeLocalEditAnnotations(4, 4, [annotation], new Map([["smart-1", smartPixels]]));
  assert.equal(merged[(1 * 4 + 2) * 4 + 3], 0);
  assert.equal(merged[3], 255);
});

test("annotation descriptions compile once without duplicating the generated section", () => {
  const annotations = [
    { id: "one", kind: "point", description: "修改鞋子", geometry: { kind: "point", x: 0.2, y: 0.2, radius: 0.03 }, createdAt: 1 },
    { id: "two", kind: "point", description: "", geometry: { kind: "point", x: 0.4, y: 0.4, radius: 0.03 }, createdAt: 2 },
    { id: "three", kind: "point", description: "替换背景文字", geometry: { kind: "point", x: 0.6, y: 0.6, radius: 0.03 }, createdAt: 3 },
  ];
  const compiled = raster.compileLocalEditPrompt("整体保持自然", annotations);
  assert.match(compiled, /区域 1：修改鞋子/);
  assert.match(compiled, /区域 3：替换背景文字/);
  assert.doesNotMatch(compiled, /区域 2：/);
  assert.equal(raster.compileLocalEditPrompt(compiled, annotations), compiled);
  assert.equal(raster.compileLocalEditPrompt("整体保持自然", [annotations[1]]), "整体保持自然");
});

test("the workbench records complete operations, supports undo/redo, feather and empty-range blocking", () => {
  assert.match(editor, /while \(nextStates\.length > 21\) nextStates\.shift\(\)/);
  assert.match(editor, /pushHistory\(gesture\.before\)/);
  assert.match(editor, /restoreHistory\(historyRef\.current\.index - 1\)/);
  assert.match(editor, /restoreHistory\(historyRef\.current\.index \+ 1\)/);
  assert.match(editor, /outputContext\.filter = `blur\(\$\{feather\}px\)`/);
  assert.match(editor, /请先指定编辑区域，再应用局部编辑/);
  assert.match(editor, /disabled=\{!ready \|\| saving \|\| Boolean\(pendingAnnotation\) \|\| Boolean\(movingAnnotation\)/);
});

test("local edit exposes reliable pointer tools, free lasso selection, and a fixed no-scroll workbench", () => {
  assert.match(editor, /type LocalEditTool = 'brush' \| 'eraser' \| 'rectangle' \| 'ellipse' \| 'lasso' \| 'point' \| 'smart' \| 'pan'/);
  assert.match(editor, /function drawLasso\(context: CanvasRenderingContext2D, path: Point\[\]\)/);
  assert.match(editor, /function radiusFor\(\)/);
  assert.match(editor, /return Math\.max\(1, brushSize \/ 2\);/);
  assert.doesNotMatch(editor, /getBoundingClientRect\(\).*brushSize/);
  assert.match(editor, /function formatCoverage\(value: number\)/);
  assert.match(editor, /return '<0\.1%';/);
  assert.match(editor, /percent\.toFixed\(1\)/);
  assert.match(editor, /event\.preventDefault\(\);/);
  assert.match(editor, /onLostPointerCapture=\{handleLostPointerCapture\}/);
  assert.match(editor, /context\.clearRect\(0, 0, canvas\.width, canvas\.height\);/);
  assert.match(editor, /onApply: \(maskDataUrl: string, coverage: number, prompt: string, annotations: LocalEditAnnotation\[\]\)/);
  assert.match(editor, /function beginMoveAnnotation/);
  assert.match(editor, /function deleteAnnotation/);
  assert.match(editor, /补充.*说明/);
  assert.match(styles, /\.local-edit-workbench\{[^}]*height:min\(900px,calc\(100vh - 24px\)\);[^}]*overflow:hidden/);
  assert.match(styles, /\.local-edit-workbench-body\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(260px,320px\)/);
});

test("local edit shortcuts append prompts without submitting automatically", () => {
  assert.match(editor, /LOCAL_EDIT_INTENTS/);
  assert.match(editor, /移除物体/);
  assert.match(editor, /替换区域/);
  assert.match(editor, /添加元素/);
  assert.match(editor, /保持主体/);
  assert.match(editor, /existing \? `\$\{existing\}\\n\$\{item\.prompt\}` : item\.prompt/);
  assert.match(editor, /应用局部编辑/);
});

test("all image entry points use local edit wording while persisted field remains mask", () => {
  for (const source of [editor, page, viewer, canvas]) {
    assert.doesNotMatch(source, /绘制蒙版|查看蒙版|应用蒙版|蒙版已设置|本次使用蒙版/);
  }
  assert.match(page, /LocalEditEditor/);
  assert.match(viewer, /onLocalEdit/);
  assert.match(canvas, /onLocalEdit/);
  assert.match(settings, /maskRaw = objectValue\(raw\.mask\)/);
  assert.match(editor, /initialMaskDataUrl/);
  assert.match(page, /const legacySavedMask = item\?\.params\?\.mask \|\| item\?\.mask/);
  assert.match(page, /const restoredMask = typeof legacySavedMask === 'string'/);
  assert.match(page, /mask: currentEditor\.mask \|\| undefined/);
  assert.match(page, /annotations: currentEditor\.mode === 'edit'/);
  assert.match(canvas, /initialAnnotations=/);
  assert.match(canvas, /annotations\.length \? \{ annotations \} : \{\}/);
});

test("local edit model selection is restricted to edit-capable image models and videos remain separate", () => {
  assert.match(settings, /export function imageEditModelOptions/);
  assert.match(settings, /settings\.mask\s*\n\s*\? imageEditModelOptions\(runtime\)/);
  assert.match(page, /generateMask && availableEditModels\.length \? availableEditModels : availableGenerationModels/);
  assert.match(page, /capability: generateMask && availableEditModels\.length \? "edit" : "generate"/);
  assert.match(canvas, /kind === "video"/);
  assert.doesNotMatch(editor, /video/);
});
