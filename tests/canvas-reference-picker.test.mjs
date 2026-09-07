import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const component = (await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");
const draftStrip = (await readFile(new URL("../components/CanvasReferenceDraftStrip.tsx", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");
const styles = (await readFile(new URL("../app/canvas.css", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");
const cursorStyles = (await readFile(new URL("../app/cursor.css", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");

test("reference picker supports connected targets and draft references", () => {
  assert.match(component, /type CanvasReferencePicker = \{[\s\S]*mode: "connected" \| "draft"/);
  assert.match(component, /const beginReferencePicker = useCallback/);
  assert.match(component, /const pickReferenceNode = useCallback/);
  assert.match(component, /connectCanvasNodes\([\s\S]*picker\.role/);
  assert.match(component, /addReferenceDrafts\(current\.references, \[reference\]\)/);
});

test("canvas node pointer handling prioritizes reference picking over dragging", () => {
  const start = component.indexOf("const startNodeDrag = useCallback");
  const end = component.indexOf("const startGroupDrag = useCallback", start);
  assert.ok(start >= 0 && end > start, "node drag handler should be present");
  const handler = component.slice(start, end);
  assert.match(handler, /if \(referencePicker\) \{[\s\S]*pickReferenceNode\(node\)/);
  assert.match(component, /if \(referencePicker && !panIntent && event\.button === 0 && overCanvasContent\)/);
  assert.match(component, /if \(referencePickerActive\) return;/);
});

test("reference picking keeps blank-canvas panning and restores the picker cursor", () => {
  const finishStart = component.indexOf("const finishInteraction = useCallback");
  const cancelStart = component.indexOf("const cancelPointerInteraction = useCallback");
  const cancelEnd = component.indexOf("useEffect(() => {", cancelStart);
  assert.ok(finishStart >= 0, "finish interaction handler should be present");
  assert.ok(cancelStart > finishStart && cancelEnd > cancelStart, "cancel interaction handler should be present");

  const interactionHandlers = component.slice(finishStart, cancelEnd);
  assert.match(
    component,
    /if \(referencePicker && !panIntent && event\.button === 0 && overCanvasContent\) \{[\s\S]*event\.preventDefault\(\);[\s\S]*return;/,
  );
  assert.match(component, /if \(interactionRef\.current\?\.kind === "pan"\) moveInteraction\(event\);/);
  assert.match(component, /clearSelectionOnClick:[\s\S]*!referencePicker,/);
  assert.match(interactionHandlers, /setCursorTask\(referencePicker \? "referencing" : "idle"\);/);
});

test("reference controls expose canvas picking while keeping file upload available", () => {
  assert.match(draftStrip, /onPickFromCanvas\?: \(\) => void/);
  assert.match(draftStrip, /⌁ 画布点选/);
  assert.match(draftStrip, /onClick=\{\(\) => inputRef\.current\?\.click\(\)\}/);
  assert.match(component, /onPickFromCanvas\?: \(role\?: CanvasInputRole\) => void/);
  assert.match(component, /onPickFromCanvas=\{onPickFromCanvas\}/);
  assert.match(component, /从画布选择参考素材/);
  assert.match(component, /上传参考素材/);
});

test("picker feedback includes cancel, hover/flash styling, and the referencing cursor", () => {
  assert.match(component, /canvas-reference-picker-banner/);
  assert.match(component, /cancelReferencePicker\(\)/);
  assert.match(styles, /reference-picker-target/);
  assert.match(styles, /reference-picker-hover/);
  assert.match(styles, /reference-picker-flash/);
  assert.match(cursorStyles, /is-cursor-referencing/);
});

test("video frame slots forward their explicit first/last-frame roles", () => {
  assert.match(component, /onPickFromCanvas\?\.\(slotRole\)/);
  assert.match(component, /onPickFromCanvas=\{\(role\) => beginReferencePicker\(/);
  assert.match(component, /role,\n\s*\)\}/);
});
