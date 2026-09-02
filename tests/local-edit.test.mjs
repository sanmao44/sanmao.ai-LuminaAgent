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

test("the workbench records complete operations, supports undo/redo, feather and empty-range blocking", () => {
  assert.match(editor, /while \(nextStates\.length > 21\) nextStates\.shift\(\)/);
  assert.match(editor, /pushHistory\(gesture\.before\)/);
  assert.match(editor, /restoreHistory\(historyRef\.current\.index - 1\)/);
  assert.match(editor, /restoreHistory\(historyRef\.current\.index \+ 1\)/);
  assert.match(editor, /outputContext\.filter = `blur\(\$\{feather\}px\)`/);
  assert.match(editor, /请先指定编辑区域，再应用局部编辑/);
  assert.match(editor, /disabled=\{!ready \|\| saving \|\| coverage <= 0\}/);
});

test("local edit exposes reliable pointer tools, free lasso selection, and a fixed no-scroll workbench", () => {
  assert.match(editor, /type LocalEditTool = 'brush' \| 'eraser' \| 'rectangle' \| 'ellipse' \| 'lasso' \| 'pan'/);
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
});

test("local edit model selection is restricted to edit-capable image models and videos remain separate", () => {
  assert.match(settings, /export function imageEditModelOptions/);
  assert.match(settings, /settings\.mask\s*\n\s*\? imageEditModelOptions\(runtime\)/);
  assert.match(page, /generateMask && availableEditModels\.length \? availableEditModels : availableGenerationModels/);
  assert.match(page, /capability: generateMask && availableEditModels\.length \? "edit" : "generate"/);
  assert.match(canvas, /kind === "video"/);
  assert.doesNotMatch(editor, /video/);
});
