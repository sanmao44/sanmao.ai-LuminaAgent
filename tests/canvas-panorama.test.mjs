import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canvas = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const viewer = await readFile(
  new URL("../components/MediaViewer.tsx", import.meta.url),
  "utf8",
);
const workbench = await readFile(
  new URL("../components/canvas/PanoramaWorkbench.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("completed image viewer exposes the panorama entry point", () => {
  assert.match(viewer, /onAngle\?: \(\) => void/);
  assert.match(viewer, /onAngle && item\.kind === "image"/);
  assert.match(canvas, /onAngle=\{[\s\S]*isCanvasReadyImageSource\(viewerNode\)[\s\S]*openImagePanorama\(viewerNode\.id\)/);
});

test("panorama workbench renders a real sphere for 2:1 images", () => {
  assert.match(workbench, /import \* as THREE from "three"/);
  assert.match(workbench, /new THREE\.SphereGeometry/);
  assert.match(workbench, /side: THREE\.BackSide/);
  assert.match(workbench, /isEquirectangular\?: boolean/);
  assert.match(workbench, /滚轮缩放/);
  assert.match(workbench, /回到原始方向/);
  assert.match(canvas, /presetId === "panorama_720"/);
  assert.match(canvas, /Math\.abs\(width \/ height - 2\) < 0\.08/);
});

test("panorama viewer applies the current local view without image generation", () => {
  assert.match(workbench, /onApply\?: \(snapshot: PanoramaSnapshot\)/);
  assert.match(workbench, /preserveDrawingBuffer: true/);
  assert.match(workbench, /canvas\.toDataURL\("image\/png"\)/);
  assert.match(workbench, /应用为平面图片/);
  assert.match(workbench, /await onApply\(\{[\s\S]*?\}\);\s*onClose\(\);/);
  assert.doesNotMatch(workbench, /AngleGenerationInput|generateCanvasImage|应用此角度/);
  assert.doesNotMatch(canvas, /runImageAngleGeneration\(panoramaNode\.id/);
  assert.match(canvas, /const applyPanoramaView = useCallback/);
  assert.match(canvas, /dataUrlFile\(snapshot\.dataUrl/);
  assert.match(canvas, /role: "全景平面视图"/);
  assert.match(canvas, /已应用为平面图片/);
  assert.match(workbench, /普通图片以正面贴图显示/);
  assert.match(workbench, /背面没有可用图像/);
  assert.match(workbench, /滚轮缩放 · 回到原始比例/);
  assert.match(workbench, /if \(!isEquirectangular\) return;/);
});

test("panorama viewer has bounded desktop and mobile layouts", () => {
  assert.match(styles, /\.canvas-spherical-dialog\{[^}]*max-height:calc\(100vh - 36px\)/);
  assert.match(styles, /\.canvas-spherical-stage\{[^}]*touch-action:none/);
  assert.match(styles, /@media\(max-width:760px\)\{\.canvas-spherical-workbench/);
  assert.match(viewer, /打开真实360°球体查看器/);
});
