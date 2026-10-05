import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const assetLibrary = createTsRequire(process.cwd())("./lib/canvas/asset-library");

test("canvas asset collections keep smart views read-only", () => {
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("uncategorized"), true);
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("ideas"), true);
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("all"), false);
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("generated"), false);
});

test("canvas asset eligibility requires ready media nodes", () => {
  const base = { type: "media", data: { kind: "image", url: "https://example.test/a.png" } };
  assert.equal(assetLibrary.canAddCanvasAsset(base), true);
  assert.equal(assetLibrary.canAddCanvasAsset({ ...base, data: { ...base.data, status: "running" } }), false);
  assert.equal(assetLibrary.canAddCanvasAsset({ ...base, data: { ...base.data, url: "" } }), false);
  assert.equal(assetLibrary.canAddCanvasAsset({ type: "prompt", data: { url: "https://example.test/a.png" } }), false);
  assert.equal(assetLibrary.canAddCanvasAsset({ type: "upscale", data: { kind: "image", url: "https://example.test/a.png" } }), true);
});
