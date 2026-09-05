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
const composeStyles = await readFile(
  new URL("../app/canvas-compose.css", import.meta.url),
  "utf8",
);
const allStyles = `${styles}\n${composeStyles}`;

test("grid compose dialog exposes tactile controls and a live preview", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /addEventListener\("keydown", closeOnEscape, true\)/);
  assert.match(dialog, /target\?\.closest\("\.select-menu\.open,\.select-menu-popover"\)/);
  assert.match(dialog, /button type="button" className="canvas-compose-reset"/);
  assert.match(dialog, /type="range" min=\{CELL_SIZE_MIN\} max=\{CELL_SIZE_MAX\}/);
  assert.match(dialog, /aria-label="图片间隔" type="range"/);
  assert.match(dialog, /aria-label="输出边长上限" type="range"/);
  assert.match(dialog, /<SelectMenu/);
  assert.match(dialog, /role="group" aria-label="图片适配"/);
  assert.match(dialog, /aria-pressed=\{settings\.fit === "contain"\}/);
  assert.match(dialog, /宫格预览 \$\{displayedLayout\.columns\} 列 \$\{displayedLayout\.rows\} 行/);
  assert.match(dialog, /canvas-compose-preview-viewport/);
  assert.match(dialog, /canvas-compose-preview-column/);
  assert.match(dialog, /canvas-compose-settings-column/);
  assert.match(dialog, /sourceOrderIds: previewSources\.map\(\(source\) => source\.id\)/);
  assert.match(dialog, /onPreviewSortPointerDown/);
  assert.match(dialog, /data-compose-preview-source-id/);
  assert.match(dialog, /dataset\.composePreviewSourceId/);
  assert.match(dialog, /直接拖动预览中的图片即可调整/);
  assert.match(dialog, /layoutMode: "auto"/);
  assert.match(dialog, /canvas-compose-color-text/);
  assert.match(dialog, /canvas-compose-background-swatch/);
  assert.match(dialog, /renderCanvasImageGridComposite\(previewSourceUrls, renderOptions\)/);
  assert.match(dialog, /拖动每格图片调整裁切区域/);
  assert.match(dialog, /onGridPointerDown/);
  assert.match(dialog, /onPreviewCellDoubleClick/);
  assert.match(dialog, /layoutMode: "fixed"/);
  assert.match(dialog, /fit: "cover"/);
  assert.match(dialog, /onDoubleClick=\{\(event\) => onPreviewCellDoubleClick/);
  assert.match(dialog, /双击图片进入裁切模式/);
  assert.match(dialog, /URL\.createObjectURL\(rendered\.blob\)/);
  assert.match(dialog, /与最终出图一致/);
  assert.match(dialog, /previewBusy && previewResult/);
  assert.match(dialog, /onWheel=\{onPreviewWheel\}/);
  assert.match(dialog, /event\.deltaY < 0/);
  assert.match(dialog, /event\.preventDefault\(\)/);
  assert.match(dialog, /aria-live="polite"/);
  assert.match(dialog, /background === "transparent"/);
  assert.match(dialog, /normalizeHex/);
});

test("grid compose dialog styles dropdowns, sliders, segmented choices and mobile layout", () => {
  assert.match(allStyles, /\.canvas-compose-select-shell/);
  assert.match(allStyles, /\.canvas-compose-range-field input\[type="range"\]/);
  assert.match(allStyles, /\.canvas-compose-segmented button\.active/);
  assert.match(allStyles, /\.canvas-compose-preview-viewport/);
  assert.match(allStyles, /\.canvas-compose-preview-result/);
  assert.match(allStyles, /\.canvas-compose-preview-hit-cell/);
  assert.match(allStyles, /\.canvas-compose-preview-viewport\.is-updating/);
  assert.match(allStyles, /overflow: hidden/);
  assert.match(allStyles, /\.canvas-compose-select-menu/);
  assert.match(allStyles, /\.canvas-compose-dialog-body/);
  assert.match(allStyles, /grid-template-columns: minmax\(0, 1\.75fr\) minmax\(300px, \.65fr\)/);
  assert.doesNotMatch(allStyles, /\.canvas-compose-source-strip/);
  assert.match(allStyles, /\.canvas-compose-preview-cell-tools/);
  assert.match(allStyles, /\.canvas-compose-background-swatch/);
  assert.match(allStyles, /height: min\(920px, calc\(100dvh - 24px\)\)/);
  assert.match(allStyles, /@media \(max-width: 720px\)/);
});
