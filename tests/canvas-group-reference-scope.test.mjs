import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const component = await readFile(
  new URL("../components/canvas/CanvasWorkspace.tsx", import.meta.url),
  "utf8",
);
const edgeProjection = await readFile(
  new URL("../lib/canvas/edge-projection.ts", import.meta.url),
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
const canvasModel = createTsRequire(process.cwd())("./lib/canvas/model");

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

test("generated image outputs retain exact inputs and recover legacy reference IDs", () => {
  const original = node("original");
  const replacement = node("replacement");
  const legacyResult = {
    ...node("legacy-result"),
    data: {
      ...node("legacy-result").data,
      referenceOrder: [original.id],
      generation: { kind: "image", referenceIds: [original.id] },
    },
  };
  const legacyDocument = documentWith([original, replacement, legacyResult], [], []);

  assert.deepEqual(
    referenceEdges.canvasImageReferencesForContinuation(legacyDocument, legacyResult.id).map((item) => item.id),
    [original.id],
  );

  const chainedResult = {
    ...node("chained-result"),
    data: {
      ...node("chained-result").data,
      referenceOrder: [original.id, replacement.id],
      generation: {
        kind: "image",
        parentNodeId: original.id,
        referenceIds: [original.id, replacement.id],
      },
    },
  };
  const chainedDocument = documentWith(
    [original, replacement, chainedResult],
    [],
    [{ id: "lineage", source: original.id, target: chainedResult.id, kind: "lineage" }],
  );
  assert.deepEqual(
    referenceEdges.canvasImageReferencesForContinuation(chainedDocument, chainedResult.id).map((item) => item.id),
    [replacement.id],
    "a generated node's direct lineage parent should not be reconnected as an inherited reference",
  );
  const connectedChainedDocument = {
    ...chainedDocument,
    edges: [
      ...chainedDocument.edges,
      { id: "parent-reference", source: original.id, target: chainedResult.id, kind: "reference", inputRole: "reference-image" },
      { id: "independent-reference", source: replacement.id, target: chainedResult.id, kind: "reference", inputRole: "reference-image" },
    ],
  };
  assert.deepEqual(
    referenceEdges.canvasImageReferencesForContinuation(connectedChainedDocument, chainedResult.id).map((item) => item.id),
    [replacement.id],
    "an explicit reference edge to the lineage parent should not create a second continuation link",
  );

  const output = node("output");
  const withOutput = documentWith([original, replacement, output], [], []);
  const attached = referenceEdges.attachCanvasImageReferenceEdges(
    withOutput,
    [original, original],
    [output.id],
    () => "output-reference-edge",
  );
  assert.deepEqual(
    canvasModel.incomingReferences(attached, output.id).map((item) => item.id),
    [original.id],
  );
  assert.deepEqual(
    attached.edges.map(({ source, target, inputRole, order, kind }) => ({ source, target, inputRole, order, kind })),
    [{
      source: original.id,
      target: output.id,
      inputRole: "reference-image",
      order: 0,
      kind: "reference",
    }],
  );

  const explicitlyReconnected = {
    ...legacyDocument,
    edges: [{ id: "replacement-edge", source: replacement.id, target: legacyResult.id, kind: "reference" }],
  };
  assert.deepEqual(
    referenceEdges.canvasImageReferencesForContinuation(explicitlyReconnected, legacyResult.id).map((item) => item.id),
    [replacement.id],
    "explicit graph inputs must take precedence over historical generation metadata",
  );

  const specializedInput = {
    ...legacyDocument,
    edges: [{ id: "specialized-edge", source: original.id, target: legacyResult.id, inputRole: "upscale-image", kind: "manual" }],
  };
  assert.deepEqual(
    referenceEdges.canvasImageReferencesForContinuation(specializedInput, legacyResult.id),
    [],
    "an existing non-reference image input must not trigger historical reference fallback",
  );
});

test("generation input sync replaces stale image links and preserves non-image group context", () => {
  const stale = node("stale");
  const first = node("first");
  const second = node("second");
  const protectedSource = node("protected-source");
  const context = { id: "context", type: "prompt", x: 0, y: 0, data: { text: "keep this context" } };
  const target = node("target");
  const grouped = documentWith(
    [stale, first, second, protectedSource, context, target],
    [{ id: "mixed", name: "Mixed inputs", nodeIds: [stale.id, context.id] }],
    [
      { id: "stale-edge", source: stale.id, target: target.id, kind: "reference" },
      { id: "mixed-edge", source: "mixed", target: target.id, kind: "reference" },
      { id: "protected-edge", source: protectedSource.id, target: target.id, inputRole: "upscale-image", kind: "manual" },
    ],
  );

  let nextEdgeId = 0;
  const synced = referenceEdges.attachCanvasImageReferenceEdges(
    grouped,
    [second, first],
    [target.id],
    () => `generated-${++nextEdgeId}`,
  );
  assert.deepEqual(
    referenceEdges.canvasImageReferencesForContinuation(synced, target.id).map((item) => item.id),
    [second.id, first.id],
  );
  assert.deepEqual(synced.edges.find((edge) => edge.id === "mixed-edge").sourceNodeIds, [context.id]);
  assert.equal(synced.edges.find((edge) => edge.id === "protected-edge"), grouped.edges[2]);
  assert.deepEqual(
    synced.edges.filter((edge) => edge.target === target.id && edge.inputRole === "reference-image")
      .map((edge) => [edge.source, edge.order]),
    [[second.id, 0], [first.id, 1]],
  );
  assert.equal(synced.edges.some((edge) => edge.id === "stale-edge"), false);

  const unchanged = referenceEdges.attachCanvasImageReferenceEdges(
    synced,
    [second, first],
    [target.id],
    () => `unexpected-${++nextEdgeId}`,
  );
  assert.equal(unchanged, synced, "repeating the same sync must preserve the document");
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
  assert.match(edgeProjection, /isCanvasGridComposeLineageEdge\(document, edge\)/);
  assert.match(edgeProjection, /isCanvasGridComposeLineageEdge\(document, edge\)/);
  assert.match(edgeProjection, /if \(!sourceVisible \|\| !targetVisible\) return false/);
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

test("world group labels counteract camera zoom above their member cards", () => {
  assert.match(styles, /\.canvas-group-label-layer\{z-index:auto\}/);
  assert.match(styles, /\.canvas-group-label-layer>\.canvas-group-world-label\{[^}]*transform:scale\(var\(--canvas-name-inverse-zoom,1\)\)/);
  assert.match(styles, /\.canvas-group-label-layer>\.canvas-group-world-label\{[^}]*pointer-events:auto/);
  assert.match(styles, /\.canvas-group-label-layer>\.canvas-group-world-label \.canvas-group-name\{[^}]*white-space:nowrap/);
});

test("group arrangement preserves the current canvas camera", () => {
  const start = component.indexOf("const arrangeCanvasAction = useCallback");
  const end = component.indexOf("const chooseGroupArrangeMode", start);
  assert.ok(start >= 0 && end > start, "arrangement action should be present");
  const action = component.slice(start, end);
  assert.match(action, /if \(!activeGroup\) fitView\(result\.arrangedIds\)/);
});
