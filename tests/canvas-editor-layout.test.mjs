import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/editor-layout.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const layout = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("centers the toolbar above and editor below the selected card", () => {
  const anchor = { left: 300, top: 240, width: 380, height: 280 };
  const stage = { width: 1280, height: 720 };
  assert.deepEqual(
    layout.placeCanvasNodeToolbar(anchor, stage, { width: 420, height: 36 }),
    { left: 280, top: 194 },
  );
  assert.deepEqual(
    layout.placeCanvasNodeEditor(anchor, stage, { width: 420, height: 360 }),
    { left: 280, top: 534 },
  );
});

test("keeps overlay offsets attached when the node is outside the viewport", () => {
  const anchor = { left: -24, top: 8, width: 280, height: 220 };
  const stage = { width: 360, height: 300 };
  const toolbar = layout.placeCanvasNodeToolbar(anchor, stage, { width: 420, height: 42 });
  const editor = layout.placeCanvasNodeEditor(anchor, stage, { width: 420, height: 420 });
  assert.deepEqual(toolbar, { left: 10, top: -44 });
  assert.deepEqual(editor, { left: -94, top: 242 });
  assert.equal(editor.top - (anchor.top + anchor.height), 14);
});

test("keeps a wide toolbar inside the stage near the right edge", () => {
  const anchor = { left: 286, top: 260, width: 120, height: 160 };
  const stage = { width: 390, height: 844 };
  assert.deepEqual(
    layout.placeCanvasNodeToolbar(anchor, stage, { width: 188, height: 47 }),
    { left: 192, top: 203 },
  );
});

test("fits a tall editor below its node without moving it across the anchor", () => {
  const anchor = { left: 300, top: 180, width: 380, height: 260 };
  const stage = { width: 1280, height: 720 };
  const editor = layout.fitCanvasNodeEditorBelow(
    anchor,
    stage,
    { width: 640, height: 580 },
  );

  assert.deepEqual(editor, { left: 170, top: 454, maxHeight: 254 });
  assert.equal(editor.top, anchor.top + anchor.height + 14);
});

test("keeps a below-node editor inside the horizontal viewport margins", () => {
  const editor = layout.fitCanvasNodeEditorBelow(
    { left: -80, top: 60, width: 280, height: 180 },
    { width: 900, height: 700 },
    { width: 640, height: 300 },
  );

  assert.deepEqual(editor, { left: 12, top: 254, maxHeight: 300 });
});

test("places a context menu below and to the right when there is room", () => {
  assert.deepEqual(
    layout.placeCanvasContextMenu(
      { left: 120, top: 80 },
      { width: 1024, height: 768 },
      { width: 240, height: 180 },
    ),
    { left: 130, top: 90 },
  );
});

test("flips a context menu above and to the left near the viewport edge", () => {
  assert.deepEqual(
    layout.placeCanvasContextMenu(
      { left: 980, top: 700 },
      { width: 1024, height: 768 },
      { width: 240, height: 180 },
    ),
    { left: 730, top: 510 },
  );
});

test("clamps an oversized context menu to the viewport safety margin", () => {
  assert.deepEqual(
    layout.placeCanvasContextMenu(
      { left: 20, top: 20 },
      { width: 220, height: 180 },
      { width: 300, height: 400 },
    ),
    { left: 8, top: 8 },
  );
});

test("keeps context menus bounded with a short dynamic viewport", () => {
  assert.deepEqual(
    layout.placeCanvasContextMenu(
      { left: 380, top: 270 },
      { width: 390, height: 280 },
      { width: 300, height: 250 },
    ),
    { left: 70, top: 10 },
  );
});
