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

test("canvas nodes project to the existing asset record contract", () => {
  const node = {
    id: "node-1",
    type: "media",
    data: {
      kind: "image",
      url: "/api/storage/file?name=generated.png",
      name: "Generated image",
      model: "model-1",
      nativeWidth: 1024,
      nativeHeight: 768,
      generation: {
        createdAt: 123,
        prompt: "A test image",
        params: { model: "model-id" },
      },
    },
  };

  assert.deepEqual(assetLibrary.canvasNodeAssetRecord(node, {
    activeProjectId: "active-project",
    projectId: "project-1",
  }), {
    id: "canvas:active-project:node-1",
    kind: "image",
    url: "/api/storage/file?name=generated.png",
    name: "Generated image",
    source: "canvas-output",
    createdAt: 123,
    favorite: false,
    prompt: "A test image",
    modelId: "model-id",
    modelName: "model-1",
    width: 1024,
    height: 768,
    projectIds: ["project-1"],
    collectionIds: [],
    tags: [],
  });
  assert.equal(assetLibrary.canvasNodeAssetRecord({ ...node, data: { ...node.data, generation: undefined } }, {
    activeProjectId: "active-project",
  })?.createdAt, 0);
  assert.equal(assetLibrary.canvasNodeAssetRecord({ ...node, type: "prompt" }, {
    activeProjectId: "active-project",
  }), null);
});
