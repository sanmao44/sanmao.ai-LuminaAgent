import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
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
