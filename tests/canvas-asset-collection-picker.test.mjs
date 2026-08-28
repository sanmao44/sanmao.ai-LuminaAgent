import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("all canvas asset actions open the collection picker before writing", () => {
  assert.match(component, /function CanvasAssetCollectionPicker/);
  assert.match(component, /onClick: \(\) => openAssetCollectionPicker\(node\)/);
  assert.match(component, /onClick: close\(\(\) => openAssetCollectionPicker\(node\)\)/);
  assert.match(component, /onAddToAssets=\{canAddCanvasAsset\(viewerNode\) \? \(\) => openAssetCollectionPicker\(viewerNode\) : undefined\}/);
  assert.match(component, /onConfirm=\{\(collectionId\) => addViewerAsset\(pickerNode, collectionId\)\}/);
  assert.match(component, /setAssetCollectionPickerNodeId\(null\)/);
  assert.match(component, /assetCollectionPickerNodeId\);/);
});

test("collection picker exposes only uncategorized and custom collections", () => {
  const picker = component.slice(
    component.indexOf("function CanvasAssetCollectionPicker"),
    component.indexOf("function CanvasAssetDrawer"),
  );
  assert.match(picker, /CANVAS_ASSET_UNCATEGORIZED_ID/);
  assert.match(picker, /\.filter\(\(item\) => item\.builtin === false\)/);
  assert.match(picker, /saveAssetCollections\(next\)/);
  assert.match(picker, /CANVAS_ASSET_LAST_COLLECTION_KEY/);
  assert.match(styles, /\.canvas-asset-target-dialog\{/);
  assert.match(styles, /\.canvas-asset-collection-picker-backdrop\{/);
});

test("asset registration preserves existing collections and rejects smart views or unfinished nodes", () => {
  assert.match(component, /function isAssignableCanvasAssetCollection/);
  assert.match(component, /const CANVAS_ASSET_SMART_COLLECTION_IDS = new Set/);
  assert.match(component, /if \(!isAssignableCanvasAssetCollection\(collectionId\)\)/);
  assert.match(component, /const existing = \(await listUnifiedAssets\(\)\)\.find/);
  assert.match(component, /\[\.\.\.new Set\(\[\.\.\.currentCollectionIds, collectionId\]\)\]/);
  assert.match(component, /collectionId === CANVAS_ASSET_UNCATEGORIZED_ID/);
  assert.match(component, /function canAddCanvasAsset/);
  assert.match(component, /CANVAS_ASSET_NON_READY_STATUSES = new Set\(\["queued", "running", "failed"\]\)/);
  assert.match(component, /if \(!isAssignableCanvasAssetCollection\(collection\)\)/);
});
