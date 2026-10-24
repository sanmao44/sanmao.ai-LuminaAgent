import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function compileTypeScript(path, transform = (source) => source) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = transform(await readFile(sourceUrl, "utf8"));
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
}

const localEditRuntime = (await compileTypeScript("../lib/local-edit.ts")).replace(/\bexport\s+/g, "");
const historyRuntime = await compileTypeScript("../lib/local-edit-history.ts", (source) => source.replace(
  /^import \{ normalizeLocalEditAnnotations, type LocalEditAnnotation \} from '\.\/local-edit';?\s*$/m,
  localEditRuntime,
));
const history = await import(`data:text/javascript;base64,${Buffer.from(historyRuntime).toString("base64")}`);

function annotation(description) {
  return {
    id: "region-1",
    kind: "rectangle",
    description,
    geometry: { kind: "rectangle", x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    createdAt: 1,
  };
}

function makeSnapshot(description, baseMask, protectedPixels, smartPixels) {
  return history.createLocalEditHistorySnapshot({
    baseMask,
    annotations: [annotation(description)],
    protectedPixels,
    smartMasks: new Map([["region-1", smartPixels]]),
  });
}

test("history snapshots share immutable raster buffers and isolate annotation metadata", () => {
  const baseMask = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
  const protectedPixels = new Uint8Array(2);
  const smartPixels = new Uint8ClampedArray(8);
  const sourceAnnotation = annotation("before");
  const snapshot = history.createLocalEditHistorySnapshot({
    baseMask,
    annotations: [sourceAnnotation],
    protectedPixels,
    smartMasks: new Map([["region-1", smartPixels]]),
  });

  sourceAnnotation.geometry.x = 0.9;

  assert.strictEqual(snapshot.baseMask, baseMask);
  assert.strictEqual(snapshot.protectedPixels, protectedPixels);
  assert.strictEqual(snapshot.smartMasks.get("region-1"), smartPixels);
  assert.notStrictEqual(snapshot.annotations[0], sourceAnnotation);
  assert.notStrictEqual(snapshot.annotations[0].geometry, sourceAnnotation.geometry);
  assert.equal(snapshot.annotations[0].geometry.x, 0.1);
});

test("history supports no-op detection, undo, redo, branches, and the existing 21-state limit", () => {
  const baseMask = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  const protectedPixels = new Uint8Array(1);
  const smartPixels = new Uint8ClampedArray(4);
  const initial = makeSnapshot("initial", baseMask, protectedPixels, smartPixels);
  const edited = makeSnapshot("edited", baseMask, protectedPixels, smartPixels);
  const historyState = new history.LocalEditHistory();

  historyState.reset(initial);
  assert.equal(historyState.push(makeSnapshot("initial", baseMask, protectedPixels, smartPixels)), false);
  assert.equal(historyState.push(edited), true);
  assert.equal(historyState.index, 1);
  assert.equal(historyState.moveTo(0).annotations[0].description, "initial");
  assert.equal(historyState.moveTo(1).annotations[0].description, "edited");

  historyState.moveTo(0);
  assert.equal(historyState.push(makeSnapshot("branch", baseMask, protectedPixels, smartPixels)), true);
  assert.equal(historyState.length, 2);
  assert.equal(historyState.moveTo(2), null);

  for (let index = 0; index < 25; index += 1) {
    historyState.push(makeSnapshot(`state-${index}`, baseMask, protectedPixels, smartPixels));
  }
  assert.equal(historyState.length, history.LOCAL_EDIT_HISTORY_LIMIT);
  assert.equal(historyState.index, history.LOCAL_EDIT_HISTORY_LIMIT - 1);
  assert.equal(historyState.moveTo(historyState.index - 1).annotations[0].description, "state-23");
});

test("history treats raster buffers as immutable identities instead of rescanning equal pixel arrays", () => {
  const baseMask = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  const protectedPixels = new Uint8Array(1);
  const smartPixels = new Uint8ClampedArray(4);
  const initial = makeSnapshot("initial", baseMask, protectedPixels, smartPixels);
  const historyState = new history.LocalEditHistory();

  historyState.reset(initial);
  assert.equal(historyState.push(makeSnapshot("initial", baseMask, protectedPixels, smartPixels)), false);
  assert.equal(historyState.push(makeSnapshot("initial", {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(baseMask.data),
  }, protectedPixels, smartPixels)), true);
  assert.equal(historyState.length, 2);
});

test("history shortcuts defer to text editing targets and resolve undo and redo outside them", () => {
  const keyboardEvent = (overrides = {}) => ({
    key: "z",
    code: "KeyZ",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  });
  const target = ({tagName, type, role, isContentEditable = false} = {}) => ({
    tagName,
    type,
    isContentEditable,
    getAttribute(name) {
      if (name === "role") return role ?? null;
      if (name === "type") return type ?? null;
      return null;
    },
  });

  for (const editingTarget of [
    target({tagName: "TEXTAREA"}),
    target({tagName: "INPUT", type: "text"}),
    target({role: "textbox"}),
    target({isContentEditable: true}),
  ]) {
    assert.equal(history.resolveLocalEditHistoryShortcut(keyboardEvent(), editingTarget), null);
  }

  assert.equal(history.resolveLocalEditHistoryShortcut(keyboardEvent(), target({tagName: "CANVAS"})), "undo");
  assert.equal(history.resolveLocalEditHistoryShortcut(keyboardEvent({shiftKey: true}), null), "redo");
  assert.equal(history.resolveLocalEditHistoryShortcut(keyboardEvent({key: "y", code: "KeyY"}), null), "redo");
  assert.equal(history.resolveLocalEditHistoryShortcut(keyboardEvent({metaKey: true, ctrlKey: false}), null), "undo");
  assert.equal(history.resolveLocalEditHistoryShortcut(keyboardEvent({repeat: true}), null), null);
  assert.equal(history.resolveLocalEditHistoryShortcut(keyboardEvent({ctrlKey: false}), null), null);
  assert.equal(history.isLocalEditTextEditingTarget(target({tagName: "INPUT", type: "range"})), false);
});
