import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/local-edit.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const runtime = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const localEdit = await import(`data:text/javascript;base64,${Buffer.from(runtime).toString("base64")}`);

test("restoring annotations retains pixels protected by the eraser", () => {
  const width = 12;
  const height = 10;
  const annotation = {
    id: "region-1",
    kind: "rectangle",
    description: "remove selected object",
    geometry: { kind: "rectangle", x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
    createdAt: 1,
  };
  const persisted = localEdit.rasterizeLocalEditAnnotations(width, height, [annotation]);
  const erasedPixel = (4 * width + 4) * 4 + 3;
  persisted[erasedPixel] = 255;

  const protectedPixels = localEdit.recoverLocalEditProtectedPixels(
    persisted,
    width,
    height,
    [annotation],
  );
  const restored = localEdit.rasterizeLocalEditAnnotations(width, height, [annotation]);
  localEdit.applyLocalEditProtectionMask(restored, protectedPixels);

  assert.equal(protectedPixels[4 * width + 4], 1);
  assert.equal(protectedPixels[4 * width + 5], 0);
  assert.deepEqual([...restored], [...persisted]);
});
