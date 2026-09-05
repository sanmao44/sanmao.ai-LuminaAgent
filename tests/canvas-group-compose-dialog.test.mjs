import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialog = await readFile(
  new URL("../components/canvas/CanvasGroupComposeDialog.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("grid compose dialog exposes tactile controls and a live preview", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /addEventListener\("keydown", closeOnEscape, true\)/);
  assert.match(dialog, /button type="button" className="canvas-compose-reset"/);
  assert.match(dialog, /type="range" min=\{CELL_SIZE_MIN\} max=\{CELL_SIZE_MAX\}/);
  assert.match(dialog, /aria-label="图片间隔" type="range"/);
  assert.match(dialog, /aria-label="输出边长上限" type="range"/);
  assert.match(dialog, /role="group" aria-label="图片适配"/);
  assert.match(dialog, /aria-pressed=\{settings\.fit === "contain"\}/);
  assert.match(dialog, /宫格预览 \$\{layout\.columns\} 列 \$\{layout\.rows\} 行/);
  assert.match(dialog, /backgroundPreset\(settings\.background\) === "custom"/);
  assert.match(dialog, /value === "transparent" \? "transparent"/);
  assert.match(dialog, /: "#e5e7eb"/);
});

test("grid compose dialog styles dropdowns, sliders, segmented choices and mobile layout", () => {
  assert.match(styles, /\.canvas-compose-select-shell\{position:relative/);
  assert.match(styles, /\.canvas-compose-range-field input\[type=range\]/);
  assert.match(styles, /\.canvas-compose-segmented button\.active/);
  assert.match(styles, /@media\(max-width:720px\)\{\.canvas-compose-dialog-head/);
});
