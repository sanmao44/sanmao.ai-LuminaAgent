import type { CanvasDocument, CanvasGroup, CanvasNode } from "./types";

/**
 * The canvas has two separate stacking systems:
 *
 * 1. These constants order screen-space UI and the world itself.
 * 2. CanvasGroup.zIndex and top-level CanvasNode.zIndex order entities inside
 *    the transformed world context. Group members use their zIndex only as an
 *    internal, stable order within their owning group.
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
export const CANVAS_ENTITY_LAYER_STRIDE = 1_000;
export const CANVAS_ENTITY_INTERACTION_OFFSET = 1_000_000;

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

function finiteLayer(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : undefined;
}

function groupMemberEntries(document: CanvasDocument, group: CanvasGroup) {
  const nodesById = new Map(document.nodes.map((node, index) => [node.id, { node, index }]));
  return group.nodeIds
    .map((id) => nodesById.get(id))
    .filter((entry): entry is { node: CanvasNode; index: number } => Boolean(entry));
}

function rawGroupLayer(document: CanvasDocument, group: CanvasGroup, groupIndex: number) {
  const explicit = finiteLayer(group.zIndex);
  if (explicit !== undefined) return explicit;
  const members = groupMemberEntries(document, group);
  if (!members.length) return CANVAS_NODE_BASE_Z_INDEX + groupIndex;
  return Math.min(
    ...members.map(({ node, index }) => rawLayer(node, index)),
  );
}

type CanvasLayerEntityEntry = {
  entity: CanvasLayerEntity;
  layer: number;
  order: number;
};

export type CanvasLayerEntity =
  | { kind: "node"; node: CanvasNode }
  | { kind: "group"; group: CanvasGroup };

function layerEntityId(entity: CanvasLayerEntity) {
  return entity.kind === "group" ? entity.group.id : entity.node.id;
}

function layerEntityEntries(document: CanvasDocument): CanvasLayerEntityEntry[] {
  const groupedNodeIds = new Set(
    document.groups.flatMap((group) => group.nodeIds),
  );
  const entries: CanvasLayerEntityEntry[] = document.nodes
    .map((node, index) => ({
      entity: { kind: "node" as const, node },
      layer: rawLayer(node, index),
      order: index,
    }))
    .filter(({ entity }) => !groupedNodeIds.has(entity.node.id));

  document.groups.forEach((group, groupIndex) => {
    const members = groupMemberEntries(document, group);
    entries.push({
      entity: { kind: "group", group },
      layer: rawGroupLayer(document, group, groupIndex),
      order: members.length
        ? Math.min(...members.map(({ index }) => index))
        : document.nodes.length + groupIndex,
    });
  });
  return entries;
}

/** Returns nodes in paint order: bottom first, top last. */
export function sortCanvasNodesByLayer(nodes: CanvasNode[]) {
  return nodes
    .map((node, index) => ({ node, index, layer: rawLayer(node, index) }))
    .sort((left, right) => left.layer - right.layer || left.index - right.index)
    .map(({ node }) => node);
}

/** Returns groups and ungrouped nodes in bottom-to-top paint order. */
export function sortCanvasEntitiesByLayer(document: CanvasDocument) {
  return layerEntityEntries(document)
    .sort((left, right) => left.layer - right.layer || left.order - right.order)
    .map(({ entity }) => entity);
}

/** Returns groups in the order in which their frames are painted. */
export function sortCanvasGroupsByLayer(document: CanvasDocument) {
  return sortCanvasEntitiesByLayer(document)
    .filter((entity): entity is { kind: "group"; group: CanvasGroup } => entity.kind === "group")
    .map(({ group }) => group);
}

function sortGroupMembersByLayer(document: CanvasDocument, group: CanvasGroup) {
  return groupMemberEntries(document, group)
    .sort((left, right) => rawLayer(left.node, left.index) - rawLayer(right.node, right.index) || left.index - right.index)
    .map(({ node }) => node);
}

function nextLayerOrder(document: CanvasDocument, orderedIds?: string[]) {
  const available = new Map(
    sortCanvasEntitiesByLayer(document).map((entity) => [layerEntityId(entity), entity]),
  );
  const order: CanvasLayerEntity[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds || []) {
    const entity = available.get(id);
    if (!entity || seen.has(id)) continue;
    seen.add(id);
    order.push(entity);
  }
  sortCanvasEntitiesByLayer(document).forEach((entity) => {
    const id = layerEntityId(entity);
    if (seen.has(id)) return;
    seen.add(id);
    order.push(entity);
  });
  return order;
}

function normalizeEntityLayers(
  document: CanvasDocument,
  orderedIds?: string[],
) {
  const ordered = nextLayerOrder(document, orderedIds);
  const rankById = new Map(ordered.map((entity, index) => [layerEntityId(entity), index]));
  const memberRankById = new Map<string, number>();
  document.groups.forEach((group) => {
    sortGroupMembersByLayer(document, group).forEach((node, index) => {
      memberRankById.set(node.id, index);
    });
  });

  let changed = false;
  const groups = document.groups.map((group, index) => {
    const zIndex = CANVAS_NODE_BASE_Z_INDEX + (rankById.get(group.id) ?? index);
    if (group.zIndex === zIndex) return group;
    changed = true;
    return { ...group, zIndex };
  });
  const nodes = document.nodes.map((node, index) => {
    const group = document.groups.find((candidate) => candidate.nodeIds.includes(node.id));
    const zIndex = group
      ? CANVAS_NODE_BASE_Z_INDEX + (memberRankById.get(node.id) ?? index)
      : CANVAS_NODE_BASE_Z_INDEX + (rankById.get(node.id) ?? index);
    if (node.zIndex === zIndex) return node;
    changed = true;
    return { ...node, zIndex };
  });
  return changed ? { ...document, nodes, groups } : document;
}

/** Normalizes one document, deriving missing group layers from legacy members. */
export function normalizeCanvasEntityLayers(document: CanvasDocument) {
  return normalizeEntityLayers(document);
}

function topLevelIds(document: CanvasDocument) {
  return new Set(sortCanvasEntitiesByLayer(document).map(layerEntityId));
}

function nodeGroupOwners(document: CanvasDocument) {
  const owners = new Map<string, string>();
  document.nodes.forEach((node) => owners.set(node.id, node.id));
  document.groups.forEach((group) =>
    group.nodeIds.forEach((nodeId) => owners.set(nodeId, group.id)),
  );
  return owners;
}

function sameNodeGroupOwnership(previous: CanvasDocument, next: CanvasDocument) {
  const previousOwners = nodeGroupOwners(previous);
  const nextOwners = nodeGroupOwners(next);
  const nodeIds = new Set([...previousOwners.keys(), ...nextOwners.keys()]);
  return [...nodeIds].every((nodeId) => previousOwners.get(nodeId) === nextOwners.get(nodeId));
}

/**
 * Preserves the old top-level positions across membership changes. A newly
 * formed group is inserted where its first old member lived, while genuinely
 * new groups/nodes are appended above the existing entities.
 */
function transitionLayerOrder(previous: CanvasDocument, next: CanvasDocument) {
  const nextEntities = sortCanvasEntitiesByLayer(next);
  const nextById = new Map(nextEntities.map((entity) => [layerEntityId(entity), entity]));
  const nextGroupByNodeId = new Map<string, string>();
  next.groups.forEach((group) => group.nodeIds.forEach((id) => nextGroupByNodeId.set(id, group.id)));
  const oldEntities = sortCanvasEntitiesByLayer(previous);
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id || seen.has(id) || !nextById.has(id)) return;
    seen.add(id);
    order.push(id);
  };
  const addNextOwner = (nodeId: string) => add(nextGroupByNodeId.get(nodeId) || nodeId);

  oldEntities.forEach((entity) => {
    if (entity.kind === "node") {
      if (next.nodes.some((node) => node.id === entity.node.id)) addNextOwner(entity.node.id);
      return;
    }
    const nextGroup = nextById.get(entity.group.id);
    const oldMembers = sortGroupMembersByLayer(previous, entity.group);
    if (nextGroup?.kind === "group") {
      add(entity.group.id);
      oldMembers.forEach((node) => {
        if (next.nodes.some((candidate) => candidate.id === node.id)) {
          const nextOwner = nextGroupByNodeId.get(node.id);
          if (nextOwner && nextOwner !== entity.group.id) add(nextOwner);
          else if (!nextOwner) add(node.id);
        }
      });
      return;
    }
    oldMembers.forEach((node) => {
      if (next.nodes.some((candidate) => candidate.id === node.id)) addNextOwner(node.id);
    });
  });

  nextEntities.forEach((entity) => add(layerEntityId(entity)));
  return order;
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
  const previousTopLevelIds = topLevelIds(previous);
  const nextEntities = sortCanvasEntitiesByLayer(next);
  const previousTopLevelOrder = sortCanvasEntitiesByLayer(previous).map(layerEntityId);
  const nextTopLevelOrder = nextEntities.map(layerEntityId);
  const sameTopLevelEntitySet =
    previousTopLevelIds.size === nextTopLevelOrder.length &&
    nextTopLevelOrder.every((id) => previousTopLevelIds.has(id));
  const explicitTopLevelOrder = sameTopLevelEntitySet &&
    sameNodeGroupOwnership(previous, next) &&
    nextTopLevelOrder.some((id, index) => id !== previousTopLevelOrder[index]);
  const appendedIds = nextEntities
    .filter((entity) => !previousTopLevelIds.has(layerEntityId(entity)))
    .filter((entity) => {
      if (entity.kind === "node") return !previous.nodes.some((node) => node.id === entity.node.id);
      return entity.group.nodeIds.some((id) => !previous.nodes.some((node) => node.id === id));
    })
    .map(layerEntityId);
  const transitionOrder = explicitTopLevelOrder
    ? nextTopLevelOrder
    : transitionLayerOrder(previous, next);
  const existingOrder = transitionOrder.filter((id) => !appendedIds.includes(id));
  return normalizeEntityLayers(next, [...existingOrder, ...appendedIds]);
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

/** Reorders groups and ungrouped nodes as stable top-level blocks. */
export function reorderCanvasEntities(
  document: CanvasDocument,
  entityIds: string[],
  action: CanvasNodeLayerAction,
) {
  const selectedIds = new Set(
    entityIds
      .map((id) => {
        const group = document.groups.find((candidate) => candidate.id === id || candidate.nodeIds.includes(id));
        return group?.id || id;
      })
      .filter((id) => sortCanvasEntitiesByLayer(document).some((entity) => layerEntityId(entity) === id)),
  );
  const ordered = sortCanvasEntitiesByLayer(document);
  const selected = ordered.filter((entity) => selectedIds.has(layerEntityId(entity)));
  if (!selected.length) return document;
  const rest = ordered.filter((entity) => !selectedIds.has(layerEntityId(entity)));
  const firstIndex = ordered.findIndex((entity) => selectedIds.has(layerEntityId(entity)));
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
  if (nextOrder.every((entity, index) => layerEntityId(entity) === layerEntityId(ordered[index]))) return document;
  return normalizeEntityLayers(document, nextOrder.map(layerEntityId));
}

/** Returns a CSS paint layer where a group's frame is below its members. */
export function canvasGroupPaintZIndex(
  document: CanvasDocument,
  group: CanvasGroup,
  interaction = false,
) {
  const layer = finiteLayer(group.zIndex) ?? rawGroupLayer(document, group, document.groups.indexOf(group));
  return layer * CANVAS_ENTITY_LAYER_STRIDE + (interaction ? CANVAS_ENTITY_INTERACTION_OFFSET : 0);
}

/** Returns a CSS paint layer for a node, keeping grouped members above frames. */
export function canvasNodePaintZIndex(
  document: CanvasDocument,
  node: CanvasNode,
  interaction = false,
) {
  const group = document.groups.find((candidate) => candidate.id === node.groupId || candidate.nodeIds.includes(node.id));
  if (!group) {
    const layer = finiteLayer(node.zIndex) ?? CANVAS_NODE_BASE_Z_INDEX;
    return layer * CANVAS_ENTITY_LAYER_STRIDE + (interaction ? CANVAS_ENTITY_INTERACTION_OFFSET : 0);
  }
  const members = sortGroupMembersByLayer(document, group);
  const memberIndex = Math.max(0, members.findIndex((item) => item.id === node.id));
  return canvasGroupPaintZIndex(document, group, interaction) + memberIndex + 1;
}
