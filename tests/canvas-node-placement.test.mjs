import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const model = createTsRequire(process.cwd())("./lib/canvas/model");
const placement = createTsRequire(process.cwd())("./lib/canvas/node-placement");

test("canvas node placement preserves an open anchor", () => {
  const node = model.createMedia("image", "/new.png", "new", { x: 0, y: 0 });
  const result = placement.findCanvasNodePlacement({ x: 640, y: 320 }, node, []);
  assert.deepEqual(result, { x: 640, y: 320 });
});

test("canvas node placement moves to the first clear ring point", () => {
  const occupied = model.createMedia("image", "/occupied.png", "occupied", { x: 0, y: 0 });
  const node = model.createMedia("image", "/new.png", "new", { x: 0, y: 0 });
  const result = placement.findCanvasNodePlacement({ x: 0, y: 0 }, node, [occupied]);
  assert.deepEqual(result, { x: 0, y: 310 });
});

test("canvas node placement separates a generated batch from existing nodes and earlier siblings", () => {
  const occupied = [model.createMedia("image", "/occupied.png", "occupied", { x: 0, y: 0 })];
  const placed = [];

  for (let index = 0; index < 4; index += 1) {
    const node = model.createMedia("image", `/result-${index}.png`, `result-${index}`, { x: 0, y: 0 });
    const position = placement.findCanvasNodePlacement({ x: node.x, y: node.y }, node, [...occupied, ...placed]);
    placed.push({ ...node, ...position });
  }

  const nodes = [...occupied, ...placed];
  for (let first = 0; first < nodes.length; first += 1) {
    const firstSize = model.nodeSize(nodes[first]);
    for (let second = first + 1; second < nodes.length; second += 1) {
      const secondSize = model.nodeSize(nodes[second]);
      const overlaps = nodes[first].x < nodes[second].x + secondSize.w + 28
        && nodes[first].x + firstSize.w + 28 > nodes[second].x
        && nodes[first].y < nodes[second].y + secondSize.h + 28
        && nodes[first].y + firstSize.h + 28 > nodes[second].y;
      assert.equal(overlaps, false, `${nodes[first].data.name} overlaps ${nodes[second].data.name}`);
    }
  }
});

test("canvas image results reserve their requested size before the image loads", () => {
  const params = {
    kind: 'image', aspect: '1:1', customAspectWidth: 16,
    customAspectHeight: 9, sizeMode: 'system', width: 1024, height: 1024,
  };
  const source = {
    ...model.createMedia('image', '/source.png', 'source', { x: 0, y: 0 }),
    ...model.smartMediaSize('image', { ...params, aspect: '1:1' }),
  };
  const outputSize = model.smartMediaSize('image', params);
  const createPendingResult = (name) => ({
    ...model.createMedia('image', '', name, { x: 0, y: 0 }, { params, status: 'running' }),
    ...outputSize,
  });
  const firstPending = createPendingResult('result 1');
  const first = {
    ...firstPending,
    ...placement.findCanvasNodePlacement(
      { x: source.x + source.w + 90, y: source.y },
      firstPending,
      [source],
    ),
  };
  const secondPending = createPendingResult('result 2');
  const second = {
    ...secondPending,
    ...placement.findCanvasNodePlacement(
      { x: first.x + 350, y: first.y },
      secondPending,
      [source, first],
    ),
  };
  const nodes = [source, first, second];

  assert.equal(firstPending.h, outputSize.h);
  assert.ok(firstPending.h > 270);
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
    const firstSize = model.nodeSize(nodes[firstIndex]);
    for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
      const secondSize = model.nodeSize(nodes[secondIndex]);
      const overlaps = nodes[firstIndex].x < nodes[secondIndex].x + secondSize.w + 28
        && nodes[firstIndex].x + firstSize.w + 28 > nodes[secondIndex].x
        && nodes[firstIndex].y < nodes[secondIndex].y + secondSize.h + 28
        && nodes[firstIndex].y + firstSize.h + 28 > nodes[secondIndex].y;
      assert.equal(overlaps, false, `${nodes[firstIndex].data.name} overlaps ${nodes[secondIndex].data.name}`);
    }
  }
});

test("canvas node placement keeps the anchor when every candidate is occupied", () => {
  const node = model.createMedia("image", "/new.png", "new", { x: 0, y: 0 });
  const occupied = [{
    ...model.createMedia("image", "/occupied.png", "occupied", { x: -50000, y: -50000 }),
    w: 100000,
    h: 100000,
  }];
  const result = placement.findCanvasNodePlacement({ x: 0, y: 0 }, node, occupied);
  assert.deepEqual(result, { x: 0, y: 0 });
});
