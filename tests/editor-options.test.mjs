import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const options = createTsRequire(process.cwd())("./lib/image-editor/editor-options");

test("image editor options keep the shared quality, scale, and cloud format contracts", () => {
  assert.deepEqual(options.upscaleScales, [1, 2, 3, 4]);
  assert.deepEqual(options.cloudUpscaleFormatOptions.map((item) => item.value), ["png", "jpg", "bmp"]);
  assert.equal(options.qualityOptions.length > 0, true);
  assert.equal(options.isCloudUpscaleModel({ provider: "tencent-ci" }), true);
  assert.equal(options.isCloudUpscaleModel({ provider: "aliyun-viapi" }), true);
  assert.equal(options.isCloudUpscaleModel({ provider: "local" }), false);
});
