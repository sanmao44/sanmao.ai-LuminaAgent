import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/canvas.css", import.meta.url), "utf8");
const globalCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const maskEditor = await readFile(
  new URL("../components/MaskEditor.tsx", import.meta.url),
  "utf8",
);

test("super canvas uses a neutral cursor until pan is intentional", () => {
  assert.match(css, /\.canvas-stage\{[^}]*cursor:default/);
  assert.match(css, /\.canvas-stage\.is-pan-ready\{[^}]*cursor:grab/);
  assert.match(css, /\.canvas-stage\.is-panning\{[^}]*cursor:grabbing/);
  assert.match(css, /\.canvas-stage\.is-panning \.canvas-node,\.canvas-stage\.is-panning \.canvas-group\{[^}]*cursor:grabbing/);
  assert.doesNotMatch(css, /\.canvas-stage\{[^}]*cursor:grab/);
  assert.doesNotMatch(css, /\.canvas-stage:active\{[^}]*cursor:grabbing/);
  assert.match(css, /\.canvas-node\.dragging\{[^}]*cursor:grabbing/);
  assert.match(css, /\.canvas-group\.dragging\{[^}]*cursor:grabbing/);
  assert.doesNotMatch(css, /\.canvas-node:active\{[^}]*cursor:grabbing/);
});

test("space-pan cursor state follows the keyboard lifecycle", () => {
  assert.match(component, /const \[panReady, setPanReady\] = useState\(false\)/);
  assert.match(component, /spaceHeldRef\.current = true;\s*setPanReady\(true\)/);
  assert.match(component, /spaceHeldRef\.current = false;\s*setPanReady\(false\)/);
  assert.match(component, /className=\{`canvas-stage \$\{panReady \? "is-pan-ready" : ""\} \$\{panActive \? "is-panning" : ""\}/);
  assert.match(component, /className=\{`canvas-node node-color-\$\{colorKey\} status-\$\{status\}[^`]*\$\{dragging \? "dragging" : ""\}/);
  assert.match(component, /className=\{`canvas-group[^`]*selectedGroupId === group\.id && draggingNodeIds\.size > 0 \? "dragging" : ""/);
});

test("canvas shows a non-interactive middle-button pan affordance", () => {
  assert.doesNotMatch(component, /canvas-middle-pan-hint/);
  assert.match(maskEditor, /className="local-edit-pan-hint"/);
  assert.match(maskEditor, /aria-label="按住鼠标中键拖动画布"/);
  assert.match(maskEditor, /className="local-edit-pan-mouse"/);
  assert.match(maskEditor, /className="wheel"/);
  assert.match(globalCss, /\.local-edit-pan-hint\{[^}]*pointer-events:none/);
  assert.match(globalCss, /\.local-edit-pan-hint\.active\{[^}]*box-shadow/);
  assert.match(globalCss, /@media\(max-width:760px\)/);
  assert.match(globalCss, /\.local-edit-pan-hint\{flex:1 1 150px/);
});

test("canvas cursor follows the active pointer task", () => {
  assert.match(component, /type CanvasCursorTask =/);
  assert.match(component, /const \[cursorTask, setCursorTask\] = useState<CanvasCursorTask>\("idle"\)/);
  assert.match(component, /setCursorTask\("selecting"\)/);
  assert.match(component, /setCursorTask\("connecting"\)/);
  assert.match(component, /setCursorTask\("resizing"\)/);
  assert.match(component, /setCursorTask\("dragging"\)/);
  assert.match(component, /setCursorTask\("copying"\)/);
  assert.match(component, /data-canvas-cursor-task=\{cursorTask\}/);
  assert.match(css, /\.canvas-stage\.is-cursor-selecting,\.canvas-stage\.is-cursor-selecting \*\{cursor:crosshair!important\}/);
  assert.match(css, /\.canvas-stage\.is-cursor-connecting,\.canvas-stage\.is-cursor-connecting \*\{cursor:crosshair!important\}/);
  assert.match(css, /\.canvas-stage\.is-cursor-resizing,\.canvas-stage\.is-cursor-resizing \*\{cursor:nwse-resize!important\}/);
  assert.match(css, /\.canvas-stage\.is-cursor-dragging,\.canvas-stage\.is-cursor-dragging \*\{cursor:grabbing!important\}/);
  assert.match(css, /\.canvas-stage\.is-cursor-copying,\.canvas-stage\.is-cursor-copying \*\{cursor:copy!important\}/);
});

test("canvas text controls expose the text editing cursor", () => {
  assert.match(css, /\.canvas-stage textarea,\.canvas-stage \[contenteditable="true"\],\.canvas-text-lightbox-body\{cursor:text\}/);
  assert.match(css, /\.canvas-stage input:not\(\[type="button"\]\).*\{cursor:text\}/);
  assert.match(css, /\.canvas-stage \.canvas-port\{cursor:crosshair\}/);
});
