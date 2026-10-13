import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const catalog = createTsRequire(process.cwd())("./lib/asset-catalog");

test("asset identity deduplicates equivalent local storage URLs", () => {
  assert.equal(
    catalog.assetKey("image", "/api/storage/file?name=cover.png"),
    catalog.assetKey("image", "http://localhost:3210/api/storage/file?name=cover.png"),
  );
});

test("asset records with the same storage key merge into one visible asset", () => {
  const records = [
    {
      id: "gallery:one",
      kind: "image",
      url: "/api/storage/file?name=cover.png",
      name: "Cover",
      source: "history",
      createdAt: 1,
      favorite: false,
      projectIds: [],
      collectionIds: [],
      tags: [],
    },
    {
      id: "index:two",
      kind: "image",
      url: "http://localhost:3210/api/storage/file?name=cover.png",
      storageKey: "images/cover.png",
      name: "Cover copy",
      source: "canvas-upload",
      createdAt: 2,
      favorite: false,
      projectIds: ["project-1"],
      collectionIds: [],
      tags: [],
    },
  ];

  const merged = catalog.mergeAssetRecords(records);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].projectIds, ["project-1"]);
  assert.equal(merged[0].name, "Cover copy");
});

test("asset merge keeps the first authoritative source and the newest metadata overlay", () => {
  const record = {
    id: "gallery:one",
    kind: "image",
    url: "/api/storage/file?name=cover.png",
    name: "Cover",
    source: "history",
    createdAt: 1,
    favorite: false,
    projectIds: [],
    collectionIds: [],
    tags: [],
  };
  const merged = catalog.mergeAssetRecords([
    record,
    { ...record, id: "index:two", source: "canvas-upload", name: "Canvas copy", createdAt: 2 },
  ], [
    {
      id: "metadata-new",
      kind: "image",
      url: "http://localhost:3210/api/storage/file?name=cover.png",
      name: "Newest name",
      source: "metadata",
      createdAt: 20,
      favorite: true,
      projectIds: [],
      collectionIds: ["new"],
      tags: ["latest"],
    },
    {
      id: "metadata-old",
      kind: "image",
      url: "/api/storage/file?name=cover.png",
      name: "Old name",
      source: "metadata",
      createdAt: 10,
      favorite: false,
      projectIds: [],
      collectionIds: ["old"],
      tags: ["stale"],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "history");
  assert.equal(merged[0].name, "Newest name");
  assert.equal(merged[0].favorite, true);
  assert.deepEqual(merged[0].collectionIds, ["new"]);
  assert.deepEqual(merged[0].tags, ["latest"]);
});

test("explicit storage keys keep CDN and canvas projections as one asset", () => {
  const base = {
    kind: "image",
    name: "Stored image",
    source: "canvas-upload",
    createdAt: 1,
    favorite: false,
    projectIds: [],
    collectionIds: [],
    tags: [],
  };
  const merged = catalog.mergeAssetRecords([
    { ...base, id: "index:one", url: "https://cdn.example.test/a.png", storageKey: "images/a.png" },
    { ...base, id: "canvas:two", url: "https://cdn.example.test/a.png", storageKey: "images/a.png", source: "canvas-upload" },
  ]);
  assert.equal(merged.length, 1);
});

test("canvas references do not re-add their existing source asset", () => {
  const merged = catalog.mergeAssetRecords([
    {
      id: "gallery:one",
      kind: "image",
      url: "https://cdn.example.test/original.png",
      name: "Original",
      source: "history",
      createdAt: 1,
      favorite: false,
      projectIds: [],
      collectionIds: [],
      tags: [],
    },
    {
      id: "canvas:project:node",
      sourceAssetId: "gallery:one",
      kind: "image",
      url: "/api/storage/file?name=canvas-projection.png",
      name: "Original",
      source: "canvas-upload",
      createdAt: 2,
      favorite: false,
      projectIds: ["project-1"],
      collectionIds: [],
      tags: [],
    },
  ]);

  assert.deepEqual(merged.map((asset) => asset.id), ["gallery:one"]);
});
