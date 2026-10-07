import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const interactionTargets = createTsRequire(process.cwd())("./lib/canvas/interaction-targets");

class FakeElement {
  constructor(matches = new Set(), dataset = {}) {
    this.matches = matches;
    this.dataset = dataset;
    this.parentElement = null;
  }

  closest(selector) {
    return selector.split(",").some((item) => this.matches.has(item.trim())) ? this : null;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;
globalThis.document = { body: null };
globalThis.window = { getComputedStyle: () => ({ overflowY: "visible", overflowX: "visible" }) };

test("canvas interaction targets resolve connection ids and editable controls", () => {
  const connectable = new FakeElement(new Set(["[data-canvas-connectable-id]"]), { canvasConnectableId: "node-1" });
  const editable = new FakeElement(new Set(["input"]));
  assert.equal(interactionTargets.canvasConnectableId(connectable), "node-1");
  assert.equal(interactionTargets.isEditableTarget(editable), true);
  assert.equal(interactionTargets.isEditableTarget(new FakeElement()), false);
});

test("canvas wheel isolation preserves node and overlay rules", () => {
  const node = new FakeElement(new Set([".canvas-node"]));
  const overlay = new FakeElement(new Set([".canvas-agent-dock"]));
  assert.equal(interactionTargets.isCanvasWheelIsolatedTarget(node), true);
  assert.equal(interactionTargets.isCanvasWheelIsolatedTargetWithOptions(node, true), false);
  assert.equal(interactionTargets.isCanvasWheelIsolatedTargetWithOptions(overlay, true), true);
  assert.match(interactionTargets.CANVAS_CREATE_MENU_INTERACTIVE_SELECTOR, /canvas-node-editor/);
});
