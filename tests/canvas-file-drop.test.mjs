import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);

test("canvas accepts external file drops at the pointer position", () => {
  assert.match(component, /function hasExternalFileTransfer\(dataTransfer: DataTransfer\)/);
  assert.match(component, /dataTransfer\.types\.includes\("Files"\)/);
  assert.match(component, /event\.preventDefault\(\);\s*event\.dataTransfer\.dropEffect = "copy";/);
  assert.match(
    component,
    /handleFiles\(\s*event\.dataTransfer\.files,\s*screenToWorld\(event\.clientX, event\.clientY\)/,
  );
  assert.match(component, /className="canvas-file-drop-hint"/);
});

test("external file drops keep the existing asset drop handler as a fallback", () => {
  const stage = component.slice(
    component.indexOf('className={`canvas-stage'),
    component.indexOf('onContextMenu={handleContextMenu}'),
  );

  assert.match(stage, /if \(hasExternalFileTransfer\(event\.dataTransfer\)\)/);
  assert.match(stage, /handleAssetDrop\(event\)/);
  assert.match(stage, /event\.stopPropagation\(\)/);
});
