import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/video-capabilities.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source
  .replace('import type { CanvasRuntimeState } from "./types";', '')
  .replace('import type { CanvasVideoInputCapabilities } from "./references";', '')
  .replace(
    /import \{\n  resolveAvailableCreationModel,\n  type VideoCreationSettings,\n\} from "\.\.\/creation\/settings";/,
    `const resolveAvailableCreationModel = (settings, runtime) => ({
  model: runtime?.models?.find((model) => model.id === settings.model) || null,
});`,
  ), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const capabilities = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("projects model capability names into the canvas input contract", () => {
  const runtime = {
    models: [{
      id: "video-model",
      capabilities: ["video-generate", "video-audio"],
    }],
  };
  const result = capabilities.canvasVideoInputCapabilities(
    { kind: "video", model: "video-model" },
    runtime,
  );

  assert.equal(result.supportsReference, true);
  assert.equal(result.supportsFirstFrame, true);
  assert.equal(result.supportsFrames, true);
  assert.equal(result.supportsAudio, true);
  assert.equal(result.model.id, "video-model");
});

test("keeps unsupported optional capabilities disabled", () => {
  const runtime = {
    models: [{ id: "text-only-video", capabilities: ["video-reference"] }],
  };
  const result = capabilities.canvasVideoInputCapabilities(
    { kind: "video", model: "text-only-video" },
    runtime,
  );

  assert.equal(result.supportsReference, true);
  assert.equal(result.supportsFirstFrame, false);
  assert.equal(result.supportsFrames, false);
  assert.equal(result.supportsAudio, false);
});

test("treats an unavailable model as capability-neutral", () => {
  const result = capabilities.canvasVideoInputCapabilities(
    { kind: "video", model: "missing" },
    { models: [] },
  );

  assert.equal(result.model, null);
  assert.equal(result.supportsReference, true);
  assert.equal(result.supportsFirstFrame, true);
  assert.equal(result.supportsFrames, true);
  assert.equal(result.supportsAudio, true);
});
