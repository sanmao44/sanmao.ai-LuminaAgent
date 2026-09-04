import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/local-segmentation.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const browserSource = await readFile(new URL("../lib/local-segmentation-browser.ts", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../components/MaskEditor.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const viewerSource = await readFile(new URL("../components/MediaViewer.tsx", import.meta.url), "utf8");
const canvasSource = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const segmentation = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("the free browser provider is cached, loaded on demand, and keeps model files out of the app bundle", () => {
  assert.match(browserSource, /const MODEL_ID = 'Xenova\/slimsam-77-uniform';/);
  assert.match(browserSource, /await import\('@huggingface\/transformers'\)/);
  assert.match(browserSource, /useBrowserCache = typeof caches !== 'undefined'/);
  assert.match(browserSource, /useWasmCache = typeof caches !== 'undefined'/);
  assert.match(browserSource, /cacheKey = MODEL_CACHE_NAME/);
  assert.match(browserSource, /registerLocalSegmentationProvider\(provider\)/);
  assert.match(browserSource, /async function clear\(\)/);
  assert.match(browserSource, /caches\.delete\(MODEL_CACHE_NAME\)/);
});

test("the shared local editor exposes smart selection at every image entry point", () => {
  assert.match(editorSource, /from '@\/lib\/local-segmentation-browser'/);
  assert.match(editorSource, /本地智能点选（SAM）/);
  assert.match(editorSource, /安装免费智能点选模型/);
  assert.match(editorSource, /请改用框选或画笔标记/);
  assert.match(pageSource, /LocalEditEditor/);
  assert.match(viewerSource, /onLocalEdit/);
  assert.match(canvasSource, /onLocalEdit/);
});

test("smart selection turns the selected subject into the transparent editable area", () => {
  assert.match(browserSource, /rgba\[offset \+ 3\] = selected \? 0 : 255;/);
  assert.match(browserSource, /selected subject must become transparent here/);
});

test("local segmentation is unavailable without an installed provider", async () => {
  segmentation.registerLocalSegmentationProvider(null);
  assert.equal(segmentation.localSegmentationStatus(), "unavailable");
  await assert.rejects(
    segmentation.segmentLocalSubject("data:image/png;base64,source", { x: 0.5, y: 0.5 }),
    /尚未安装/,
  );
});

test("local segmentation reports provider load failures without returning a partial result", async () => {
  segmentation.registerLocalSegmentationProvider({
    id: "broken",
    modelName: "broken-model",
    status: () => "loading",
    load: async () => { throw new Error("model download failed"); },
    segment: async () => ({ maskDataUrl: "data:image/png;base64,partial" }),
  });

  await assert.rejects(
    segmentation.segmentLocalSubject("data:image/png;base64,source", { x: 0.5, y: 0.5 }),
    /model download failed/,
  );
});

test("a ready local segmentation provider returns a complete subject mask", async () => {
  let status = "unavailable";
  let loadCount = 0;
  segmentation.registerLocalSegmentationProvider({
    id: "ready-on-demand",
    modelName: "cached-sam",
    status: () => status,
    load: async () => { loadCount += 1; status = "ready"; },
    segment: async (_image, point) => ({
      maskDataUrl: "data:image/png;base64,subject",
      bounds: { x: point.x - 0.1, y: point.y - 0.1, width: 0.2, height: 0.2 },
      label: "subject",
    }),
  });

  const result = await segmentation.segmentLocalSubject(
    "data:image/png;base64,source",
    { x: 0.6, y: 0.4 },
  );
  assert.equal(loadCount, 1);
  assert.equal(result.maskDataUrl, "data:image/png;base64,subject");
  assert.deepEqual(result.bounds, { x: 0.5, y: 0.30000000000000004, width: 0.2, height: 0.2 });
});
