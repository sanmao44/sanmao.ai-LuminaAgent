import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const layout = createTsRequire(process.cwd())("./lib/image-editor/outpaint-layout");

test("outpaint layout centers source and supplies the existing default padding", () => {
  assert.deepEqual(layout.centeredOutpaintLayout(100, 80, 300, 200), {
    sourceWidth: 100,
    sourceHeight: 80,
    canvasWidth: 300,
    canvasHeight: 200,
    offsetX: 100,
    offsetY: 60,
  });
  const defaultLayout = layout.defaultOutpaintLayout(100, 80);
  assert.equal(defaultLayout.canvasWidth >= 292, true);
  assert.equal(defaultLayout.canvasHeight >= 272, true);
});

test("model rules and validation preserve existing limits", () => {
  const rule = layout.outpaintRuleForModel({ rawId: "gpt-image-2", displayName: "GPT Image 2" });
  assert.equal(rule.maxEdge, 3840);
  assert.equal(rule.maxRatio, 3);
  const validation = layout.validateOutpaintLayout(layout.centeredOutpaintLayout(100, 100, 4000, 1000), rule);
  assert.equal(validation.valid, false);
  assert.match(validation.messages.join(" "), /长边不能超过/);
  assert.match(validation.messages.join(" "), /长短边比例不能超过/);
});

test("fitting keeps the source visible while snapping the canvas back into model bounds", () => {
  const rule = layout.outpaintRuleForModel({ displayName: "GPT Image 2" });
  const fitted = layout.fitOutpaintLayoutToRule(layout.centeredOutpaintLayout(1000, 800, 9000, 1000), rule);
  assert.equal(fitted.canvasWidth >= fitted.sourceWidth, true);
  assert.equal(fitted.canvasHeight >= fitted.sourceHeight, true);
  assert.equal(layout.validateOutpaintLayout(fitted, rule).valid, true);
});
