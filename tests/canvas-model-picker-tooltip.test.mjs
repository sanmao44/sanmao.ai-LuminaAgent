import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("canvas model picker shows the complete name above the trigger", () => {
  assert.match(
    styles,
    /\.canvas-deck \.model-picker-trigger\[data-tooltip\],\.canvas-node-editor-popover \.model-picker-trigger\[data-tooltip\]\{overflow:visible\}/,
  );
  assert.match(
    styles,
    /\.canvas-deck \.model-picker-trigger\[data-tooltip\]::after,.canvas-node-editor-popover \.model-picker-trigger\[data-tooltip\]::after\{top:auto;bottom:calc\(100% \+ 8px\);transform:translate\(-50%,4px\)\}/,
  );
  assert.doesNotMatch(
    styles,
    /\.canvas-deck \.model-picker-trigger\[data-tooltip\]::after\{display:none\}/,
  );
});
