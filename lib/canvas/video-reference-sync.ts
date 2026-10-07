import {
  incomingReferences,
  nodeById,
} from "@/lib/canvas/model";
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasInputRole,
  CanvasNode,
  CanvasRuntimeState,
} from "@/lib/canvas/types";
import type { CanvasVideoInputMode } from "@/lib/canvas/references";
import {
  preferredCanvasVideoInputModeForImageCount,
} from "@/lib/canvas/references";
import {
  defaultCanvasVideoInputRole,
  videoParamsForCanvasNode,
  updateCanvasVideoMode,
} from "@/lib/canvas/video-mode";
import {
  referenceEdgesForCanvasTarget,
  referenceNodesForCanvasEdge,
} from "@/lib/canvas/reference-edges";
import { canvasInputRolesForTarget } from "@/lib/canvas/input-roles";
import { canvasVideoInputCapabilities } from "@/lib/canvas/video-capabilities";
import { getVideoModelLimits } from "@/lib/video-model-limits";
import type { VideoCreationSettings } from "@/lib/creation/settings";

function sameCanvasIdOrder(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((id, index) => id === expected[index]);
}

/** Reconcile automatic video modes, input order and persisted edge roles. */
export function syncCanvasVideoReferences(
  document: CanvasDocument,
  runtime: CanvasRuntimeState | null,
) {
  let next = document;
  for (const initialTarget of document.nodes) {
    const target = nodeById(next, initialTarget.id);
    if (!target) continue;
    if (
      (target.type !== "media" && target.type !== "generator") ||
      target.data.kind !== "video"
    ) continue;

    const settings = videoParamsForCanvasNode(target, runtime);
    const directReferenceEdges = referenceEdgesForCanvasTarget(next, target.id);
    const directReferences = [...new Map(
      directReferenceEdges
        .flatMap(({ edge }) => referenceNodesForCanvasEdge(next, edge))
        .map((node) => [node.id, node]),
    ).values()];
    const directReferenceIds = new Set(directReferences.map((node) => node.id));
    const storedReferenceIds = target.data.referenceOrder?.length
      ? target.data.referenceOrder
      : target.data.generation?.referenceIds || [];
    const storedReferences = storedReferenceIds
      .map((id) => nodeById(next, id))
      .filter((node): node is CanvasNode => Boolean(node && directReferenceIds.has(node.id)));
    const seenReferenceIds = new Set(storedReferences.map((node) => node.id));
    const references = directReferenceEdges.length
      ? [...storedReferences, ...directReferences.filter((node) => !seenReferenceIds.has(node.id))]
      : incomingReferences(next, target.id);
    const images = references.filter((node) => node.data.kind === "image");
    const videos = references.filter((node) => node.data.kind === "video");
    const audios = references.filter((node) => node.data.kind === "audio");
    const capabilities = canvasVideoInputCapabilities(settings, runtime);
    const limits = getVideoModelLimits(
      capabilities.model || undefined,
      runtime?.providers.find((item) => item.id === capabilities.model?.providerId),
    );
    const automatic = target.data.videoInputModeAuto !== false;
    let inputMode = settings.inputMode;
    if (automatic) {
      if (audios.length > 0 && capabilities.supportsAudio && capabilities.supportsReference && limits.maxAudios > 0) {
        inputMode = "reference";
      } else if (videos.length > 0) {
        inputMode = capabilities.supportsReference && limits.maxReferenceVideos > 0 ? "reference" : "text";
      } else {
        inputMode = preferredCanvasVideoInputModeForImageCount(images.length, capabilities) || "text";
      }
    }

    const hasTopLevelVideoParams = Boolean(
      target.data.params &&
      typeof target.data.params === "object" &&
      "inputMode" in target.data.params,
    );
    if (inputMode !== settings.inputMode || !hasTopLevelVideoParams) {
      next = updateCanvasVideoMode(next, target.id, inputMode, runtime);
    }

    const currentTarget = nodeById(next, target.id) || target;
    const priorRoles = canvasInputRolesForTarget(next, target.id);
    const roleByReference = new Map<string, CanvasInputRole>();
    let imagePosition = 0;
    references.forEach((reference) => {
      const defaultRole = defaultCanvasVideoInputRole(reference, inputMode, imagePosition);
      if (reference.data.kind === "image") imagePosition += 1;
      const persistedRole = priorRoles.get(reference.id);
      const role = automatic
        ? defaultRole
        : persistedRole || defaultRole;
      if (role) roleByReference.set(reference.id, role);
    });

    const referenceEdges = referenceEdgesForCanvasTarget(next, target.id);
    const edgeUpdates = new Map<string, CanvasEdge>();
    referenceEdges.forEach(({ edge }, edgeIndex) => {
      const sourceNodes = referenceNodesForCanvasEdge(next, edge);
      const roles = sourceNodes
        .map((node) => roleByReference.get(node.id))
        .filter((role): role is CanvasInputRole => Boolean(role));
      const firstRole = roles[0];
      const inputRole = sourceNodes.length === 1
        ? firstRole
        : roles.length === sourceNodes.length && firstRole && roles.every((role) => role === firstRole)
          ? firstRole
          : undefined;
      const orderChanged = edge.order !== edgeIndex;
      const roleChanged = edge.inputRole !== inputRole;
      if (!orderChanged && !roleChanged) return;
      const updatedEdge: CanvasEdge = { ...edge, order: edgeIndex };
      if (inputRole) updatedEdge.inputRole = inputRole;
      else delete updatedEdge.inputRole;
      edgeUpdates.set(edge.id, updatedEdge);
    });

    const hasReferenceEdges = referenceEdges.length > 0;
    const hasStoredReferenceOrder = Array.isArray(currentTarget.data.referenceOrder) ||
      Array.isArray(currentTarget.data.generation?.referenceIds);
    const referenceOrder = references.map((node) => node.id);
    const nodes = next.nodes.map((node) => {
      if (node.id !== target.id) return node;
      const params = videoParamsForCanvasNode(node, runtime);
      const paramsChanged = params.inputMode !== inputMode;
      const referenceOrderChanged = (hasReferenceEdges || hasStoredReferenceOrder) &&
        !sameCanvasIdOrder(node.data.referenceOrder, referenceOrder);
      const generationReferenceIdsChanged = (hasReferenceEdges || hasStoredReferenceOrder) &&
        Boolean(node.data.generation) &&
        !sameCanvasIdOrder(node.data.generation?.referenceIds, referenceOrder);
      if (!paramsChanged && !referenceOrderChanged && !generationReferenceIdsChanged && !edgeUpdates.size) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...(paramsChanged ? { params: { ...params, inputMode } as VideoCreationSettings } : {}),
          ...(referenceOrderChanged ? { referenceOrder } : {}),
          ...(generationReferenceIdsChanged
            ? { generation: { ...node.data.generation!, referenceIds: referenceOrder } }
            : {}),
        },
      };
    });
    const edges = edgeUpdates.size
      ? next.edges.map((edge) => edgeUpdates.get(edge.id) || edge)
      : next.edges;
    const nodesChanged = nodes.some((node, index) => node !== next.nodes[index]);
    next = nodesChanged || edgeUpdates.size
      ? { ...next, nodes: nodesChanged ? nodes : next.nodes, edges }
      : next;
  }
  return next;
}
