import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../components/canvas/trackpad-input.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const gestures = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("middle-button pan takes ownership before child pointer handlers", () => {
  const effects = [];
  const event = {
    button: 1,
    buttons: 4,
    preventDefault: () => effects.push("preventDefault"),
    stopPropagation: () => effects.push("stopPropagation"),
  };

  assert.equal(gestures.startCanvasMiddleButtonPan(event, () => {
    effects.push("pan");
    return true;
  }), true);
  assert.deepEqual(effects, ["pan", "preventDefault", "stopPropagation"]);
});

test("middle-button pan leaves non-middle and rejected overlay events alone", () => {
  let starts = 0;
  const event = { button: 0, buttons: 1, preventDefault() { throw new Error("unexpected preventDefault"); }, stopPropagation() { throw new Error("unexpected stopPropagation"); } };
  assert.equal(gestures.startCanvasMiddleButtonPan(event, () => { starts += 1; return true; }), false);
  assert.equal(gestures.startCanvasMiddleButtonPan({ ...event, button: 1 }, () => { starts += 1; return false; }), false);
  assert.equal(gestures.startCanvasMiddleButtonPan({ ...event, button: 0, buttons: 4, preventDefault() {}, stopPropagation() {} }, () => { starts += 1; return true; }), true);
  assert.equal(starts, 2);
});

test("pixel-based two-finger trackpad scrolling pans while mouse-wheel steps keep zoom", () => {
  assert.equal(gestures.shouldCanvasPanWithWheel(0, 0, 24), true);
  assert.equal(gestures.shouldCanvasPanWithWheel(0, -18, 120), true);
  assert.equal(gestures.shouldCanvasPanWithWheel(1, 0, 1), false);
  assert.equal(gestures.shouldCanvasPanWithWheel(0, 0, 100), false);
  assert.equal(gestures.shouldCanvasPanWithWheel(0, 0, 120), false);
  assert.equal(gestures.shouldCanvasPanWithWheel(0, 0, 0), false);
  assert.deepEqual(
    gestures.panCanvasCameraByWheel({ x: 50, y: 80, zoom: 2 }, -12, 24),
    { x: 62, y: 56, zoom: 2 },
  );
});

test("canvas consumes trackpad pan before browser navigation and forwards its delta", () => {
  const effects = [];
  let delta;
  const event = {
    deltaMode: 0,
    deltaX: -28,
    deltaY: 12,
    preventDefault: () => effects.push("preventDefault"),
    stopPropagation: () => effects.push("stopPropagation"),
  };
  assert.equal(
    gestures.handleCanvasTrackpadPanWheel(event, (x, y) => { delta = { x, y }; }),
    true,
  );
  assert.deepEqual(effects, ["preventDefault", "stopPropagation"]);
  assert.deepEqual(delta, { x: -28, y: 12 });
});

test("trackpad pinch scales continuously while a mouse wheel keeps its step", () => {
  assert.equal(gestures.trackpadPinchZoomFactor(-20), Math.exp(20 * 0.0032));
  assert.ok(gestures.trackpadPinchZoomFactor(-20) > Math.exp(20 * 0.0024));
  assert.ok(gestures.trackpadPinchZoomFactor(-20) > Math.exp(20 * 0.0014));
  assert.ok(gestures.mediaViewerWheelZoom(1, -20, true) > 1);
  assert.ok(gestures.mediaViewerWheelZoom(1, 20, true) < 1);
  assert.equal(gestures.mediaViewerWheelZoom(1, -120, false), 1.1);
  assert.equal(gestures.mediaViewerWheelZoom(1, 120, false), 0.9);
});

test("media viewer consumes native wheel gestures and zooms around the pointer", () => {
  const effects = [];
  let result;
  const event = {
    deltaY: -40,
    ctrlKey: true,
    metaKey: false,
    clientX: 120,
    clientY: 80,
    preventDefault: () => effects.push("preventDefault"),
    stopPropagation: () => effects.push("stopPropagation"),
  };
  gestures.handleMediaViewerWheel(event, 1, (zoom, focus) => { result = { zoom, focus }; });
  assert.deepEqual(effects, ["preventDefault", "stopPropagation"]);
  assert.ok(result.zoom > 1);
  assert.deepEqual(result.focus, { x: 120, y: 80 });
});

test("canvas gives modified wheel gestures to the image viewer when it is underneath", () => {
  assert.equal(gestures.shouldCanvasInterceptModifiedWheel(true, false), true);
  assert.equal(gestures.shouldCanvasInterceptModifiedWheel(true, true), false);
  assert.equal(gestures.shouldCanvasInterceptModifiedWheel(false, false), false);
});
