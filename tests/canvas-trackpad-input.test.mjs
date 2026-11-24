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

class WheelTarget {
  constructor(selectors = []) {
    this.selectors = selectors;
  }
  closest(selector) {
    return this.selectors.includes(selector) ? this : null;
  }
}

globalThis.Element = WheelTarget;

class CanvasDocument extends EventTarget {
  registrations = [];
  removals = [];
  addEventListener(type, listener, options) {
    this.registrations.push({ type, listener, options });
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.removals.push({ type, listener, options });
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const registration = this.registrations.find((item) =>
      item.type === type && item.listener === listener &&
      (typeof item.options === "boolean" ? item.options : Boolean(item.options?.capture)) === capture,
    );
    super.removeEventListener(type, listener, registration?.options ?? options);
  }
}

function pinchWheel(target, overrides = {}) {
  const event = new Event("wheel", { cancelable: true, bubbles: true });
  Object.assign(event, { ctrlKey: true, metaKey: false, deltaY: -24, clientX: 420, clientY: 280 }, overrides);
  Object.defineProperty(event, "target", { value: target });
  return event;
}

test("canvas pinch listener cancels page zoom across stage, controls and body portals exactly once", (t) => {
  const document = new CanvasDocument();
  const zooms = [];
  const unbind = gestures.bindCanvasPinchZoom(document, (...args) => zooms.push(args));
  t.after(unbind);

  for (const selectors of [[], ["textarea"], [".canvas-node-editor-popover"], [".canvas-topbar"], [".select-menu-popover"]]) {
    const before = zooms.length;
    const event = pinchWheel(new WheelTarget(selectors));
    assert.equal(document.dispatchEvent(event), false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.cancelBubble, true);
    assert.equal(zooms.length, before + 1);
    assert.deepEqual(zooms.at(-1), [420, 280, Math.exp(24 * 0.0032)]);
  }
  const event = pinchWheel(new WheelTarget(), { ctrlKey: false, metaKey: true, deltaY: 24 });
  document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.ok(zooms.at(-1)[2] < 1);
});

test("canvas pinch listener preserves normal scrolling in controls and menus", (t) => {
  const document = new CanvasDocument();
  const unbind = gestures.bindCanvasPinchZoom(document, () => assert.fail("ordinary scroll must not pinch zoom"));
  t.after(unbind);
  for (const deltaY of [24, 120]) {
    const event = pinchWheel(new WheelTarget(["textarea", ".select-menu-popover"]), { ctrlKey: false, deltaY });
    assert.equal(document.dispatchEvent(event), true);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.cancelBubble, false);
  }
});

test("media preview keeps its own pinch while preview controls do not zoom the background", (t) => {
  const document = new CanvasDocument();
  const unbind = gestures.bindCanvasPinchZoom(document, () => assert.fail("preview must not zoom canvas"));
  t.after(unbind);
  const stageEvent = pinchWheel(new WheelTarget([".media-viewer-stage", ".canvas-modal-backdrop"]));
  assert.equal(document.dispatchEvent(stageEvent), true);
  assert.equal(stageEvent.defaultPrevented, false);
  assert.equal(stageEvent.cancelBubble, false);

  const headerEvent = pinchWheel(new WheelTarget([".canvas-modal-backdrop"]));
  assert.equal(document.dispatchEvent(headerEvent), false);
  assert.equal(headerEvent.defaultPrevented, true);
  assert.equal(headerEvent.cancelBubble, false);
});

test("modal workbenches retain their own gestures without zooming the canvas behind them", (t) => {
  const document = new CanvasDocument();
  const unbind = gestures.bindCanvasPinchZoom(document, () => assert.fail("modal must not zoom canvas"));
  t.after(unbind);
  for (const stage of [".canvas-spherical-stage", ".video-editor-preview", ".video-editor-timeline"]) {
    const event = pinchWheel(new WheelTarget([stage, ".canvas-modal-backdrop"]));
    document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.cancelBubble, false, "local gesture handler must still receive the event");
  }
});

test("canvas pinch registers a cancellable capture listener and removes it on exit", (t) => {
  const document = new CanvasDocument();
  let zooms = 0;
  const unbind = gestures.bindCanvasPinchZoom(document, () => zooms++);
  const registration = document.registrations[0];
  assert.equal(registration.type, "wheel");
  assert.deepEqual(registration.options, { capture: true, passive: false });
  document.dispatchEvent(pinchWheel(new WheelTarget()));
  assert.equal(zooms, 1);
  unbind();
  assert.equal(document.removals[0].listener, registration.listener);
  assert.equal(document.removals[0].options, true);
  const afterExit = pinchWheel(new WheelTarget());
  document.dispatchEvent(afterExit);
  assert.equal(zooms, 1);
  assert.equal(afterExit.defaultPrevented, false);
});
