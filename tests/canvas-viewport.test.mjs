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
