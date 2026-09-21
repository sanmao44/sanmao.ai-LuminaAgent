import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");

test("smart variant portal isolates native control events from canvas gestures", () => {
  const portal = source.slice(source.indexOf('{smartVariantOpen && createPortal('), source.indexOf('<CanvasMinimap'));
  for (const event of ["PointerDown", "PointerMove", "PointerUp", "Click", "DoubleClick", "Wheel"]) {
    assert.ok(portal.includes(`on${event}={(event) => event.stopPropagation()}`));
  }
  assert.ok(source.includes("if (!event.currentTarget.contains(event.target as Node)) return;"));
  assert.ok(portal.includes("smartVariantSession.current?.sources.map"));
  assert.ok(portal.includes("<article key={index}>"));
});

test("smart variant apply uses the session target instead of current selection", () => {
  const apply = source.slice(source.indexOf("const applySmartVariant ="), source.indexOf("const groupQuickActions ="));
  assert.ok(apply.includes('smartVariantSession.current?.nodeId'));
  assert.ok(apply.includes("node.id !== target.id"));
  assert.ok(!apply.includes("selectedSingle"));
});

test("smart variant planning locks one output to each source unit and retries invalid mappings", () => {
  const planning = source.slice(source.indexOf("function smartVariantPlanningPrompt"), source.indexOf("function variantStatesFor"));
  const open = source.slice(source.indexOf("const openSmartVariant ="), source.indexOf("const applySmartVariant ="));
  assert.ok(planning.includes("每个 sourceId 恰好生成一条变体"));
  assert.ok(planning.includes("禁止拆分一段为多条、合并多段为一条、遗漏或编造段落"));
  assert.ok(planning.includes("variants.length !== sourceUnits.length"));
  assert.ok(planning.includes("new Set(sourceIds).size !== sourceUnits.length"));
  assert.ok(open.includes('source.id !== "shared-prompt"'));
  assert.ok(open.includes("smartVariantPlanningPrompt(sourceUnits, sharedPrompt, repairReason)"));
});

test("smart variant analysis has a bounded, cancellable request path", () => {
  const open = source.slice(source.indexOf("const cancelSmartVariant ="), source.indexOf("const applySmartVariant ="));
  const portal = source.slice(source.indexOf('{smartVariantOpen && createPortal('), source.indexOf('<CanvasMinimap'));
  assert.ok(source.includes("const SMART_VARIANT_MAX_WAIT_MS = 75_000"));
  assert.ok(open.includes("const controller = new AbortController()"));
  assert.ok(open.includes("window.setTimeout"));
  assert.ok(open.includes("generateCanvasAgent({"));
  assert.ok(open.includes("signal: controller.signal"));
  assert.ok(portal.includes("停止分析"));
  assert.ok(portal.includes("closeSmartVariant"));
});

test("image variants anchor the first reference subject while allowing an explicit opt-out", () => {
  assert.ok(source.includes("function variantIdentityAnchorPrompt"));
  assert.ok(source.includes("参考图 1「${primaryName}」是主体身份锚点"));
  assert.ok(source.includes("禁止换脸、换人、改变性别/年龄、身体比例漂移或重设计服装"));
  assert.ok(source.includes("variantIdentityPreservation !== false"));
  assert.ok(source.includes("保持首图主体"));
  assert.ok(source.includes("首图主体锚定"));
});
