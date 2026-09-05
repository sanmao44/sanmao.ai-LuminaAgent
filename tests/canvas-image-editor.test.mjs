import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workbench = await readFile(
  new URL("../components/canvas/CanvasImageEditorWorkbench.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);
const cursorStyles = await readFile(
  new URL("../app/cursor.css", import.meta.url),
  "utf8",
);

test("image editor workbench exposes all local image operations and preserves upscale flow", () => {
  for (const label of ["超分", "扩图", "缩放", "裁切", "宫格切分", "镜像-旋转"]) {
    assert.match(workbench, new RegExp(`label: "${label}"`));
  }
  assert.match(workbench, /onUpscale\(\)/);
  assert.match(workbench, /aria-label="图片编辑操作"/);
  assert.match(workbench, /image-editor-outpaint-handle/);
  assert.match(workbench, /data-image-editor-grid-preview/);
  assert.match(workbench, /className="image-editor-crop-frame"/);
  assert.match(workbench, /目标长边像素/);
  assert.match(workbench, /1K/);
  assert.match(workbench, /2K/);
  assert.match(workbench, /4K/);
  assert.match(workbench, /默认扩图提示词/);
  assert.match(workbench, /生成新节点/);
  assert.match(workbench, /覆盖当前/);
  assert.match(workbench, /addEventListener\("pointerdown", closeOnOutside, true\)/);
  assert.match(workbench, /event\.key !== "Escape"/);
});

test("grid editor supports dynamic presets, custom lines, and deletion", () => {
  assert.match(workbench, /CANVAS_IMAGE_GRID_MAX_LINES/);
  assert.match(workbench, /gridLines\.vertical\.length \+ 1/);
  assert.match(workbench, /gridLines\.horizontal\.length \+ 1/);
  assert.match(workbench, /canvas-image-editor-grid-custom-add vertical/);
  assert.match(workbench, /canvas-image-editor-grid-custom-add horizontal/);
  assert.match(workbench, /image-editor-grid-line-hit/);
  assert.match(workbench, /image-editor-grid-line-remove/);
  assert.match(workbench, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(workbench, /setPointerCapture\(event\.pointerId\)/);
  assert.match(workbench, /const setGridPreset = \(count: number\)/);
  assert.match(workbench, /setGridSelection\(null\)/);
  assert.match(workbench, /gridPreviewRects\.length < 2/);
});

test("image editor overlays use the canvas token stack and keep outpaint handles hittable", () => {
  assert.match(styles, /\.canvas-image-editor-workbench\{[^}]*z-index:var\(--canvas-z-node-editor\)/);
  assert.match(styles, /\.image-editor-outpaint-handle\{[^}]*z-index:var\(--canvas-z-local-control\)/);
  assert.match(styles, /\.image-editor-outpaint-handle\.top\{top:0\}/);
  assert.match(styles, /\.image-editor-outpaint-handle\.bottom\{bottom:0\}/);
  assert.match(styles, /\.image-editor-outpaint-handle\.left\{left:0\}/);
  assert.match(styles, /\.image-editor-outpaint-handle\.right\{right:0\}/);
});

test("grid editor uses fine visual lines with independent drag hit areas", () => {
  assert.match(styles, /\.image-editor-grid-line\.vertical::before\{[^}]*width:1px/);
  assert.match(styles, /\.image-editor-grid-line\.vertical\{[^}]*width:16px/);
  assert.match(styles, /\.image-editor-grid-line\.horizontal\{[^}]*height:16px/);
  assert.match(styles, /\.image-editor-grid-line-hit\{[^}]*cursor:col-resize[^}]*touch-action:none/);
  assert.match(styles, /\.image-editor-grid-line\.horizontal \.image-editor-grid-line-hit\{[^}]*cursor:row-resize/);
  assert.match(styles, /\.image-editor-grid-line-remove\{[^}]*opacity:0/);
  assert.match(styles, /\.image-editor-grid-line::after\{[^}]*pointer-events:none/);
  assert.match(styles, /\.image-editor-grid-line:hover \.image-editor-grid-line-remove/);
  assert.match(styles, /\.canvas-image-editor-grid-custom-actions\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(cursorStyles, /\.image-editor-grid-line-hit\s*\{\s*cursor:\s*var\(--cursor-resize-horizontal\) !important/);
  assert.match(cursorStyles, /\.image-editor-grid-line\.horizontal \.image-editor-grid-line-hit\s*\{\s*cursor:\s*var\(--cursor-resize-vertical\) !important/);
  assert.match(cursorStyles, /\.image-editor-grid-line-remove\s*\{\s*cursor:\s*var\(--cursor-pointer\) !important/);
  assert.match(cursorStyles, /:not\(\.image-editor-grid-line-hit\):not\(\.image-editor-grid-line-remove\)/);
});
