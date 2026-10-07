import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const component = await readFile(
  new URL("../components/canvas/CanvasWorkspace.tsx", import.meta.url),
  "utf8",
);
const groupLayer = await readFile(
  new URL("../components/canvas/CanvasGroupLayer.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);
const referenceEdges = createTsRequire(process.cwd())("./lib/canvas/reference-edges");

function node(id, kind = "image", url = `/${id}.png`) {
  return { id, type: "media", x: 0, y: 0, data: { kind, url } };
}

function documentWith(nodes, groups, edges) {
  return { version: "1", nodes, groups, edges, camera: { x: 0, y: 0, zoom: 1 } };
}

test("canvas edge resolver expands only an explicit group source", () => {
  const member = node("member");
  const sibling = node("sibling");
  const target = node("target");
  const document = documentWith(
    [member, sibling, target],
    [{ id: "group", name: "Group", nodeIds: [member.id, sibling.id] }],
    [],
  );

  assert.deepEqual(
    referenceEdges.referenceNodesForCanvasEdge(document, { id: "direct", source: member.id, target: target.id }),
    [member],
    "a member edge must not fall back to its containing group",
  );
  assert.deepEqual(
    referenceEdges.referenceNodesForCanvasEdge(document, { id: "group-edge", source: "group", target: target.id }),
    [member, sibling],
  );
});

test("group edge sourceNodeIds restricts and de-duplicates projected members", () => {
  const first = node("first");
  const second = node("second");
  const target = node("target");
  const document = documentWith(
    [first, second, target],
    [{ id: "group", name: "Group", nodeIds: [first.id, second.id] }],
    [],
  );

  assert.deepEqual(
    referenceEdges.referenceNodesForCanvasEdge(document, {
      id: "subset",
      source: "group",
      target: target.id,
      sourceNodeIds: [second.id, second.id, "missing"],
    }),
    [second],
  );
});

test("reference edges filter generated output and preserve explicit order", () => {
  const source = node("source");
  const second = node("second");
  const target = node("target");
  const document = documentWith(
    [source, second, target],
    [],
    [
      { id: "un-ordered", source: second.id, target: target.id },
      { id: "generated", source: source.id, target: target.id, kind: "generated", order: 0 },
      { id: "ordered", source: source.id, target: target.id, order: 1 },
      { id: "first", source: second.id, target: target.id, order: 0 },
    ],
  );

  assert.deepEqual(
    referenceEdges.referenceEdgesForCanvasTarget(document, target.id).map(({ edge }) => edge.id),
    ["first", "ordered", "un-ordered"],
  );
  assert.deepEqual(referenceEdges.referenceEdgeIdsForCanvasSource(document, target.id, source.id), ["ordered"]);
  assert.deepEqual(referenceEdges.referenceEdgeIdsForCanvasSource(document, target.id, second.id), ["first", "un-ordered"]);
});

test("group headers expose an accessible grid compose action", () => {
  assert.match(groupLayer, /className=\{`canvas-group-compose/);
  assert.match(groupLayer, /disabled=\{availableImageCount < 2 \|\| Boolean\(composingGroupId\)\}/);
  assert.match(component, /const openComposeDialog = useCallback/);
  assert.match(component, /onClick: \(\) => openComposeDialog\(group\.id\)/);
  assert.match(component, /<CanvasGroupComposeDialog/);
  assert.match(component, /canvas-compose-backdrop/);
  assert.match(component, /querySelector\("\.canvas-compose-backdrop"\)/);
  assert.match(component, /operation: "grid-compose"/);
  assert.match(component, /sourceNodeIds: sourceIds/);
  assert.match(component, /kind: "lineage"/);
  assert.match(component, /isCanvasGridComposeLineageEdge/);
  assert.match(component, /!isCanvasGridComposeLineageEdge\(document, edge\)/);
  assert.match(styles, /\.canvas-group-label \.canvas-group-compose/);
  assert.match(styles, /\.canvas-group-label \.canvas-group-compose:disabled/);
  assert.match(styles, /\.canvas-group-label \.canvas-group-compose:hover/);
});

test("group removal control scales with its card and stays within the card", () => {
  assert.match(styles, /\.canvas-node\{container-type:inline-size\}/);
  assert.match(styles, /\.canvas-node-group-remove\{[^}]*height:clamp\(30px,8cqw,42px\)/);
  assert.match(styles, /\.canvas-node-group-remove\{[^}]*font-size:clamp\(12px,3\.3cqw,17px\)/);
  assert.match(styles, /\.canvas-node-group-remove\{[^}]*max-width:calc\(100% - 14px\)/);
  assert.match(styles, /\.canvas-node-group-remove\{[^}]*overflow:hidden/);
});

test("light theme group boundaries stay visible without overpowering cards", () => {
  assert.match(styles, /html\[data-theme="light"\] \.canvas-group\{/);
  assert.match(styles, /html\[data-theme="light"\] \.canvas-group\.selected\{/);
  assert.match(styles, /html\[data-theme="light"\] \.canvas-group-label\{/);
});

test("group arrangement preserves the current canvas camera", () => {
  const start = component.indexOf("const arrangeCanvasAction = useCallback");
  const end = component.indexOf("const chooseGroupArrangeMode", start);
  assert.ok(start >= 0 && end > start, "arrangement action should be present");
  const action = component.slice(start, end);
  assert.match(action, /if \(!activeGroup\) fitView\(result\.arrangedIds\)/);
});
