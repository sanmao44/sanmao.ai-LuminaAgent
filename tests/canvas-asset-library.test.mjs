import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const assetLibrary = createTsRequire(process.cwd())("./lib/canvas/asset-library");
const assetServiceCalls = { lists: [], updates: [], registrations: [] };
const assetService = createTsRequire(process.cwd(), {
  "@/lib/assets": {
    listUnifiedAssets: async (extra = []) => {
      assetServiceCalls.lists.push(extra);
      return [...extra];
    },
    updateUnifiedAssetMetadata: async (asset, patch) => {
      assetServiceCalls.updates.push({ asset, patch });
    },
    registerCanvasAsset: async (asset) => {
      assetServiceCalls.registrations.push(asset);
    },
  },
  "@/lib/canvas/asset-library": assetLibrary,
})("./lib/canvas/asset-library-service");

test("canvas asset collections keep smart views read-only", () => {
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("uncategorized"), true);
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("ideas"), true);
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("all"), false);
  assert.equal(assetLibrary.isAssignableCanvasAssetCollection("generated"), false);
});

test("canvas asset filtering keeps collection, text, tag, favorite and sort semantics", () => {
  const assets = [
    {
      id: "new-image", kind: "image", url: "new.png", name: "Sunset study", source: "canvas-upload",
      createdAt: 900, favorite: true, prompt: "warm light", modelName: "Model A",
      projectIds: [], collectionIds: ["ideas"], tags: ["reference"],
    },
    {
      id: "old-video", kind: "video", url: "old.mp4", name: "Ocean clip", source: "video-task",
      createdAt: 100, favorite: false, prompt: "blue water", modelName: "Model B",
      projectIds: [], collectionIds: [], tags: [],
    },
    {
      id: "mid-image", kind: "image", url: "mid.png", name: "Portrait", source: "history",
      createdAt: 500, favorite: false, prompt: "studio light", modelName: "Model C",
      projectIds: [], collectionIds: ["ideas"], tags: [],
    },
  ];
  const options = {
    collection: "ideas",
    kind: "image",
    source: "all",
    favoritesOnly: false,
    query: "sunset",
    tagFilter: "ref",
    sort: "newest",
    now: 1000,
  };
  assert.deepEqual(assetLibrary.filterCanvasAssets(assets, options).map((asset) => asset.id), ["new-image"]);
  assert.deepEqual(assetLibrary.filterCanvasAssets(assets, { ...options, query: "", tagFilter: "", favoritesOnly: true }).map((asset) => asset.id), ["new-image"]);
  assert.deepEqual(assetLibrary.filterCanvasAssets(assets, { ...options, collection: "recent", kind: "all", query: "", tagFilter: "", sort: "oldest" }).map((asset) => asset.id), ["old-video", "mid-image", "new-image"]);
  assert.deepEqual(assetLibrary.filterCanvasAssets(assets, { ...options, collection: "all", kind: "all", query: "", tagFilter: "", sort: "name" }).map((asset) => asset.id), ["old-video", "mid-image", "new-image"]);
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

test("canvas asset collection service preserves and merges collection metadata", async () => {
  assetServiceCalls.lists.length = 0;
  assetServiceCalls.updates.length = 0;
  assetServiceCalls.registrations.length = 0;
  const existing = {
    id: "asset-1",
    kind: "image",
    url: "image.png",
    name: "Image",
    source: "canvas-upload",
    createdAt: 1,
    favorite: false,
    projectIds: [],
    collectionIds: ["ideas"],
    tags: [],
  };

  const updated = await assetService.addExistingCanvasAssetToCollection(
    { kind: "image", url: "image.png" },
    "selected",
    [existing],
  );
  assert.equal(updated.status, "saved");
  assert.deepEqual(assetServiceCalls.updates[0].patch.collectionIds, ["ideas", "selected"]);
  assert.equal(assetServiceCalls.registrations.length, 0);

  const registered = await assetService.registerCanvasAssetInCollection({
    ...existing,
    id: "asset-2",
    url: "new.png",
    collectionIds: [],
  }, "new-collection", []);
  assert.equal(registered.status, "saved");
  assert.equal(assetServiceCalls.registrations.length, 1);
  assert.deepEqual(assetServiceCalls.registrations[0].collectionIds, ["new-collection"]);
  assert.equal((await assetService.addExistingCanvasAssetToCollection(
    { kind: "image", url: "missing.png" },
    "selected",
    [],
  )).status, "missing-asset");
  assert.equal((await assetService.registerCanvasAssetInCollection(
    existing,
    "generated",
    [],
  )).status, "invalid-collection");
});
