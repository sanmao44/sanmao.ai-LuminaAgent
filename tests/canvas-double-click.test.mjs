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
