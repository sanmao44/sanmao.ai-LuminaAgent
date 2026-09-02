import type { CanvasDocument, CanvasNode } from "./types";

/**
 * The canvas has two separate stacking systems:
 *
 * 1. These constants order screen-space UI and the world itself.
 * 2. CanvasNode.zIndex orders nodes inside the transformed world context.
 *
 * Keep the gaps intentional so a new layer can be inserted without another
 * round of magic-number overrides.
 */
export const CANVAS_Z_INDEX = {
  grid: 0,
  world: 1,
  edge: 10,
  group: 20,
  node: 30,
  stageGuide: 50,
  minimap: 70,
  selectionToolbar: 70,
  deck: 80,
  topbar: 100,
  projectPopover: 100,
  fileDropHint: 110,
  nodeQuickToolbar: 200,
  nodeEditor: 220,
  assetDrawer: 260,
  portalPopover: 300,
  agentResult: 320,
  contextMenu: 360,
  expandedEditor: 450,
  modal: 500,
  assetPreview: 520,
  assetCollectionPicker: 540,
  modelDialog: 560,
  modalPopover: 580,
  toast: 700,
} as const;

export const CANVAS_NODE_INTERACTION_OFFSET = 10_000;
export const CANVAS_NODE_BASE_Z_INDEX = CANVAS_Z_INDEX.node;

export type CanvasNodeLayerAction =
  | "bring-to-front"
  | "bring-to-back"
  | "raise"
  | "lower";

function rawLayer(node: CanvasNode, index: number) {
  const value = node.zIndex;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : CANVAS_NODE_BASE_Z_INDEX + index;
}

/** Returns nodes in paint order: bottom first, top last. */
export function sortCanvasNodesByLayer(nodes: CanvasNode[]) {
  return nodes
    .map((node, index) => ({ node, index, layer: rawLayer(node, index) }))
    .sort((left, right) => left.layer - right.layer || left.index - right.index)
    .map(({ node }) => node);
}

/**
 * Normalizes arbitrary or legacy layer values into a dense, stable sequence.
 * Missing values intentionally fall back to the old array order.
 */
export function normalizeCanvasNodeLayers(nodes: CanvasNode[]) {
  const ordered = sortCanvasNodesByLayer(nodes);
  const rankById = new Map(ordered.map((node, index) => [node.id, index]));
  let changed = false;
  const normalized = nodes.map((node, index) => {
    const zIndex = CANVAS_NODE_BASE_Z_INDEX + (rankById.get(node.id) ?? index);
    if (node.zIndex === zIndex) return node;
    changed = true;
    return { ...node, zIndex };
  });
  // Camera-only updates are frequent while zooming/panning. Preserve the
  // array and node identities when the layer values are already normalized so
  // memoized node cards do not repaint the entire canvas for every frame.
  return changed ? normalized : nodes;
}

/** Assigns newly inserted nodes above every existing node. */
export function appendCanvasNodeLayers(
  document: CanvasDocument,
  nodes: CanvasNode[],
) {
  const existing = sortCanvasNodesByLayer(document.nodes);
  const highest = existing.reduce(
    (current, node, index) => Math.max(current, rawLayer(node, index)),
    CANVAS_NODE_BASE_Z_INDEX - 1,
  );
  return nodes.map((node, index) => ({
    ...node,
    zIndex: highest + index + 1,
  }));
}

/**
 * Normalizes a document after an edit while making every newly introduced
 * node a top-level insertion. This keeps copy/import/generation paths from
 * accidentally inheriting the source node's paint order.
 */
export function normalizeCanvasDocumentLayers(
  previous: CanvasDocument,
  next: CanvasDocument,
) {
  const previousIds = new Set(previous.nodes.map((node) => node.id));
  const inserted = next.nodes.filter((node) => !previousIds.has(node.id));
  if (!inserted.length) {
    const nodes = normalizeCanvasNodeLayers(next.nodes);
    return {
      ...next,
      nodes,
    };
  }
  const insertedIds = new Set(inserted.map((node) => node.id));
  const appended = appendCanvasNodeLayers(previous, inserted);
  const appendedLayers = new Map(appended.map((node) => [node.id, node.zIndex]));
  return {
    ...next,
    nodes: normalizeCanvasNodeLayers(
      next.nodes.map((node) =>
        insertedIds.has(node.id)
          ? { ...node, zIndex: appendedLayers.get(node.id) }
          : node,
      ),
    ),
  };
}

/**
 * Reorders one node or a multi-selection as a stable block. The document's
 * semantic node array remains untouched; only the persisted paint order is
 * rewritten.
 */
export function reorderCanvasNodes(
  document: CanvasDocument,
  nodeIds: string[],
  action: CanvasNodeLayerAction,
) {
  const selectedIds = new Set(nodeIds);
  const ordered = sortCanvasNodesByLayer(document.nodes);
  const selected = ordered.filter((node) => selectedIds.has(node.id));
  if (!selected.length) return document;

  const rest = ordered.filter((node) => !selectedIds.has(node.id));
  const firstIndex = ordered.findIndex((node) => selectedIds.has(node.id));
  let insertionIndex = firstIndex;

  if (action === "bring-to-front") insertionIndex = rest.length;
  else if (action === "bring-to-back") insertionIndex = 0;
  else if (action === "raise") insertionIndex = Math.min(rest.length, firstIndex + 1);
  else insertionIndex = Math.max(0, firstIndex - 1);

  const nextOrder = [
    ...rest.slice(0, insertionIndex),
    ...selected,
    ...rest.slice(insertionIndex),
  ];
  if (nextOrder.every((node, index) => node.id === ordered[index]?.id)) {
    return document;
  }
  const zIndexById = new Map(nextOrder.map((node, index) => [node.id, index]));
  return {
    ...document,
    nodes: document.nodes.map((node, index) => ({
      ...node,
      zIndex: CANVAS_NODE_BASE_Z_INDEX + (zIndexById.get(node.id) ?? index),
    })),
  };
}
