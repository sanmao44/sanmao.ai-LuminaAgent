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
  assert.doesNotMatch(component, /onAddToAssets=\{/);
  assert.match(component, /preferredCollectionId=\{assetLibraryCollectionId\}/);
  assert.match(component, /const success = await addViewerAsset\(pickerNode, collectionId\)/);
  assert.match(component, /collectionSelection=\{assetLibraryCollectionId\}/);
  assert.match(component, /onCollectionSelectionChange=\{setAssetLibraryCollectionId\}/);
  assert.match(component, /listUnifiedAssets\(canvasAssets\)/);
  assert.match(component, /setAssetCollectionPickerNodeId\(null\)/);
  assert.match(component, /assetCollectionPickerNodeId\);/);
});

test("collection picker mirrors drawer categories and disables smart views", () => {
  const picker = component.slice(
    component.indexOf("function CanvasAssetCollectionPicker"),
    component.indexOf("function CanvasAssetDrawer"),
  );
  assert.match(picker, /CANVAS_ASSET_UNCATEGORIZED_ID/);
  assert.match(picker, /const collectionOptions = collections\.map\(\(item\) =>/);
  assert.match(picker, /assignable: isAssignableCanvasAssetCollection\(item\.id\)/);
  assert.match(picker, /disabled: !item\.assignable/);
  assert.match(picker, /智能筛选视图不可直接归类/);
  assert.match(picker, /saveAssetCollections\(next\)/);
  assert.match(picker, /CANVAS_ASSET_LAST_COLLECTION_KEY/);
  assert.match(picker, /全局资产中心的“\{selectedCollection\?\.name/);
  assert.match(styles, /\.canvas-asset-target-dialog\{/);
  assert.match(styles, /\.canvas-asset-collection-picker-backdrop\{/);
});

test("asset registration preserves existing collections and rejects smart views or unfinished nodes", () => {
  assert.match(component, /function isAssignableCanvasAssetCollection/);
  assert.match(component, /const CANVAS_ASSET_SMART_COLLECTION_IDS = new Set/);
  assert.match(component, /if \(!isAssignableCanvasAssetCollection\(collectionId\)\)/);
  assert.match(component, /const existing = \(await listUnifiedAssets\((?:canvasAssets)?\)\)\.find/);
  assert.match(component, /\[\.\.\.new Set\(\[\.\.\.currentCollectionIds, collectionId\]\)\]/);
  assert.match(component, /collectionId === CANVAS_ASSET_UNCATEGORIZED_ID/);
  assert.match(component, /function canAddCanvasAsset/);
  assert.match(component, /CANVAS_ASSET_NON_READY_STATUSES = new Set\(\["queued", "running", "failed"\]\)/);
  assert.match(component, /if \(!isAssignableCanvasAssetCollection\(collection\)\)/);
});

test("asset drawer makes new collection creation a clear primary action", () => {
  const drawer = component.slice(
    component.indexOf("function CanvasAssetDrawer"),
    component.indexOf("function CanvasAssetCollectionPicker", component.indexOf("function CanvasAssetDrawer")),
  );
  assert.match(drawer, /className="canvas-asset-new-collection" aria-label="新建资产合集"/);
  assert.match(drawer, /className="canvas-asset-new-collection-head"/);
  assert.match(drawer, />新建合集<\/b>/);
  assert.match(drawer, /创建后自动切换到新合集/);
  assert.match(drawer, /placeholder="输入合集名称，例如：灵感参考"/);
  assert.match(drawer, /disabled=\{!newCollectionName\.trim\(\)\}/);
  assert.match(styles, /\.canvas-asset-new-collection\{display:grid;[^}]*border:1px solid color-mix/);
  assert.match(styles, /\.canvas-asset-new-collection-form button\{[^}]*background:linear-gradient/);
});

test("asset drawer keeps the media preview primary across responsive layouts", () => {
  assert.match(styles, /\.canvas-asset-drawer\{width:min\(480px,calc\(100vw - 32px\)\)\}/);
  assert.match(styles, /\.canvas-asset-drawer \.canvas-asset-kind\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
  assert.match(styles, /\.canvas-asset-drawer \.canvas-asset-filters\{grid-template-columns:minmax\(0,1\.25fr\) repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(styles, /\.canvas-asset-drawer \.canvas-global-asset-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px\}/);
  assert.match(styles, /\.canvas-asset-drawer \.canvas-global-asset-card\{display:block\}/);
  assert.match(styles, /\.canvas-asset-drawer \.canvas-global-asset-preview\{[^}]*aspect-ratio:4 \/ 3/);
  assert.match(styles, /\.canvas-asset-drawer \.canvas-asset-new-collection\{display:grid;grid-template-columns:minmax\(0,.82fr\) minmax\(0,1\.18fr\)/);
  assert.match(styles, /@media\(max-width:720px\)\{[\s\S]*?\.canvas-asset-drawer \.canvas-global-asset-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});

test("custom asset collections can be renamed even when legacy records omit builtin false", () => {
  const drawer = component.slice(
    component.indexOf("function CanvasAssetDrawer"),
    component.indexOf("function CanvasAssetCollectionPicker", component.indexOf("function CanvasAssetDrawer")),
  );
  assert.match(drawer, /disabled=\{collection === "all" \|\| !collections\.some\(\(item\) => item\.id === collection && item\.builtin !== true\)\}/);
  assert.match(drawer, /if \(!target \|\| target\.builtin\)/);
});
