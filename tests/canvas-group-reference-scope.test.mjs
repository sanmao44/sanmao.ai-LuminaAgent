import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("canvas edge resolver expands only an explicit group source", () => {
  const start = component.indexOf("function referenceNodesForCanvasEdge");
  const end = component.indexOf("function referenceEdgesForCanvasTarget", start);
  assert.ok(start >= 0 && end > start, "canvas reference resolver should be present");

  const resolver = component.slice(start, end);
  assert.match(resolver, /const sourceGroup = groupById\(document, edge\.source\)/);
  assert.match(resolver, /if \(!sourceGroup\)/);
  assert.doesNotMatch(
    resolver,
    /source\?\.groupId/,
    "a member edge must not fall back to its containing group",
  );
});

test("group headers expose an accessible grid compose action", () => {
  assert.match(component, /className=\{`canvas-group-compose/);
  assert.match(component, /disabled=\{availableImageCount < 2 \|\| Boolean\(composingGroupId\)\}/);
  assert.match(component, /void composeCanvasGroup\(group\.id\)/);
  assert.match(component, /operation: "grid-compose"/);
  assert.match(component, /sourceNodeIds: sourceIds/);
  assert.match(component, /kind: "lineage"/);
  assert.match(styles, /\.canvas-group-label \.canvas-group-compose/);
  assert.match(styles, /\.canvas-group-label \.canvas-group-compose:disabled/);
  assert.match(styles, /\.canvas-group-label \.canvas-group-compose:hover/);
});

test("group removal control scales with its card and stays within the card", () => {
  assert.match(styles, /\.canvas-node\{container-type:inline-size\}/);
  assert.match(styles, /\.canvas-node-group-remove\{[^}]*font-size:clamp\(10px,3cqw,16px\)/);
  assert.match(styles, /\.canvas-node-group-remove\{[^}]*max-width:calc\(100% - 14px\)/);
  assert.match(styles, /\.canvas-node-group-remove\{[^}]*overflow:hidden/);
});
