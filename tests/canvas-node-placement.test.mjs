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
