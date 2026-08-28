import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);

test("only a blank canvas double-click opens the add-node menu", () => {
  const start = component.indexOf("onDoubleClick={(event) => {");
  const end = component.indexOf("onDragStart=", start);
  assert.ok(start >= 0 && end > start, "canvas double-click handler should exist");
  const handler = component.slice(start, end);

  assert.match(handler, /else if \(node\) \{\s*event\.preventDefault\(\);\s*return;\s*\} else \{/);
  assert.match(handler, /setContextMenu\(\{[\s\S]*world:/);
});

test("node editors and node quick panels stay outside the canvas double-click handler", () => {
  const start = component.indexOf("onDoubleClick={(event) => {");
  const end = component.indexOf("onDragStart=", start);
  const handler = component.slice(start, end);

  assert.match(handler, /\.canvas-node-editor/);
  assert.match(handler, /\.canvas-node-editor-popover/);
  assert.match(handler, /\.canvas-node-parameters/);
  assert.match(handler, /\.canvas-node-quick-toolbar/);
});

test("completed upscale results use the same image preview path as media nodes", () => {
  const cardStart = component.indexOf("function CanvasNodeCard");
  const cardEnd = component.indexOf("function CanvasMinimap", cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, "canvas node card should exist");
  const card = component.slice(cardStart, cardEnd);

  assert.match(component, /if \(isCanvasReferenceableNode\(node\)\)\s*setLightbox\(\{ nodeId: node\.id, compare: false \}\)/);
  assert.match(card, /else if \(isCanvasReferenceableNode\(node\)\) onPreview\(\)/);
  assert.match(component, /if \(!viewerNode \|\| !isCanvasReferenceableNode\(viewerNode\)\) return null/);
  assert.match(component, /const viewerIsMedia = viewerNode\.type === "media"/);
  assert.match(component, /parameters=\{viewerIsMedia && viewerNode\.data\.kind === "video"/);
  assert.match(component, /onEdit=\{viewerIsMedia \?/);
});
