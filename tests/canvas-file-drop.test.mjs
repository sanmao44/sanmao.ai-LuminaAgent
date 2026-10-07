import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const component = await readFile(
  new URL("../components/canvas/CanvasWorkspace.tsx", import.meta.url),
  "utf8",
);
const overlay = await readFile(
  new URL("../components/canvas/CanvasViewportOverlay.tsx", import.meta.url),
  "utf8",
);
const fileInput = createTsRequire(new URL("../lib/canvas", import.meta.url).pathname)("./file-input.ts");

test("canvas accepts external file drops at the pointer position", () => {
  assert.equal(fileInput.hasExternalFileTransfer({ types: ["Files"], items: [] }), true);
  assert.equal(fileInput.hasExternalFileTransfer({ types: [], items: [{ kind: "file" }] }), true);
  assert.equal(fileInput.hasExternalFileTransfer({ types: [], items: [{ kind: "string" }] }), false);
  assert.match(component, /event\.preventDefault\(\);\s*event\.dataTransfer\.dropEffect = "copy";/);
  assert.match(
    component,
    /handleFiles\(\s*event\.dataTransfer\.files,\s*screenToWorld\(event\.clientX, event\.clientY\)/,
  );
  assert.match(overlay, /className="canvas-file-drop-hint"/);
});

test("canvas file classification keeps text and audio references deterministic", () => {
  assert.equal(fileInput.isCanvasTextReferenceFile({ name: "notes.md", type: "" }), true);
  assert.equal(fileInput.isCanvasTextReferenceFile({ name: "data.bin", type: "application/json" }), true);
  assert.equal(fileInput.isCanvasTextReferenceFile({ name: "photo.png", type: "image/png" }), false);
  assert.equal(fileInput.isCanvasAudioFile({ name: "voice.WAV", type: "" }), true);
  assert.equal(fileInput.isCanvasAudioFile({ name: "voice.bin", type: "audio/custom" }), true);
  assert.equal(fileInput.isCanvasAudioFile({ name: "clip.mp4", type: "video/mp4" }), false);
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
