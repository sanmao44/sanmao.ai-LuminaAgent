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
