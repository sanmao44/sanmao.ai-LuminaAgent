import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../components/canvas/CanvasNodeCardContract.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const contract = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

function createProps(overrides = {}) {
  const node = { id: "node-1" };
  const nodes = [node];
  const document = { nodes, edges: [], groups: [] };
  const callback = () => {};
  return {
    node,
    selected: false,
    dragging: false,
    referencePickerActive: false,
    referencePickerTargetId: null,
    referencePickerHoverNodeId: null,
    referencePickerFlashNodeId: null,
    document,
    onPointerDown: callback,
    onResize: callback,
    onConnect: callback,
    onSelect: callback,
    onRemoveFromGroup: callback,
    onPreview: callback,
    onOpenVideoClip: callback,
    onOpenVideoEditor: callback,
    onOpenAngle: callback,
    onCancelAngle: callback,
    onTextPreview: callback,
    onLocalEdit: callback,
    onUseAsImagePrompt: callback,
    onRetryVariant: callback,
    onRetryFailedVariants: callback,
    onNaturalSize: callback,
    onPromptChange: callback,
    onEditorPromptChange: callback,
    onEditorParamsChange: callback,
    onVariantRequirementsChange: callback,
    runtime: null,
    editorPrompt: "",
    editorParams: undefined,
    expanded: false,
    onToggleEditor: callback,
    onGenerate: callback,
    onOneTake: callback,
    onReferenceReorder: callback,
    onReferenceRemove: callback,
    onReferenceDrop: callback,
    onAddReferenceFiles: callback,
    editorContexts: [],
    mentionCandidates: [],
    onOutputPreview: callback,
    editing: false,
    onEdit: callback,
    ...overrides,
  };
}

test("node card comparator accepts unchanged presentation props", () => {
  const props = createProps();
  assert.equal(contract.areCanvasNodeCardPropsEqual(props, props), true);
});

test("node card comparator invalidates when a Workspace callback changes", () => {
  const previous = createProps();
  const next = createProps({ onPreview: () => {} });
  assert.equal(contract.areCanvasNodeCardPropsEqual(previous, next), false);
});

test("node card comparator keeps camera-only document replacements stable", () => {
  const previous = createProps();
  const next = {
    ...previous,
    document: { ...previous.document, camera: { x: 100, y: 40, zoom: 1.2 } },
  };
  assert.equal(contract.areCanvasNodeCardPropsEqual(previous, next), true);
});
