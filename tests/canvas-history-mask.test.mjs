import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/history-mask.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const masks = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("converts a canvas mask to the history contract and clamps feather", () => {
  const annotations = [{ type: "brush", x: 1, y: 2 }];
  const result = masks.canvasHistoryMask({
    url: "data:image/png;base64,mask",
    feather: 99.4,
    annotations,
  });

  assert.deepEqual(result, {
    dataUrl: "data:image/png;base64,mask",
    feather: 48,
    annotations,
  });
});

test("normalizes invalid feather values and omits empty annotations", () => {
  assert.deepEqual(masks.canvasHistoryMask({ url: "/mask.png", feather: "bad", annotations: [] }), {
    dataUrl: "/mask.png",
    feather: 0,
  });
  assert.deepEqual(masks.canvasHistoryMask({ url: "/mask.png", feather: -4 }), {
    dataUrl: "/mask.png",
    feather: 0,
  });
});

test("returns no history mask when the source URL is missing", () => {
  assert.equal(masks.canvasHistoryMask(undefined), undefined);
  assert.equal(masks.canvasHistoryMask({ url: "" }), undefined);
});
