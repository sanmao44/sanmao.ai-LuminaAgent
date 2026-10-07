import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const generationKey = createTsRequire(process.cwd())("./lib/canvas/generation-key");

test("canvas generation keys prefer the source node, then the target node", () => {
  assert.equal(
    generationKey.canvasGenerationKey({ node: { id: "source" }, target: { id: "target" }, kind: "image" }),
    "source",
  );
  assert.equal(
    generationKey.canvasGenerationKey({ node: null, target: { id: "target" }, kind: "image" }),
    "target",
  );
});

test("canvas generation keys keep draft mode names stable", () => {
  assert.equal(
    generationKey.canvasGenerationKey({ node: null, target: null, kind: "video" }),
    "draft:video",
  );
});
