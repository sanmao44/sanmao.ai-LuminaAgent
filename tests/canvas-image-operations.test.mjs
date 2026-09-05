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

test("adding a grid line splits the largest segment at its midpoint", () => {
  assert.deepEqual(operations.addGridLine([]), [0.5]);
  assert.deepEqual(operations.addGridLine([0.5]), [0.25, 0.5]);
  assert.deepEqual(operations.addGridLine([0.75, 0.25, 0.5]), [0.125, 0.25, 0.5, 0.75]);
});

test("repeated grid line additions stay sorted and respect the minimum gap", () => {
  let lines = [];
  for (let count = 0; count < 8; count += 1) lines = operations.addGridLine(lines);
  assert.equal(lines.length, 8);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  const boundaries = [0, ...lines, 1];
  for (let index = 1; index < boundaries.length; index += 1) {
    assert.ok(boundaries[index] - boundaries[index - 1] >= operations.CANVAS_IMAGE_GRID_MIN_GAP);
  }
  assert.deepEqual(operations.addGridLine(lines), lines);
});

test("grid line additions stop at the per-direction maximum and removal targets one line", () => {
  const lines = Array.from({ length: operations.CANVAS_IMAGE_GRID_MAX_LINES }, (_, index) => (index + 1) / 9);
  assert.deepEqual(operations.addGridLine(lines), lines);
  assert.deepEqual(operations.removeGridLine([0.75, 0.25, 0.5], 1), [0.25, 0.75]);
  assert.deepEqual(operations.removeGridLine([0.5], 0), []);
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
    layoutMode: "fixed",
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

test("automatic layout preserves a shared source ratio instead of forcing square cells", () => {
  const layout = operations.gridCompositeLayout(6, {
    columns: 3,
    cellSize: 512,
    gap: 16,
    sourceSizes: Array.from({ length: 6 }, () => ({ width: 1600, height: 900 })),
  });

  assert.equal(layout.layoutMode, "auto");
  assert.equal(layout.columns, 3);
  assert.equal(layout.rows, 2);
  assert.ok(Math.abs(layout.placements[0].width / layout.placements[0].height - 16 / 9) < 0.01);
  assert.ok(Math.abs(layout.placements[5].width / layout.placements[5].height - 16 / 9) < 0.01);
  assert.equal(layout.placements[3].y, layout.placements[0].height + layout.gap);
});

test("automatic mixed-ratio layout keeps placements proportional and leaves the last row un-stretched", () => {
  const sourceSizes = [
    { width: 1600, height: 900 },
    { width: 1000, height: 1000 },
    { width: 800, height: 1200 },
    { width: 1200, height: 800 },
    { width: 900, height: 1600 },
  ];
  const layout = operations.gridCompositeLayout(sourceSizes.length, {
    columns: 3,
    cellSize: 512,
    gap: 16,
    sourceSizes,
  });

  assert.equal(layout.rows, 2);
  for (const placement of layout.placements) {
    const source = sourceSizes[placement.index];
    assert.ok(Math.abs(placement.width / placement.height - source.width / source.height) < 0.02);
    assert.ok(placement.x >= 0 && placement.y >= 0);
    assert.ok(placement.x + placement.width <= layout.width);
    assert.ok(placement.y + placement.height <= layout.height);
  }
  assert.ok(layout.placements[3].height <= layout.placements[0].height);
  assert.ok(layout.placements[3].x + layout.placements[3].width <= layout.width);
  assert.ok(layout.placements[4].x + layout.placements[4].width <= layout.width);
});

test("fixed layout keeps square placements for the legacy crop workflow", () => {
  const layout = operations.gridCompositeLayout(3, {
    layoutMode: "fixed",
    columns: 2,
    cellSize: 512,
    gap: 12,
    sourceSizes: [
      { width: 1600, height: 900 },
      { width: 900, height: 1600 },
      { width: 1000, height: 1000 },
    ],
  });

  assert.ok(layout.placements.every((placement) => placement.width === placement.height));
  assert.equal(layout.placements[2].x, 0);
  assert.equal(layout.placements[2].y, layout.placements[0].height + layout.gap);
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
