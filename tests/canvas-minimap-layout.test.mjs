import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/minimap-layout.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const layout = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("minimap keeps world rectangles and viewport mapping in one coordinate space", () => {
  const bounds = { x: 0, y: 0, w: 400, h: 200 };
  const map = layout.createCanvasMinimapMap(bounds);
  assert.equal(map.mapWidth, 160);
  assert.deepEqual(layout.canvasMinimapRect({ x: 100, y: 50, w: 80, h: 40 }, bounds, map), {
    left: 25,
    top: 30,
    width: 20,
    height: 16,
  });
  assert.deepEqual(
    layout.canvasMinimapPointFromClient({ x: 80, y: 50 }, { left: 0, top: 0, width: 160, height: 100 }, bounds, map),
    { x: 200, y: 100 },
  );
});

test("minimap clips offscreen viewports and reports direction", () => {
  assert.deepEqual(layout.canvasMinimapClipAxis(-20, 30), { start: 0, size: 10 });
  assert.deepEqual(layout.canvasMinimapClipAxis(110, 20), { start: 97, size: 3 });
  assert.deepEqual(
    layout.canvasMinimapOffscreenDirection(
      { x: 500, y: -180, w: 100, h: 80 },
      { x: 0, y: 0, w: 400, h: 200 },
    ),
    { left: true, right: false, top: false, bottom: true },
  );
});
