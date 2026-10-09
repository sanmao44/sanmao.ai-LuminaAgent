import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/depth-fallback.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const fallback = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("fallback depth pixels produce opaque contrast-preserving grayscale", () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 12,
    0, 255, 0, 24,
    0, 0, 255, 48,
  ]);
  const result = fallback.applyFallbackDepthPixels(pixels);
  assert.deepEqual([...result], [67, 67, 67, 255, 154, 154, 154, 255, 11, 11, 11, 255]);
});
