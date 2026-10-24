import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const settings = createTsRequire(process.cwd())("./lib/canvas/depth-settings");

test("depth quality exposes low, medium, and high profiles in increasing resource tiers", () => {
  assert.deepEqual(
    settings.DEPTH_QUALITY_OPTIONS.map((option) => option.value),
    ["low", "medium", "high"],
  );
  assert.equal(settings.DEFAULT_DEPTH_QUALITY, "medium");
  assert.deepEqual(
    ["low", "medium", "high"].map((quality) => {
      const profile = settings.depthQualityProfile(quality);
      return [profile.inferenceSide, profile.exportSide, profile.frameQuality];
    }),
    [
      [512, 1280, 0.76],
      [768, 1600, 0.84],
      [1024, 1920, 0.9],
    ],
  );
});

test("depth quality falls back to the balanced profile for invalid persisted values", () => {
  assert.equal(settings.normalizeDepthQuality("low"), "low");
  assert.equal(settings.normalizeDepthQuality("high"), "high");
  assert.equal(settings.normalizeDepthQuality("unknown"), "medium");
  assert.equal(settings.normalizeDepthQuality(null), "medium");
  assert.equal(settings.depthQualityProfile("unknown").inferenceSide, 768);
});
