import {
  addEdge,
  canConnect,
  groupById,
  groupNodes,
  incomingContext,
  incomingReferences,
  isCanvasReadyImageSource,
  isCanvasReferenceableNode,
  nodeById,
} from "./model";
import {
  preferredCanvasVideoInputModeForImageCount,
  type CanvasVideoInputMode,
} from "./references";
import type {
  CanvasDocument,
  CanvasInputRole,
  CanvasNode,
  CanvasRuntimeState,
} from "./types";
import {
  defaultCanvasVideoInputRole,
  updateCanvasVideoMode,
  updateCanvasVideoModeAuto,
} from "./video-mode";
import { canvasInputRolesForTarget } from "./input-roles";
import { canvasVideoInputCapabilities } from "./video-capabilities";
import { syncCanvasVideoReferences } from "./video-reference-sync";
import { syncCanvasVideoEditorReferences } from "./video-editor-sync";
import { getVideoModelLimits } from "../video-model-limits";
import {
  normalizeCreationSettings,
  type VideoCreationSettings,
} from "../creation/settings";
export type CanvasConnectionResult = {
  ok: boolean;
  document: CanvasDocument;
  inputRole?: CanvasInputRole;
  videoMode?: CanvasVideoInputMode;
  reason?: string;
};

export function connectCanvasNodesInDocument(
  document: CanvasDocument,
  sourceId: string,
  targetId: string,
  sourcePort: "left" | "right" = "right",
  targetPort: "left" | "right" = "left",
  runtime: CanvasRuntimeState | null,
  requestedRole?: CanvasInputRole,
): CanvasConnectionResult {
  const source = nodeById(document, sourceId);
  const sourceGroup = groupById(document, sourceId);
  const sourceMembershipGroup = source?.groupId
    ? groupById(document, source.groupId)
    : undefined;
  const target = nodeById(document, targetId);
  if ((!source && !sourceGroup) || !target) return { ok: false, document, reason: "源节点或目标节点不存在。" };
  if (source?.type === "video-editor") {
    return { ok: false, document, reason: "视频编辑节点当前只保存编辑计划，暂不输出视频素材。" };
  }
  if (
    source?.id === target.id ||
    sourceGroup?.nodeIds.includes(target.id) ||
    sourceMembershipGroup?.nodeIds.includes(target.id) ||
    sourceMembershipGroup?.id === target.id
  ) return { ok: false, document, reason: "不能连接自身。" };

  const targetKind = target.type === "media" || target.type === "generator" ? target.data.kind : undefined;
  const sourceKind = source && isCanvasReferenceableNode(source) ? source.data.kind : undefined;
  // Only a group boundary carries all of its referenceable members. A direct
  // member connection must stay scoped to that one member.
  const sourceInputs = sourceGroup
    ? groupNodes(document, sourceGroup.id).filter(isCanvasReferenceableNode)
    : source && isCanvasReferenceableNode(source)
      ? [source]
      : [];
  const sourceHasImage = sourceInputs.some((node) => node.data.kind === "image");
  const sourceHasVideo = sourceInputs.some((node) => node.data.kind === "video");
  const sourceHasAudio = sourceInputs.some((node) => node.data.kind === "audio");
  let inputRole = requestedRole;
  let videoMode: CanvasVideoInputMode | undefined;
  let next = document;

  if (target.type === "angle") {
    if (!source || !isCanvasReadyImageSource(source)) {
      return { ok: false, document, reason: "角度控制节点只接受一张已完成的图片。" };
    }
    if (next.edges.some((edge) => edge.target === target.id && !["generated", "variant", "lineage"].includes(edge.kind || ""))) {
      return { ok: false, document, reason: "角度控制节点只能连接一张图片。" };
    }
    const beforeEdges = next.edges.length;
    next = addEdge(next, sourceId, targetId, sourcePort, targetPort, "reference", "reference-image", 0);
    if (next.edges.length === beforeEdges) {
      return { ok: false, document, reason: "这条连线已存在，或不符合角度节点的输入规则。" };
    }
    return { ok: true, document: next, inputRole: "reference-image" };
  }

  if (target.type === "video-editor") {
    if (!sourceInputs.length) {
      return { ok: false, document, reason: "视频编辑节点只接受已有素材或素材组。" };
    }
    inputRole = sourceHasAudio && !sourceHasImage && !sourceHasVideo
      ? "audio"
      : sourceHasVideo && !sourceHasImage && !sourceHasAudio
        ? "video"
        : "reference-image";
    const beforeEdges = next.edges.length;
    next = addEdge(next, sourceId, targetId, sourcePort, targetPort, "reference", inputRole, incomingContext(next, targetId).length);
    if (next.edges.length === beforeEdges) {
      const existingEdge = next.edges.find(
        (edge) => edge.source === sourceId && edge.target === targetId && edge.sourcePort === sourcePort && edge.targetPort === targetPort,
      );
      if (existingEdge) return { ok: true, document: syncCanvasVideoEditorReferences(next), inputRole: existingEdge.inputRole || inputRole };
      return { ok: false, document, reason: "这条连线已存在，或不符合当前节点的输入规则。" };
    }
    return { ok: true, document: syncCanvasVideoEditorReferences(next), inputRole };
  }

  if (targetKind === "image" && (sourceKind === "video" || sourceHasVideo)) {
    return { ok: false, document, reason: "图片节点不能接收视频作为图片参考。" };
  }
  if ((sourceKind === "audio" || sourceHasAudio) && targetKind !== "video") {
    return { ok: false, document, reason: "参考音频只能连接到视频节点。" };
  }

  if (targetKind === "video" && (sourceKind === "image" || sourceKind === "audio" || sourceHasImage || sourceHasVideo || sourceHasAudio)) {
    const settings = target.data.params && typeof target.data.params === "object" && "inputMode" in target.data.params
      ? target.data.params as VideoCreationSettings
      : normalizeCreationSettings("video", target.data.params, runtime);
    const capabilities = canvasVideoInputCapabilities(settings, runtime);
    const provider = runtime?.providers.find((item) => item.id === capabilities.model?.providerId);
    const limits = getVideoModelLimits(capabilities.model || undefined, provider);
    if (sourceHasVideo && limits.maxReferenceVideos <= 0) {
      return {
        ok: false,
        document,
        reason: "当前视频模型不支持参考视频，请切换到支持参考视频的模型，或移除视频输入。",
      };
    }
    const existing = incomingReferences(document, targetId);
    const existingVideoCount = existing.filter((node) => node.data.kind === "video").length;
    const existingAudioCount = existing.filter((node) => node.data.kind === "audio").length;
    const duplicateSourceIds = new Set(existing.map((node) => node.id));
    const newVideoCount = sourceInputs.filter((node) => node.data.kind === "video" && !duplicateSourceIds.has(node.id)).length;
    const newAudioCount = sourceInputs.filter((node) => node.data.kind === "audio" && !duplicateSourceIds.has(node.id)).length;
    if (existingVideoCount + newVideoCount > limits.maxReferenceVideos) {
      return {
        ok: false,
        document,
        reason: `当前模型最多接收 ${limits.maxReferenceVideos} 个参考视频，请减少视频输入或切换模型。`,
      };
    }
    if (existingAudioCount + newAudioCount > limits.maxAudios) {
      return {
        ok: false,
        document,
        reason: `当前模型最多接收 ${limits.maxAudios} 段参考音频，请减少音频输入或切换模型。`,
      };
    }
    const combined = [
      ...new Map([...existing, ...sourceInputs].map((node) => [node.id, node])).values(),
    ];
    const combinedImages = combined.filter((node) => node.data.kind === "image");
    const automatic = target.data.videoInputModeAuto !== false;
    const explicitSlot = requestedRole === "first-frame" || requestedRole === "last-frame";
    if (automatic && !explicitSlot) {
      videoMode = combined.some((node) => node.data.kind === "audio")
        ? capabilities.supportsAudio && capabilities.supportsReference && limits.maxAudios > 0 ? "reference" : settings.inputMode
        : combined.some((node) => node.data.kind === "video")
        ? capabilities.supportsReference && limits.maxReferenceVideos > 0 ? "reference" : undefined
        : preferredCanvasVideoInputModeForImageCount(combinedImages.length, capabilities);
      if (!videoMode && (combinedImages.length || combined.some((node) => node.data.kind === "video"))) {
        return {
          ok: false,
          document,
            reason: combined.some((node) => node.data.kind === "audio")
              ? "参考音频需要当前模型支持参考模式和音频输入，请切换模型。"
              : combinedImages.length >= 3
              ? "当前模型不支持多张参考图生视频，请切换到支持参考图的视频模型。"
              : "当前模型不支持图片输入，请切换到支持首帧或参考图的视频模型。",
        };
      }
    } else {
      videoMode = settings.inputMode;
      if (requestedRole === "last-frame") videoMode = "frames";
      else if (requestedRole === "first-frame" && videoMode !== "frames") videoMode = "first-frame";
      if (videoMode === "reference" && !capabilities.supportsReference)
        return { ok: false, document, reason: "当前模型不支持参考图，请切换到支持参考图的视频模型。" };
      if ((videoMode === "first-frame" || videoMode === "frames") && !capabilities.supportsFirstFrame)
        return { ok: false, document, reason: "当前模型不支持首帧/首尾帧，请切换到支持首帧的视频模型。" };
      if (videoMode === "text" && (sourceHasImage || sourceHasVideo))
        return { ok: false, document, reason: "当前视频节点已锁定为文生视频，请切换生成方式或恢复自动后再接入图片。" };
    }
    if (!videoMode) videoMode = settings.inputMode;
    const roles = canvasInputRolesForTarget(document, targetId);
    const sourceImageIndex = source?.id
      ? combinedImages.findIndex((node) => node.id === source.id)
      : -1;
    inputRole = explicitSlot
      ? requestedRole
        : sourceHasAudio && !sourceHasImage && !sourceHasVideo
          ? "audio"
          : sourceHasVideo && !sourceHasImage
        ? "video"
        : sourceGroup
          ? "reference-image"
          : defaultCanvasVideoInputRole(source || sourceInputs[0], videoMode, Math.max(0, sourceImageIndex));
    if (!inputRole && sourceHasImage) inputRole = "reference-image";
    const slotRole = inputRole === "first-frame" || inputRole === "last-frame" ? inputRole : undefined;
    const previousSlotOwner = slotRole
      ? [...roles.entries()].find(([nodeId, role]) => nodeId !== source?.id && role === slotRole)?.[0]
      : undefined;
    if (explicitSlot) next = updateCanvasVideoModeAuto(next, targetId, false);
    if (videoMode !== settings.inputMode) next = updateCanvasVideoMode(next, targetId, videoMode, runtime);

    if (slotRole && source) {
      const existingEdge = next.edges.find(
        (edge) =>
          edge.source === sourceId &&
          edge.target === targetId &&
          edge.sourcePort === sourcePort &&
          edge.targetPort === targetPort,
      );
      if (existingEdge) {
        next = {
          ...next,
          edges: next.edges.map((edge) => {
            if (edge.target !== targetId) return edge;
            if (edge.id === existingEdge.id) {
              return {
                ...edge,
                kind: "reference" as const,
                inputRole: slotRole,
                order: slotRole === "first-frame" ? 0 : 1,
              };
            }
            return edge.inputRole === slotRole
              ? { ...edge, inputRole: "reference-image" as CanvasInputRole }
              : edge;
          }),
        };
        const synchronized = syncCanvasVideoReferences(next, runtime);
        return { ok: true, document: synchronized, inputRole, videoMode };
      }
    }
  } else if (!inputRole) {
    if (target.type === "prompt") inputRole = source?.type === "prompt" || source?.type === "generator" ? "context" : sourceKind === "video" ? "video" : "reference-image";
    else if (source?.type === "prompt" || source?.type === "generator") inputRole = "context";
    else if (sourceKind === "video") inputRole = "video";
    else if (sourceKind === "image") inputRole = "reference-image";
  }

  const beforeEdges = next.edges.length;
  const existingInputs = incomingReferences(next, targetId).length;
  const hasReferenceInput = inputRole === "reference-image" || inputRole === "first-frame" || inputRole === "last-frame" || inputRole === "audio" || sourceHasImage || sourceHasVideo || sourceHasAudio;
  next = addEdge(next, sourceId, targetId, sourcePort, targetPort, hasReferenceInput ? "reference" : "manual", inputRole, existingInputs);
  if (next.edges.length === beforeEdges) {
    // Re-mentioning or re-dropping an input that is already wired should be a
    // no-op success rather than a confusing "already exists" error. Keep the
    // existing edge role so video slot semantics stay stable.
    const existingEdge = next.edges.find(
      (edge) =>
        edge.source === sourceId &&
        edge.target === targetId &&
        edge.sourcePort === sourcePort &&
        edge.targetPort === targetPort,
    );
    if (
      existingEdge &&
      !["generated", "variant", "lineage"].includes(existingEdge.kind || "") &&
      canConnect(next, sourceId, targetId, inputRole).ok
    ) {
      return { ok: true, document: next, inputRole: existingEdge.inputRole || inputRole, videoMode };
    }
    return { ok: false, document, reason: "这条连线已存在，或不符合当前节点的输入规则。" };
  }
  const synchronized = targetKind === "video"
    ? syncCanvasVideoReferences(next, runtime)
    : next;
  const connectedTarget = nodeById(synchronized, targetId);
  const connectedMode = connectedTarget?.data.params && typeof connectedTarget.data.params === "object" && "inputMode" in connectedTarget.data.params
    ? (connectedTarget.data.params.inputMode as CanvasVideoInputMode)
    : videoMode;
  return { ok: true, document: synchronized, inputRole, videoMode: connectedMode };
}

