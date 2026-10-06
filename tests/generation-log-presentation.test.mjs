import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const presentation = createTsRequire(process.cwd())("./lib/generation-log-presentation");
const imageLog = { mode: "generate", status: "success", prompt: "scene", imageCount: 2, outputSize: "2048x1024", aspectRatio: "2:1", source: "canvas" };

test("generation log presentation keeps media and source labels stable", () => {
  assert.equal(presentation.generationMediaKind({ taskKind: "llm", mode: "agent" }), "llm");
  assert.equal(presentation.generationMediaKind({ mode: "video" }), "video");
  assert.equal(presentation.generationMediaKind({ mode: "audio" }), "audio");
  assert.equal(presentation.generationLogSourceLabel(imageLog), "\u753b\u5e03\u751f\u6210");
  assert.equal(presentation.gallerySourceLabel("agent"), "\u52a9\u624b\u751f\u6210");
  assert.equal(presentation.gallerySourceLabel("unknown"), "\u76f4\u63a5\u751f\u6210");
  assert.equal(presentation.generationLogTitle({ mode: "generate", prompt: "  ## scene **test**  " }), "scene test");
});

test("ratio and output conversion remains independent from React", () => {
  assert.equal(presentation.exactRatioFromDimensions(1920, 1080), "16:9");
  assert.equal(presentation.ratioFromDimensions(1000, 500), "2:1");
  assert.deepEqual(presentation.outputDimensions("2048x1024"), { width: 2048, height: 1024 });
  assert.equal(presentation.sizeTierFromDimensions(2048, 1024), "2k");
  assert.deepEqual(presentation.presetDimensions("16:9", "2k"), { width: 2048, height: 1152 });
});

test("generation log metadata fallbacks stay deterministic", () => {
  assert.equal(presentation.logResolutionLabel(imageLog, undefined), "\u672a\u8bb0\u5f55");
  assert.equal(presentation.logOutputSizeLabel(imageLog, undefined), "2048x1024");
  assert.equal(presentation.logAspectRatioLabel(imageLog, undefined), "2:1");
  assert.equal(presentation.logDurationTone(5000), "fast");
  assert.equal(presentation.logDurationTone(45000), "slow");
});
