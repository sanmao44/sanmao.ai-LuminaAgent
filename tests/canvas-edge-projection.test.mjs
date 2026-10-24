import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const model = createTsRequire(process.cwd())("./lib/canvas/model");
const projection = createTsRequire(process.cwd())("./lib/canvas/edge-projection");

test("edge color projection follows nodes and the first existing group member", () => {
  const image = model.createMedia("image", "/image.png", "Image", { x: 0, y: 0 });
  const video = model.createMedia("video", "/video.mp4", "Video", { x: 200, y: 0 });
  const group = { id: "group-mixed", nodeIds: [video.id, image.id], name: "Mixed" };
  const emptyGroup = { id: "group-empty", nodeIds: [], name: "Empty" };
  const colors = projection.canvasEdgeColorKeysByEntityId(
    [image, video],
    [group, emptyGroup],
  );

  assert.equal(colors.get(image.id), "image");
  assert.equal(colors.get(video.id), "video");
  assert.equal(colors.get(group.id), "video");
  assert.equal(colors.get(emptyGroup.id), "image");
});

test("edge geometry projection tracks node and group member position and size", () => {
  const image = model.createMedia("image", "/image.png", "Image", { x: 20, y: 30 });
  const group = { id: "group", nodeIds: [image.id], name: "Group" };
  const geometry = projection.canvasEdgeGeometryKeysByEntityId([image], [group]);

  assert.equal(geometry.get(image.id), `n:${image.id}:${image.x}:${image.y}:${model.nodeSize(image).w}x${model.nodeSize(image).h}`);
  assert.equal(geometry.get(group.id), `g:${group.id}:${image.id}:${image.x}:${image.y}:${model.nodeSize(image).w}x${model.nodeSize(image).h}`);
});

test("visible edge projection requires rendered endpoints and omits compose lineage", () => {
  const first = model.createMedia("image", "/first.png", "First", { x: 0, y: 0 });
  const second = model.createMedia("image", "/second.png", "Second", { x: 200, y: 0 });
  const third = model.createMedia("image", "/third.png", "Third", { x: 400, y: 0 });
  const linked = model.addEdge(model.normalizeDocument({ nodes: [first, second, third] }), first.id, second.id);
  const document = {
    ...linked,
    nodes: linked.nodes.map((node) => node.id === second.id
      ? { ...node, data: { ...node.data, imageOperation: { operation: "grid-compose" } } }
      : node),
    edges: [
      ...linked.edges,
      { id: "hidden", source: first.id, target: third.id, kind: "manual" },
      { id: "lineage", source: first.id, target: second.id, kind: "lineage" },
    ],
  };
  const visible = projection.visibleCanvasEdgeProjection(
    document,
    new Set([first.id, second.id]),
    new Set(),
  );

  assert.deepEqual(visible.map((edge) => edge.id), [linked.edges[0].id]);
});

test("hidden edge mode keeps only directly related selected-node connections", () => {
  const source = model.createPrompt({ x: 0, y: 0 }, "Source");
  const selected = model.createMedia("image", "/selected.png", "Selected", { x: 240, y: 0 });
  const target = model.createGenerator("image", { x: 480, y: 0 });
  const unrelated = model.createPrompt({ x: 720, y: 0 }, "Unrelated");
  let document = model.normalizeDocument({ nodes: [source, selected, target, unrelated] });
  document = model.addEdge(document, source.id, selected.id);
  document = model.addEdge(document, selected.id, target.id);
  document = model.addEdge(document, target.id, unrelated.id);
  const related = new Set(
    document.edges
      .filter((edge) => model.edgeTouchesSelection(document, edge, [selected.id]))
      .map((edge) => edge.id),
  );

  assert.deepEqual(
    projection.visibleCanvasEdgeProjection(document, new Set(), new Set(), related).map((edge) => edge.id),
    [...related],
    "selected relationships remain visible even when the other endpoint is outside the viewport",
  );
  assert.deepEqual(
    projection.visibleCanvasEdgeProjection(document, new Set([source.id, selected.id, target.id]), new Set(), related).map((edge) => edge.id),
    [...related],
  );

  assert.deepEqual(
    projection.visibleCanvasEdgeProjection(document, new Set([source.id, selected.id, target.id, unrelated.id]), new Set(), related).map((edge) => edge.id),
    [...related],
    "hidden mode does not fall back to all edges whose endpoints are in view",
  );
  assert.deepEqual(
    projection.visibleCanvasEdgeProjection(document, new Set([source.id, selected.id, target.id, unrelated.id]), new Set(), new Set()).map((edge) => edge.id),
    [],
    "hidden mode with no selection renders no ordinary connections",
  );
});
