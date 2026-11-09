import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const keyboard = createTsRequire(process.cwd())("./components/canvas/agent-dock-keyboard");

const enterEvent = (overrides = {}) => ({
  key: "Enter",
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
  ...overrides,
});

test("Canvas Agent Dock does not submit Enter while a Chinese IME is composing", () => {
  assert.equal(keyboard.shouldSubmitCanvasAgentDockEnter(enterEvent({ isComposing: true })), false);
  assert.equal(keyboard.shouldSubmitCanvasAgentDockEnter(enterEvent({ keyCode: 229 })), false);
  assert.equal(keyboard.isCanvasAgentDockCompositionEvent({ isComposing: false, keyCode: 229 }), true);
});

test("Canvas Agent Dock keeps Enter send and Shift+Enter newline behavior", () => {
  assert.equal(keyboard.shouldSubmitCanvasAgentDockEnter(enterEvent()), true);
  assert.equal(keyboard.shouldSubmitCanvasAgentDockEnter(enterEvent({ shiftKey: true })), false);
  assert.equal(keyboard.shouldSubmitCanvasAgentDockEnter(enterEvent({ key: "Tab" })), false);
});
