import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL("../components/canvas/CanvasWorkspace.tsx", import.meta.url),
  "utf8",
);
const picker = await readFile(
  new URL("../components/canvas/CanvasAssetCollectionPicker.tsx", import.meta.url),
  "utf8",
);
const drawer = await readFile(
  new URL("../components/canvas/CanvasAssetDrawer.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);
const pickerStyles = await readFile(
  new URL("../app/canvas-asset-collection-picker.css", import.meta.url),
  "utf8",
);
const previewStyles = await readFile(
  new URL("../app/canvas-asset-preview.css", import.meta.url),
  "utf8",
);
const assetStyles = await readFile(
  new URL("../app/canvas-asset-library.css", import.meta.url),
  "utf8",
);

test("all canvas asset actions open the collection picker before writing", () => {
  assert.match(picker, /export default function CanvasAssetCollectionPicker/);
  assert.match(workspace, /onClick: \(\) => openAssetCollectionPicker\(node\)/);
  assert.match(workspace, /onClick: close\(\(\) => openAssetCollectionPicker\(node\)\)/);
  assert.doesNotMatch(workspace, /onAddToAssets=\{/);
  assert.match(workspace, /preferredCollectionId=\{assetLibraryCollectionId\}/);
  assert.match(workspace, /const success = await addViewerAsset\(pickerNode, collectionId\)/);
  assert.match(workspace, /collectionSelection=\{assetLibraryCollectionId\}/);
  assert.match(workspace, /onCollectionSelectionChange=\{setAssetLibraryCollectionId\}/);
  assert.match(workspace, /listUnifiedAssets\(canvasAssets\)/);
  assert.match(workspace, /setAssetCollectionPickerNodeId\(null\)/);
  assert.match(workspace, /assetCollectionPickerNodeId\);/);
});

test("collection picker only shows writable asset collections", () => {
  assert.match(picker, /CANVAS_ASSET_UNCATEGORIZED_ID/);
  assert.match(picker, /const collectionOptions = collections\s+\.filter\(\(item\) => isAssignableCanvasAssetCollection\(item\.id\)\)/);
  assert.doesNotMatch(picker, /disabled: !item\.assignable/);
  assert.doesNotMatch(picker, /智能筛选视图不可直接归类/);
  assert.match(picker, /saveAssetCollections\(next\)/);
  assert.match(picker, /CANVAS_ASSET_LAST_COLLECTION_KEY/);
  assert.match(picker, /selectedCollection\?\.name/);
  assert.match(pickerStyles, /\.canvas-asset-target-dialog\{/);
  assert.match(styles, /\.canvas-asset-collection-picker-backdrop\{/);
});

test("asset registration preserves existing collections and rejects smart views or unfinished nodes", () => {
  assert.match(workspace, /if \(!isAssignableCanvasAssetCollection\(collectionId\)\)/);
  assert.match(workspace, /const existing = \(await listUnifiedAssets\(canvasAssets\)\)\.find/);
  assert.match(workspace, /\[\.\.\.new Set\(\[\.\.\.currentCollectionIds, collectionId\]\)\]/);
  assert.match(drawer, /if \(!isAssignableCanvasAssetCollection\(collection\)\)/);
});

test("asset drawer makes new collection creation a clear primary action", () => {
  assert.match(drawer, /export default function CanvasAssetDrawer/);
  assert.match(drawer, /className="canvas-asset-new-collection" aria-label="新建资产合集"/);
  assert.match(drawer, /className="canvas-asset-new-collection-head"/);
  assert.match(drawer, />新建合集<\/b>/);
  assert.match(drawer, /创建后自动切换到新合集/);
  assert.match(drawer, /placeholder="输入合集名称，例如：灵感参考"/);
  assert.match(drawer, /disabled=\{!newCollectionName\.trim\(\)\}/);
  assert.match(assetStyles, /\.canvas-asset-new-collection\{display:grid;[^}]*border:1px solid color-mix/);
  assert.match(assetStyles, /\.canvas-asset-new-collection-form button\{[^}]*background:linear-gradient/);
});

test("asset drawer keeps the media preview primary across responsive layouts", () => {
  assert.match(styles, /\.canvas-asset-drawer\{[^}]*width:var\(--canvas-panel-width\)/);
  assert.match(assetStyles, /\.canvas-asset-drawer \.canvas-asset-kind\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
  assert.match(assetStyles, /\.canvas-asset-drawer \.canvas-asset-filters\{grid-template-columns:minmax\(0,1\.25fr\) repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(assetStyles, /\.canvas-asset-drawer \.canvas-global-asset-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px\}/);
  assert.match(assetStyles, /\.canvas-asset-drawer \.canvas-global-asset-card\{display:block\}/);
  assert.match(assetStyles, /\.canvas-asset-drawer \.canvas-global-asset-preview\{[^}]*aspect-ratio:4 \/ 3/);
  assert.match(assetStyles, /\.canvas-asset-drawer \.canvas-asset-new-collection\{display:grid;grid-template-columns:minmax\(0,.82fr\) minmax\(0,1\.18fr\)/);
  assert.match(assetStyles, /@media\(max-width:720px\)\{[\s\S]*?\.canvas-asset-drawer \.canvas-global-asset-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});

test("custom asset collections can be renamed even when legacy records omit builtin false", () => {
  assert.match(drawer, /export default function CanvasAssetDrawer/);
  assert.match(drawer, /disabled=\{collection === "all" \|\| !collections\.some\(\(item\) => item\.id === collection && item\.builtin !== true\)\}/);
  assert.match(drawer, /if \(!target \|\| target\.builtin\)/);
});

test("asset preview keeps its media stage in the preview domain stylesheet", () => {
  assert.match(previewStyles, /\.canvas-asset-preview-modal\{/);
  assert.match(previewStyles, /\.canvas-asset-preview-stage\{/);
  assert.match(previewStyles, /\.canvas-asset-preview-stage audio\{width:min\(620px,100%\)\}/);
  assert.match(styles, /\.canvas-asset-preview-backdrop\{/);
});
