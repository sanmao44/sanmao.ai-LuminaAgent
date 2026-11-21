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

test("sizes wide media editors to the available canvas width", () => {
  assert.equal(layout.canvasWideNodeEditorWidth(1440), 840);
  assert.equal(layout.canvasWideNodeEditorWidth(1440, 740), 740);
  assert.equal(layout.canvasWideNodeEditorWidth(390), 358);
  assert.equal(layout.canvasWideNodeEditorWidth(640, 740), 608);
  assert.equal(layout.canvasWideNodeEditorWidth(10), 1);
});

test("scales every node editor family inversely with canvas zoom within readable bounds", () => {
  const widthAtZoomOut = layout.canvasZoomResponsiveNodeEditorWidth(1440, 0.5, 520, 420, 660);
  const widthAtDefault = layout.canvasZoomResponsiveNodeEditorWidth(1440, 1, 520, 420, 660);
  const widthAtZoomIn = layout.canvasZoomResponsiveNodeEditorWidth(1440, 2, 520, 420, 660);

  assert.equal(widthAtZoomOut, 660);
  assert.equal(widthAtDefault, 520);
  assert.equal(widthAtZoomIn, 420);
  assert.ok(widthAtZoomOut > widthAtDefault);
  assert.ok(widthAtDefault > widthAtZoomIn);
  assert.equal(layout.canvasZoomResponsiveNodeEditorWidth(390, 0.5, 520, 420, 660), 358);

  for (const profile of [
    { base: 680, min: 560, max: 760 },
    { base: 680, min: 600, max: 760 },
    { base: 520, min: 420, max: 660 },
    { base: 500, min: 420, max: 620 },
  ]) {
    const compact = layout.canvasZoomResponsiveNodeEditorWidth(1440, 2, profile.base, profile.min, profile.max);
    const defaultSize = layout.canvasZoomResponsiveNodeEditorWidth(1440, 1, profile.base, profile.min, profile.max);
    const expanded = layout.canvasZoomResponsiveNodeEditorWidth(1440, 0.5, profile.base, profile.min, profile.max);
    assert.ok(compact < defaultSize);
    assert.ok(defaultSize < expanded);
    assert.ok(compact >= profile.min);
    assert.ok(expanded <= profile.max);
  }
});

test("keeps the editor below a near-edge node and lets it extend past the viewport", () => {
  const anchor = { left: 300, top: 790, width: 380, height: 160 };
  const viewport = { width: 1280, height: 1000 };
  const editor = layout.placeCanvasNodeEditor(anchor, viewport, { width: 640, height: 560 });

  assert.deepEqual(editor, { left: 170, top: 964 });
  assert.ok(editor.top + 560 > viewport.height);
});

test("shifts a below-node editor sideways to avoid covering a neighboring node", () => {
  const anchor = { left: 896, top: 122, width: 109, height: 91 };
  const stage = { width: 1630, height: 856 };
  const editor = layout.placeCanvasNodeEditor(
    anchor,
    stage,
    { width: 620, height: 597 },
    14,
    12,
    [{ left: 625, top: 401, width: 115, height: 53 }],
  );

  assert.deepEqual(editor, { left: 752, top: 227 });
  assert.equal(editor.left, 740 + 12);
  assert.equal(editor.left + 620 < 625 || editor.left > 740, true);
  assert.equal(editor.top, anchor.top + anchor.height + 14);
});

test("keeps an open editor attached below its node as the canvas pans", () => {
  const viewport = { width: 1280, height: 720 };
  const panel = { width: 840, height: 520 };
  const beforeNode = { left: 420, top: 180, width: 280, height: 220 };
  const afterPanNode = { ...beforeNode, left: 300, top: 260 };

  const before = layout.placeCanvasNodeEditor(beforeNode, viewport, panel);
  const after = layout.placeCanvasNodeEditor(afterPanNode, viewport, panel);

  assert.deepEqual(before, { left: 140, top: 414 });
  assert.deepEqual(after, { left: 20, top: 494 });
  assert.equal(after.left - before.left, afterPanNode.left - beforeNode.left);
  assert.equal(after.top - before.top, afterPanNode.top - beforeNode.top);
});

test("keeps overlay offsets attached when the node is outside the viewport", () => {
  const anchor = { left: -24, top: 8, width: 280, height: 220 };
  const stage = { width: 360, height: 300 };
  const toolbar = layout.placeCanvasNodeToolbar(anchor, stage, { width: 420, height: 42 });
  const editor = layout.placeCanvasNodeEditor(anchor, stage, { width: 420, height: 420 });
  assert.deepEqual(toolbar, { left: 10, top: 18 });
  assert.deepEqual(editor, { left: 12, top: 242 });
  assert.equal(editor.top - (anchor.top + anchor.height), 14);
});

test("keeps a node toolbar reachable when a tall node runs past the top edge", () => {
  const anchor = { left: 300, top: -220, width: 380, height: 600 };
  const stage = { width: 1280, height: 720 };

  assert.deepEqual(
    layout.placeCanvasNodeToolbar(anchor, stage, { width: 420, height: 36 }),
    { left: 280, top: 10 },
  );
});

test("keeps a wide toolbar inside the stage near the right edge", () => {
  const anchor = { left: 286, top: 260, width: 120, height: 160 };
  const stage = { width: 390, height: 844 };
  assert.deepEqual(
    layout.placeCanvasNodeToolbar(anchor, stage, { width: 188, height: 47 }),
    { left: 192, top: 203 },
  );
});

test("places a group toolbar above the selected group", () => {
  const anchor = { left: 300, top: 240, width: 380, height: 280 };
  const stage = { width: 1280, height: 720 };

  assert.deepEqual(
    layout.placeCanvasGroupToolbar(anchor, stage, { width: 420, height: 36 }),
    { left: 280, top: 194, placement: "above" },
  );
});

test("moves a group toolbar inside the group when the top edge is too close", () => {
  const anchor = { left: 300, top: 30, width: 380, height: 280 };
  const stage = { width: 1280, height: 720 };

  assert.deepEqual(
    layout.placeCanvasGroupToolbar(anchor, stage, { width: 420, height: 36 }),
    { left: 280, top: 40, placement: "inside" },
  );
});

test("keeps a group toolbar within the horizontal stage margins", () => {
  const anchor = { left: 1120, top: 240, width: 180, height: 280 };
  const stage = { width: 1280, height: 720 };

  assert.deepEqual(
    layout.placeCanvasGroupToolbar(anchor, stage, { width: 360, height: 36 }),
    { left: 910, top: 194, placement: "above" },
  );
});

test("keeps the group color popover visible inside narrow and near-edge viewports", () => {
  assert.deepEqual(
    layout.placeCanvasActionPopover(
      { left: 4, top: 680, width: 28, height: 30 },
      { width: 320, height: 720 },
      { width: 196, height: 172 },
    ),
    { left: 12, top: 500, width: 196 },
  );
  assert.deepEqual(
    layout.placeCanvasActionPopover(
      { left: 360, top: 80, width: 32, height: 30 },
      { width: 390, height: 844 },
      { width: 196, height: 172 },
    ),
    { left: 182, top: 118, width: 196 },
  );
  assert.deepEqual(
    layout.placeCanvasActionPopover(
      { left: 145, top: 80, width: 30, height: 30 },
      { width: 180, height: 160 },
      { width: 196, height: 172 },
    ),
    { left: 12, top: 12, width: 156 },
  );
});

test("preserves a tall editor below its node even when the panel extends past the viewport", () => {
  const anchor = { left: 300, top: 180, width: 380, height: 260 };
  const stage = { width: 1280, height: 720 };
  const editor = layout.placeCanvasNodeEditor(
    anchor,
    stage,
    { width: 640, height: 580 },
  );

  assert.deepEqual(editor, { left: 170, top: 454 });
  assert.equal(editor.top, anchor.top + anchor.height + 14);
  assert.ok(editor.top + 580 > stage.height);
});

test("does not shrink a below-node editor to the remaining viewport height", () => {
  const editor = layout.placeCanvasNodeEditor(
    { left: 300, top: 520, width: 380, height: 120 },
    { width: 1280, height: 720 },
    { width: 640, height: 560 },
  );

  assert.deepEqual(editor, { left: 170, top: 654 });
  assert.equal(editor.top, 520 + 120 + 14);
  assert.ok(editor.top + 560 > 720);
});

test("keeps the editor below the node when the full panel fits", () => {
  const editor = layout.placeCanvasNodeEditor(
    { left: 300, top: 120, width: 380, height: 120 },
    { width: 1280, height: 720 },
    { width: 640, height: 400 },
  );

  assert.deepEqual(editor, { left: 170, top: 254 });
});

test("keeps a below-node editor inside the horizontal viewport margins", () => {
  const editor = layout.placeCanvasNodeEditor(
    { left: -80, top: 60, width: 280, height: 180 },
    { width: 900, height: 700 },
    { width: 640, height: 300 },
  );

  assert.deepEqual(editor, { left: 12, top: 254 });
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
