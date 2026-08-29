import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const canvasCss = await readFile(
  new URL("../app/canvas.css", import.meta.url),
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

  assert.match(component, /if \(isCanvasReferenceableNode\(node\)\)\s*openCanvasMediaViewer\(node\.id\)/);
  assert.match(card, /else if \(isCanvasReferenceableNode\(node\)\) onPreview\(\)/);
  assert.match(component, /if \(!viewerNode \|\| !isCanvasReferenceableNode\(viewerNode\)\) return null/);
  assert.match(component, /const viewerIsMedia = viewerNode\.type === "media"/);
  assert.match(component, /parameters=\{viewerIsMedia && viewerNode\.data\.kind === "video"/);
  assert.match(component, /onEdit=\{viewerIsMedia \?/);
});

test("canvas overlays share the token stack and asset preview owns the first Escape", () => {
  assert.match(canvasCss, /--canvas-z-world:1/);
  assert.match(canvasCss, /--canvas-z-node:30/);
  assert.match(canvasCss, /--canvas-z-context-menu:360/);
  assert.match(canvasCss, /--canvas-z-toast:700/);
  assert.match(canvasCss, /\.canvas-world-content>\.canvas-edge-layer\{z-index:var\(--canvas-z-edge\)\}/);
  assert.match(canvasCss, /\.canvas-node-editor-popover\.is-prompt-expanded\{z-index:var\(--canvas-z-expanded-editor\)\}/);
  assert.match(component, /return typeof document === "undefined" \? menu : createPortal\(menu, document\.body\)/);
  assert.match(component, /if \(window\.document\.querySelector\("\.canvas-asset-preview-backdrop"\)\) return;/);
  assert.match(component, /if \(!preview\) return;[\s\S]*setPreview\(null\);[\s\S]*addEventListener\("keydown", handleEscape, true\)/);
});
