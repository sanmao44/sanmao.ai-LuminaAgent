import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const loadCanvas = createTsRequire(new URL("../lib/canvas", import.meta.url).pathname);
const loadCanvasCore = createTsRequire(new URL("../packages/canvas-core", import.meta.url).pathname);
const { canvasGroupShortcutAction, canvasGroupShortcutTarget } = loadCanvas("./group-shortcut.ts");
const { CanvasCore } = loadCanvasCore("./runtime.ts");

function makeCore() {
  return new CanvasCore({
    version: "test",
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [],
    groups: [
      { id: "group-1", nodeIds: ["a", "b"] },
      { id: "group-2", nodeIds: ["c"] },
    ],
    camera: { x: 0, y: 0, zoom: 1 },
  });
}

test("Ctrl+Shift+G maps the physical G key and runs once per press", () => {
  assert.equal(canvasGroupShortcutAction({ key: "G", code: "KeyG", ctrlKey: true, metaKey: false, shiftKey: true, repeat: false }), "ungroup");
  assert.equal(canvasGroupShortcutAction({ key: "ğ", code: "KeyG", ctrlKey: true, metaKey: false, shiftKey: true, repeat: false }), "ungroup");
  assert.equal(canvasGroupShortcutAction({ key: "g", code: "KeyG", ctrlKey: true, metaKey: false, shiftKey: false, repeat: false }), "group");
  assert.equal(canvasGroupShortcutAction({ key: "g", code: "KeyG", ctrlKey: true, metaKey: false, shiftKey: true, repeat: true }), null);
  assert.equal(canvasGroupShortcutAction({ key: "g", code: "KeyG", ctrlKey: false, metaKey: false, shiftKey: true, repeat: false }), null);
});

test("ungroup target reads the current CanvasCore selection", () => {
  const core = makeCore();
  core.setSelection({ nodeIds: ["a", "b"] });
  assert.equal(canvasGroupShortcutTarget(core.document(), core.selection()), "group-1");

  core.setSelection({ nodeIds: ["a", "c"] });
  assert.equal(canvasGroupShortcutTarget(core.document(), core.selection()), null);

  core.setSelection({ nodeIds: ["c"], groupId: "group-2" });
  assert.equal(canvasGroupShortcutTarget(core.document(), core.selection()), "group-2");
});
