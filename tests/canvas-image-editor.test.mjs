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

test("image editor overlays use the canvas token stack and keep outpaint handles hittable", () => {
  assert.match(styles, /\.canvas-image-editor-workbench\{[^}]*z-index:var\(--canvas-z-node-editor\)/);
  assert.match(styles, /\.image-editor-outpaint-handle\{[^}]*z-index:var\(--canvas-z-local-control\)/);
  assert.match(styles, /\.image-editor-outpaint-handle\.top\{top:0\}/);
  assert.match(styles, /\.image-editor-outpaint-handle\.bottom\{bottom:0\}/);
  assert.match(styles, /\.image-editor-outpaint-handle\.left\{left:0\}/);
  assert.match(styles, /\.image-editor-outpaint-handle\.right\{right:0\}/);
});
