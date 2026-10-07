import {
  clone,
  uid,
} from './model';
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasGroup,
  CanvasNode,
} from './types';

export type CanvasClipboardPayload = {
  type: 'sanmao-canvas-nodes';
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
};

export function isCanvasClipboardPayload(
  value: unknown,
): value is CanvasClipboardPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<CanvasClipboardPayload>;
  return (
    payload.type === 'sanmao-canvas-nodes' &&
    payload.version === 1 &&
    Array.isArray(payload.nodes) &&
    Array.isArray(payload.edges) &&
    Array.isArray(payload.groups)
  );
}

export function remapCanvasNodeReferences(
  node: CanvasNode,
  idMap: ReadonlyMap<string, string>,
): CanvasNode {
  const referenceOrder = node.data.referenceOrder?.map(
    (id) => idMap.get(id) || id,
  );
  const generation = node.data.generation
    ? {
        ...node.data.generation,
        referenceIds: node.data.generation.referenceIds?.map(
          (id) => idMap.get(id) || id,
        ),
      }
    : node.data.generation;
  return {
    ...node,
    data: {
      ...node.data,
      ...(referenceOrder ? { referenceOrder } : {}),
      ...(generation ? { generation } : {}),
    },
  };
}

export function duplicateCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  offset = { x: 48, y: 48 },
  preserveInputConnections = false,
  preserveGroupConnections = false,
) {
  const selected = document.nodes.filter((node) => nodeIds.includes(node.id));
  const selectedIds = new Set(selected.map((node) => node.id));
  const idMap = new Map(selected.map((node) => [node.id, uid('node')]));
  const groupMap = new Map<string, string>();
  const groups = document.groups
    .filter(
      (group) =>
        group.nodeIds.length >= 2 &&
        group.nodeIds.every((id) => selectedIds.has(id)),
    )
    .map((group) => {
      const id = uid('group');
      groupMap.set(group.id, id);
      return {
        ...clone(group),
        id,
        nodeIds: group.nodeIds
          .map((nodeId) => idMap.get(nodeId)!)
          .filter(Boolean),
      };
    });
  const selectedEntityIds = preserveGroupConnections
    ? new Set([
        ...selectedIds,
        ...document.groups
          .filter(
            (group) =>
              group.nodeIds.length >= 2 &&
              group.nodeIds.every((id) => selectedIds.has(id)),
          )
          .map((group) => group.id),
      ])
    : selectedIds;
  const copies = selected.map((node) => {
    const copy = remapCanvasNodeReferences(clone(node), idMap);
    return {
      ...copy,
      id: idMap.get(node.id)!,
      x: node.x + offset.x,
      y: node.y + offset.y,
      ...(node.groupId && groupMap.has(node.groupId)
        ? { groupId: groupMap.get(node.groupId) }
        : { groupId: undefined }),
    };
  });
  const edgeCandidates = preserveGroupConnections
    ? document.edges.filter(
        (edge) =>
          selectedEntityIds.has(edge.source) ||
          selectedEntityIds.has(edge.target) ||
          edge.sourceNodeIds?.some((id) => selectedIds.has(id)),
      )
    : preserveInputConnections
      ? document.edges.filter((edge) => selectedIds.has(edge.target))
      : document.edges.filter(
          (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
        );
  const edges = edgeCandidates.map((edge) => ({
    ...clone(edge),
    id: uid('edge'),
    source: groupMap.get(edge.source) || idMap.get(edge.source) || edge.source,
    target: groupMap.get(edge.target) || idMap.get(edge.target) || edge.target,
    ...(edge.sourceNodeIds
      ? { sourceNodeIds: edge.sourceNodeIds.map((id) => idMap.get(id) || id) }
      : {}),
  }));
  return {
    nodes: copies,
    edges,
    groups,
    ids: copies.map((node) => node.id),
    groupIds: groups.map((group) => group.id),
  };
}

export function createCanvasClipboardPayload(
  document: CanvasDocument,
  nodeIds: readonly string[],
): CanvasClipboardPayload {
  const selected = document.nodes.filter((node) => nodeIds.includes(node.id));
  const selectedIds = new Set(selected.map((node) => node.id));
  return {
    type: 'sanmao-canvas-nodes',
    version: 1,
    nodes: clone(selected),
    edges: clone(
      document.edges.filter(
        (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
      ),
    ),
    groups: clone(
      document.groups.filter(
        (group) =>
          group.nodeIds.length >= 2 &&
          group.nodeIds.every((id) => selectedIds.has(id)),
      ),
    ),
  };
}
