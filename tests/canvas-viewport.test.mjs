import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/viewport.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const viewport = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("projects client coordinates into stage and world coordinates", () => {
  const stage = viewport.canvasClientToStagePoint(
    { x: 340, y: 260 },
    { left: 100, top: 80 },
  );
  assert.deepEqual(stage, { x: 240, y: 180 });
  assert.deepEqual(
    viewport.canvasStageToWorldPoint(stage, { x: 20, y: 30, zoom: 2 }),
    { x: 110, y: 75 },
  );
});

test("world to stage projection preserves the camera transform", () => {
  const camera = { x: -140, y: 72, zoom: 0.5 };
  const world = { x: 320, y: 180 };
  const stage = viewport.canvasWorldToStagePoint(world, camera);
  assert.deepEqual(stage, { x: 20, y: 162 });
  assert.deepEqual(viewport.canvasStageToWorldPoint(stage, camera), world);
});

test("viewport world bounds account for camera zoom and overscan", () => {
  assert.deepEqual(
    viewport.canvasViewportWorldBounds(
      { x: 100, y: 60, zoom: 2 },
      { width: 800, height: 600 },
      100,
    ),
    { x: -100, y: -80, w: 500, h: 400 },
  );
  assert.equal(
    viewport.canvasBoundsIntersect(
      { x: 200, y: 200, w: 40, h: 40 },
      { x: 0, y: 0, w: 100, h: 100 },
    ),
    false,
  );
  assert.equal(
    viewport.canvasBoundsIntersect(
      { x: 90, y: 90, w: 40, h: 40 },
      { x: 0, y: 0, w: 100, h: 100 },
    ),
    true,
  );
});

test("zoom keeps the anchored world point stable and clamps the zoom", () => {
  const camera = { x: 20, y: -10, zoom: 1 };
  const anchor = { x: 240, y: 180 };
  const next = viewport.canvasZoomCameraAtPoint(anchor, camera, 2);
  assert.deepEqual(next, { x: -200, y: -200, zoom: 2 });
  assert.deepEqual(
    viewport.canvasStageToWorldPoint(anchor, next),
    viewport.canvasStageToWorldPoint(anchor, camera),
  );
  assert.equal(viewport.canvasZoomCameraAtPoint(anchor, camera, 100).zoom, 3);
  assert.equal(viewport.canvasZoomCameraAtPoint(anchor, camera, 0).zoom, 0.12);
});

test("fit camera centers bounds in the visible stage and respects the inset", () => {
  const camera = viewport.canvasFitCamera(
    [{ x: 100, y: 80, w: 300, h: 200 }],
    { width: 1200, height: 760 },
    240,
  );
  assert.deepEqual(camera, { x: 167.5, y: 95, zoom: 1.25 });
  assert.deepEqual(
    viewport.canvasFitCamera([], { width: 1000, height: 600 }, 200),
    { x: 400, y: 300, zoom: 1 },
  );
});
