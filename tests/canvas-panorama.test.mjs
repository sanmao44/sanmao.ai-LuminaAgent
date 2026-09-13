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

test("panorama workbench keeps 0 degrees as the original angle and clamps the dial", () => {
  assert.match(workbench, /function normalizePanoramaAngle\(value: number\)/);
  assert.match(workbench, /Math\.round\(value\) % 360/);
  assert.match(workbench, /if \(normalized === 0 \|\| normalized === 360\) return "原图角度"/);
  assert.match(workbench, /aria-valuemin=\{0\}/);
  assert.match(workbench, /aria-valuemax=\{360\}/);
  assert.match(workbench, /onClick=\{\(\) => setAngle\(0\)\}/);
  assert.match(workbench, /回到原角度/);
  assert.match(workbench, /cameraStart = cameraForAngle\(0, modelId\)/);
});

test("panorama generation writes through the existing angle image path", () => {
  assert.match(canvas, /const runImageAngleGeneration = useCallback/);
  assert.match(canvas, /createPendingNode\?: boolean/);
  assert.match(canvas, /createPendingNode: false/);
  assert.match(canvas, /onResult: \(url\) => setPanoramaResultUrl\(url\)/);
  assert.match(canvas, /onError: \(message\) => setPanoramaError\(message\)/);
  assert.match(canvas, /source: source\.id,[\s\S]*target: output\.id,[\s\S]*kind: "lineage"/);
  assert.match(canvas, /options\?\.onResult\?\.\(image\.url\)/);
  assert.match(canvas, /options\?\.onError\?\.\(message\)/);
  assert.match(workbench, /不会把原图横向拉伸成全景展开图/);
});

test("panorama workbench has bounded desktop and mobile layouts", () => {
  assert.match(styles, /\.canvas-panorama-dialog\{[^}]*max-height:calc\(100vh - 36px\)/);
  assert.match(styles, /\.canvas-panorama-body\{[^}]*overflow:auto/);
  assert.match(styles, /@media\(max-width:760px\)\{\.canvas-panorama-workbench/);
  assert.match(styles, /\.canvas-panorama-preview-grid\{grid-template-columns:1fr\}/);
});
