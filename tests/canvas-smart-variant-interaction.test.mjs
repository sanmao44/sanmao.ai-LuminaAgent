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
