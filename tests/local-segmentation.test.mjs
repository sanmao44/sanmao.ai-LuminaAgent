import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/local-segmentation.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const segmentation = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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
