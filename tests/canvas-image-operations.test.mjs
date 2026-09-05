import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/image-operations.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const operations = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("crop presets stay inside the source and preserve their ratio", () => {
  const sourceSize = { width: 1600, height: 900 };
  for (const [aspect, expected] of [["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["16:9", 16 / 9], ["9:16", 9 / 16]]) {
    const rect = operations.cropRectForAspect(sourceSize, aspect);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= sourceSize.width);
    assert.ok(rect.y + rect.height <= sourceSize.height);
    assert.ok(Math.abs(rect.width / rect.height - expected) < 0.01);
  }
});

test("crop movement and resize are clamped to the source", () => {
  const sourceSize = { width: 1200, height: 800 };
  const moved = operations.moveImageRect({ x: 240, y: 120, width: 500, height: 400 }, 900, -900, sourceSize);
  assert.deepEqual(moved, { x: 700, y: 0, width: 500, height: 400 });
  const resized = operations.resizeImageRect(moved, "bottom-right", 9999, 9999, sourceSize, "free");
  assert.equal(resized.x + resized.width, sourceSize.width);
  assert.equal(resized.y + resized.height, sourceSize.height);
  assert.ok(resized.width >= operations.CANVAS_IMAGE_OPERATION_MIN_EDGE);
  assert.ok(resized.height >= operations.CANVAS_IMAGE_OPERATION_MIN_EDGE);
});

test("crop presets remain bounded for small sources and original keeps its ratio", () => {
  const smallSource = { width: 20, height: 100 };
  const narrow = operations.cropRectForAspect(smallSource, "4:3");
  assert.ok(narrow.x >= 0 && narrow.y >= 0);
  assert.ok(narrow.x + narrow.width <= smallSource.width);
  assert.ok(narrow.y + narrow.height <= smallSource.height);

  const source = { width: 1600, height: 900 };
  const original = operations.resizeImageRect(
    { x: 100, y: 50, width: 800, height: 300 },
    "bottom-right",
    100,
    100,
    source,
    "original",
  );
  assert.ok(Math.abs(original.width / original.height - source.width / source.height) < 0.01);
});

test("outpaint margins, resize targets, and transforms produce expected dimensions", () => {
  const sourceSize = { width: 1600, height: 900 };
  const target = operations.resizeTargetSize(sourceSize, 2048);
  assert.deepEqual(target, { width: 2048, height: 1152 });
  assert.deepEqual(operations.transformImageSize(sourceSize, 90), { width: 900, height: 1600 });
  const rects = operations.gridRects(sourceSize, { vertical: [0.5], horizontal: [0.5] });
  assert.equal(rects.length, 4);
  assert.equal(rects.reduce((total, rect) => total + rect.width * rect.height, 0), sourceSize.width * sourceSize.height);
});

test("grid line dragging keeps neighbouring lines separated", () => {
  const lines = [0.25, 0.5, 0.75];
  assert.equal(operations.clampGridLine(0.99, 1, lines), 0.72);
  assert.equal(operations.clampGridLine(0.01, 1, lines), 0.28);
});

test("grid composite layout uses a square-ish 1024px grid for common counts", () => {
  const expected = new Map([
    [2, { columns: 2, rows: 1, width: 2064, height: 1024 }],
    [3, { columns: 2, rows: 2, width: 2064, height: 2064 }],
    [4, { columns: 2, rows: 2, width: 2064, height: 2064 }],
    [5, { columns: 3, rows: 2, width: 3104, height: 2064 }],
  ]);
  for (const [count, dimensions] of expected) {
    const layout = operations.gridCompositeLayout(count);
    assert.deepEqual(
      {
        columns: layout.columns,
        rows: layout.rows,
        width: layout.width,
        height: layout.height,
      },
      dimensions,
    );
    assert.equal(layout.cellSize, 1024);
    assert.equal(layout.gap, 16);
    assert.equal(layout.scale, 1);
  }
});

test("grid composite layout respects the existing 6144px edge limit", () => {
  const layout = operations.gridCompositeLayout(36);
  assert.equal(layout.columns, 6);
  assert.equal(layout.rows, 6);
  assert.ok(layout.width <= operations.CANVAS_IMAGE_OPERATION_MAX_EDGE);
  assert.ok(layout.height <= operations.CANVAS_IMAGE_OPERATION_MAX_EDGE);
  assert.ok(layout.scale < 1);
});

test("grid composite layout accepts explicit columns and visual options", () => {
  const layout = operations.gridCompositeLayout(5, {
    columns: 2,
    cellSize: 512,
    gap: 0,
    maxEdge: 2048,
    background: "transparent",
    fit: "cover",
    cropPosition: "bottom-right",
  });
  assert.deepEqual(
    {
      columns: layout.columns,
      rows: layout.rows,
      cellSize: layout.cellSize,
      gap: layout.gap,
      width: layout.width,
      height: layout.height,
      background: layout.background,
      fit: layout.fit,
      cropPosition: layout.cropPosition,
    },
    {
      columns: 2,
      rows: 3,
      cellSize: 512,
      gap: 0,
      width: 1024,
      height: 1536,
      background: "transparent",
      fit: "cover",
      cropPosition: "bottom-right",
    },
  );
});

test("grid composite layout keeps an independent crop offset for every image", () => {
  const layout = operations.gridCompositeLayout(3, {
    fit: "cover",
    cropPosition: "center",
    cropOffsets: [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.75 },
      { x: 9, y: -2 },
    ],
  });
  assert.deepEqual(layout.cropOffsets, [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.75 },
    { x: 1, y: 0 },
  ]);
});
