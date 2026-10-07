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
