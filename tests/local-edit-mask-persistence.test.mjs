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

test("restoring a legacy move mask unlocks its old protected destination", () => {
  const width = 20;
  const height = 10;
  const source = { kind: "rectangle", x: 0.1, y: 0.2, width: 0.2, height: 0.5 };
  const target = { kind: "rectangle", x: 0.6, y: 0.2, width: 0.2, height: 0.5 };
  const annotation = {
    id: "move-1",
    kind: "rectangle",
    description: "move object",
    geometry: target,
    move: { from: [source] },
    createdAt: 1,
  };
  const legacyMask = localEdit.rasterizeLocalEditAnnotations(width, height, [annotation]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 12; x < 16; x += 1) legacyMask[(y * width + x) * 4 + 3] = 255;
  }

  const legacyProtected = localEdit.recoverLocalEditProtectedPixels(legacyMask, width, height, [annotation], undefined, true);
  const currentProtected = localEdit.recoverLocalEditProtectedPixels(legacyMask, width, height, [annotation]);

  assert.equal(legacyProtected[4 * width + 13], 0, "legacy target protection is removed");
  assert.equal(currentProtected[4 * width + 13], 1, "new masks preserve explicit eraser protection");
  assert.equal(legacyProtected[4 * width + 4], 0, "the source remains editable");
});
