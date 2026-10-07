import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const model = createTsRequire(process.cwd())("./lib/canvas/model");
const command = createTsRequire(process.cwd())("./lib/canvas/connection-command");

function documentWith(nodes, groups = [], edges = []) {
  return model.normalizeDocument({ nodes, groups, edges });
}

test("connection command preserves existing validation and returns an immutable result", () => {
  const source = model.createMedia("image", "/source.png", "Source", { x: 0, y: 0 });
  const target = model.createEmptyMedia("image", { x: 300, y: 0 });
  const document = documentWith([source, target]);
  const result = command.connectCanvasNodesInDocument(document, source.id, target.id, "right", "left", null);

  assert.equal(result.ok, true);
  assert.notEqual(result.document, document);
  assert.equal(result.document.edges.length, 1);
  assert.equal(result.document.edges[0].source, source.id);
  assert.equal(result.document.edges[0].target, target.id);
});

test("connection command rejects self connections without mutating the document", () => {
  const source = model.createMedia("image", "/source.png", "Source", { x: 0, y: 0 });
  const document = documentWith([source]);
  const result = command.connectCanvasNodesInDocument(document, source.id, source.id, "right", "left", null);

  assert.equal(result.ok, false);
  assert.equal(result.document, document);
  assert.equal(result.document.edges.length, 0);
});

test("connection command keeps group sources scoped to their members", () => {
  const first = model.createMedia("image", "/first.png", "First", { x: 0, y: 0 });
  const second = model.createMedia("image", "/second.png", "Second", { x: 0, y: 300 });
  const target = model.createEmptyMedia("video", { x: 500, y: 0 });
  const group = { id: "group", name: "Group", nodeIds: [first.id, second.id] };
  const result = command.connectCanvasNodesInDocument(documentWith([first, second, target], [group]), group.id, target.id, "right", "left", null);

  assert.equal(result.ok, true);
  assert.equal(result.document.edges[0].source, group.id);
  assert.equal(result.document.edges[0].target, target.id);
});
