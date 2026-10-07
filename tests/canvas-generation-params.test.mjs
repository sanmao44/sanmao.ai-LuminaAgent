import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/generation-params.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source
  .replace('import { clone } from "./model";', 'const clone = (value) => JSON.parse(JSON.stringify(value));')
  .replace('import type { CanvasRuntimeState, CanvasGenerationParams } from "./types";', '')
  .replace(
    /import \{[\s\S]*?\} from "\.\.\/creation\/settings";/,
    `const readSharedCreationSettings = (kind, runtime) => ({ kind, runtime, source: "shared" });
const normalizeCreationSettings = (kind, value, runtime) => ({ kind, value, runtime, source: "normalized" });`,
  ), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const params = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("reads shared defaults through the existing settings boundary", () => {
  const runtime = { models: [] };
  assert.deepEqual(params.defaultCanvasGenerationParams("image", runtime), {
    kind: "image",
    runtime,
    source: "shared",
  });
});

test("copies and normalizes supplied params without mutating the input", () => {
  const input = { kind: "image", nested: { count: 2 } };
  const runtime = { models: [] };
  const result = params.copyCanvasGenerationParams(input, "image", runtime);

  assert.deepEqual(result, {
    kind: "image",
    value: input,
    runtime,
    source: "normalized",
  });
  assert.notEqual(result.value, input);
  assert.notEqual(result.value.nested, input.nested);
  result.value.nested.count = 9;
  assert.equal(input.nested.count, 2);
});

test("falls back to shared defaults when supplied params are not objects", () => {
  const result = params.copyCanvasGenerationParams(null, "video", null);
  assert.deepEqual(result, {
    kind: "video",
    runtime: null,
    source: "normalized",
    value: { kind: "video", runtime: null, source: "shared" },
  });
});

test("adds generation defaults only for media kinds with generation settings", () => {
  const runtime = { models: [] };
  assert.deepEqual(params.defaultMediaParams("audio", runtime), {});
  assert.deepEqual(params.defaultMediaParams("image", runtime), {
    params: { kind: "image", runtime, source: "shared" },
  });
});
