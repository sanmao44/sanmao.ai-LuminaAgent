"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent as ReactChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import {
  addEdge,
  alignCanvasNodes,
  arrangeCanvas,
  clone,
  connectionPath,
  createEmptyMedia,
  createGenerator,
  createGroup,
  createMedia,
  createPrompt,
  createUpscaleNode,
  detachNodesFromGroups,
  distributeCanvasNodes,
  edgeTouchesSelection,
  edgePath,
  entityBounds,
  entityPortPoint,
  groupAtPoint,
  groupBounds,
  groupById,
  groupNodes,
  isCanvasReadyImageSource,
  isCanvasReferenceableNode,
  incomingContext,
  incomingReferences,
  normalizeVariantRequirements,
  mediaCardSizeForRatio,
  nodeById,
  nodeSize,
  normalizeDocument,
  recoverInterruptedCanvasDocument,
  removeEdge,
  removeNodes,
  moveNodesToGroup,
  reorderReferences,
  smartPrompt,
  snapshot,
  uid,
  type CanvasAlignment,
  type CanvasDistribution,
} from "@/lib/canvas/model";
import {
  CANVAS_NODE_INTERACTION_OFFSET,
  CANVAS_Z_INDEX,
  normalizeCanvasDocumentLayers,
  reorderCanvasNodes,
  sortCanvasNodesByLayer,
  type CanvasNodeLayerAction,
} from "@/lib/canvas/layers";
import { createPortal } from "react-dom";
import {
  getCanvasVideoTask,
  generateCanvasAgent,
  generateCanvasImage,
  generateCanvasUpscale,
  getCanvasUpscaleTask,
  generateCanvasVideo,
  inferCanvasAgentTask,
  loadCanvasRuntime,
  uploadCanvasAsset,
} from "@/lib/canvas/api";
import {
  canvasProjectFromDocument,
  deleteCanvasProject,
  ensureCanvasStorage,
  loadCanvasDocument,
  saveCanvasDocument,
  saveCanvasProjects,
} from "@/lib/canvas/storage";
import {
  CANVAS_NODE_COLOR_KEYS,
  canvasNodeColorKey,
  canvasSourceColorKey,
} from "@/lib/canvas/appearance";
import { formatCanvasVideoDuration } from "@/lib/canvas/media";
import { downloadCanvasShareImage } from "@/lib/canvas/share";
import {
  normalizeCreationSettings,
  imageModelOptions,
  readSharedCreationSettings,
  resolveAvailableCreationModel,
  subscribeSharedCreationSettings,
  videoModelOptions,
  writeSharedCreationSettings,
  type CreationSettings,
  type AgentCreationSettings,
  type ImageCreationSettings,
  type VideoCreationSettings,
} from "@/lib/creation/settings";
import { recordModelCall } from "@/lib/model-preferences";
import { classifyAgentDeliverable } from "@/lib/agent-intent";
import { getUpscaleCatalogModel } from "@/lib/upscale-catalog";
import {
  inferCanvasInputRole,
  preferredCanvasVideoInputMode,
  resolveCanvasInputSemantics,
  resolveCanvasVideoInputs,
  type CanvasVideoInputMode,
} from "@/lib/canvas/references";
import { getVideoModelLimits } from "@/lib/video-model-limits";
import {
  fitCanvasNodeEditorBelow,
  placeCanvasContextMenu,
  placeCanvasNodeToolbar,
} from "@/lib/canvas/editor-layout";
import {
  createCanvasImageZip,
  orderCanvasImageItems,
} from "@/lib/canvas/download";
import { recordCanvasImages } from "@/lib/creation/history";
import {
  requestPromptOptimization,
  runOneTakeVideoPrompt,
  runReversePrompt,
} from "@/lib/creation/agent";
import {
  hideUnifiedAsset,
  listUnifiedAssets,
  registerCanvasAsset,
  setUnifiedAssetFavorite,
  updateUnifiedAssetMetadata,
  type AssetRecord,
  type AssetSource,
} from "@/lib/assets";
import {
  DEFAULT_ASSET_COLLECTIONS,
  listAssetCollections,
  saveAssetCollections,
  type AssetCollection,
} from "@/lib/client-history";
import { bootstrapWorkspace, startWorkspaceSync, type WorkspaceSyncStatus } from "@/lib/workspace";
import CreationParameterEditor from "@/components/CreationParameterEditor";
import CanvasReferenceDraftStrip from "@/components/CanvasReferenceDraftStrip";
import CanvasProcessingIndicator, {
  type CanvasProcessingKind,
} from "@/components/canvas/CanvasProcessingIndicator";
import MediaViewer, {
  type MediaViewerItem,
  type MediaViewerReference,
} from "@/components/MediaViewer";
import MaskEditor from "@/components/MaskEditor";
import SelectMenu from "@/components/SelectMenu";
import type {
  CanvasCamera,
  CanvasConnectionStyle,
  CanvasDocument,
  CanvasEdge,
  CanvasGenerationParams,
  CanvasGroup,
  CanvasInputRole,
  CanvasMediaKind,
  CanvasMaskState,
  CanvasNode,
  CanvasProject,
  CanvasRuntimeState,
  CanvasSnapshot,
  CanvasVariantState,
  CanvasUpscaleParams,
} from "@/lib/canvas/types";
import {
  canvasMaskStateFromParams,
  canvasMaskStatusLabel,
  normalizeCanvasMaskState,
  updateCanvasMaskState,
} from "@/lib/canvas/mask";
import { canvasUpscaleSize, loadImageDimensions, seedVrTargetSize } from "@/lib/canvas/upscale";
import {
  CANVAS_MAX_REFERENCES,
  addReferenceDrafts,
  cloneReuseDraft,
  dedupeReferenceDrafts,
  removeReferenceDraft,
  reorderReferenceDrafts,
  reuseDraftFromNode,
  type CanvasReferenceDraft,
  type CanvasReuseDraft,
} from "@/lib/canvas/reuse";
import {
  snapCanvasNodePositions,
  type CanvasSnapGuide,
} from "@/lib/canvas/snap";
import { copyCanvasImageToClipboard } from "@/lib/canvas/clipboard";

type Mode = CanvasMediaKind | "text";
type ConnectionStyle = CanvasConnectionStyle;
type CanvasTheme = "light" | "dark";
type Point = { x: number; y: number };
const CANVAS_VIDEO_MAX_WAIT_MS = 30 * 60 * 1000;

function canvasEdgeMidpoint(document: CanvasDocument, edge: CanvasEdge): Point {
  const start = entityPortPoint(document, edge.source, edge.sourcePort || "right");
  const end = entityPortPoint(document, edge.target, edge.targetPort || "left");
  const sourceDirection = (edge.sourcePort || "right") === "right" ? 1 : -1;
  const targetDirection = (edge.targetPort || "left") === "left" ? -1 : 1;
  const dx = Math.max(72, Math.abs(end.x - start.x) * 0.42);
  const t = 0.5;
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * (start.x + dx * sourceDirection) +
      3 * inverse * t ** 2 * (end.x + dx * targetDirection) +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * start.y +
      3 * inverse * t ** 2 * end.y +
      t ** 3 * end.y,
  };
}

function hasExternalFileTransfer(dataTransfer: DataTransfer) {
  return (
    dataTransfer.types.includes("Files") ||
    [...dataTransfer.items].some((item) => item.kind === "file")
  );
}

type Notice = { message: string; kind: "ok" | "error" };
type CanvasGenerationLog = {
  id: string;
  createdAt: string;
  status: "pending" | "success" | "error";
  mode: "generate" | "edit" | "upscale" | "agent" | "video" | "audio";
  mediaKind?: "image" | "video" | "audio";
  source?: "workspace" | "agent" | "canvas";
  prompt: string;
  modelName?: string;
  providerName?: string;
  resolution?: string;
  aspectRatio?: string;
  outputSize?: string;
  count?: number;
  durationMs?: number;
  imageCount?: number;
  imageUrls?: string[];
  videoUrls?: string[];
  error?: string;
  references?: Array<{ name?: string; dataUrl?: string; url?: string }>;
  operation?: "generate" | "edit" | "extend";
  providerTaskId?: string;
};
type CanvasActivityLog = {
  id: string;
  message: string;
  createdAt: string;
  type: "canvas" | "generation" | "agent" | "asset" | "project" | "system";
  status: "ok" | "error";
};
type CanvasClipboardPayload = {
  type: "sanmao-canvas-nodes";
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
};
type CanvasContextMenuState = {
  x: number;
  y: number;
  world: Point;
  menu: "node" | "create" | "tools";
  nodeId?: string;
};
type MentionState = { start: number; end: number; query: string } | null;
type CanvasPanel = "assets" | "activity" | "settings" | "shortcuts";

const CANVAS_ASSET_UNCATEGORIZED_ID = "uncategorized";
const CANVAS_ASSET_SMART_COLLECTION_IDS = new Set([
  "all",
  "recent",
  "favorite",
  "generated",
  "reference",
  "image",
  "video",
]);
const CANVAS_ASSET_NON_READY_STATUSES = new Set(["queued", "running", "failed"]);

function isAssignableCanvasAssetCollection(collectionId: string) {
  return (
    collectionId === CANVAS_ASSET_UNCATEGORIZED_ID ||
    !CANVAS_ASSET_SMART_COLLECTION_IDS.has(collectionId)
  );
}

function canAddCanvasAsset(node: CanvasNode) {
  return (
    node.type === "media" &&
    Boolean(node.data.url) &&
    !CANVAS_ASSET_NON_READY_STATUSES.has(String(node.data.status || ""))
  );
}

function ConnectionOptionIcon({
  value,
}: {
  value: ConnectionStyle;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {value === "curve" ? (
        <path d="M3 16c4 0 4-8 9-8s5 8 9 8" />
      ) : value === "straight" ? (
        <path d="m4 18 16-12" />
      ) : (
        <path d="M3 17h7V7h11" />
      )}
    </svg>
  );
}

type CanvasLayoutIconKind = CanvasAlignment | CanvasDistribution;

function CanvasLayoutIcon({
  kind,
}: {
  kind: CanvasLayoutIconKind;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "left" && (
        <>
          <path d="M5 4v16" />
          <path d="M8 7h11M8 12h7M8 17h11" />
        </>
      )}
      {kind === "center-x" && (
        <>
          <path d="M12 4v16" strokeDasharray="2 2" />
          <path d="M5 7h14M7 12h10M5 17h14" />
        </>
      )}
      {kind === "right" && (
        <>
          <path d="M19 4v16" />
          <path d="M5 7h11M9 12h7M5 17h11" />
        </>
      )}
      {kind === "top" && (
        <>
          <path d="M4 5h16" />
          <path d="M7 8v11M12 8v7M17 8v11" />
        </>
      )}
      {kind === "center-y" && (
        <>
          <path d="M4 12h16" strokeDasharray="2 2" />
          <path d="M7 5v14M12 7v10M17 5v14" />
        </>
      )}
      {kind === "bottom" && (
        <>
          <path d="M4 19h16" />
          <path d="M7 5v11M12 9v7M17 5v11" />
        </>
      )}
      {kind === "horizontal" && (
        <>
          <rect x="4" y="8" width="3" height="8" rx="1" />
          <rect x="10.5" y="8" width="3" height="8" rx="1" />
          <rect x="17" y="8" width="3" height="8" rx="1" />
          <path d="M7 19h3.5M13.5 19H17" />
        </>
      )}
      {kind === "vertical" && (
        <>
          <rect x="8" y="4" width="8" height="3" rx="1" />
          <rect x="8" y="10.5" width="8" height="3" rx="1" />
          <rect x="8" y="17" width="8" height="3" rx="1" />
          <path d="M19 7v3.5M19 13.5V17" />
        </>
      )}
    </svg>
  );
}

function mentionStateForValue(value: string, cursor: number): MentionState {
  const safeCursor = Number.isFinite(cursor)
    ? Math.max(0, Math.min(cursor, value.length))
    : value.length;
  const match = /@([^\s@]*)$/.exec(value.slice(0, safeCursor));
  if (!match) return null;
  return {
    start: safeCursor - match[0].length,
    end: safeCursor,
    query: match[1],
  };
}

type CanvasDrafts = {
  image: { prompt: string; params: ImageCreationSettings };
  video: { prompt: string; params: VideoCreationSettings };
  text: { prompt: string; params: AgentCreationSettings };
};
type CanvasEditorDraft = {
  prompt: string;
  params?: CanvasGenerationParams;
  sourceNodeId?: string;
  references?: CanvasReferenceDraft[];
  operation?: "generate" | "edit" | "extend";
  dirty?: boolean;
};
type Interaction =
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      camera: CanvasCamera;
      changed: boolean;
      clearSelectionOnClick: boolean;
    }
  | {
      kind: "nodePress";
      pointerId: number;
      startX: number;
      startY: number;
      startTime: number;
      nodeId: string;
      nodeIds: string[];
      positions: Record<string, Point>;
      shiftKey: boolean;
      doubleClick?: boolean;
      originGroupId?: string;
      originGroupBounds?: { x: number; y: number; w: number; h: number };
      copyOnMove?: boolean;
      preserveInputConnections?: boolean;
    }
  | {
      kind: "drag";
      pointerId: number;
      startX: number;
      startY: number;
      nodeIds: string[];
      positions: Record<string, Point>;
      changed: boolean;
      snapGuides: CanvasSnapGuide[];
      originGroupId?: string;
      originGroupBounds?: { x: number; y: number; w: number; h: number };
      copyOnMove?: boolean;
      preserveInputConnections?: boolean;
    }
  | {
      kind: "resize";
      pointerId: number;
      startX: number;
      startY: number;
      nodeId: string;
      width: number;
      height: number;
      changed: boolean;
    }
  | {
      kind: "resizeGroup";
      pointerId: number;
      startX: number;
      startY: number;
      groupId: string;
      bounds: { x: number; y: number; w: number; h: number };
      origin: Point;
      nodes: Record<string, { x: number; y: number; w: number; h: number }>;
      changed: boolean;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startX: number;
      startY: number;
      changed: boolean;
      additive: boolean;
      baseSelection: string[];
    }
  | {
      kind: "connect";
      pointerId: number;
      sourceId: string;
      sourcePort: "left" | "right";
      end: Point;
      start: Point;
    };
type ConnectionPreview = {
  sourceId: string;
  start: Point;
  end: Point;
  sourcePort: "left" | "right";
};
type ConnectableNodeKind =
  | "image"
  | "video"
  | "text"
  | "workflowImage"
  | "workflowVideo"
  | "upscale";
type ConnectionNodePicker = {
  x: number;
  y: number;
  world: Point;
  sourceId: string;
  sourcePort: "left" | "right";
};

const CANVAS_SETTINGS_KEY = "sanmao.canvas.settings";
const CANVAS_ALIGNMENT_OPTIONS: Array<{
  value: CanvasAlignment;
  label: string;
  title: string;
  icon: CanvasLayoutIconKind;
}> = [
  { value: "left", label: "左对齐", title: "将选中节点左边缘对齐", icon: "left" },
  { value: "center-x", label: "水平居中", title: "将选中节点水平居中", icon: "center-x" },
  { value: "right", label: "右对齐", title: "将选中节点右边缘对齐", icon: "right" },
  { value: "top", label: "顶部对齐", title: "将选中节点顶部对齐", icon: "top" },
  { value: "center-y", label: "垂直居中", title: "将选中节点垂直居中", icon: "center-y" },
  { value: "bottom", label: "底部对齐", title: "将选中节点底部对齐", icon: "bottom" },
];
const CANVAS_DISTRIBUTION_OPTIONS: Array<{
  value: CanvasDistribution;
  label: string;
  title: string;
  icon: CanvasLayoutIconKind;
}> = [
  {
    value: "horizontal",
    label: "水平均匀分布",
    title: "将选中节点按边缘等间隙水平分布",
    icon: "horizontal",
  },
  {
    value: "vertical",
    label: "垂直均匀分布",
    title: "将选中节点按边缘等间隙垂直分布",
    icon: "vertical",
  },
];
const CONNECTION_STYLE_OPTIONS: Array<{
  value: ConnectionStyle;
  label: string;
  description: string;
}> = [
  {
    value: "curve",
    label: "平滑曲线",
    description: "柔和的贝塞尔曲线，适合自由画布",
  },
  {
    value: "straight",
    label: "直线",
    description: "端口之间直接连接，路径最短",
  },
  {
    value: "orthogonal",
    label: "直角折线",
    description: "水平与垂直走线，适合流程图",
  },
];
const CONNECTION_NODE_OPTIONS: Array<{
  kind: ConnectableNodeKind;
  icon: string;
  label: string;
  description: string;
}> = [
  {
    kind: "image",
    icon: "✦",
    label: "图片节点",
    description: "连接到图片生成节点",
  },
  {
    kind: "video",
    icon: "▶",
    label: "视频节点",
    description: "连接到视频生成节点",
  },
  {
    kind: "text",
    icon: "T",
    label: "Agent 节点",
    description: "连接对话上下文并调用对话模型",
  },
  {
    kind: "workflowImage",
    icon: "✧",
    label: "图片变体生成器",
    description: "按多条要求批量生成图片变体",
  },
  {
    kind: "workflowVideo",
    icon: "◆",
    label: "视频变体生成器",
    description: "按多条要求串行生成视频变体",
  },
  {
    kind: "upscale",
    icon: "↗",
    label: "超分节点",
    description: "连接一张已完成图片并打开超分设置",
  },
];
const CANVAS_SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Esc"], label: "关闭弹层、取消当前操作并清除选择" },
  { keys: ["左键"], label: "拖动空白区域平移画布" },
  { keys: ["双击左键"], label: "打开创建节点菜单" },
  { keys: ["右键"], label: "打开画布操作菜单" },
  { keys: ["中键"], label: "拖动平移画布" },
  { keys: ["Space", "左键"], label: "按住 Space 拖动空白区域平移画布" },
  { keys: ["Shift", "左键"], label: "追加选择节点或对象组" },
  { keys: ["Ctrl"], label: "按住并拖拽框选节点" },
  { keys: ["Ctrl", "G"], label: "合并选中的图片为组" },
  { keys: ["Ctrl", "Shift", "G"], label: "释放选中的分组" },
  { keys: ["Ctrl", "Z"], label: "撤销上一步操作" },
  { keys: ["Ctrl", "Shift", "Z"], label: "恢复上一步操作" },
  { keys: ["Ctrl", "C"], label: "复制选中的节点" },
  { keys: ["Ctrl", "V"], label: "粘贴节点或剪贴板图片" },
  { keys: ["Ctrl", "D"], label: "复制选中的节点" },
  {
    keys: ["Delete"],
    label: "删除选中的节点或连线；输入框内 Backspace 编辑文字",
  },
  { keys: ["Alt"], label: "按住并拖动复制节点" },
  { keys: ["Alt", "Shift"], label: "复制节点并保留输入连线" },
  { keys: ["A"], label: "打开/关闭资产库" },
  { keys: ["Z"], label: "适应画布视图" },
  { keys: ["+", "="], label: "放大画布视图" },
  { keys: ["-"], label: "缩小画布视图" },
  { keys: ["Ctrl", "Enter"], label: "执行当前生成任务" },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function defaultParams(
  kind: CanvasMediaKind,
  runtime: CanvasRuntimeState | null,
): CanvasGenerationParams {
  return readSharedCreationSettings(kind, runtime);
}

type CanvasConnectionResult = {
  ok: boolean;
  document: CanvasDocument;
  inputRole?: CanvasInputRole;
  videoMode?: CanvasVideoInputMode;
  reason?: string;
};

function canvasInputRolesForTarget(document: CanvasDocument, targetId: string) {
  const target = nodeById(document, targetId);
  const roles = new Map<string, CanvasInputRole | undefined>();
  const position = new Map<string, number>();
  document.edges
    .filter((edge) => edge.target === targetId)
    .sort((left, right) => {
      const leftOrder = Number(left.order);
      const rightOrder = Number(right.order);
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder)) return leftOrder - rightOrder;
      if (Number.isFinite(leftOrder) !== Number.isFinite(rightOrder)) return Number.isFinite(leftOrder) ? -1 : 1;
      return 0;
    })
    .forEach((edge) => {
      const source = nodeById(document, edge.source);
      if (!source) return;
      const current = position.get(targetId) || 0;
      if (isCanvasReferenceableNode(source) && source.data.kind === "image") position.set(targetId, current + 1);
      roles.set(
        source.id,
        edge.inputRole || (target ? inferCanvasInputRole(source, target, target.data.params && "inputMode" in target.data.params ? target.data.params.inputMode as CanvasVideoInputMode : undefined, current) : undefined),
      );
    });
  return roles;
}

function updateCanvasVideoMode(document: CanvasDocument, targetId: string, inputMode: CanvasVideoInputMode) {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== targetId || (node.type !== "media" && node.type !== "generator")) return node;
      const params = node.data.params;
      if (!params || typeof params !== "object" || !("inputMode" in params)) return node;
      const nextParams = { ...params, inputMode } as VideoCreationSettings;
      return {
        ...node,
        data: {
          ...node.data,
          params: nextParams,
          generation: node.data.generation
            ? { ...node.data.generation, params: nextParams }
            : node.data.generation,
        },
      };
    }),
  };
}

function connectCanvasNodesInDocument(
  document: CanvasDocument,
  sourceId: string,
  targetId: string,
  sourcePort: "left" | "right" = "right",
  targetPort: "left" | "right" = "left",
  runtime: CanvasRuntimeState | null,
  requestedRole?: CanvasInputRole,
): CanvasConnectionResult {
  const source = nodeById(document, sourceId);
  const sourceGroup = groupById(document, sourceId) || (source?.groupId ? groupById(document, source.groupId) : undefined);
  const target = nodeById(document, targetId);
  if ((!source && !sourceGroup) || !target) return { ok: false, document, reason: "源节点或目标节点不存在。" };
  if (source?.id === target.id || sourceGroup?.nodeIds.includes(target.id)) return { ok: false, document, reason: "不能连接自身。" };

  const targetKind = target.type === "media" || target.type === "generator" ? target.data.kind : undefined;
  const sourceKind = source && isCanvasReferenceableNode(source) ? source.data.kind : undefined;
  // A node inside a group carries the whole group as its effective input. Keep
  // that same semantics when the group itself is dragged to a target, so every
  // image/video in the group is visible to the resolver in canvas order.
  const sourceInputs = sourceGroup
    ? groupNodes(document, sourceGroup.id).filter(isCanvasReferenceableNode)
    : source && isCanvasReferenceableNode(source)
      ? [source]
      : [];
  const sourceHasImage = sourceInputs.some((node) => node.data.kind === "image");
  const sourceHasVideo = sourceInputs.some((node) => node.data.kind === "video");
  let inputRole = requestedRole;
  let videoMode: CanvasVideoInputMode | undefined;
  let next = document;

  if (targetKind === "image" && (sourceKind === "video" || sourceHasVideo)) {
    return { ok: false, document, reason: "图片节点不能接收视频作为图片参考。" };
  }

  if (targetKind === "video" && (sourceKind === "image" || sourceHasImage || sourceHasVideo)) {
    const settings = target.data.params && typeof target.data.params === "object" && "inputMode" in target.data.params
      ? target.data.params as VideoCreationSettings
      : normalizeCreationSettings("video", target.data.params, runtime);
    const resolved = resolveAvailableCreationModel(settings, runtime);
    const model = resolved.model;
    // Some providers only publish the coarse `video-generate` capability.
    // The main video panel treats that as supporting image-to-video inputs;
    // keep the canvas connection path consistent so dragging an image onto a
    // fresh video node does not fail before the node can be configured.
    const supportsReference = !model || Boolean(
      model.capabilities.includes("video-reference") ||
      model.capabilities.includes("video-generate"),
    );
    const supportsFirstFrame = !model || Boolean(
      model.capabilities.includes("video-first-frame") ||
      model.capabilities.includes("video-generate"),
    );
    const provider = runtime?.providers.find((item) => item.id === model?.providerId);
    const limits = getVideoModelLimits(model || undefined, provider);
    if (sourceHasVideo && limits.maxReferenceVideos <= 0) {
      return {
        ok: false,
        document,
        reason: "当前视频模型不支持参考视频，请切换到支持参考视频的模型，或移除视频输入。",
      };
    }
    const preferred = preferredCanvasVideoInputMode({ supportsReference, supportsFirstFrame });
    // A video-only connection has no image capability to infer a mode from.
    // Models that expose a positive reference-video limit can still consume it
    // in reference mode, so make that transition explicit instead of leaving
    // the edge in text mode where the video would be silently ignored.
    if (!preferred && !(sourceHasVideo && limits.maxReferenceVideos > 0)) {
      return { ok: false, document, reason: "当前视频模型不支持参考图或首帧输入，请先切换到支持图像输入的模型。" };
    }
    videoMode = settings.inputMode;
    if (requestedRole === "last-frame") videoMode = "frames";
    else if (requestedRole === "first-frame" && videoMode === "text") videoMode = "first-frame";
    else if (
      videoMode === "text" ||
      (videoMode === "reference" && !supportsReference) ||
      ((videoMode === "first-frame" || videoMode === "frames") && !supportsFirstFrame)
    ) videoMode = preferred || "reference";

    const existing = incomingReferences(document, targetId);
    const existingVideoCount = existing.filter((node) => node.data.kind === "video").length;
    const duplicateSourceIds = new Set(existing.map((node) => node.id));
    const newVideoCount = sourceInputs.filter((node) => node.data.kind === "video" && !duplicateSourceIds.has(node.id)).length;
    if (existingVideoCount + newVideoCount > limits.maxReferenceVideos) {
      return {
        ok: false,
        document,
        reason: `当前模型最多接收 ${limits.maxReferenceVideos} 个参考视频，请减少视频输入或切换模型。`,
      };
    }
    const roles = canvasInputRolesForTarget(document, targetId);
    const modeRole = videoMode === "reference"
      ? "reference-image"
      : videoMode === "first-frame"
        ? "first-frame"
        : videoMode === "frames"
          ? (requestedRole === "last-frame" ? "last-frame" : undefined)
          : undefined;
    inputRole = requestedRole === "first-frame" || requestedRole === "last-frame"
      ? requestedRole
      : modeRole;
    if (!inputRole && videoMode === "frames") {
      const current = resolveCanvasVideoInputs(existing, videoMode, roles, { maxReferenceImages: limits.maxReferenceImages });
      inputRole = current.firstFrame ? (current.lastFrame ? undefined : "last-frame") : "first-frame";
    }
    if (!inputRole && videoMode === "first-frame") inputRole = "first-frame";
    if (!inputRole && videoMode === "reference") inputRole = "reference-image";
    const nextRoles = new Map(roles);
    const slotRole = inputRole === "first-frame" || inputRole === "last-frame" ? inputRole : undefined;
    const previousSlotOwner = slotRole
      ? [...roles.entries()].find(([nodeId, role]) => nodeId !== source?.id && role === slotRole)?.[0]
      : undefined;
    if (previousSlotOwner) nextRoles.set(previousSlotOwner, "reference-image");
    if (source) nextRoles.set(source.id, inputRole);
    const resolvedInputs = resolveCanvasVideoInputs(
      [...existing, ...sourceInputs],
      videoMode,
      nextRoles,
      { maxReferenceImages: limits.maxReferenceImages },
    );
    if (resolvedInputs.unused.some((node) => sourceInputs.some((sourceNode) => sourceNode.id === node.id))) {
      const reason = videoMode === "reference"
        ? `当前模型最多接收 ${limits.maxReferenceImages} 张参考图。`
        : videoMode === "first-frame"
          ? "首帧槽位已经有图片；如需更多图片请切换到参考图或首尾帧模式。"
          : "首帧和尾帧槽位已经占满，超出的图片不会参与本次生成。";
      return { ok: false, document, reason };
    }
    if (videoMode !== settings.inputMode) next = updateCanvasVideoMode(next, targetId, videoMode);

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
        return { ok: true, document: next, inputRole, videoMode };
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
  const hasReferenceInput = inputRole === "reference-image" || inputRole === "first-frame" || inputRole === "last-frame" || sourceHasImage || sourceHasVideo;
  next = addEdge(next, sourceId, targetId, sourcePort, targetPort, hasReferenceInput ? "reference" : "manual", inputRole, existingInputs);
  if (next.edges.length === beforeEdges) return { ok: false, document, reason: "这条连线已存在，或不符合当前节点的输入规则。" };
  return { ok: true, document: next, inputRole, videoMode };
}

function canvasVideoInputError(
  inputs: ReturnType<typeof resolveCanvasVideoInputs>,
  inputMode: CanvasVideoInputMode,
  limits: ReturnType<typeof getVideoModelLimits>,
  operation: VideoCreationSettings["operation"] = "generate",
) {
  const connectedImages = inputs.orderedImages;
  const connectedVideos = inputs.media.filter((node) => node.data.kind === "video");
  if (inputMode === "text") {
    if (connectedImages.length || connectedVideos.length) return "已连接图片或参考视频，但当前为文生视频模式；请切换到图片/参考模式，或移除输入后再生成。";
    return undefined;
  }
  if (inputMode === "first-frame") {
    if (!inputs.firstFrame) return "首帧模式请先连接一张首帧图片。";
    if (inputs.unused.some((node) => node.data.kind === "image")) return "首帧模式只支持一张图片；请切换到首尾帧或参考图模式。";
  }
  if (inputMode === "frames") {
    if (!inputs.firstFrame || !inputs.lastFrame) return "首尾帧模式请先连接首帧和尾帧两张图片。";
    if (inputs.unused.some((node) => node.data.kind === "image")) return "首尾帧模式只支持首帧和尾帧两张图片；请移除多余图片或切换到参考图模式。";
  }
  if (inputMode === "reference") {
    if (!inputs.referenceImages.length && !inputs.referenceVideo) return "参考图模式请先连接图片或参考视频。";
    if (inputs.unused.some((node) => node.data.kind === "image")) return `当前模型最多接收 ${limits.maxReferenceImages} 张参考图，请减少图片输入。`;
  }
  if (connectedVideos.length && operation === "generate" && inputMode !== "reference") {
    return "生成视频的首帧/首尾帧模式不能同时使用参考视频；请切换到参考图模式，或移除视频输入。";
  }
  if (!connectedVideos.length) return undefined;
  if (inputMode !== "reference" && operation !== "generate" && limits.maxReferenceVideos <= 0) {
    return "当前视频模型不支持参考视频，请切换到支持参考视频的模型，或移除视频输入。";
  }
  if (limits.maxReferenceVideos <= 0) {
    return "当前视频模型不支持参考视频，请切换到支持参考视频的模型，或移除视频输入。";
  }
  if (connectedVideos.length > limits.maxReferenceVideos) {
    return `当前模型最多接收 ${limits.maxReferenceVideos} 个参考视频，请减少视频输入或切换模型。`;
  }
  return undefined;
}

function copyParams(
  value: unknown,
  kind: CanvasMediaKind,
  runtime: CanvasRuntimeState | null,
) {
  return normalizeCreationSettings(
    kind,
    value && typeof value === "object"
      ? clone(value as CanvasGenerationParams)
      : defaultParams(kind, runtime),
    runtime,
  );
}

function generationKey(source: {
  node?: CanvasNode | null;
  target?: CanvasNode | null;
  kind: Mode;
}) {
  return source.node?.id || source.target?.id || `draft:${source.kind}`;
}

function dataUrlFile(dataUrl: string, name: string) {
  const [header, encoded = ""] = dataUrl.split(",");
  const mime = header.match(/^data:([^;]+)/)?.[1] || "image/png";
  const bytes = atob(encoded);
  const content = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1)
    content[index] = bytes.charCodeAt(index);
  return new File([content], name, { type: mime });
}

function nodeLabel(node: CanvasNode) {
  if (node.type === "upscale") return "图片超分";
  if (node.type === "prompt") return "Agent 节点";
  if (node.type === "generator")
    return node.data.kind === "video" ? "视频变体生成器" : "图片变体生成器";
  return node.data.kind === "video" ? "视频卡片" : "图片卡片";
}

function canvasUpscaleSource(document: CanvasDocument, nodeId: string) {
  return incomingReferences(document, nodeId).find(
    (item) => isCanvasReadyImageSource(item),
  );
}

function canvasConnectableId(target: EventTarget | null) {
  return (target as HTMLElement | null)
    ?.closest<HTMLElement>("[data-canvas-connectable-id]")
    ?.dataset.canvasConnectableId;
}

async function waitForCanvasUpscaleTask(taskId: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, attempt === 0 ? 800 : 2000));
    const latest = await getCanvasUpscaleTask(taskId);
    if (latest.task?.status === "succeeded") return latest;
    if (latest.task?.status === "failed") throw new Error(latest.task.error || "高清处理失败");
  }
  throw new Error("高清处理时间较长，请稍后重试。");
}

const CANVAS_CREATE_MENU_INTERACTIVE_SELECTOR =
  "button,textarea,input,select,[contenteditable=\"true\"],.canvas-node,.canvas-node-asset-drag-handle,.canvas-node-resize,.canvas-node-editor,.canvas-node-editor-popover,.canvas-node-parameters,.canvas-node-quick-toolbar,.canvas-group,.canvas-edge-layer,.canvas-floating,.canvas-deck,.canvas-selection-toolbar,.canvas-selection-layout-toolbar,.canvas-minimap,.canvas-context-menu,.canvas-connection-picker,.select-menu,.select-menu-popover,.model-picker,.model-picker-panel,.model-picker-dialog-backdrop";

// Wheel gestures inside a node or an overlay belong to that control. Keep
// them out of the stage zoom handler so native text/list scrolling can work
// without moving the whole canvas underneath it.
function isCanvasWheelIsolatedTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const selector =
    ".canvas-node, .canvas-node-editor-popover, .canvas-node-quick-toolbar, .canvas-minimap, .canvas-workbench, .canvas-context-menu, .canvas-modal-backdrop, [data-canvas-wheel-isolate]";
  if (target.closest(selector)) return true;

  // Keep future native scroll containers safe without requiring every new
  // panel to add a separate wheel handler. Only treat an element as a scroll
  // target when it can actually scroll in the wheel direction's axis.
  for (let element: HTMLElement | null =
    target instanceof HTMLElement ? target : target.parentElement;
    element && element !== document.body;
    element = element.parentElement) {
    const style = window.getComputedStyle(element);
    const vertical =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight + 1;
    const horizontal =
      /(auto|scroll|overlay)/.test(style.overflowX) &&
      element.scrollWidth > element.clientWidth + 1;
    if (vertical || horizontal) return true;
  }
  return false;
}

function nodeStatus(node: CanvasNode) {
  if (node.data.status === "queued" || node.data.status === "running")
    return node.data.statusLabel || "生成中";
  if (node.data.status === "failed")
    return node.data.statusLabel || "生成失败，可重试";
  if (!node.data.url && node.data.status === "draft")
    return node.data.statusLabel || "选中后在下方生成";
  return node.data.role || "参考素材";
}

function generationLogKind(log: CanvasGenerationLog) {
  if (log.mediaKind) return log.mediaKind;
  if (log.mode === "video") return "video" as const;
  if (log.mode === "audio") return "audio" as const;
  return "image" as const;
}

function generationLogKindLabel(log: CanvasGenerationLog) {
  const kind = generationLogKind(log);
  return kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片";
}

function generationLogStatusLabel(status: CanvasGenerationLog["status"]) {
  return status === "pending" ? "进行中" : status === "success" ? "成功" : "失败";
}

function generationLogDuration(log: CanvasGenerationLog) {
  if (log.status === "pending") return "进行中";
  if (!log.durationMs) return "—";
  return `${(log.durationMs / 1000).toFixed(1)}s`;
}

function generationLogOutputUrls(log: CanvasGenerationLog) {
  return generationLogKind(log) === "video" ? log.videoUrls || [] : log.imageUrls || [];
}

function variantRequirementsFor(node: CanvasNode) {
  return normalizeVariantRequirements(node.data.variantRequirements);
}

function variantStatesFor(node: CanvasNode): CanvasVariantState[] {
  const requirements = variantRequirementsFor(node);
  return requirements.map((instruction, index) => {
    const current = node.data.variantStates?.[index];
    return {
      id: String(current?.id || `variant-${index + 1}`),
      instruction,
      status: current?.status || "pending",
      resultIds: current?.resultIds || [],
      ...(current?.taskIds ? { taskIds: current.taskIds } : {}),
      ...(typeof current?.progress === "number"
        ? { progress: current.progress }
        : {}),
      ...(current?.error ? { error: current.error } : {}),
      ...(current?.updatedAt ? { updatedAt: current.updatedAt } : {}),
    };
  });
}

function variantStatusLabel(status: CanvasVariantState["status"]) {
  return status === "running"
    ? "生成中"
    : status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : "等待中";
}

function variantBatchStatus(states: CanvasVariantState[]) {
  if (states.some((state) => state.status === "running")) return "running" as const;
  if (states.some((state) => state.status === "failed")) return "failed" as const;
  if (states.length && states.every((state) => state.status === "completed"))
    return "completed" as const;
  return "queued" as const;
}

function rectanglesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap = 28,
) {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

function mentionLabel(node: CanvasNode, index: number) {
  return `${index + 1}. ${node.data.name || (node.data.kind === "video" ? "视频素材" : "图片素材")}`;
}

function canvasReferenceDraftFromNode(node: CanvasNode): CanvasReferenceDraft | null {
  if (!isCanvasReferenceableNode(node)) return null;
  return {
    id: `node-ref:${node.id}`,
    nodeId: node.id,
    kind: node.data.kind === "video" ? "video" : "image",
    url: String(node.data.url),
    name: String(node.data.name || (node.data.kind === "video" ? "视频素材" : "图片素材")),
    origin: "node",
  };
}

function mentionedMedia(prompt: string, candidates: CanvasNode[]) {
  const ids = [...prompt.matchAll(/@([0-9]+)/g)]
    .map((match) => Number(match[1]) - 1)
    .filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < candidates.length,
    )
    .map((index) => candidates[index].id);
  return candidates.filter((node) => ids.includes(node.id));
}

function resolveMentionTokens(prompt: string, candidates: CanvasNode[]) {
  return prompt.replace(/@([0-9]+)/g, (token, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    return index >= 0 && index < candidates.length
      ? `参考图${index + 1}`
      : token;
  });
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
  );
}

function isCanvasClipboardPayload(
  value: unknown,
): value is CanvasClipboardPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<CanvasClipboardPayload>;
  return (
    payload.type === "sanmao-canvas-nodes" &&
    payload.version === 1 &&
    Array.isArray(payload.nodes) &&
    Array.isArray(payload.edges) &&
    Array.isArray(payload.groups)
  );
}

function remapNodeReferences(node: CanvasNode, idMap: Map<string, string>) {
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

function duplicateNodes(
  document: CanvasDocument,
  nodeIds: string[],
  offset = { x: 48, y: 48 },
  preserveInputConnections = false,
) {
  const selected = document.nodes.filter((node) => nodeIds.includes(node.id));
  const selectedIds = new Set(selected.map((node) => node.id));
  const idMap = new Map(selected.map((node) => [node.id, uid("node")]));
  const groupMap = new Map<string, string>();
  const groups = document.groups
    .filter(
      (group) =>
        group.nodeIds.length >= 2 &&
        group.nodeIds.every((id) => selectedIds.has(id)),
    )
    .map((group) => {
      const id = uid("group");
      groupMap.set(group.id, id);
      return {
        ...clone(group),
        id,
        nodeIds: group.nodeIds
          .map((nodeId) => idMap.get(nodeId)!)
          .filter(Boolean),
      };
    });
  const copies = selected.map((node) => {
    const copy = remapNodeReferences(clone(node), idMap);
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
  const edgeCandidates = preserveInputConnections
    ? document.edges.filter((edge) => selectedIds.has(edge.target))
    : document.edges.filter(
        (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
      );
  const edges = edgeCandidates.map((edge) => ({
    ...clone(edge),
    id: uid("edge"),
    source: groupMap.get(edge.source) || idMap.get(edge.source) || edge.source,
    target: groupMap.get(edge.target) || idMap.get(edge.target) || edge.target,
  }));
  return {
    nodes: copies,
    edges,
    groups,
    ids: copies.map((node) => node.id),
    groupIds: groups.map((group) => group.id),
  };
}

function createCanvasClipboardPayload(
  document: CanvasDocument,
  nodeIds: string[],
): CanvasClipboardPayload {
  const selected = document.nodes.filter((node) => nodeIds.includes(node.id));
  const selectedIds = new Set(selected.map((node) => node.id));
  return {
    type: "sanmao-canvas-nodes",
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

function CanvasEdgeVisual({
  document,
  edge,
  related,
  style,
  selected,
  onSelect,
  onHover,
  onLeave,
}: {
  document: CanvasDocument;
  edge: CanvasEdge;
  related: boolean;
  style: ConnectionStyle;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
}) {
  const path = edgePath(document, edge, style);
  const colorKey = canvasSourceColorKey(document, edge.source);
  const handlePointerDown = (event: ReactPointerEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0) onSelect();
  };
  const handlePointerEnter = (event: ReactPointerEvent<SVGPathElement>) => {
    event.stopPropagation();
    onHover();
  };
  const handlePointerLeave = () => {
    onLeave();
  };
  return (
    <g className={`canvas-edge-visual node-color-${colorKey}`}>
      <path
        className="canvas-edge-hit"
        d={path}
        aria-hidden="true"
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      />
      <path
        className={`canvas-edge ${related ? "related" : ""} ${selected ? "selected" : ""}`}
        d={path}
        markerEnd={`url(#canvas-arrow-${colorKey})`}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      />
      {related && (
        <path
          className="canvas-edge-related-flow"
          d={path}
          pathLength="1000"
          aria-hidden="true"
        />
      )}
    </g>
  );
}

export default function SuperCanvas() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFilePositionRef = useRef<Point | null>(null);
  const workflowInputRef = useRef<HTMLInputElement | null>(null);
  const openFilePicker = useCallback((position?: Point) => {
    pendingFilePositionRef.current = position || null;
    fileInputRef.current?.click();
  }, []);
  const deckPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const lastNodePressRef = useRef<{ nodeId: string; at: number } | null>(null);
  const canvasPointerDownRef = useRef<{ pointerId: number; interactive: boolean } | null>(null);
  const canvasClipboardRef = useRef<CanvasClipboardPayload | null>(null);
  const docRef = useRef<CanvasDocument>(normalizeDocument(null));
  const saveTimerRef = useRef<number | null>(null);
  const pollTimersRef = useRef<Set<number>>(new Set());
  const pollAttemptsRef = useRef<Map<string, number>>(new Map());
  const pollStartedAtRef = useRef<Map<string, number>>(new Map());
  const runGenerationRef = useRef<(() => Promise<void>) | null>(null);
  const runUpscaleNodeRef = useRef<((node: CanvasNode) => Promise<void>) | null>(null);
  const mountedRef = useRef(true);
  const generationKeysRef = useRef<Set<string>>(new Set());
  const registeredAssetUrlsRef = useRef<Set<string>>(new Set());
  const spaceHeldRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [runtime, setRuntime] = useState<CanvasRuntimeState | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [document, setDocument] = useState<CanvasDocument>(docRef.current);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [expandedEditorId, setExpandedEditorId] = useState<string | null>(null);
  const [nodeGestureActive, setNodeGestureActive] = useState(false);
  const [quickToolbarNodeId, setQuickToolbarNodeId] = useState<string | null>(
    null,
  );
  const [pendingClickNodeId, setPendingClickNodeId] = useState<string | null>(null);
  const [editorDrafts, setEditorDrafts] = useState<Record<string, CanvasEditorDraft>>({});
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const [mode, setMode] = useState<Mode>("image");
  const [drafts, setDrafts] = useState<CanvasDrafts>({
    image: { prompt: "", params: readSharedCreationSettings("image") },
    video: { prompt: "", params: readSharedCreationSettings("video") },
    text: { prompt: "", params: readSharedCreationSettings("text") },
  });
  const [saving, setSaving] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [workspaceSyncStatus, setWorkspaceSyncStatus] = useState<WorkspaceSyncStatus>("idle");
  const [generationKeys, setGenerationKeys] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [snapGuides, setSnapGuides] = useState<CanvasSnapGuide[]>([]);
  const cancelPendingNodeClick = useCallback(() => {
    setPendingClickNodeId(null);
  }, []);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [lightbox, setLightbox] = useState<{
    nodeId: string;
    compare: boolean;
  } | null>(null);
  const [reuseDraft, setReuseDraft] = useState<CanvasReuseDraft | null>(null);
  const [reusePreview, setReusePreview] = useState<CanvasReferenceDraft | null>(null);
  const [textLightboxNodeId, setTextLightboxNodeId] = useState<string | null>(
    null,
  );
  const [agentResult, setAgentResult] = useState<{ value: string; title: string } | null>(null);
  const [activePanel, setActivePanel] = useState<"assets" | "activity" | "settings" | "shortcuts" | null>(null);
  const [topbarCollapsed, setTopbarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("sanmao.canvas.topbar.collapsed") === "true"; } catch { return false; }
  });
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectRename, setProjectRename] = useState(false);
  const [projectRenameValue, setProjectRenameValue] = useState("");
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [connection, setConnection] = useState<ConnectionPreview | null>(null);
  const [connectionNodePicker, setConnectionNodePicker] =
    useState<ConnectionNodePicker | null>(null);
  const [connectionTargetId, setConnectionTargetId] = useState<string | null>(
    null,
  );
  const [connectionCancelEdgeId, setConnectionCancelEdgeId] = useState<
    string | null
  >(null);
  const connectionHoverEdgeRef = useRef<string | null>(null);
  const connectionCancelButtonHoverRef = useRef(false);
  const connectionCancelHideTimerRef = useRef<number | null>(null);
  const [logs, setLogs] = useState<CanvasActivityLog[]>([]);
  const [generationLogs, setGenerationLogs] = useState<CanvasGenerationLog[]>([]);
  const [generationLogsLoading, setGenerationLogsLoading] = useState(false);
  const [draggingNodeIds, setDraggingNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [deckCollapsed, setDeckCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return (
        window.localStorage.getItem("sanmao.canvas.deck.collapsed") === "true"
      );
    } catch {
      return false;
    }
  });
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1200, height: 760 });
  const [deckHeight, setDeckHeight] = useState(0);
  const [connectionStyle, setConnectionStyle] =
    useState<ConnectionStyle>("curve");
  const [theme, setTheme] = useState<CanvasTheme>("light");
  const [mentionState, setMentionState] = useState<MentionState>(null);
  const [panActive, setPanActive] = useState(false);
  const [maskNodeId, setMaskNodeId] = useState<string | null>(null);
  const [assetRefresh, setAssetRefresh] = useState(0);
  const [assetLibraryCollectionId, setAssetLibraryCollectionId] =
    useState("all");
  const [assetCollectionPickerNodeId, setAssetCollectionPickerNodeId] =
    useState<string | null>(null);
  const [assetDropGroupId, setAssetDropGroupId] = useState<string | null>(
    null,
  );
  const [fileDropActive, setFileDropActive] = useState(false);

  const closeCanvasOverlayConflicts = useCallback(() => {
    setContextMenu(null);
    setProjectMenuOpen(false);
    setReusePreview(null);
    setAgentResult(null);
    setLightbox(null);
    setTextLightboxNodeId(null);
    setMaskNodeId(null);
    setAssetCollectionPickerNodeId(null);
    setActivePanel(null);
    setEditingNodeId(null);
    setExpandedEditorId(null);
    setConnectionNodePicker(null);
    setConnectionTargetId(null);
    setConnection(null);
    setMentionState(null);
  }, []);
  const openCanvasMediaViewer = useCallback(
    (nodeId: string, compare = false) => {
      closeCanvasOverlayConflicts();
      setLightbox({ nodeId, compare });
    },
    [closeCanvasOverlayConflicts],
  );
  const openCanvasTextViewer = useCallback(
    (nodeId: string) => {
      closeCanvasOverlayConflicts();
      setTextLightboxNodeId(nodeId);
    },
    [closeCanvasOverlayConflicts],
  );
  const openCanvasMaskEditor = useCallback(
    (nodeId: string) => {
      closeCanvasOverlayConflicts();
      setMaskNodeId(nodeId);
    },
    [closeCanvasOverlayConflicts],
  );
  const openCanvasAssetPicker = useCallback(
    (nodeId: string) => {
      closeCanvasOverlayConflicts();
      setAssetCollectionPickerNodeId(nodeId);
    },
    [closeCanvasOverlayConflicts],
  );
  const openCanvasPanel = useCallback(
    (panel: CanvasPanel) => {
      closeCanvasOverlayConflicts();
      setActivePanel(panel);
    },
    [closeCanvasOverlayConflicts],
  );

  useEffect(() => {
    setTheme(
      window.document.documentElement.dataset.theme === "dark"
        ? "dark"
        : "light",
    );
  }, []);

  const toggleTheme = useCallback(() => {
    const next: CanvasTheme = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.document.documentElement.dataset.theme = next;
    window.document.documentElement.style.colorScheme = next;
    try {
      window.localStorage.setItem("sanmao-theme", next);
    } catch {
      /* 主题偏好保存失败不应阻断画布 */
    }
  }, [theme]);

  const toggleDeckCollapsed = () =>
    setDeckCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(
          "sanmao.canvas.deck.collapsed",
          String(next),
        );
      } catch {
        /* local storage is optional */
      }
      return next;
    });

  const currentProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  const selectedNodes = useMemo(
    () => document.nodes.filter((node) => selectedIds.has(node.id)),
    [document.nodes, selectedIds],
  );
  const selectedImageDownloads = useMemo(
    () =>
      orderCanvasImageItems(
        document.nodes
          .filter((node) => isCanvasReadyImageSource(node))
          .map((node) => ({
            id: node.id,
            name: node.data.name,
            url: String(node.data.url),
          })),
        selectedIds,
      ),
    [document.nodes, selectedIds],
  );
  const selectedSingle = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const relatedConnectionEdgeIds = useMemo(
    () =>
      new Set(
        document.edges
          .filter((edge) =>
            edgeTouchesSelection(
              document,
              edge,
              selectedIds,
              selectedGroupId,
            ),
          )
          .map((edge) => edge.id),
      ),
    [document, selectedGroupId, selectedIds],
  );
  const collapsedGeneratorOutputIds = useMemo(() => {
    const generatorIds = new Set(
      document.nodes.filter((node) => node.type === "generator").map((node) => node.id),
    );
    return new Set(
      document.nodes
        .filter(
          (node) =>
            node.type === "media" &&
            Boolean(node.data.generation?.sourceGeneratorId) &&
            generatorIds.has(String(node.data.generation?.sourceGeneratorId)),
        )
        .map((node) => node.id),
    );
  }, [document.nodes]);
  const visibleCanvasNodes = useMemo(
    () => sortCanvasNodesByLayer(document.nodes).filter((node) => !collapsedGeneratorOutputIds.has(node.id)),
    [collapsedGeneratorOutputIds, document.nodes],
  );
  const visibleCanvasNodeIds = useMemo(
    () => new Set(visibleCanvasNodes.map((node) => node.id)),
    [visibleCanvasNodes],
  );
  const selectedGroup = selectedGroupId
    ? groupById(document, selectedGroupId)
    : undefined;
  const referenceNodes = useMemo(
    () => document.nodes.filter((node) => isCanvasReferenceableNode(node)),
    [document.nodes],
  );
  const canvasAssets = useMemo<AssetRecord[]>(
    () =>
      document.nodes
        .filter((node) => node.type === "media" && Boolean(node.data.url))
        .map((node) => ({
          id: `canvas:${activeProjectId}:${node.id}`,
          kind: node.data.kind === "video" ? "video" : "image",
          url: String(node.data.url),
          name: String(node.data.name || "画布素材"),
          source: (node.data.generation
            ? "canvas-output"
            : "canvas-upload") as AssetSource,
          createdAt: Number(node.data.generation?.createdAt || 0),
          favorite: false,
          prompt: node.data.generation?.prompt,
          modelId: node.data.generation?.params.model,
          modelName:
            typeof node.data.model === "string" ? node.data.model : undefined,
          width: Number(node.data.nativeWidth) || undefined,
          height: Number(node.data.nativeHeight) || undefined,
          projectIds: activeProjectId ? [activeProjectId] : [],
          collectionIds: [],
          tags: [],
        })),
    [activeProjectId, document.nodes],
  );
  const referenceOwnerId = selectedGroupId || selectedSingle?.id;
  const mentionCandidates = useMemo(
    () =>
      selectedGroupId
        ? groupNodes(document, selectedGroupId).filter(
            (node) => isCanvasReferenceableNode(node),
          )
        : referenceOwnerId
          ? incomingReferences(document, referenceOwnerId)
          : referenceNodes,
    [document, referenceNodes, referenceOwnerId, selectedGroupId],
  );

  const setDoc = useCallback((next: CanvasDocument) => {
    const normalized = normalizeCanvasDocumentLayers(docRef.current, next);
    docRef.current = normalized;
    setDocument(normalized);
  }, []);
  const replaceDoc = useCallback((next: CanvasDocument) => {
    const normalized = normalizeDocument(next);
    docRef.current = normalized;
    setDocument(normalized);
  }, []);
  const focusCanvasStage = useCallback(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, []);
  const updateDoc = useCallback(
    (updater: (value: CanvasDocument) => CanvasDocument) =>
      setDoc(updater(docRef.current)),
    [setDoc],
  );
  const commit = useCallback(
    (updater: (value: CanvasDocument) => CanvasDocument) => {
      setUndoStack((items) => [...items, snapshot(docRef.current)].slice(-60));
      setRedoStack([]);
      updateDoc(updater);
    },
    [updateDoc],
  );
  const addLog = useCallback(
    (message: string) => {
      const normalized = message.toLowerCase();
      const type: CanvasActivityLog["type"] = normalized.includes("agent")
        ? "agent"
        : normalized.includes("生成") || normalized.includes("任务") || normalized.includes("超分")
          ? "generation"
          : normalized.includes("资产") || normalized.includes("素材")
            ? "asset"
            : normalized.includes("导入") || normalized.includes("导出") || normalized.includes("项目") || normalized.includes("工作流")
              ? "project"
              : normalized.includes("节点") || normalized.includes("连线") || normalized.includes("对象组")
                ? "canvas"
                : "system";
      const status: CanvasActivityLog["status"] = /失败|错误|超时/.test(message) ? "error" : "ok";
      const entry: CanvasActivityLog = {
        id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message,
        createdAt: new Date().toISOString(),
        type,
        status,
      };
      setLogs((items) => [entry, ...items].slice(0, 120));
    },
    [],
  );
  const notify = useCallback((message: string, kind: Notice["kind"] = "ok") => {
    setNotice({ message, kind });
    window.setTimeout(
      () => setNotice((value) => (value?.message === message ? null : value)),
      kind === "error" ? 5200 : 2800,
    );
  }, []);
  const connectCanvasNodes = useCallback(
    (
      sourceId: string,
      targetId: string,
      sourcePort: "left" | "right" = "right",
      targetPort: "left" | "right" = "left",
      requestedRole?: CanvasInputRole,
    ) => {
      const result = connectCanvasNodesInDocument(
        docRef.current,
        sourceId,
        targetId,
        sourcePort,
        targetPort,
        runtime,
        requestedRole,
      );
      if (!result.ok) {
        notify(result.reason || "连线失败。", "error");
        return false;
      }
      commit(() => result.document);
      addLog(
        result.videoMode
          ? `已连接图片到视频节点，已切换为 ${result.videoMode} 模式`
          : `已连接 ${sourceId} → ${targetId}`,
      );
      notify(
        result.videoMode
          ? `已连接图片，视频节点使用${result.videoMode === "reference" ? "参考图" : result.videoMode === "frames" ? "首尾帧" : "首帧"}模式`
          : "已建立节点连接",
      );
      return true;
    },
    [addLog, commit, notify, runtime],
  );
  const refreshGenerationLogs = useCallback(async () => {
    setGenerationLogsLoading(true);
    try {
      const response = await fetch("/api/generation-logs?limit=200", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        logs?: CanvasGenerationLog[];
      };
      if (!response.ok) throw new Error("任务日志读取失败");
      setGenerationLogs(Array.isArray(body.logs) ? body.logs : []);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "任务日志读取失败",
        "error",
      );
    } finally {
      setGenerationLogsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!ready || activePanel !== "activity") return;
    void refreshGenerationLogs();
    const timer = window.setInterval(() => void refreshGenerationLogs(), 5000);
    return () => window.clearInterval(timer);
  }, [activePanel, ready, refreshGenerationLogs]);

  useEffect(() => {
    let cancelled = false;
    let stopWorkspaceSync = () => {};
    const start = async () => {
      await bootstrapWorkspace();
      if (cancelled) return;
      const storage = ensureCanvasStorage();
      const initial = loadCanvasDocument(storage.activeId);
      const recovered = recoverInterruptedCanvasDocument(initial);
      docRef.current = recovered.document;
      setDocument(recovered.document);
      setProjects(storage.projects);
      setActiveProjectId(storage.activeId);
      setReady(true);
      if (storage.migrated) notify("已将 NOVA 画布项目迁移到 SANMAO.AI");
      if (recovered.recoveredCount)
        notify(`已恢复 ${recovered.recoveredCount} 个中断任务，可重新生成`);
      stopWorkspaceSync = startWorkspaceSync({ onStatus: setWorkspaceSyncStatus });
      void loadCanvasRuntime()
        .then((value) => {
          if (cancelled) return;
          setRuntime(value);
          setDrafts((current) => ({
            ...current,
            image: {
              ...current.image,
              params: readSharedCreationSettings("image", value),
            },
            video: {
              ...current.video,
              params: readSharedCreationSettings("video", value),
            },
            text: {
              ...current.text,
              params: readSharedCreationSettings("text", value),
            },
          }));
        })
        .catch((error: unknown) =>
          setRuntimeError(
            error instanceof Error ? error.message : "模型库读取失败",
          ),
        );
    };
    void start();
    return () => {
      cancelled = true;
      stopWorkspaceSync();
      mountedRef.current = false;
      pollTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      pollTimersRef.current.clear();
      pollAttemptsRef.current.clear();
      pollStartedAtRef.current.clear();
    };
  }, [notify]);

  useEffect(() => {
    if (!ready || !runtime) return;
    const pending = docRef.current.nodes.filter((node) =>
      node.type === "upscale" &&
      node.data.status === "running" &&
      node.data.upscaleRequestId &&
      node.data.jobId,
    );
    pending.forEach((node) => void runUpscaleNodeRef.current?.(node));
  }, [ready, runtime]);

  useEffect(
    () =>
      subscribeSharedCreationSettings(() =>
        setDrafts((current) => ({
          ...current,
          image: {
            ...current.image,
            params: readSharedCreationSettings("image", runtime),
          },
          video: {
            ...current.video,
            params: readSharedCreationSettings("video", runtime),
          },
          text: {
            ...current.text,
            params: readSharedCreationSettings("text", runtime),
          },
        })),
      ),
    [runtime],
  );

  useEffect(() => {
    if (selectedSingle?.type === "prompt") setMode("text");
    else if (
      selectedSingle?.type === "media" ||
      selectedSingle?.type === "generator" ||
      selectedSingle?.type === "upscale"
    )
      setMode(selectedSingle.data.kind === "video" ? "video" : "image");
  }, [selectedSingle?.id, selectedSingle?.type, selectedSingle?.data.kind]);

  useEffect(() => {
    try {
      const raw = JSON.parse(
        window.localStorage.getItem(CANVAS_SETTINGS_KEY) || "null",
      ) as {
        connectionStyle?: unknown;
      } | null;
      if (
        CONNECTION_STYLE_OPTIONS.some(
          (item) => item.value === raw?.connectionStyle,
        )
      )
        setConnectionStyle(raw!.connectionStyle as ConnectionStyle);
    } catch {
      /* 使用默认设置 */
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(
        CANVAS_SETTINGS_KEY,
        JSON.stringify({ connectionStyle }),
      );
    } catch {
      /* 设置保存失败不应阻断画布 */
    }
  }, [connectionStyle, ready]);

  useEffect(() => {
    if (!ready || !activeProjectId) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaving(true);
    setSaveError(false);
    saveTimerRef.current = window.setTimeout(() => {
      const ok = saveCanvasDocument(activeProjectId, document);
      setSaving(false);
      setSaveError(!ok);
      if (ok)
        setProjects((items) =>
          items.map((project) =>
            project.id === activeProjectId
              ? { ...project, updatedAt: Date.now() }
              : project,
          ),
        );
      else notify("画布保存失败，请先导出工作流 JSON。", "error");
    }, 350);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [activeProjectId, document, notify, ready]);

  useEffect(() => {
    if (!ready || !stageRef.current || typeof ResizeObserver === "undefined")
      return;
    const stage = stageRef.current;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [ready]);

  // The composer is an overlay by design, but it must still behave like a
  // reserved work area. Measuring the real rendered height keeps the canvas,
  // minimap and selected-node focus in sync when references, parameters or a
  // multiline prompt expand the deck.
  useEffect(() => {
    if (!ready || !deckRef.current || typeof ResizeObserver === "undefined")
      return;
    const deck = deckRef.current;
    const update = () => {
      const height = Math.ceil(deck.getBoundingClientRect().height);
      setDeckHeight((current) => (current === height ? current : height));
      stageRef.current?.style.setProperty("--canvas-deck-height", `${height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(deck);
    return () => observer.disconnect();
  }, [deckCollapsed, ready]);

  useEffect(() => {
    if (ready && activeProjectId) saveCanvasProjects(projects, activeProjectId);
  }, [activeProjectId, projects, ready]);

  useEffect(() => {
    if (!ready || !activeProjectId) return;
    const pending = document.nodes.filter(
      (node) =>
        node.type === "media" &&
        node.data.url &&
        !registeredAssetUrlsRef.current.has(
          `${node.data.kind}:${node.data.url}`,
        ),
    );
    if (!pending.length) return;
    pending.forEach((node) =>
      registeredAssetUrlsRef.current.add(`${node.data.kind}:${node.data.url}`),
    );
    void Promise.all(
      pending.map((node) =>
        registerCanvasAsset({
          id: String(
            node.data.assetId || `canvas-${activeProjectId}-${node.id}`,
          ),
          kind: node.data.kind === "video" ? "video" : "image",
          url: String(node.data.url),
          name: String(
            node.data.name ||
              (node.data.kind === "video" ? "画布视频" : "画布图片"),
          ),
          source: node.data.generation ? "canvas-output" : "canvas-upload",
          createdAt: Number(node.data.generation?.createdAt || Date.now()),
          prompt: node.data.generation?.prompt,
          modelId: node.data.generation?.params.model,
          modelName:
            typeof node.data.model === "string" ? node.data.model : undefined,
          width: Number(node.data.nativeWidth) || undefined,
          height: Number(node.data.nativeHeight) || undefined,
          projectIds: [activeProjectId],
        }),
      ),
    )
      .then(() => setAssetRefresh((value) => value + 1))
      .catch(() => {
        pending.forEach((node) =>
          registeredAssetUrlsRef.current.delete(
            `${node.data.kind}:${node.data.url}`,
          ),
        );
      });
  }, [activeProjectId, document.nodes, ready]);

  const stagePoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) };
  }, []);
  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const point = stagePoint(clientX, clientY);
      return {
        x: (point.x - document.camera.x) / document.camera.zoom,
        y: (point.y - document.camera.y) / document.camera.zoom,
      };
    },
    [document.camera, stagePoint],
  );
  const stageToWorld = useCallback(
    (point: Point) => ({
      x: (point.x - document.camera.x) / document.camera.zoom,
      y: (point.y - document.camera.y) / document.camera.zoom,
    }),
    [document.camera],
  );
  const worldToScreen = useCallback(
    (x: number, y: number) => ({
      x: x * document.camera.zoom + document.camera.x,
      y: y * document.camera.zoom + document.camera.y,
    }),
    [document.camera],
  );

  const ensureSelectedNodeVisible = useCallback(() => {
    const node = selectedSingle;
    const stage = stageRef.current;
    const deck = deckRef.current;
    if (!node || !stage || !deck || interactionRef.current) return;
    const nodeElement = [...stage.querySelectorAll<HTMLElement>("[data-canvas-node-id]")]
      .find((element) => element.dataset.canvasNodeId === node.id);
    if (!nodeElement) return;
    const stageRect = stage.getBoundingClientRect();
    const nodeRect = nodeElement.getBoundingClientRect();
    const deckRect = deck.getBoundingClientRect();
    const topSafe = 112;
    const bottomSafe = deckRect.top - stageRect.top - 18;
    const safeHeight = bottomSafe - topSafe;
    if (safeHeight < 120) return;

    const size = nodeSize(node);
    const camera = docRef.current.camera;
    const nextZoom = clamp(
      Math.min(
        camera.zoom,
        (safeHeight - 18) / Math.max(1, size.h),
        (stageRect.width - 32) / Math.max(1, size.w),
      ),
      0.12,
      3,
    );
    const currentTop = nodeRect.top - stageRect.top;
    const currentBottom = nodeRect.bottom - stageRect.top;
    const needsVerticalMove = currentTop < topSafe || currentBottom > bottomSafe;
    const needsScale = nextZoom < camera.zoom - 0.005;
    if (!needsVerticalMove && !needsScale) return;

    const renderedHeight = size.h * nextZoom;
    const desiredTop = topSafe + Math.max(0, (safeHeight - renderedHeight) / 2);
    updateDoc((value) => ({
      ...value,
      camera: {
        x: stageRect.width / 2 - (node.x + size.w / 2) * nextZoom,
        y: desiredTop - node.y * nextZoom,
        zoom: nextZoom,
      },
    }));
  }, [selectedSingle, updateDoc]);

  useEffect(() => {
    if (!ready || !selectedSingle) return;
    const frame = window.requestAnimationFrame(ensureSelectedNodeVisible);
    return () => window.cancelAnimationFrame(frame);
  }, [deckHeight, ensureSelectedNodeVisible, ready, selectedSingle?.id]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedGroupId(null);
    setSelectedEdgeId(null);
    setConnectionCancelEdgeId(null);
    setEditingNodeId(null);
    setExpandedEditorId(null);
  }, []);
  const clearConnectionCancelHideTimer = useCallback(() => {
    if (connectionCancelHideTimerRef.current === null) return;
    window.clearTimeout(connectionCancelHideTimerRef.current);
    connectionCancelHideTimerRef.current = null;
  }, []);
  const showConnectionCancel = useCallback(
    (edgeId: string) => {
      if (connection) return;
      clearConnectionCancelHideTimer();
      setConnectionCancelEdgeId(edgeId);
    },
    [clearConnectionCancelHideTimer, connection],
  );
  const hideConnectionCancel = useCallback(() => {
    clearConnectionCancelHideTimer();
    setConnectionCancelEdgeId(null);
    connectionHoverEdgeRef.current = null;
    connectionCancelButtonHoverRef.current = false;
  }, [clearConnectionCancelHideTimer]);
  const scheduleConnectionCancelHide = useCallback(
    (edgeId: string) => {
      clearConnectionCancelHideTimer();
      connectionCancelHideTimerRef.current = window.setTimeout(() => {
        connectionCancelHideTimerRef.current = null;
        if (
          !connectionCancelButtonHoverRef.current &&
          !connectionHoverEdgeRef.current
        )
          setConnectionCancelEdgeId((current) =>
            current === edgeId ? null : current,
          );
      }, 180);
    },
    [clearConnectionCancelHideTimer],
  );
  const handleConnectionHover = useCallback(
    (edgeId: string) => {
      connectionHoverEdgeRef.current = edgeId;
      showConnectionCancel(edgeId);
    },
    [showConnectionCancel],
  );
  const handleConnectionLeave = useCallback(
    (edgeId: string) => {
      if (connectionHoverEdgeRef.current === edgeId)
        connectionHoverEdgeRef.current = null;
      if (!connectionCancelButtonHoverRef.current)
        scheduleConnectionCancelHide(edgeId);
    },
    [scheduleConnectionCancelHide],
  );
  useEffect(() => {
    const handleSpaceDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditableTarget(event.target)) return;
      spaceHeldRef.current = true;
      event.preventDefault();
      if (interactionRef.current?.kind === "pan") setPanActive(true);
    };
    const handleSpaceUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceHeldRef.current = false;
      if (!interactionRef.current) setPanActive(false);
    };
    const handleWindowBlur = () => {
      spaceHeldRef.current = false;
      setPanActive(false);
    };
    window.addEventListener("keydown", handleSpaceDown);
    window.addEventListener("keyup", handleSpaceUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleSpaceDown);
      window.removeEventListener("keyup", handleSpaceUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);
  const openNodePosition = useCallback((position: Point, node: CanvasNode, extraOccupied: CanvasNode[] = []) => {
    const size = nodeSize(node);
    const candidates: Point[] = [{ x: position.x, y: position.y }];
    for (let ring = 1; ring <= 8; ring += 1) {
      const distance = 70 + ring * 30;
      candidates.push(
        { x: position.x + distance, y: position.y },
        { x: position.x - distance, y: position.y },
        { x: position.x, y: position.y + distance },
        { x: position.x, y: position.y - distance },
        { x: position.x + distance, y: position.y + distance },
        { x: position.x - distance, y: position.y + distance },
      );
    }
    const occupied = [...docRef.current.nodes, ...extraOccupied].map((item) => {
      const metric = nodeSize(item);
      return { x: item.x, y: item.y, w: metric.w, h: metric.h };
    });
    return (
      candidates.find(
        (candidate) =>
          !rectanglesOverlap(
            { ...candidate, w: size.w, h: size.h },
            occupied[0] || { x: Infinity, y: Infinity, w: 0, h: 0 },
          ) &&
          occupied.every(
            (item) =>
              !rectanglesOverlap({ ...candidate, w: size.w, h: size.h }, item),
          ),
      ) || position
    );
  }, []);
  const selectNode = useCallback((node: CanvasNode, additive = false) => {
    setSelectedEdgeId(null);
    if (node.groupId) {
      const group = groupById(docRef.current, node.groupId);
      if (group) {
        setSelectedIds((current) => {
          if (
            !additive &&
            current.has(node.id) &&
            current.size >= group.nodeIds.length
          )
            return current;
          if (!additive) return new Set(group.nodeIds);
          const next = new Set(current);
          const allSelected = group.nodeIds.every((id) => next.has(id));
          group.nodeIds.forEach((id) =>
            allSelected ? next.delete(id) : next.add(id),
          );
          return next;
        });
        setSelectedGroupId(additive ? null : group.id);
        return;
      }
    }
    setSelectedGroupId(null);
    setSelectedIds((current) => {
      if (!additive && current.has(node.id) && current.size > 1) return current;
      if (!additive) return new Set([node.id]);
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }, []);

  const startMarquee = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const point = stagePoint(event.clientX, event.clientY);
      setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
      interactionRef.current = {
        kind: "marquee",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        changed: false,
        additive: event.shiftKey,
        baseSelection: event.shiftKey ? [...selectedIds] : [],
      };
      stageRef.current?.setPointerCapture(event.pointerId);
    },
    [selectedIds, stagePoint],
  );
  const capture = useCallback((event: ReactPointerEvent) => {
    stageRef.current?.setPointerCapture(event.pointerId);
  }, []);
  const handleStagePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      const pointTarget = window.document.elementFromPoint(
        event.clientX,
        event.clientY,
      );
      const interactiveTarget =
        target?.closest(CANVAS_CREATE_MENU_INTERACTIVE_SELECTOR) ||
        pointTarget?.closest(CANVAS_CREATE_MENU_INTERACTIVE_SELECTOR);
      canvasPointerDownRef.current = {
        pointerId: event.pointerId,
        interactive: Boolean(interactiveTarget),
      };
      if (target?.closest(".canvas-context-menu") || pointTarget?.closest(".canvas-context-menu")) return;
      // A click in a node or editor should dismiss an already-open create menu
      // even when the child intentionally stops the bubbling pointer event.
      setContextMenu(null);
    },
    [],
  );
  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 1) return;
      const target = event.target as HTMLElement;
      setContextMenu(null);
      if (
        target.closest(
          ".canvas-node,.canvas-group,.canvas-floating,.canvas-deck,.canvas-selection-toolbar,.canvas-selection-layout-toolbar,.canvas-minimap,.canvas-context-menu,.canvas-connection-picker,.select-menu,.select-menu-popover,.model-picker,.model-picker-panel,.model-picker-dialog-backdrop",
        )
      )
        return;
      setConnectionNodePicker(null);
      setDraggingNodeIds(new Set());
      setQuickToolbarNodeId(null);
      cancelPendingNodeClick();
      if (
        event.button === 0 &&
        (event.ctrlKey || event.metaKey) &&
        !spaceHeldRef.current
      )
        return startMarquee(event);
      event.preventDefault();
      interactionRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        camera: document.camera,
        changed: false,
        clearSelectionOnClick:
          event.button === 0 && !event.shiftKey && !spaceHeldRef.current,
      };
      setPanActive(true);
      capture(event);
    },
    [
      capture,
      document.camera,
      cancelPendingNodeClick,
      startMarquee,
    ],
  );

  const startNodeDrag = useCallback(
    (event: ReactPointerEvent, node: CanvasNode) => {
      if (
        event.button !== 0 ||
        (event.target as HTMLElement).closest(
          "textarea,button,.canvas-node-resize",
        )
      )
        return;
      focusCanvasStage();
      if (event.ctrlKey || event.metaKey) return startMarquee(event);
      event.preventDefault();
      event.stopPropagation();
      cancelPendingNodeClick();
      setNodeGestureActive(true);
      setQuickToolbarNodeId(null);
      const now = Date.now();
      const doubleClick = Boolean(
        lastNodePressRef.current &&
          lastNodePressRef.current.nodeId === node.id &&
          now - lastNodePressRef.current.at < 320,
      );
      lastNodePressRef.current = { nodeId: node.id, at: now };
      selectNode(node, event.shiftKey);
      const group = node.groupId
        ? groupById(docRef.current, node.groupId)
        : undefined;
      const ids =
        event.shiftKey && group
          ? (() => {
              const allSelected = group.nodeIds.every((id) =>
                selectedIds.has(id),
              );
              return allSelected
                ? [...selectedIds].filter((id) => !group.nodeIds.includes(id))
                : [...new Set([...selectedIds, ...group.nodeIds])];
            })()
          : event.shiftKey
            ? selectedIds.has(node.id)
              ? [...selectedIds].filter((id) => id !== node.id)
              : [...new Set([...selectedIds, node.id])]
            : node.groupId && selectedGroupId === node.groupId
              ? groupNodes(docRef.current, node.groupId).map((item) => item.id)
              : selectedIds.has(node.id) && selectedIds.size > 1
                ? [...selectedIds]
                : [node.id];
      const dragIds = node.groupId ? [node.id] : ids;
      const originGroupBounds = node.groupId
        ? groupBounds(docRef.current, node.groupId)
        : undefined;
      const positions = Object.fromEntries(
        dragIds.map((id) => {
          const item = nodeById(docRef.current, id);
          return [id, { x: item?.x || 0, y: item?.y || 0 }];
        }),
      );
      interactionRef.current = {
        kind: "nodePress",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: Date.now(),
        nodeId: node.id,
        nodeIds: dragIds,
        positions,
        shiftKey: event.shiftKey,
        doubleClick,
        originGroupId: node.groupId,
        originGroupBounds,
        copyOnMove: event.altKey,
        preserveInputConnections: event.altKey && event.shiftKey,
      };
      capture(event);
    },
    [
      capture,
      cancelPendingNodeClick,
      focusCanvasStage,
      selectNode,
      setNodeGestureActive,
      selectedGroupId,
      selectedIds,
      startMarquee,
    ],
  );

  const startGroupDrag = useCallback(
    (event: ReactPointerEvent, group: CanvasGroup) => {
      if (event.button !== 0) return;
      focusCanvasStage();
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) return startMarquee(event);
      const allSelected = group.nodeIds.every((id) => selectedIds.has(id));
      const ids = event.shiftKey
        ? (() => {
            const next = new Set(selectedIds);
            group.nodeIds.forEach((id) =>
              allSelected ? next.delete(id) : next.add(id),
            );
            setSelectedIds(next);
            setSelectedGroupId(null);
            return [...next];
          })()
        : (() => {
            setSelectedGroupId(group.id);
            setSelectedIds(new Set(group.nodeIds));
            return group.nodeIds;
          })();
      setDraggingNodeIds(new Set(ids));
      setSelectedEdgeId(null);
      setQuickToolbarNodeId(null);
      const positions = Object.fromEntries(
        ids.map((id) => {
          const item = nodeById(docRef.current, id);
          return [id, { x: item?.x || 0, y: item?.y || 0 }];
        }),
      );
      interactionRef.current = {
        kind: "drag",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        nodeIds: ids,
        positions,
        changed: false,
        snapGuides: [],
        copyOnMove: event.altKey,
        preserveInputConnections: event.altKey && event.shiftKey,
      };
      capture(event);
    },
    [capture, focusCanvasStage, selectedIds, startMarquee],
  );

  const startGroupResize = useCallback(
    (event: ReactPointerEvent, group: CanvasGroup) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = groupBounds(docRef.current, group.id);
      const origin = { x: bounds.x + 30, y: bounds.y + 48 };
      const nodes = Object.fromEntries(
        group.nodeIds.flatMap((id) => {
          const node = nodeById(docRef.current, id);
          if (!node) return [];
          const size = nodeSize(node);
          return [[id, { x: node.x, y: node.y, w: size.w, h: size.h }]];
        }),
      );
      setDraggingNodeIds(new Set(group.nodeIds));
      setSelectedGroupId(group.id);
      setSelectedIds(new Set(group.nodeIds));
      setSelectedEdgeId(null);
      interactionRef.current = {
        kind: "resizeGroup",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        groupId: group.id,
        bounds,
        origin,
        nodes,
        changed: false,
      };
      capture(event);
    },
    [capture],
  );

  const startResize = useCallback(
    (event: ReactPointerEvent, node: CanvasNode) => {
      event.preventDefault();
      event.stopPropagation();
      setQuickToolbarNodeId(null);
      setDraggingNodeIds(new Set([node.id]));
      const size = nodeSize(node);
      interactionRef.current = {
        kind: "resize",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        nodeId: node.id,
        width: size.w,
        height: size.h,
        changed: false,
      };
      capture(event);
    },
    [capture],
  );
  const startConnection = useCallback(
    (event: ReactPointerEvent, nodeId: string, port: "left" | "right") => {
      event.preventDefault();
      event.stopPropagation();
      const point = stagePoint(event.clientX, event.clientY);
      setConnectionNodePicker(null);
      setConnection({
        sourceId: nodeId,
        start: point,
        end: point,
        sourcePort: port,
      });
      setConnectionTargetId(null);
      setSelectedEdgeId(null);
      interactionRef.current = {
        kind: "connect",
        pointerId: event.pointerId,
        sourceId: nodeId,
        sourcePort: port,
        end: point,
        start: point,
      };
      capture(event);
    },
    [capture, stagePoint],
  );

  const cancelConnection = useCallback(
    (event?: ReactPointerEvent<HTMLButtonElement>) => {
      event?.preventDefault();
      event?.stopPropagation();
      interactionRef.current = null;
      setConnection(null);
      setConnectionNodePicker(null);
      setConnectionTargetId(null);
      setMarquee(null);
      try {
        if (event) stageRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture already released */
      }
    },
    [],
  );

  const removeConnection = useCallback(
    (edgeId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      commit((value) => removeEdge(value, edgeId));
      setSelectedEdgeId((current) => (current === edgeId ? null : current));
      addLog("已取消连线");
      try {
        stageRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture already released */
      }
    },
    [
      addLog,
      commit,
    ],
  );

  const moveInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      let interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      const dx =
        "startX" in interaction ? event.clientX - interaction.startX : 0;
      const dy =
        "startY" in interaction ? event.clientY - interaction.startY : 0;
      const zoom = docRef.current.camera.zoom;
      if (interaction.kind === "nodePress") {
        const distance = Math.hypot(dx, dy);
        const elapsed = Date.now() - interaction.startTime;
        if (distance > 10 || (elapsed >= 220 && distance > 6)) {
          const press = interaction;
          interactionRef.current = {
            kind: "drag",
            pointerId: press.pointerId,
            startX: press.startX,
            startY: press.startY,
            nodeIds: press.nodeIds,
            positions: press.positions,
            changed: false,
            snapGuides: [],
            originGroupId: press.originGroupId,
            originGroupBounds: press.originGroupBounds,
            copyOnMove: press.copyOnMove,
            preserveInputConnections: press.preserveInputConnections,
          };
          setDraggingNodeIds(new Set(press.nodeIds));
          setQuickToolbarNodeId(null);
          lastNodePressRef.current = null;
          interaction = interactionRef.current;
        }
      }
      if (interaction.kind === "pan" && !interaction.changed) {
        if (Math.hypot(dx, dy) > 4) interaction.changed = true;
      }
      if (interaction.kind === "pan")
        updateDoc((value) => ({
          ...value,
          camera: {
            ...interaction.camera,
            x: interaction.camera.x + dx,
            y: interaction.camera.y + dy,
          },
        }));
      if (interaction.kind === "drag") {
        if (!interaction.changed && Math.abs(dx) + Math.abs(dy) > 2) {
          setUndoStack((items) =>
            [...items, snapshot(docRef.current)].slice(-60),
          );
          setRedoStack([]);
          if (interaction.copyOnMove) {
            const copies = duplicateNodes(
              docRef.current,
              interaction.nodeIds,
              { x: 0, y: 0 },
              interaction.preserveInputConnections,
            );
            const positions = Object.fromEntries(
              copies.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
            );
            interaction.nodeIds = copies.ids;
            interaction.positions = positions;
            interaction.copyOnMove = false;
            interaction.originGroupId = undefined;
            interaction.originGroupBounds = undefined;
            setDoc({
              ...docRef.current,
              nodes: [...docRef.current.nodes, ...copies.nodes],
              edges: [...docRef.current.edges, ...copies.edges],
              groups: [...docRef.current.groups, ...copies.groups],
            });
            setSelectedIds(new Set(copies.ids));
            setDraggingNodeIds(new Set(copies.ids));
            setSelectedGroupId(
              copies.groupIds.length === 1 ? copies.groupIds[0] : null,
            );
            notify(
              interaction.preserveInputConnections
                ? "已复制节点并保留输入连线"
                : `已复制 ${copies.nodes.length} 个节点`,
            );
          }
          interaction.changed = true;
        }
        if (interaction.changed) {
          const proposedPositions = Object.fromEntries(
            interaction.nodeIds.map((id) => [
              id,
              {
                x: interaction.positions[id].x + dx / zoom,
                y: interaction.positions[id].y + dy / zoom,
              },
            ]),
          );
          const snapResult = snapCanvasNodePositions(
            docRef.current.nodes.map((node) => {
              const size = nodeSize(node);
              return {
                id: node.id,
                x: node.x,
                y: node.y,
                w: size.w,
                h: size.h,
              };
            }),
            interaction.nodeIds,
            proposedPositions,
            10 / Math.max(0.12, zoom),
            {
              releaseThreshold: 14 / Math.max(0.12, zoom),
              previousGuides: interaction.snapGuides,
              visibleNodeIds: visibleCanvasNodeIds,
            },
          );
          interaction.snapGuides = snapResult.guides;
          setSnapGuides(snapResult.guides);
          updateDoc((value) => ({
            ...value,
            nodes: value.nodes.map((node) =>
              snapResult.positions[node.id]
                ? {
                    ...node,
                    ...snapResult.positions[node.id],
                  }
                : node,
            ),
          }));
        } else {
          setSnapGuides([]);
        }
      }
      if (interaction.kind === "resize") {
        if (!interaction.changed && Math.abs(dx) + Math.abs(dy) > 2) {
          interaction.changed = true;
          setUndoStack((items) =>
            [...items, snapshot(docRef.current)].slice(-60),
          );
          setRedoStack([]);
        }
        if (interaction.changed)
          updateDoc((value) => ({
            ...value,
            nodes: value.nodes.map((node) =>
              node.id === interaction.nodeId
                ? {
                    ...node,
                    w: Math.max(190, interaction.width + dx / zoom),
                    h: Math.max(130, interaction.height + dy / zoom),
                    data: { ...node.data, autoFit: false },
                  }
                : node,
            ),
          }));
      }
      if (interaction.kind === "resizeGroup") {
        if (!interaction.changed && Math.abs(dx) + Math.abs(dy) > 2) {
          interaction.changed = true;
          setUndoStack((items) =>
            [...items, snapshot(docRef.current)].slice(-60),
          );
          setRedoStack([]);
        }
        if (interaction.changed) {
          const baseWidth = Math.max(1, interaction.bounds.w - 60);
          const baseHeight = Math.max(1, interaction.bounds.h - 78);
          const nextWidth = Math.max(240, baseWidth + dx / zoom);
          const nextHeight = Math.max(180, baseHeight + dy / zoom);
          const scaleX = nextWidth / baseWidth;
          const scaleY = nextHeight / baseHeight;
          updateDoc((value) => ({
            ...value,
            nodes: value.nodes.map((node) => {
              const metric = interaction.nodes[node.id];
              if (!metric) return node;
              return {
                ...node,
                x:
                  interaction.origin.x +
                  (metric.x - interaction.origin.x) * scaleX,
                y:
                  interaction.origin.y +
                  (metric.y - interaction.origin.y) * scaleY,
                w: Math.max(190, metric.w * scaleX),
                h: Math.max(130, metric.h * scaleY),
                data: { ...node.data, autoFit: false },
              };
            }),
          }));
        }
      }
      if (interaction.kind === "marquee") {
        const start = stagePoint(interaction.startX, interaction.startY);
        const point = stagePoint(event.clientX, event.clientY);
        const left = Math.min(start.x, point.x);
        const right = Math.max(start.x, point.x);
        const top = Math.min(start.y, point.y);
        const bottom = Math.max(start.y, point.y);
        const camera = docRef.current.camera;
        const ids = docRef.current.nodes
          .filter((node) => {
            const x = node.x * camera.zoom + camera.x;
            const y = node.y * camera.zoom + camera.y;
            const size = nodeSize(node);
            return (
              x < right &&
              x + size.w * camera.zoom > left &&
              y < bottom &&
              y + size.h * camera.zoom > top
            );
          })
          .map((node) => node.id);
        interaction.changed = true;
        setSelectedIds(
          new Set(
            interaction.additive ? [...interaction.baseSelection, ...ids] : ids,
          ),
        );
        setSelectedGroupId(null);
        setMarquee({
          x: start.x,
          y: start.y,
          w: point.x - start.x,
          h: point.y - start.y,
        });
      }
      if (interaction.kind === "connect") {
        const point = stagePoint(event.clientX, event.clientY);
        interaction.end = point;
        setConnection({
          sourceId: interaction.sourceId,
          start: interaction.start,
          end: point,
          sourcePort: interaction.sourcePort,
        });
        const target = canvasConnectableId(
          window.document.elementFromPoint(event.clientX, event.clientY),
        );
        setConnectionTargetId(
          target && target !== interaction.sourceId ? target : null,
        );
      }
    },
    [notify, setDoc, stagePoint, updateDoc, visibleCanvasNodeIds],
  );

  const finishInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      if (interaction.kind === "nodePress") {
        const node = nodeById(docRef.current, interaction.nodeId);
        if (node) {
          if (interaction.doubleClick) {
            cancelPendingNodeClick();
            setQuickToolbarNodeId(null);
            setExpandedEditorId(null);
            if (reuseDraft?.sourceNodeId === node.id) setReuseDraft(null);
            if (isCanvasReferenceableNode(node))
              openCanvasMediaViewer(node.id);
            else if (node.type === "prompt") openCanvasTextViewer(node.id);
          } else if (!interaction.shiftKey) {
            // A click is confirmed on pointer-up. Dragging has already been
            // promoted to `drag` in moveInteraction, so it cannot open the
            // editor accidentally.
            setQuickToolbarNodeId(node.id);
            setPendingClickNodeId(node.id);
          }
        }
      }
      if (interaction.kind === "marquee") {
        const start = stagePoint(interaction.startX, interaction.startY);
        const point = stagePoint(event.clientX, event.clientY);
        const left = Math.min(start.x, point.x);
        const right = Math.max(start.x, point.x);
        const top = Math.min(start.y, point.y);
        const bottom = Math.max(start.y, point.y);
        const camera = docRef.current.camera;
        const ids = docRef.current.nodes
          .filter((node) => {
            const x = node.x * camera.zoom + camera.x;
            const y = node.y * camera.zoom + camera.y;
            const size = nodeSize(node);
            return (
              x < right &&
              x + size.w * camera.zoom > left &&
              y < bottom &&
              y + size.h * camera.zoom > top
            );
          })
          .map((node) => node.id);
        setSelectedIds(
          new Set(
            interaction.additive ? [...interaction.baseSelection, ...ids] : ids,
          ),
        );
        setSelectedGroupId(null);
      }
      if (interaction.kind === "connect") {
        const point = stagePoint(event.clientX, event.clientY);
        const target =
          connectionTargetId ||
          canvasConnectableId(
            window.document.elementFromPoint(event.clientX, event.clientY),
          );
        const moved =
          Math.hypot(
            point.x - interaction.start.x,
            point.y - interaction.start.y,
          ) > 12;
        if (target && target !== interaction.sourceId) {
          connectCanvasNodes(
            interaction.sourceId,
            target,
            interaction.sourcePort,
            interaction.sourcePort === "right" ? "left" : "right",
          );
          setConnectionNodePicker(null);
        } else if (!target && moved) {
          setConnectionNodePicker({
            x: point.x,
            y: point.y,
            world: stageToWorld(point),
            sourceId: interaction.sourceId,
            sourcePort: interaction.sourcePort,
          });
        } else {
          setConnectionNodePicker(null);
        }
        setConnection(null);
        setConnectionTargetId(null);
      }
      if (
        interaction.kind === "pan" &&
        interaction.clearSelectionOnClick &&
        !interaction.changed
      )
        clearSelection();
      if (interaction.kind === "drag" && interaction.changed) {
        const point = stageToWorld(stagePoint(event.clientX, event.clientY));
        const draggedNodes = interaction.nodeIds
          .map((id) => nodeById(docRef.current, id))
          .filter(Boolean) as CanvasNode[];
        if (draggedNodes.length) {
          const bounds = draggedNodes.reduce(
            (result, node) => {
              const size = nodeSize(node);
              return {
                left: Math.min(result.left, node.x),
                top: Math.min(result.top, node.y),
                right: Math.max(result.right, node.x + size.w),
                bottom: Math.max(result.bottom, node.y + size.h),
              };
            },
            {
              left: Infinity,
              top: Infinity,
              right: -Infinity,
              bottom: -Infinity,
            },
          );
          const dropPoint = {
            x: Number.isFinite(bounds.left)
              ? (bounds.left + bounds.right) / 2
              : point.x,
            y: Number.isFinite(bounds.top)
              ? (bounds.top + bounds.bottom) / 2
              : point.y,
          };
          const target = groupAtPoint(docRef.current, dropPoint);
          const originBounds = interaction.originGroupBounds;
          const insideOrigin = Boolean(
            interaction.originGroupId &&
              originBounds &&
              dropPoint.x >= originBounds.x &&
              dropPoint.x <= originBounds.x + originBounds.w &&
              dropPoint.y >= originBounds.y &&
              dropPoint.y <= originBounds.y + originBounds.h,
          );
          const dropTarget = interaction.originGroupId
            ? insideOrigin
              ? groupById(docRef.current, interaction.originGroupId)
              : [...docRef.current.groups]
                  .reverse()
                  .find((group) => {
                    if (group.id === interaction.originGroupId) return false;
                    const targetBounds = groupBounds(docRef.current, group.id);
                    return (
                      dropPoint.x >= targetBounds.x &&
                      dropPoint.x <= targetBounds.x + targetBounds.w &&
                      dropPoint.y >= targetBounds.y &&
                      dropPoint.y <= targetBounds.y + targetBounds.h
                    );
                  })
            : target;
          const before = docRef.current;
          let after = before;
          if (interaction.originGroupId && !insideOrigin) {
            after = dropTarget
              ? moveNodesToGroup(
                  before,
                  draggedNodes.map((node) => node.id),
                  dropTarget.id,
                )
              : detachNodesFromGroups(
                  before,
                  draggedNodes.map((node) => node.id),
                );
          } else if (!interaction.originGroupId && dropTarget) {
            after = moveNodesToGroup(
              before,
              draggedNodes.map((node) => node.id),
              dropTarget.id,
            );
          }
          if (after !== before) {
            updateDoc(() => after);
            if (dropTarget) {
              setSelectedGroupId(dropTarget.id);
              setSelectedIds(
                new Set(
                  after.groups.find((group) => group.id === dropTarget.id)
                    ?.nodeIds || [],
                ),
              );
              addLog(`已将 ${draggedNodes.length} 个节点加入${dropTarget.name}`);
              notify(`已将 ${draggedNodes.length} 个节点加入${dropTarget.name}`);
            } else {
              setSelectedGroupId(null);
              setSelectedIds(new Set(draggedNodes.map((node) => node.id)));
              addLog("已将节点移出对象组");
              notify("已将节点移出对象组");
            }
          }
        }
      }
      if (
        interaction.kind === "drag" ||
        interaction.kind === "resize" ||
        interaction.kind === "resizeGroup"
      )
        setQuickToolbarNodeId(null);
      setNodeGestureActive(false);
      interactionRef.current = null;
      setDraggingNodeIds(new Set());
      setSnapGuides([]);
      setPanActive(false);
      setMarquee(null);
      try {
        stageRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture already released */
      }
    },
    [
      addLog,
      commit,
      connectCanvasNodes,
      connectionTargetId,
      clearSelection,
      notify,
      cancelPendingNodeClick,
      reuseDraft,
      stagePoint,
      stageToWorld,
      setNodeGestureActive,
      updateDoc,
    ],
  );

  const cancelPointerInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) {
        setNodeGestureActive(false);
        return;
      }
      interactionRef.current = null;
      setNodeGestureActive(false);
      setDraggingNodeIds(new Set());
      setSnapGuides([]);
      setPanActive(false);
      setMarquee(null);
      setConnection(null);
      setConnectionNodePicker(null);
      setConnectionTargetId(null);
      try {
        stageRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture already released */
      }
    },
    [],
  );

  useEffect(() => {
    const handleWindowBlur = () => {
      interactionRef.current = null;
      setNodeGestureActive(false);
      setDraggingNodeIds(new Set());
      setSnapGuides([]);
      setPanActive(false);
      setMarquee(null);
      setConnection(null);
      setConnectionNodePicker(null);
      setConnectionTargetId(null);
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const point = stagePoint(clientX, clientY);
      const before = {
        x: (point.x - document.camera.x) / document.camera.zoom,
        y: (point.y - document.camera.y) / document.camera.zoom,
      };
      const zoom = clamp(document.camera.zoom * factor, 0.12, 3);
      updateDoc((value) => ({
        ...value,
        camera: {
          x: point.x - before.x * zoom,
          y: point.y - before.y * zoom,
          zoom,
        },
      }));
    },
    [document.camera, stagePoint, updateDoc],
  );
  const panToWorld = useCallback(
    (x: number, y: number) => {
      updateDoc((value) => ({
        ...value,
        camera: {
          ...value.camera,
          x: stageSize.width / 2 - x * value.camera.zoom,
          y: stageSize.height / 2 - y * value.camera.zoom,
        },
      }));
    },
    [stageSize.height, stageSize.width, updateDoc],
  );
  const moveMinimapNodes = useCallback(
    (positions: Record<string, Point>, recordHistory: boolean) => {
      if (recordHistory) {
        setUndoStack((items) =>
          [...items, snapshot(docRef.current)].slice(-60),
        );
        setRedoStack([]);
      }
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          positions[node.id] ? { ...node, ...positions[node.id] } : node,
        ),
      }));
    },
    [updateDoc],
  );
  const fitView = useCallback(
    (ids?: string[]) => {
      const targets = ids?.length
        ? ids
        : docRef.current.nodes.map((node) => node.id);
      const rect = stageRef.current?.getBoundingClientRect();
      const width = rect?.width || 1200;
      const height = rect?.height || 760;
      if (!targets.length) {
        updateDoc((value) => ({
          ...value,
          camera: { x: width / 2, y: height / 2, zoom: 1 },
        }));
        return;
      }
      const bounds = targets.map((id) => entityBounds(docRef.current, id));
      const minX = Math.min(...bounds.map((item) => item.x));
      const minY = Math.min(...bounds.map((item) => item.y));
      const maxX = Math.max(...bounds.map((item) => item.x + item.w));
      const maxY = Math.max(...bounds.map((item) => item.y + item.h));
      const zoom = clamp(
        Math.min(
          (width - 180) / Math.max(1, maxX - minX),
          (height - 320) / Math.max(1, maxY - minY),
        ),
        0.12,
        1.25,
      );
      updateDoc((value) => ({
        ...value,
        camera: {
          x: width / 2 - (minX + (maxX - minX) / 2) * zoom,
          y: (height - 120) / 2 - (minY + (maxY - minY) / 2) * zoom,
          zoom,
        },
      }));
    },
    [updateDoc],
  );

  const arrangeCanvasAction = useCallback(() => {
    const selected = selectedIds.size ? [...selectedIds] : undefined;
    const result = arrangeCanvas(docRef.current, selected);
    if (result.changed) {
      setUndoStack((items) => [...items, snapshot(docRef.current)].slice(-60));
      setRedoStack([]);
      setDoc(result.document);
      addLog(
        selected
          ? `已整理选中的 ${result.arrangedIds.length} 个节点`
          : `已整理全部 ${result.arrangedIds.length} 个节点`,
      );
      notify(
        selected
          ? `已整理选中的 ${result.arrangedIds.length} 个节点`
          : `已整理全部 ${result.arrangedIds.length} 个节点`,
      );
    } else {
      notify(selected ? "选中节点无需重新整理" : "画布无需重新整理");
    }
    fitView(result.arrangedIds);
  }, [addLog, fitView, notify, selectedIds, setDoc]);

  const reorderSelection = useCallback(
    (action: CanvasNodeLayerAction, nodeIds?: string[]) => {
      const ids = nodeIds?.length
        ? nodeIds
        : selectedIds.size
          ? [...selectedIds]
          : [];
      if (!ids.length) return;
      const labels: Record<CanvasNodeLayerAction, string> = {
        "bring-to-front": "置于顶层",
        "bring-to-back": "置于底层",
        raise: "上移一层",
        lower: "下移一层",
      };
      const next = reorderCanvasNodes(docRef.current, ids, action);
      if (next === docRef.current) {
        const boundary = action === "bring-to-back" || action === "lower" ? "底层" : "顶层";
        notify(`选中的 ${ids.length} 个节点已在${boundary}`);
        return;
      }
      commit(() => next);
      setSelectedIds(new Set(ids));
      const message = `已将 ${ids.length} 个节点${labels[action]}`;
      addLog(message);
      notify(message);
    },
    [addLog, commit, notify, selectedIds],
  );

  const alignSelection = useCallback(
    (alignment: CanvasAlignment) => {
      if (selectedGroupId || selectedNodes.length < 2) return;
      const option = CANVAS_ALIGNMENT_OPTIONS.find((item) => item.value === alignment);
      const result = alignCanvasNodes(
        docRef.current,
        [...selectedIds],
        alignment,
      );
      const label = option?.label || "对齐";
      if (!result.changed) {
        notify("已对齐");
        return;
      }
      commit(() => result.document);
      addLog(`已将 ${result.alignedIds.length} 个节点${label}`);
      notify(`已将 ${result.alignedIds.length} 个节点${label}`);
    },
    [addLog, commit, notify, selectedGroupId, selectedIds, selectedNodes.length],
  );

  const distributeSelection = useCallback(
    (direction: CanvasDistribution) => {
      if (selectedGroupId || selectedNodes.length < 3) return;
      const option = CANVAS_DISTRIBUTION_OPTIONS.find(
        (item) => item.value === direction,
      );
      const result = distributeCanvasNodes(
        docRef.current,
        [...selectedIds],
        direction,
      );
      const label = option?.label || "均匀分布";
      if (!result.changed) {
        notify("已均匀分布");
        return;
      }
      commit(() => result.document);
      addLog(`已将 ${result.alignedIds.length} 个节点${label}`);
      notify(`已将 ${result.alignedIds.length} 个节点${label}`);
    },
    [addLog, commit, notify, selectedGroupId, selectedIds, selectedNodes.length],
  );

  const undo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((items) => [...items, snapshot(docRef.current)]);
    setUndoStack((items) => items.slice(0, -1));
    setDoc(normalizeDocument(previous));
    clearSelection();
  }, [clearSelection, setDoc, undoStack]);
  const redo = useCallback(() => {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((items) => [...items, snapshot(docRef.current)]);
    setRedoStack((items) => items.slice(0, -1));
    setDoc(normalizeDocument(next));
    clearSelection();
  }, [clearSelection, redoStack, setDoc]);

  const addNode = useCallback(
    (
      kind: "image" | "video" | "text" | "workflowImage" | "workflowVideo" | "upscale",
      position?: Point,
    ) => {
      if (kind === "upscale") {
        const seed = position || screenToWorld(stageSize.width / 2, stageSize.height / 2);
        const draft = createUpscaleNode(seed);
        const point = position ? seed : openNodePosition(seed, draft);
        const node = { ...draft, x: point.x, y: point.y };
        const source = selectedSingle && isCanvasReadyImageSource(selectedSingle) ? selectedSingle : undefined;
        const connected = source ? addEdge({ ...docRef.current, nodes: [...docRef.current.nodes, node] }, source.id, node.id, "right", "left", "manual", "upscale-image") : { ...docRef.current, nodes: [...docRef.current.nodes, node] };
        commit(() => connected);
        setSelectedIds(new Set([node.id]));
        setSelectedGroupId(null);
        setExpandedEditorId(node.id);
        setContextMenu(null);
        notify("已添加超分节点");
        return;
      }
      const mediaKind =
        kind === "workflowVideo" || kind === "video" ? "video" : "image";
      const params = defaultParams(mediaKind, runtime);
      const seed =
        position || screenToWorld(stageSize.width / 2, stageSize.height / 2);
      const draft =
        kind === "text"
          ? createPrompt(seed)
          : kind === "workflowImage" || kind === "workflowVideo"
            ? createGenerator(mediaKind, seed, params)
            : createEmptyMedia(mediaKind, seed, params);
      const point = position ? seed : openNodePosition(seed, draft);
      const node = { ...draft, x: point.x, y: point.y };
      commit((value) => ({ ...value, nodes: [...value.nodes, node] }));
      setSelectedIds(new Set([node.id]));
      setSelectedGroupId(null);
      setMode(kind === "text" ? "text" : mediaKind);
      setContextMenu(null);
      notify(
        `已添加${kind === "text" ? "Agent" : kind === "workflowVideo" ? "视频变体生成器" : kind === "workflowImage" ? "图片变体生成器" : mediaKind === "video" ? "视频" : "图片"}节点`,
      );
    },
    [
      commit,
      notify,
      openNodePosition,
      runtime,
      screenToWorld,
      stageSize.height,
      stageSize.width,
      selectedSingle,
    ],
  );
  const connectNewNode = useCallback(
    (kind: ConnectableNodeKind, picker: ConnectionNodePicker) => {
      if (
        !nodeById(docRef.current, picker.sourceId) &&
        !groupById(docRef.current, picker.sourceId)
      ) {
        setConnectionNodePicker(null);
        return notify("源节点已不存在，请重新发起连线。", "error");
      }
      if (kind === "upscale" && groupById(docRef.current, picker.sourceId)) {
        setConnectionNodePicker(null);
        return notify("对象组不能作为超分输入，请连接单张图片", "error");
      }
      const sourceNode = nodeById(docRef.current, picker.sourceId);
      if (
        kind === "upscale" &&
        !isCanvasReadyImageSource(sourceNode)
      ) {
        setConnectionNodePicker(null);
        return notify("超分节点只接受一张已完成的图片", "error");
      }
      const mediaKind =
        kind === "workflowVideo" || kind === "video" ? "video" : "image";
      const params = defaultParams(mediaKind, runtime);
      const draft =
        kind === "upscale"
          ? createUpscaleNode(picker.world)
          : kind === "text"
          ? createPrompt(picker.world)
          : kind === "workflowImage" || kind === "workflowVideo"
            ? createGenerator(mediaKind, picker.world, params)
            : createEmptyMedia(mediaKind, picker.world, params);
      const size = nodeSize(draft);
      const seed = {
        x: picker.world.x - size.w / 2,
        y: picker.world.y - size.h / 2,
      };
      const point = openNodePosition(seed, draft);
      const node = { ...draft, x: point.x, y: point.y };
      const targetPort = picker.sourcePort === "right" ? "left" : "right";
      const connected = connectCanvasNodesInDocument(
        { ...docRef.current, nodes: [...docRef.current.nodes, node] },
        picker.sourceId,
        node.id,
        picker.sourcePort,
        targetPort,
        runtime,
      );
      if (!connected.ok) {
        setConnectionNodePicker(null);
        return notify(connected.reason || "连接新节点失败。", "error");
      }
      commit(() => connected.document);
      setConnectionNodePicker(null);
      setSelectedIds(new Set([node.id]));
      setSelectedGroupId(null);
      setMode(kind === "text" ? "text" : mediaKind);
      if (kind === "upscale") setExpandedEditorId(node.id);
      notify(
        `已添加并连接${kind === "text" ? "Agent" : kind === "workflowVideo" ? "视频变体生成器" : kind === "workflowImage" ? "图片变体生成器" : mediaKind === "video" ? "视频" : "图片"}节点`,
      );
    },
    [commit, notify, openNodePosition, runtime],
  );
  const deleteSelection = useCallback(() => {
    if (!selectedIds.size) return;
    const count = selectedIds.size;
    commit((value) => removeNodes(value, [...selectedIds]));
    clearSelection();
    notify(`已删除 ${count} 个对象`);
  }, [clearSelection, commit, notify, selectedIds]);
  const duplicateSelection = useCallback(() => {
    if (!selectedIds.size) return;
    const copies = duplicateNodes(
      docRef.current,
      [...selectedIds],
      { x: 48, y: 48 },
      true,
    );
    commit((value) => ({
      ...value,
      nodes: [...value.nodes, ...copies.nodes],
      edges: [...value.edges, ...copies.edges],
      groups: [...value.groups, ...copies.groups],
    }));
    setSelectedIds(new Set(copies.ids));
    setSelectedGroupId(
      copies.groupIds.length === 1 ? copies.groupIds[0] : null,
    );
    notify(`已复制 ${copies.nodes.length} 个对象，并保留输入连线`);
  }, [commit, notify, selectedIds]);
  const makeGroup = useCallback(() => {
    if (selectedIds.size < 2)
      return notify("请先选择至少 2 个对象再成组。", "error");
    const next = createGroup(docRef.current, [...selectedIds]);
    const group = next.groups.at(-1);
    commit(() => next);
    if (group) {
      setSelectedGroupId(group.id);
      setSelectedIds(new Set(group.nodeIds));
    }
    notify("已创建对象组");
  }, [commit, notify, selectedIds]);
  const breakGroup = useCallback(() => {
    if (!selectedGroupId) return;
    const id = selectedGroupId;
    commit((value) => {
      const group = groupById(value, id);
      if (!group) return value;
      return {
        ...value,
        nodes: value.nodes.map((node) =>
          group.nodeIds.includes(node.id)
            ? { ...node, groupId: undefined }
            : node,
        ),
        groups: value.groups.filter((item) => item.id !== id),
        edges: value.edges.filter(
          (edge) => edge.source !== id && edge.target !== id,
        ),
      };
    });
    clearSelection();
    notify("已解散对象组");
  }, [clearSelection, commit, notify, selectedGroupId]);
  const removeNodeFromGroup = useCallback(
    (nodeId: string) => {
      const node = nodeById(docRef.current, nodeId);
      if (!node?.groupId) return;
      const group = groupById(docRef.current, node.groupId);
      const next = detachNodesFromGroups(docRef.current, [nodeId]);
      if (next === docRef.current) return;
      commit(() => next);
      setSelectedGroupId(null);
      setSelectedIds(new Set([nodeId]));
      notify(`已将${nodeLabel(node)}移出${group?.name || "对象组"}`);
    },
    [commit, notify],
  );

  const openProject = useCallback(
    (id: string) => {
      if (id === activeProjectId) {
        setProjectMenuOpen(false);
        return;
      }
      saveCanvasDocument(activeProjectId, docRef.current);
      const next = loadCanvasDocument(id);
      replaceDoc(next);
      setActiveProjectId(id);
      clearSelection();
      setUndoStack([]);
      setRedoStack([]);
      setProjectMenuOpen(false);
      addLog(
        `已打开项目：${projects.find((project) => project.id === id)?.name || "未命名画布"}`,
      );
    },
    [activeProjectId, addLog, clearSelection, projects, replaceDoc],
  );
  const newProject = useCallback(() => {
    const project: CanvasProject = {
      id: `canvas_${Date.now().toString(36)}`,
      name: `新画布 ${projects.length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [project, ...projects];
    saveCanvasProjects(next, project.id);
    saveCanvasDocument(project.id, normalizeDocument(null));
    setProjects(next);
    setActiveProjectId(project.id);
    setDoc(normalizeDocument(null));
    clearSelection();
    setUndoStack([]);
    setRedoStack([]);
    setProjectMenuOpen(false);
    notify("已新建画布");
  }, [clearSelection, notify, projects, setDoc]);
  const saveProjectName = useCallback(() => {
    const name = projectRenameValue.trim();
    if (!name || !currentProject) return;
    setProjects((items) =>
      items.map((project) =>
        project.id === currentProject.id
          ? { ...project, name: name.slice(0, 60), updatedAt: Date.now() }
          : project,
      ),
    );
    setProjectRename(false);
    notify("项目名称已更新");
  }, [currentProject, notify, projectRenameValue]);
  const deleteProject = useCallback(
    (id: string) => {
      if (projects.length <= 1) return notify("至少保留一个画布。", "error");
      const project = projects.find((item) => item.id === id);
      if (
        !window.confirm(
          `删除“${project?.name || "这个画布"}”？本地内容会被移除。`,
        )
      )
        return;
      const next = projects.filter((item) => item.id !== id);
      deleteCanvasProject(id);
      setProjects(next);
      if (id === activeProjectId) {
        const replacement = next[0];
        replaceDoc(loadCanvasDocument(replacement.id));
        setActiveProjectId(replacement.id);
        clearSelection();
        setUndoStack([]);
        setRedoStack([]);
        setProjectMenuOpen(false);
      }
      notify("画布项目已删除");
    },
    [activeProjectId, clearSelection, notify, projects, replaceDoc],
  );

  const exportWorkflow = useCallback(() => {
    const blob = new Blob(
      [
        canvasProjectFromDocument(
          currentProject?.name || "SANMAO 无限画布",
          document,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentProject?.name || "SANMAO画布"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    addLog("已导出工作流 JSON");
    notify("工作流已导出");
  }, [addLog, currentProject?.name, document, notify]);
  const importWorkflow = useCallback(
    async (file: File) => {
      try {
        const next = normalizeDocument(JSON.parse(await file.text()));
        commit(() => next);
        clearSelection();
        fitView();
        addLog(`已导入工作流：${file.name}`);
        notify("工作流已导入");
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "工作流 JSON 无效。",
          "error",
        );
      }
    },
    [addLog, clearSelection, commit, fitView, notify],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[], position?: Point) => {
      const list = [...files].filter(
        (file) =>
          file.type.startsWith("image/") || file.type.startsWith("video/"),
      );
      if (!list.length) return notify("请选择图片或视频素材。", "error");
      const rect = stageRef.current?.getBoundingClientRect();
      const center = {
        x: (rect?.left || 0) + (rect?.width || stageSize.width) / 2,
        y: (rect?.top || 0) + (rect?.height || stageSize.height) / 2,
      };
      const base = position || screenToWorld(center.x, center.y);
      const nodes: CanvasNode[] = [];
      let optimizedImageCount = 0;
      for (const [index, file] of list.entries()) {
        try {
          const asset = await uploadCanvasAsset(file);
          if (asset.kind === "image" && asset.optimized) optimizedImageCount += 1;
          const draft = createMedia(
            asset.kind,
            asset.url,
            asset.name,
            {
              x: base.x + (index % 3) * 350,
              y: base.y + Math.floor(index / 3) * 270,
            },
            {
              role: "参考素材",
              params: defaultParams(asset.kind, runtime),
            },
          );
          const point = position
            ? openNodePosition(
                {
                  x: base.x + (index % 3) * 350,
                  y: base.y + Math.floor(index / 3) * 270,
                },
                draft,
                nodes,
              )
            : draft;
          nodes.push({ ...draft, x: point.x, y: point.y });
          addLog(
            `已导入${asset.kind === "video" ? "视频" : "图片"}：${file.name}`,
          );
        } catch (error) {
          notify(
            error instanceof Error ? error.message : "素材上传失败。",
            "error",
          );
        }
      }
      if (nodes.length) {
        commit((value) => ({ ...value, nodes: [...value.nodes, ...nodes] }));
        setSelectedIds(new Set(nodes.map((node) => node.id)));
        setSelectedGroupId(null);
        notify(
          optimizedImageCount
            ? `已自动优化 ${optimizedImageCount} 张图片后上传，已导入 ${nodes.length} 个素材`
            : `已导入 ${nodes.length} 个素材`,
        );
      }
    },
    [
      addLog,
      commit,
      notify,
      openNodePosition,
      runtime,
      screenToWorld,
      stageSize.height,
      stageSize.width,
    ],
  );

  const copySelection = useCallback(async () => {
    if (!selectedIds.size) return notify("请先选择要复制的节点。", "error");
    const payload = createCanvasClipboardPayload(docRef.current, [
      ...selectedIds,
    ]);
    canvasClipboardRef.current = payload;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
    } catch {
      /* 内部剪贴板仍可在当前画布中使用 */
    }
    notify(`已复制 ${payload.nodes.length} 个节点`);
  }, [notify, selectedIds]);

  const pasteCanvasPayload = useCallback(
    (payload: CanvasClipboardPayload, position?: Point) => {
      const source = payload.nodes;
      if (!source.length) return notify("剪贴板中没有可粘贴的节点。", "error");
      const minX = Math.min(...source.map((node) => node.x));
      const minY = Math.min(...source.map((node) => node.y));
      const rect = stageRef.current?.getBoundingClientRect();
      const center = {
        x: (rect?.left || 0) + (rect?.width || stageSize.width) / 2,
        y: (rect?.top || 0) + (rect?.height || stageSize.height) / 2,
      };
      const target = position || screenToWorld(center.x, center.y);
      const idMap = new Map(source.map((node) => [node.id, uid("node")]));
      const groupMap = new Map(
        payload.groups.map((group) => [group.id, uid("group")]),
      );
      let nodes = source.map((node) => {
        const copy = remapNodeReferences(clone(node), idMap);
        return {
          ...copy,
          id: idMap.get(node.id)!,
          x: node.x + target.x - minX + 48,
          y: node.y + target.y - minY + 48,
          ...(node.groupId && groupMap.has(node.groupId)
            ? { groupId: groupMap.get(node.groupId) }
            : { groupId: undefined }),
        };
      });
      if (position && nodes.length) {
        const maxX = Math.max(...source.map((node) => node.x + nodeSize(node).w));
        const maxY = Math.max(...source.map((node) => node.y + nodeSize(node).h));
        const desiredOrigin = {
          x: target.x - minX + 48,
          y: target.y - minY + 48,
        };
        const probe = {
          ...nodes[0],
          x: desiredOrigin.x,
          y: desiredOrigin.y,
          w: Math.max(1, maxX - minX),
          h: Math.max(1, maxY - minY),
        };
        const placedOrigin = openNodePosition(desiredOrigin, probe);
        const offset = {
          x: placedOrigin.x - desiredOrigin.x,
          y: placedOrigin.y - desiredOrigin.y,
        };
        if (offset.x || offset.y) {
          nodes = nodes.map((node) => ({
            ...node,
            x: node.x + offset.x,
            y: node.y + offset.y,
          }));
        }
      }
      const groups = payload.groups.map((group) => ({
        ...clone(group),
        id: groupMap.get(group.id)!,
        nodeIds: group.nodeIds.map((id) => idMap.get(id)!).filter(Boolean),
      }));
      const nodeIds = new Set(source.map((node) => node.id));
      const edges = payload.edges
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map((edge) => ({
          ...clone(edge),
          id: uid("edge"),
          source: idMap.get(edge.source)!,
          target: idMap.get(edge.target)!,
        }));
      commit((value) => ({
        ...value,
        nodes: [...value.nodes, ...nodes],
        edges: [...value.edges, ...edges],
        groups: [...value.groups, ...groups],
      }));
      setSelectedIds(new Set(nodes.map((node) => node.id)));
      setSelectedGroupId(groups.length === 1 ? groups[0].id : null);
      notify(`已粘贴 ${nodes.length} 个节点`);
    },
    [commit, notify, openNodePosition, screenToWorld, stageSize.height, stageSize.width],
  );

  const pasteFromClipboard = useCallback(async (position?: Point) => {
    let clipboardText = "";
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) =>
            type.startsWith("image/"),
          );
          if (imageType) {
            const blob = await item.getType(imageType);
            await handleFiles([
              new File(
                [blob],
                `剪贴板图片.${imageType.split("/")[1] || "png"}`,
                { type: imageType },
              ),
            ], position);
            return;
          }
        }
        const textType = items
          .flatMap((item) => item.types)
          .find((type) => type === "text/plain");
        if (textType) {
          const blob = await items
            .find((item) => item.types.includes(textType))!
            .getType(textType);
          clipboardText = await blob.text();
          const parsed: unknown = JSON.parse(clipboardText);
          if (isCanvasClipboardPayload(parsed))
            return pasteCanvasPayload(parsed, position);
        }
      }
      if (!clipboardText)
        clipboardText = (await navigator.clipboard?.readText()) || "";
      if (clipboardText) {
        const parsed: unknown = JSON.parse(clipboardText);
        if (isCanvasClipboardPayload(parsed)) return pasteCanvasPayload(parsed, position);
      }
      if (canvasClipboardRef.current)
        pasteCanvasPayload(canvasClipboardRef.current, position);
    } catch {
      if (!clipboardText && canvasClipboardRef.current)
        pasteCanvasPayload(canvasClipboardRef.current, position);
      else
        notify(
          clipboardText
            ? "剪贴板内容不是可粘贴的画布节点或图片。"
            : "无法读取剪贴板内容，请检查浏览器权限。",
          "error",
        );
    }
  }, [handleFiles, notify, pasteCanvasPayload]);

  const toggleAssetLibrary = useCallback(() => {
    if (activePanel === "assets") setActivePanel(null);
    else openCanvasPanel("assets");
  }, [activePanel, openCanvasPanel]);

  const setMediaNaturalSize = useCallback(
    (
      nodeId: string,
      width: number,
      height: number,
      durationSeconds?: number,
    ) => {
      const durationMs =
        typeof durationSeconds === "number" &&
        Number.isFinite(durationSeconds) &&
        durationSeconds > 0
          ? Math.round(durationSeconds * 1000)
          : undefined;
      if ((!width || !height) && !durationMs) return;
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== "media") return node;
          const nextData = {
            ...node.data,
            ...(width && height
              ? { nativeWidth: width, nativeHeight: height }
              : {}),
            ...(durationMs ? { durationMs } : {}),
          };
          if (!width || !height)
            return { ...node, data: nextData };
          if (node.data.autoFit === false)
            return {
              ...node,
              data: nextData,
            };
          return {
            ...node,
            ...mediaCardSizeForRatio(width / height, node.data.kind || "image"),
            data: nextData,
          };
        }),
      }));
    },
    [updateDoc],
  );

  const deckSource = useCallback(() => {
    if (selectedSingle?.type === "prompt") {
      return {
        kind: "text" as const,
        // A completed Agent node displays its answer in `text`, but reruns
        // must use the original request so the conversation is reproducible.
        prompt: String(
          selectedSingle.data.agentPrompt || selectedSingle.data.text || "",
        ),
        params: normalizeCreationSettings(
          "text",
          selectedSingle.data.params,
          runtime,
        ),
        node: selectedSingle,
        target: null as CanvasNode | null,
      };
    }
    if (selectedSingle?.type === "generator") {
      const kind: CanvasMediaKind = selectedSingle.data.kind || "image";
      return {
        kind,
        prompt: String(selectedSingle.data.prompt || ""),
        params: copyParams(selectedSingle.data.params, kind, runtime),
        node: selectedSingle,
        target: null as CanvasNode | null,
      };
    }
    if (selectedSingle?.type === "media") {
      const kind: CanvasMediaKind = selectedSingle.data.kind || "image";
      return {
        kind,
        prompt: String(
          selectedSingle.data.generation?.prompt ||
            selectedSingle.data.prompt ||
            "",
        ),
        params: copyParams(
          selectedSingle.data.generation?.params || selectedSingle.data.params,
          kind,
          runtime,
        ),
        node: null,
        target: selectedSingle,
      };
    }
    const kind = mode;
    return {
      kind,
      prompt: drafts[mode].prompt,
      params:
        mode === "text"
          ? normalizeCreationSettings("text", drafts.text.params, runtime)
          : copyParams(drafts[mode].params, mode, runtime),
      node: null,
      target: null as CanvasNode | null,
    };
  }, [drafts, mode, runtime, selectedSingle]);

  const updatePrompt = useCallback(
    (value: string) => {
      if (selectedSingle?.type === "prompt")
        return updateDoc((documentValue) => ({
          ...documentValue,
          nodes: documentValue.nodes.map((node) =>
            node.id === selectedSingle.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    text: value,
                    agentPrompt: value,
                    agentResponse: undefined,
                    role: "Agent 输入",
                    status: "idle",
                    statusLabel: undefined,
                  },
                }
              : node,
          ),
        }));
      if (selectedSingle?.type === "generator")
        return updateDoc((documentValue) => ({
          ...documentValue,
          nodes: documentValue.nodes.map((node) =>
            node.id === selectedSingle.id
              ? { ...node, data: { ...node.data, prompt: value } }
              : node,
          ),
        }));
      if (selectedSingle?.type === "media")
        return updateDoc((documentValue) => ({
          ...documentValue,
          nodes: documentValue.nodes.map((node) =>
            node.id === selectedSingle.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    prompt: value,
                    ...(node.data.generation
                      ? {
                          generation: {
                            ...node.data.generation,
                            prompt: value,
                          },
                        }
                      : {}),
                  },
                }
              : node,
          ),
        }));
      setDrafts((current) => ({
        ...current,
        [mode]: { ...current[mode], prompt: value },
      }));
    },
    [mode, selectedSingle, updateDoc],
  );

  const updateVariantRequirements = useCallback(
    (value: string) => {
      if (selectedSingle?.type !== "generator") return;
      updateDoc((documentValue) => ({
        ...documentValue,
        nodes: documentValue.nodes.map((node) =>
          node.id === selectedSingle.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  variantRequirementsText: value,
                  variantRequirements: normalizeVariantRequirements(value),
                  variantStates: [],
                  variantBatchId: undefined,
                  variantGroupId: undefined,
                },
              }
            : node,
        ),
      }));
    },
    [selectedSingle, updateDoc],
  );

  const createImageBranchFromText = useCallback(
    (node: CanvasNode, value: string) => {
      if (node.type !== "prompt") return;
      const response = value.trim();
      if (!response) return;
      const imageParams = normalizeCreationSettings("image", null, runtime);
      const imageNode = createEmptyMedia(
        "image",
        {
          x: node.x + nodeSize(node).w + 90,
          y: node.y,
        },
        imageParams,
      );
      const nextImageNode: CanvasNode = {
        ...imageNode,
        data: {
          ...imageNode.data,
          role: "Agent 转图片",
          prompt: response,
          generation: imageNode.data.generation
            ? { ...imageNode.data.generation, prompt: response }
            : imageNode.data.generation,
        },
      };
      commit((current) =>
        addEdge(
          { ...current, nodes: [...current.nodes, nextImageNode] },
          node.id,
          nextImageNode.id,
          "right",
          "left",
          "generated",
          "context",
        ),
      );
      setEditorDrafts((current) => ({
        ...current,
        [nextImageNode.id]: {
          prompt: response,
          params: imageParams,
          dirty: true,
        },
      }));
      setSelectedIds(new Set([nextImageNode.id]));
      setSelectedGroupId(null);
      setMode("image");
      setExpandedEditorId(nextImageNode.id);
      setTextLightboxNodeId(null);
      notify("已创建图片分支，文本已填入画布编辑器");
    },
    [commit, notify, runtime],
  );

  const useAgentResponseAsImagePrompt = useCallback(
    (node: CanvasNode) => {
      if (node.type !== "prompt") return;
      createImageBranchFromText(
        node,
        String(node.data.agentResponse || node.data.text || ""),
      );
    },
    [createImageBranchFromText],
  );

  const updateParams = useCallback(
    (settings: CreationSettings) => {
      const source = deckSource();
      if (source.node) {
        updateDoc((valueDoc) => ({
          ...valueDoc,
          nodes: valueDoc.nodes.map((node) =>
            node.id === source.node!.id
              ? { ...node, data: { ...node.data, params: clone(settings) } }
              : node,
          ),
        }));
        return;
      }
      if (source.target && settings.kind !== "text") {
        const target = source.target;
        if (target.data.kind === "image" && settings.kind === "image") {
          updateDoc((valueDoc) => ({
            ...valueDoc,
            nodes: valueDoc.nodes.map((node) =>
              node.id === target.id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      params: clone(settings),
                      ...(node.data.generation
                        ? {
                            generation: {
                              ...node.data.generation,
                              params: clone(settings),
                            },
                          }
                        : {}),
                    },
                  }
                : node,
            ),
          }));
          setMode("image");
          writeSharedCreationSettings(settings);
          return;
        }
        const references = incomingReferences(docRef.current, target.id)
          .map(canvasReferenceDraftFromNode)
          .filter((reference): reference is CanvasReferenceDraft => Boolean(reference));
        const draft = reuseDraftFromNode(
          target,
          references,
          copyParams(
            target.data.generation?.params || target.data.params,
            target.data.kind || "image",
            runtime,
          ),
        );
        if (draft) {
          setReuseDraft((current) => current?.sourceNodeId === target.id
            ? { ...current, params: clone(settings), dirty: true }
            : { ...draft, params: clone(settings), dirty: true });
          setMode(target.data.kind === "video" ? "video" : "image");
          setDeckCollapsed(false);
        }
        return;
      }
      if (settings.kind === "image")
        setDrafts((current) => ({
          ...current,
          image: { ...current.image, params: settings },
        }));
      else if (settings.kind === "video")
        setDrafts((current) => ({
          ...current,
          video: { ...current.video, params: settings },
        }));
      else
        setDrafts((current) => ({
          ...current,
          text: { ...current.text, params: settings },
        }));
      writeSharedCreationSettings(settings);
    },
    [deckSource, runtime, updateDoc],
  );

  const pollVideo = useCallback(
    async (nodeId: string, taskId: string) => {
      if (!mountedRef.current || !nodeById(docRef.current, nodeId)) return;
      const startedAt =
        pollStartedAtRef.current.get(taskId) || Date.now();
      pollStartedAtRef.current.set(taskId, startedAt);
      const attempts = (pollAttemptsRef.current.get(taskId) || 0) + 1;
      pollAttemptsRef.current.set(taskId, attempts);
      if (Date.now() - startedAt >= CANVAS_VIDEO_MAX_WAIT_MS) {
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) => {
            if (node.id === nodeId)
              return {
                ...node,
                data: {
                  ...node.data,
                  status: "failed" as const,
                  statusLabel: "视频任务查询超时，请重试",
                },
              };
            const variantIndex = nodeById(value, nodeId)?.data.generation
              ?.variantIndex;
            const sourceGeneratorId = nodeById(value, nodeId)?.data.generation
              ?.sourceGeneratorId;
            if (
              node.id === sourceGeneratorId &&
              typeof variantIndex === "number"
            ) {
              const states = variantStatesFor(node).map((state, index) =>
                index === variantIndex
                  ? {
                      ...state,
                      status: "failed" as const,
                      error: "视频任务查询超时，请重试",
                      updatedAt: Date.now(),
                    }
                  : state,
              );
              return {
                ...node,
                data: {
                  ...node.data,
                  variantStates: states,
                  status: variantBatchStatus(states),
                  statusLabel: "视频变体生成失败",
                },
              };
            }
            return node;
          }),
        }));
        addLog(`视频任务查询超时：${taskId}`);
        pollAttemptsRef.current.delete(taskId);
        pollStartedAtRef.current.delete(taskId);
        return;
      }
      try {
        const result = await getCanvasVideoTask(taskId);
        if (!mountedRef.current) return;
        const task = result.task;
        const terminal =
          task.status === "done" ||
          task.status === "failed" ||
          task.status === "cancelled" ||
          task.status === "canceled";
        updateDoc((value) => {
          const targetNode = nodeById(value, nodeId);
          const variantIndex = targetNode?.data.generation?.variantIndex;
          const sourceGeneratorId = targetNode?.data.generation
            ?.sourceGeneratorId;
          const nextStatus =
            task.status === "done"
              ? ("completed" as const)
              : terminal
                ? ("failed" as const)
                : ("running" as const);
          return {
            ...value,
            nodes: value.nodes.map((node) => {
              if (node.id === nodeId)
                return {
                  ...node,
                  data: {
                    ...node.data,
                    status:
                      task.status === "done"
                        ? "completed" as const
                        : terminal
                          ? "failed" as const
                          : "running" as const,
                    progress: Number(
                      task.progress || (task.status === "done" ? 100 : 0),
                    ),
                    url: task.videoUrls?.[0] || node.data.url,
                    statusLabel:
                      task.error ||
                      (task.status === "done"
                        ? "视频已完成"
                        : terminal
                          ? "视频任务已中断"
                          : "视频生成中"),
                  },
                };
              if (
                node.id === sourceGeneratorId &&
                typeof variantIndex === "number"
              ) {
                const states = variantStatesFor(node).map((state, index) =>
                  index === variantIndex
                    ? {
                        ...state,
                        status: nextStatus,
                        progress: Number(
                          task.progress || (task.status === "done" ? 100 : 0),
                        ),
                        ...(task.error ? { error: task.error } : {}),
                        updatedAt: Date.now(),
                      }
                    : state,
                );
                return {
                  ...node,
                  data: {
                    ...node.data,
                    variantStates: states,
                    status: variantBatchStatus(states),
                    statusLabel:
                      variantBatchStatus(states) === "completed"
                        ? "视频变体生成完成"
                        : variantBatchStatus(states) === "failed"
                          ? "部分视频变体失败"
                          : "视频变体生成中",
                  },
                };
              }
              return node;
            }),
          };
        });
        if (!terminal) {
          const timer = window.setTimeout(() => {
            pollTimersRef.current.delete(timer);
            void pollVideo(nodeId, taskId);
          }, 3000);
          pollTimersRef.current.add(timer);
        } else {
          pollAttemptsRef.current.delete(taskId);
          pollStartedAtRef.current.delete(taskId);
          addLog(
            task.status === "done"
              ? "视频生成完成"
              : `视频任务失败：${task.error || "任务已中断"}`,
          );
        }
      } catch (error) {
        if (!mountedRef.current) return;
        addLog(
          `视频进度查询失败：${error instanceof Error ? error.message : "网络错误"}`,
        );
        const timer = window.setTimeout(() => {
          pollTimersRef.current.delete(timer);
          void pollVideo(nodeId, taskId);
        }, 5000);
        pollTimersRef.current.add(timer);
      }
    },
    [addLog, updateDoc],
  );

  useEffect(() => {
    if (!ready) return;
    document.nodes.forEach((node) => {
      const taskId = String(
        node.data.jobId || node.data.generation?.taskId || "",
      );
      if (
        node.type === "media" &&
        node.data.kind === "video" &&
        taskId &&
        (node.data.status === "queued" || node.data.status === "running") &&
        !pollAttemptsRef.current.has(taskId)
      )
        void pollVideo(node.id, taskId);
    });
  }, [activeProjectId, document.nodes, pollVideo, ready]);

  const runVariantBatch = useCallback(
    async (
      generatorId: string,
      retryIndices?: number[],
      mode: "all" | "failed" | "pending" = retryIndices ? "failed" : "all",
    ) => {
      const generator = nodeById(docRef.current, generatorId);
      if (!generator || generator.type !== "generator") {
        notify("变体生成器已不存在，请重新选择节点。", "error");
        return;
      }
      const kind = generator.data.kind === "video" ? "video" : "image";
      const requirements = variantRequirementsFor(generator);
      const currentStates = variantStatesFor(generator);
      const requested = retryIndices
        ? [...new Set(retryIndices)].filter(
            (index) =>
              index >= 0 &&
              index < requirements.length &&
              currentStates[index]?.status ===
                (mode === "pending" ? "pending" : "failed"),
          )
        : requirements.map((_, index) => index);
      const isRetry = mode === "failed";
      const isResume = mode === "pending";
      if (!requested.length)
        return notify(
          isRetry ? "当前没有可重试的失败变体。" : "请至少填写一条变体要求。",
          isRetry ? "ok" : "error",
        );
      const activeKey = generatorId;
      if (generationKeysRef.current.has(activeKey))
        return notify("这个变体生成器正在处理中，请稍候。", "error");
      generationKeysRef.current.add(activeKey);
      setGenerationKeys(new Set(generationKeysRef.current));

      const batchId =
        (isRetry || isResume) && generator.data.variantBatchId
          ? String(generator.data.variantBatchId)
          : uid("variant-batch");
      const initialStates = currentStates.map((state, index) => {
        if (!requested.includes(index)) return state;
        return {
          ...state,
          instruction: requirements[index],
          status: "pending" as const,
          resultIds: isRetry || isResume ? state.resultIds : [],
          taskIds: isRetry || isResume ? state.taskIds : undefined,
          progress: 0,
          error: undefined,
          updatedAt: Date.now(),
        };
      });
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.id === generatorId
            ? {
                ...node,
                data: {
                  ...node.data,
                  variantBatchId: batchId,
                  variantStates: initialStates,
                  status: "running" as const,
                  processingStartedAt: Date.now(),
                  statusLabel: `正在生成 ${kind === "video" ? "视频" : "图片"}变体`,
                },
              }
            : node,
        ),
      }));

      const sourceParams = copyParams(generator.data.params, kind, runtime);
      const resolvedModel = resolveAvailableCreationModel(sourceParams, runtime);
      const effectiveParams = {
        ...sourceParams,
        model: resolvedModel.model?.id || "auto",
      } as ImageCreationSettings | VideoCreationSettings;
      const incoming = incomingContext(docRef.current, generatorId);
      const linked = [
        ...new Map(
          incoming
            .filter((node) => isCanvasReferenceableNode(node))
            .map((node) => [node.id, node]),
        ).values(),
      ];
      const context = [
        ...incoming.filter((node) => node.type === "prompt"),
        ...linked,
      ];
      const refs = linked
        .map((node) => ({
          url: String(node.data.url || ""),
          name: String(node.data.name || "参考素材"),
        }))
        .filter((item) => item.url);
      const commonPrompt = String(generator.data.prompt || "").trim();
      const batchName = `${kind === "video" ? "视频" : "图片"}变体批次`;
      const updateVariantState = (
        value: CanvasDocument,
        index: number,
        patch: Partial<CanvasVariantState>,
      ) => {
        const nextNodes = value.nodes.map((node) => {
          if (node.id !== generatorId) return node;
          const states = variantStatesFor(node).map((state, stateIndex) =>
            stateIndex === index
              ? {
                  ...state,
                  ...patch,
                  instruction: requirements[stateIndex],
                  updatedAt: Date.now(),
                }
              : state,
          );
          const status = variantBatchStatus(states);
          return {
            ...node,
            data: {
              ...node.data,
              variantStates: states,
              status,
              statusLabel:
                status === "completed"
                  ? `${kind === "video" ? "视频" : "图片"}变体生成完成`
                  : status === "failed"
                    ? `部分${kind === "video" ? "视频" : "图片"}变体失败`
                    : `${kind === "video" ? "视频" : "图片"}变体生成中`,
            },
          };
        });
        return { ...value, nodes: nextNodes };
      };
      const attachBatchGroup = (
        value: CanvasDocument,
        newResultIds: string[],
      ) => {
        const currentGenerator = nodeById(value, generatorId);
        if (!currentGenerator) return value;
        const allResultIds = variantStatesFor(currentGenerator).flatMap(
          (state) => state.resultIds,
        );
        let next = value;
        const existingGroup = currentGenerator.data.variantGroupId
          ? groupById(next, String(currentGenerator.data.variantGroupId))
          : undefined;
        if (existingGroup) next = moveNodesToGroup(next, newResultIds, existingGroup.id);
        else if (allResultIds.length >= 2)
          next = createGroup(next, allResultIds, batchName);
        const createdGroup = nodeById(next, generatorId)?.data.variantGroupId
          ? groupById(next, String(nodeById(next, generatorId)?.data.variantGroupId))
          : next.groups.find((group) =>
              allResultIds.every((id) => group.nodeIds.includes(id)),
            );
        return createdGroup
          ? {
              ...next,
              nodes: next.nodes.map((node) =>
                node.id === generatorId
                  ? {
                      ...node,
                      data: { ...node.data, variantGroupId: createdGroup.id },
                    }
                  : node,
              ),
            }
          : next;
      };
      const promptFor = (index: number) => {
        const instruction = requirements[index];
        return smartPrompt(
          [
            commonPrompt,
            instruction ? `变体要求：${instruction}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          context,
        );
      };
      const positionFor = (index: number, outputIndex = 0) => ({
        x:
          generator.x +
          nodeSize(generator).w +
          110 +
          (outputIndex % 2) * 350,
        y: generator.y + index * 300 + Math.floor(outputIndex / 2) * 280,
      });

      const applyVideoTask = (
        value: CanvasDocument,
        targetId: string,
        index: number,
        task: {
          status: string;
          progress?: number;
          videoUrls?: string[];
          error?: string;
        },
      ) => {
        const terminal = ["done", "failed", "cancelled", "canceled"].includes(
          task.status,
        );
        const variantStatus =
          task.status === "done"
            ? ("completed" as const)
            : terminal
              ? ("failed" as const)
              : ("running" as const);
        let next = {
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === targetId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    status:
                      task.status === "done"
                        ? ("completed" as const)
                        : terminal
                          ? ("failed" as const)
                          : ("running" as const),
                    progress: Number(
                      task.progress || (task.status === "done" ? 100 : 0),
                    ),
                    url: task.videoUrls?.[0] || node.data.url,
                    statusLabel:
                      task.error ||
                      (task.status === "done"
                        ? "视频已完成"
                        : terminal
                          ? "视频任务已中断"
                          : "视频生成中"),
                  },
                }
              : node,
          ),
        };
        next = updateVariantState(next, index, {
          status: variantStatus,
          progress: Number(task.progress || (task.status === "done" ? 100 : 0)),
          ...(task.error ? { error: task.error } : {}),
        });
        return next;
      };

      try {
        for (const index of requested) {
          if (!mountedRef.current) return;
          const prompt = promptFor(index);
          if (!prompt.trim()) {
            updateDoc((value) =>
              updateVariantState(value, index, {
                status: "failed",
                error: "共同提示词和变体要求都为空",
              }),
            );
            continue;
          }
          updateDoc((value) =>
            updateVariantState(value, index, {
              status: "running",
              progress: 0,
              error: undefined,
            }),
          );
          try {
            if (kind === "image") {
              const imageParams = effectiveParams as ImageCreationSettings;
              const result = await generateCanvasImage({
                taskId: uid("image-task"),
                prompt,
                model: imageParams.model,
                count: imageParams.count,
                aspect:
                  imageParams.aspect === "自定义"
                    ? `${imageParams.customAspectWidth}:${imageParams.customAspectHeight}`
                    : imageParams.aspect,
                resolution: imageParams.resolution,
                quality: imageParams.quality,
                ...(imageParams.sizeMode === "custom"
                  ? { width: imageParams.width, height: imageParams.height }
                  : {}),
                outputFormat: imageParams.outputFormat,
                background:
                  imageParams.backgroundMode === "api-transparent"
                    ? "transparent"
                    : imageParams.backgroundMode === "opaque"
                      ? "opaque"
                      : undefined,
                maskUrl: imageParams.mask?.url,
                references: refs,
              });
              if (!result.images?.length)
                throw new Error("服务端没有返回图片结果。");
              const outputs = result.images.map((image, outputIndex) =>
                createMedia(
                  "image",
                  image.url,
                  `图片变体 ${index + 1}-${outputIndex + 1}`,
                  positionFor(index, outputIndex),
                  {
                    role: "变体结果",
                    model: result.model?.name || imageParams.model,
                    generation: {
                      kind: "image",
                      prompt,
                      params: clone(imageParams),
                      referenceIds: linked.map((item) => item.id),
                      sourceGeneratorId: generatorId,
                      variantBatchId: batchId,
                      variantIndex: index,
                      variantInstruction: requirements[index],
                      createdAt: Date.now(),
                    },
                    referenceOrder: linked.map((item) => item.id),
                  },
                ),
              );
              updateDoc((value) => {
                let next = {
                  ...value,
                  nodes: [...value.nodes, ...outputs],
                };
                outputs.forEach((output) => {
                  next = addEdge(
                    next,
                    generatorId,
                    output.id,
                    "right",
                    "left",
                    "generated",
                  );
                });
                next = updateVariantState(next, index, {
                  status: "completed",
                  progress: 100,
                  resultIds: outputs.map((output) => output.id),
                  error: undefined,
                });
                return attachBatchGroup(next, outputs.map((output) => output.id));
              });
              void recordCanvasImages(result.images, {
                prompt,
                source: "canvas",
                modelId: imageParams.model,
                modelName: result.model?.name,
                providerName: result.model?.provider,
                aspectRatio: imageParams.aspect,
                outputSize:
                  imageParams.sizeMode === "custom"
                    ? `${imageParams.width}x${imageParams.height}`
                    : imageParams.resolution,
                outputFormat: imageParams.outputFormat,
                parentId: generatorId,
              }).catch(() => addLog("图片变体已生成，但写入历史失败"));
            } else {
              const videoParams = effectiveParams as VideoCreationSettings;
              const videoModelProvider = runtime?.providers.find((item) => item.id === resolvedModel.model?.providerId);
              const videoLimits = getVideoModelLimits(resolvedModel.model || undefined, videoModelProvider);
              const videoInputs = resolveCanvasVideoInputs(
                linked,
                videoParams.inputMode,
                canvasInputRolesForTarget(docRef.current, generatorId),
                { maxReferenceImages: videoLimits.maxReferenceImages },
              );
              const videoInputError = canvasVideoInputError(videoInputs, videoParams.inputMode, videoLimits, videoParams.operation);
              if (videoInputError) throw new Error(videoInputError);
              const task = await generateCanvasVideo({
                prompt,
                model: effectiveParams.model,
                operation: videoParams.operation,
                inputMode: videoParams.inputMode,
                duration: videoParams.duration,
                aspect: videoParams.aspect,
                resolution: videoParams.resolution,
                references: videoInputs.referenceImages.map((item) => ({
                    url: String(item.data.url),
                    name: String(item.data.name || "参考图片"),
                  })),
                firstFrame: videoInputs.firstFrame?.data.url ? String(videoInputs.firstFrame.data.url) : undefined,
                lastFrame: videoInputs.lastFrame?.data.url ? String(videoInputs.lastFrame.data.url) : undefined,
                referenceVideo: videoInputs.referenceVideo?.data.url ? String(videoInputs.referenceVideo.data.url) : undefined,
                audio: videoParams.audio,
              });
              const target = createMedia(
                "video",
                task.videoUrls?.[0] || "",
                `视频变体 ${index + 1}`,
                positionFor(index),
                {
                  role: "变体结果",
                  model: task.modelId || videoParams.model,
                  jobId: task.id,
                  status: task.status === "done" ? "completed" : "running",
                  processingStartedAt:
                    task.status === "done" ? undefined : Date.now(),
                  progress: Number(task.progress || (task.status === "done" ? 100 : 0)),
                  statusLabel: task.status === "done" ? "视频已完成" : "视频生成中",
                  generation: {
                    kind: "video",
                    prompt,
                    params: clone(videoParams),
                    referenceIds: linked.map((item) => item.id),
                    sourceGeneratorId: generatorId,
                    variantBatchId: batchId,
                    variantIndex: index,
                    variantInstruction: requirements[index],
                    taskId: task.id,
                    createdAt: Date.now(),
                  },
                  referenceOrder: linked.map((item) => item.id),
                },
              );
              pollAttemptsRef.current.set(task.id, 1);
              const videoPollDeadline = Date.now() + CANVAS_VIDEO_MAX_WAIT_MS;
              updateDoc((value) => {
                let next = {
                  ...value,
                  nodes: [...value.nodes, target],
                };
                next = addEdge(
                  next,
                  generatorId,
                  target.id,
                  "right",
                  "left",
                  "generated",
                );
                next = updateVariantState(next, index, {
                  status: task.status === "done" ? "completed" : "running",
                  progress: Number(task.progress || (task.status === "done" ? 100 : 0)),
                  resultIds: [target.id],
                  taskIds: [task.id],
                  ...(task.error ? { error: task.error } : {}),
                });
                return attachBatchGroup(next, [target.id]);
              });
              if (task.status !== "done") {
                let finished = task;
                let lastError: unknown;
                for (let attempt = 0; Date.now() < videoPollDeadline; attempt += 1) {
                  try {
                    const latest = await getCanvasVideoTask(task.id);
                    finished = latest.task;
                    updateDoc((value) =>
                      applyVideoTask(value, target.id, index, finished),
                    );
                    if (
                      ["done", "failed", "cancelled", "canceled"].includes(
                        finished.status,
                      )
                    )
                      break;
                    lastError = undefined;
                  } catch (error) {
                    lastError = error;
                  }
                  await new Promise((resolve) =>
                    window.setTimeout(resolve, lastError ? 5000 : 3000),
                  );
                }
                pollAttemptsRef.current.delete(task.id);
                if (
                  !["done", "failed", "cancelled", "canceled"].includes(
                    finished.status,
                  )
                )
                  throw new Error("视频任务查询超时，请稍后重试");
                if (finished.status !== "done")
                  throw new Error(finished.error || "视频变体生成失败");
              } else pollAttemptsRef.current.delete(task.id);
              writeSharedCreationSettings(videoParams);
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "变体生成失败";
            updateDoc((value) =>
              updateVariantState(value, index, {
                status: "failed",
                error: message,
              }),
            );
            addLog(`${kind === "video" ? "视频" : "图片"}变体 ${index + 1} 失败：${message}`);
        }
      }
        notify(`${kind === "video" ? "视频" : "图片"}变体批量处理完成`);
      } finally {
        generationKeysRef.current.delete(activeKey);
        setGenerationKeys(new Set(generationKeysRef.current));
      }
    },
    [addLog, notify, resolveAvailableCreationModel, runtime, updateDoc],
  );

  useEffect(() => {
    if (!ready) return;
    document.nodes.forEach((node) => {
      if (
        node.type !== "generator" ||
        node.data.kind !== "video" ||
        (node.data.status !== "queued" &&
          node.data.status !== "running" &&
          node.data.status !== "failed") ||
        generationKeysRef.current.has(node.id)
      )
        return;
      const states = variantStatesFor(node);
      if (states.some((state) => state.status === "running")) return;
      const nextPendingIndex = states.findIndex(
        (state) => state.status === "pending",
      );
      if (nextPendingIndex >= 0)
        void runVariantBatch(node.id, [nextPendingIndex], "pending");
    });
  }, [document.nodes, ready, runVariantBatch]);

  const openReuseDraft = useCallback(
    (
      source: CanvasNode,
      options?: {
        prompt?: string;
        params?: CanvasGenerationParams;
        operation?: "generate" | "edit" | "extend";
        includeSourceReference?: boolean;
      },
    ) => {
      if (source.type !== "media" || !source.data.kind || !source.data.url) {
        notify("只有已完成的图片或视频节点可以复用参数。", "error");
        return;
      }
      const linkedReferences = incomingReferences(docRef.current, source.id)
        .map(canvasReferenceDraftFromNode)
        .filter((reference): reference is CanvasReferenceDraft => Boolean(reference));
      const draft = reuseDraftFromNode(
        source,
        linkedReferences,
        copyParams(
          source.data.generation?.params || source.data.params,
          source.data.kind || "image",
          runtime,
        ),
      );
      if (!draft) {
        notify("当前节点没有完整的生成参数，无法复用。", "error");
        return;
      }
      const sourceReference = options?.includeSourceReference
        ? canvasReferenceDraftFromNode(source)
        : null;
      const references = sourceReference
        ? addReferenceDrafts(draft.references, [sourceReference]).references
        : draft.references;
      setReuseDraft({
        ...draft,
        references,
        ...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
        ...(options?.params ? { params: clone(options.params) } : {}),
        ...(options?.operation ? { operation: options.operation } : {}),
        dirty: Boolean(options),
      });
      setMode(source.data.kind);
      setExpandedEditorId(source.id);
      setSelectedIds(new Set([source.id]));
      setSelectedGroupId(null);
      setLightbox(null);
      notify("已复制完整参数和参考图，可在节点下方生成新分支");
    },
    [notify, runtime],
  );

  const addReuseReferences = useCallback(
    (incoming: CanvasReferenceDraft[]) => {
      setReuseDraft((current) => {
        if (!current) return current;
        const result = addReferenceDrafts(current.references, incoming);
        if (result.rejected.length && current.references.length >= 16)
          notify("参考图最多 16 张。", "error");
        else if (result.rejected.length)
          notify("部分参考图重复或无法添加。", "error");
        return { ...current, references: result.references, dirty: true };
      });
    },
    [notify],
  );

  const addReuseFiles = useCallback(
    async (files: File[]) => {
      if (!reuseDraft || !files.length) return;
      const pending = files.map((file, index) => ({
        id: uid("draft-ref"),
        kind: (file.type.startsWith("video/") ? "video" : "image") as CanvasMediaKind,
        url: URL.createObjectURL(file),
        name: file.name || `参考图 ${index + 1}`,
        origin: "upload" as const,
        pending: true,
      }));
      addReuseReferences(pending);
      let optimizedImageCount = 0;
      for (const [index, file] of files.entries()) {
        const draftRef = pending[index];
        try {
          const asset = await uploadCanvasAsset(file);
          if (asset.kind === "image" && asset.optimized) optimizedImageCount += 1;
          setReuseDraft((current) => {
            if (!current) return current;
            return {
              ...current,
              references: current.references.map((reference) =>
                reference.id === draftRef.id
                  ? { ...reference, url: asset.url, name: asset.name, kind: asset.kind, pending: false, error: undefined }
                  : reference,
              ),
              dirty: true,
            };
          });
        } catch (error) {
          setReuseDraft((current) => current ? {
            ...current,
            references: current.references.map((reference) => reference.id === draftRef.id ? { ...reference, pending: false, error: error instanceof Error ? error.message : "上传失败" } : reference),
          } : current);
          notify(error instanceof Error ? error.message : "参考图上传失败。", "error");
        } finally {
          URL.revokeObjectURL(draftRef.url);
        }
      }
      if (optimizedImageCount)
        notify(`已自动优化 ${optimizedImageCount} 张图片后上传`);
    },
    [addReuseReferences, notify, reuseDraft],
  );

  const pasteReuseReference = useCallback(async () => {
    if (!reuseDraft || !navigator.clipboard?.read) {
      notify("当前浏览器不允许读取剪贴板图片，请使用上传或拖入。", "error");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        await addReuseFiles([new File([blob], `粘贴参考图.${type.split("/")[1] || "png"}`, { type })]);
        return;
      }
      notify("剪贴板中没有图片。", "error");
    } catch (error) {
      notify(error instanceof Error ? error.message : "读取剪贴板失败。", "error");
    }
  }, [addReuseFiles, notify, reuseDraft]);

  const removeReuseReference = useCallback((id: string) => {
    setReuseDraft((current) => current ? { ...current, references: removeReferenceDraft(current.references, id), dirty: true } : current);
  }, []);

  const reorderReuseReference = useCallback((from: number, to: number) => {
    setReuseDraft((current) => current ? { ...current, references: reorderReferenceDrafts(current.references, from, to), dirty: true } : current);
  }, []);

  const addCurrentNodeToReuse = useCallback((node: CanvasNode) => {
    const reference = canvasReferenceDraftFromNode(node);
    if (!reference) return;
    if (reuseDraft?.sourceNodeId === node.id) addReuseReferences([reference]);
    else openReuseDraft(node, { includeSourceReference: true });
    setLightbox(null);
  }, [addReuseReferences, openReuseDraft, reuseDraft]);

  const addReuseReferenceNode = useCallback(
    (nodeId: string) => {
      const node = nodeById(docRef.current, nodeId);
      const reference = node ? canvasReferenceDraftFromNode(node) : null;
      if (reference) addReuseReferences([reference]);
    },
    [addReuseReferences],
  );

  const previewReuseReference = useCallback((reference: CanvasReferenceDraft) => {
    setReusePreview(reference);
  }, []);

  const optimizeReusePrompt = useCallback(async () => {
    if (!reuseDraft?.prompt.trim()) return notify("请输入需要优化的提示词。", "error");
    if (!runtime?.models?.some((model) => model.kind === "chat" && model.enabled !== false && model.published !== false))
      return notify("没有可用的对话模型，请先在主界面模型库启用。", "error");
    try {
      const value = await requestPromptOptimization(
        reuseDraft.prompt,
        reuseDraft.references.map((reference) => ({ url: reference.url, name: reference.name })),
        runtime.settings.agentModelId || undefined,
      );
      setReuseDraft((current) => current ? { ...current, prompt: value, dirty: true } : current);
      notify("AI 已优化提示词，尚未生成");
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI 优化失败", "error");
    }
  }, [notify, reuseDraft, runtime]);

  const reverseReusePrompt = useCallback(async () => {
    if (!reuseDraft) return;
    const source = reuseDraft.sourceNodeId ? nodeById(docRef.current, reuseDraft.sourceNodeId) : undefined;
    const images = [
      source && source.type === "media" && source.data.url ? { url: String(source.data.url), name: String(source.data.name || "当前图片") } : null,
      ...reuseDraft.references.filter((reference) => reference.kind === "image").map((reference) => ({ url: reference.url, name: reference.name })),
    ].filter((item): item is { url: string; name: string } => Boolean(item));
    if (!images.length) return notify("请先添加图片参考。", "error");
    if (!runtime?.models?.some((model) => model.kind === "chat" && model.enabled !== false && model.published !== false))
      return notify("没有可用的对话模型，请先在主界面模型库启用。", "error");
    try {
      const value = await runReversePrompt(images, runtime.settings.agentModelId || undefined);
      setReuseDraft((current) => current ? { ...current, prompt: value, dirty: true } : current);
      notify("已反推提示词，尚未生成");
    } catch (error) {
      notify(error instanceof Error ? error.message : "反推提示词失败", "error");
    }
  }, [notify, reuseDraft, runtime]);

  const runImageContinuation = useCallback(async (draftInput: CanvasReuseDraft) => {
    const draft = cloneReuseDraft(draftInput);
    if (draft.kind !== "image") return;
    if (!draft.prompt.trim()) return notify("请输入生成提示词。", "error");
    if (draft.references.some((reference) => reference.pending || reference.error)) {
      return notify("请等待参考图准备完成，或移除失败的参考图。", "error");
    }
    if (draft.references.some((reference) => reference.kind !== "image")) {
      return notify("图片生成只能使用图片参考，请移除视频素材。", "error");
    }
    const source = draft.sourceNodeId
      ? nodeById(docRef.current, draft.sourceNodeId)
      : undefined;
    if (!source || source.type !== "media" || source.data.kind !== "image" || !source.data.url) {
      return notify("图片续生成需要一个已完成的图片节点。", "error");
    }
    const activeKey = `reuse:${source.id}`;
    if (generationKeysRef.current.has(activeKey)) {
      return notify("这个图片续生成任务正在处理，请稍候。", "error");
    }

    const params = copyParams(draft.params, "image", runtime) as ImageCreationSettings;
    const createdAt = Date.now();
    const taskId = uid("image-task");
    const outputPosition = {
      x: source.x + nodeSize(source).w + 90,
      y: source.y,
    };
    const resolvedReferenceIds: string[] = [];
    const referenceKeys = new Set<string>();
    const apiReferences: Array<{ url: string; name: string }> = [];
    const materializedReferences: CanvasNode[] = [];
    const referenceEdges: CanvasEdge[] = [];
    let skippedReferenceCount = 0;
    const outputReservation = createMedia(
      "image",
      "",
      "图片生成中",
      outputPosition,
    );

    const addReference = (
      id: string,
      url: string,
      name: string,
    ) => {
      const normalizedUrl = url.trim();
      const key = `${id}:${normalizedUrl}`;
      if (!normalizedUrl || referenceKeys.has(key) || referenceKeys.has(`url:${normalizedUrl}`)) return false;
      referenceKeys.add(key);
      referenceKeys.add(`url:${normalizedUrl}`);
      resolvedReferenceIds.push(id);
      apiReferences.push({ url: normalizedUrl, name: name || "参考图片" });
      if (id !== source.id) {
        referenceEdges.push({
          id: uid("edge"),
          source: id,
          target: "",
          sourcePort: "right",
          targetPort: "left",
          inputRole: "reference-image",
          order: resolvedReferenceIds.length - 1,
          kind: "reference",
        });
      }
      return true;
    };

    addReference(
      source.id,
      String(source.data.url),
      String(source.data.name || "当前图片"),
    );

    for (const [index, reference] of draft.references.entries()) {
      const existing = reference.nodeId
        ? nodeById(docRef.current, reference.nodeId)
        : undefined;
      const existingUrl = existing?.type === "media" ? String(existing.data.url || "") : "";
      const url = existingUrl || reference.url;
      const name = existing?.type === "media"
        ? String(existing.data.name || reference.name || "参考图片")
        : reference.name;
      const normalizedUrl = url.trim();
      if (normalizedUrl && referenceKeys.has(`url:${normalizedUrl}`)) continue;
      if (resolvedReferenceIds.length >= CANVAS_MAX_REFERENCES) {
        skippedReferenceCount += 1;
        continue;
      }
      const beforeCount = resolvedReferenceIds.length;
      if (existing?.type === "media" && existing.data.kind === "image" && existing.data.url) {
        addReference(existing.id, url, name);
      } else if (url.trim()) {
        const materialized = createMedia(
          "image",
          url,
          name,
          { x: outputPosition.x - 430, y: outputPosition.y + index * 300 },
          { role: "续生成参考素材", params: defaultParams("image", runtime) },
        );
        const placed = {
          ...materialized,
          ...openNodePosition(
            { x: materialized.x, y: materialized.y },
            materialized,
            [...materializedReferences, outputReservation],
          ),
        };
        if (addReference(placed.id, url, name)) materializedReferences.push(placed);
      }
      if (resolvedReferenceIds.length === beforeCount && !url.trim()) {
        notify("有参考图片地址为空，已跳过该参考。", "error");
      }
    }
    if (skippedReferenceCount)
      notify(`图片参考最多 ${CANVAS_MAX_REFERENCES} 张，已跳过 ${skippedReferenceCount} 张多余参考。`, "error");

    const createOutput = (
      url: string,
      name: string,
      position: Point,
      status: "running" | "completed" | "failed",
    ) => createMedia("image", url, name, position, {
      role: "图片续生成结果",
      model: params.model,
      ...(params.mask ? { maskApplied: true, maskSourceNodeId: source.id } : {}),
      params: clone(params),
      status,
      ...(status === "running" ? { processingStartedAt: createdAt } : {}),
      statusLabel: status === "running" ? "图片续生成中" : status === "completed" ? "图片已完成" : "图片生成失败",
      generation: {
        kind: "image",
        prompt: draft.prompt,
        params: clone(params),
        operation: "edit",
        referenceIds: [...resolvedReferenceIds],
        parentNodeId: source.id,
        reuseSourceNodeId: source.id,
        taskId,
        createdAt,
      },
      referenceOrder: [...resolvedReferenceIds],
    });

    const pending = createOutput("", "图片生成中", outputPosition, "running");
    const pendingPositioned = {
      ...pending,
      ...openNodePosition(outputPosition, pending, materializedReferences),
    };
    const inputEdges = [
      {
        id: uid("edge"),
        source: source.id,
        target: pendingPositioned.id,
        sourcePort: "right" as const,
        targetPort: "left" as const,
        kind: "lineage" as const,
      },
      ...referenceEdges.map((edge) => ({ ...edge, target: pendingPositioned.id })),
    ];
    const initialDocument: CanvasDocument = {
      ...docRef.current,
      nodes: [...docRef.current.nodes, ...materializedReferences, pendingPositioned],
      edges: [...docRef.current.edges, ...inputEdges],
    };
    generationKeysRef.current.add(activeKey);
    setGenerationKeys(new Set(generationKeysRef.current));
    commit(() => initialDocument);
    setSelectedIds(new Set([pendingPositioned.id]));
    setSelectedGroupId(null);
    if (params.mask) {
      updateDoc((value) =>
        updateCanvasMaskState(value, source.id, {
          status: "running",
          taskId,
          error: undefined,
        }),
      );
    }

    try {
      const result = await generateCanvasImage({
        taskId,
        prompt: draft.prompt,
        model: params.model,
        count: params.count,
        aspect: params.aspect === "自定义"
          ? `${params.customAspectWidth}:${params.customAspectHeight}`
          : params.aspect,
        resolution: params.resolution,
        quality: params.quality,
        ...(params.sizeMode === "custom" ? { width: params.width, height: params.height } : {}),
        outputFormat: params.outputFormat,
        background: params.backgroundMode === "api-transparent"
          ? "transparent"
          : params.backgroundMode === "opaque"
            ? "opaque"
            : undefined,
        maskUrl: params.mask?.url,
        references: apiReferences,
      });
      if (!result.images?.length) throw new Error("服务端没有返回图片结果。");

      const outputs: CanvasNode[] = [];
      result.images.forEach((image, index) => {
        if (index === 0) return;
        const output = createOutput(
          image.url,
          `继续生成图片 ${index + 1}`,
          {
            x: pendingPositioned.x + (index % 2) * 350,
            y: pendingPositioned.y + Math.floor(index / 2) * 280,
          },
          "completed",
        );
        outputs.push({
          ...output,
          ...openNodePosition(
            { x: output.x, y: output.y },
            output,
            outputs,
          ),
        });
      });
      const firstData = createOutput(result.images[0].url, "继续生成图片 1", pendingPositioned, "completed").data;
      const extraEdges = outputs.flatMap((output) => [
        {
          id: uid("edge"),
          source: source.id,
          target: output.id,
          sourcePort: "right" as const,
          targetPort: "left" as const,
          kind: "lineage" as const,
        },
        ...referenceEdges
          .filter((edge) => edge.source !== source.id)
          .map((edge) => ({ ...edge, id: uid("edge"), target: output.id })),
      ]);
      updateDoc((value) => {
        const withMask = params.mask
          ? updateCanvasMaskState(value, source.id, {
              status: "used",
              taskId,
              error: undefined,
            })
          : value;
        return {
        ...withMask,
        nodes: withMask.nodes
          .map((node) => node.id === pendingPositioned.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...firstData,
                  url: result.images[0].url,
                  name: "继续生成图片 1",
                  model: result.model?.name || params.model,
                  status: "completed" as const,
                  statusLabel: "图片已完成",
                  processingStartedAt: undefined,
                },
              }
            : node,
          )
          .concat(outputs),
        edges: [...value.edges, ...extraEdges],
        };
      });
      setSelectedIds(new Set([pendingPositioned.id, ...outputs.map((output) => output.id)]));
      writeSharedCreationSettings(params);
      setReuseDraft(null);
      setEditorDrafts((current) => {
        const next = { ...current };
        delete next[source.id];
        return next;
      });
      void recordCanvasImages(result.images, {
        prompt: draft.prompt,
        source: "canvas",
        modelId: params.model,
        modelName: result.model?.name,
        providerName: result.model?.provider,
        aspectRatio: params.aspect,
        outputSize: params.sizeMode === "custom" ? `${params.width}x${params.height}` : params.resolution,
        outputFormat: params.outputFormat,
        parentId: source.id,
      }).then(() => setAssetRefresh((value) => value + 1)).catch(() => addLog("图片续生成完成，但写入主界面历史失败"));
      notify(`已生成 ${result.images.length} 张新图片，原图已保留`);
      addLog(`图片续生成完成：${result.images.length} 张`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片续生成失败";
      if (params.mask) {
        updateDoc((value) =>
          updateCanvasMaskState(value, source.id, {
            status: "failed",
            taskId,
            error: message,
          }),
        );
      }
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((node) => node.id === pendingPositioned.id
          ? { ...node, data: { ...node.data, status: "failed" as const, statusLabel: message } }
          : node),
      }));
      notify(message, "error");
      addLog(`图片续生成失败：${message}`);
    } finally {
      generationKeysRef.current.delete(activeKey);
      setGenerationKeys(new Set(generationKeysRef.current));
    }
  }, [addLog, commit, notify, openNodePosition, runtime, updateDoc]);

  const runReuseGeneration = useCallback(async (draftInput: CanvasReuseDraft) => {
    const draft = cloneReuseDraft(draftInput);
    if (draft.kind === "image") {
      await runImageContinuation(draft);
      return;
    }
    if (!draft.prompt.trim()) return notify("请输入生成提示词。", "error");
    if (draft.references.some((reference) => reference.pending || reference.error)) {
      return notify("请等待参考图准备完成，或移除失败的参考图。", "error");
    }
    const activeKey = `reuse:${draft.sourceNodeId || draft.kind}`;
    if (generationKeysRef.current.has(activeKey)) return notify("这个复用任务正在生成，请稍候。", "error");
    const source = draft.sourceNodeId ? nodeById(docRef.current, draft.sourceNodeId) : undefined;
    const sourcePosition = source || selectedSingle;
    const seed = sourcePosition
      ? { x: sourcePosition.x + nodeSize(sourcePosition).w + 90, y: sourcePosition.y }
      : screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const generatorBase = createGenerator(draft.kind, seed, clone(draft.params));
    const generator = {
      ...generatorBase,
      ...openNodePosition(seed, generatorBase),
      data: {
        ...generatorBase.data,
        prompt: draft.prompt,
        role: "复用参数生成器",
        status: "running" as const,
        processingStartedAt: Date.now(),
        statusLabel: draft.kind === "video" ? "视频复用生成中" : "图片复用生成中",
        reuseSourceNodeId: draft.sourceNodeId,
        variantRequirementsText: draft.variantRequirementsText || "",
        variantRequirements: normalizeVariantRequirements(draft.variantRequirementsText || ""),
      },
    };
    const materializedReferences: CanvasNode[] = [];
    const resolvedReferenceIds: string[] = [];
    for (const [index, reference] of draft.references.entries()) {
      const existing = reference.nodeId ? nodeById(docRef.current, reference.nodeId) : undefined;
      if (existing?.type === "media" && existing.data.url) {
        resolvedReferenceIds.push(existing.id);
        continue;
      }
      const materialized = createMedia(
        reference.kind,
        reference.url,
        reference.name,
        { x: generator.x - 430, y: generator.y + index * 285 },
        { role: "复用参考素材", ...(reference.assetId ? { sourceAssetId: reference.assetId } : {}) },
      );
      const placed = { ...materialized, ...openNodePosition({ x: generator.x - 430, y: generator.y + index * 285 }, materialized) };
      materializedReferences.push(placed);
      resolvedReferenceIds.push(placed.id);
    }
    const referenceByIndex = draft.references.map((reference, index) => ({ reference, id: resolvedReferenceIds[index] }));
    const referenceInputNodes = referenceByIndex.map(({ reference, id }) => {
      const existing = nodeById(docRef.current, id);
      return existing || {
        id,
        type: "media" as const,
        x: 0,
        y: 0,
        data: { kind: reference.kind, url: reference.url, name: reference.name },
      };
    });
    const reuseInputMode = draft.kind === "video" ? (draft.params as VideoCreationSettings).inputMode : undefined;
    let imageInputPosition = 0;
    const initialEdges: CanvasEdge[] = referenceByIndex.map(({ id }, index) => {
      const sourceNode = referenceInputNodes[index];
      const inputRole = sourceNode && reuseInputMode
        ? inferCanvasInputRole(sourceNode, generator, reuseInputMode, sourceNode.data.kind === "image" ? imageInputPosition : index)
        : sourceNode
          ? inferCanvasInputRole(sourceNode, generator, undefined, sourceNode.data.kind === "image" ? imageInputPosition : index)
          : undefined;
      if (sourceNode?.data.kind === "image") imageInputPosition += 1;
      return {
        id: uid("edge"), source: id, target: generator.id, sourcePort: "right" as const, targetPort: "left" as const, kind: "manual" as const,
        ...(inputRole ? { inputRole } : {}),
        order: index,
      };
    });
    if (source) initialEdges.push({ id: uid("edge"), source: source.id, target: generator.id, sourcePort: "right", targetPort: "left", kind: "lineage" });
    const outputPosition = { x: generator.x + nodeSize(generator).w + 90, y: generator.y };
    const output = createMedia(draft.kind, "", draft.kind === "video" ? "视频任务" : "图片生成中", outputPosition, {
      role: "复用生成结果",
      status: draft.kind === "video" ? "queued" : "running",
      processingStartedAt: Date.now(),
      statusLabel: draft.kind === "video" ? "视频任务提交中" : "图片生成中",
      generation: {
        kind: draft.kind,
        prompt: draft.prompt,
        params: clone(draft.params),
        operation: draft.operation,
        referenceIds: resolvedReferenceIds,
        sourceGeneratorId: generator.id,
        parentNodeId: source?.id,
        reuseSourceNodeId: source?.id,
        createdAt: Date.now(),
      },
      referenceOrder: resolvedReferenceIds,
    });
    let initialDocument: CanvasDocument = {
      ...docRef.current,
      nodes: [...docRef.current.nodes, ...materializedReferences, generator, output],
      edges: [...docRef.current.edges, ...initialEdges, { id: uid("edge"), source: generator.id, target: output.id, sourcePort: "right", targetPort: "left", kind: "generated" }],
    };
    generationKeysRef.current.add(activeKey);
    setGenerationKeys(new Set(generationKeysRef.current));
    commit(() => initialDocument);
    setSelectedIds(new Set([generator.id]));
    setSelectedGroupId(null);
    try {
        const params = draft.params as VideoCreationSettings;
        const sourceNode = draft.sourceNodeId
          ? nodeById(docRef.current, draft.sourceNodeId)
          : undefined;
        const resolvedVideoModel = resolveAvailableCreationModel(params, runtime);
        const videoProvider = runtime?.providers.find((item) => item.id === resolvedVideoModel.model?.providerId);
        const videoLimits = getVideoModelLimits(resolvedVideoModel.model || undefined, videoProvider);
        const videoInputs = resolveCanvasVideoInputs(
          referenceInputNodes,
          params.inputMode,
          new Map(initialEdges.map((edge) => [edge.source, edge.inputRole])),
          { maxReferenceImages: videoLimits.maxReferenceImages },
        );
        const videoInputError = canvasVideoInputError(videoInputs, params.inputMode, videoLimits, params.operation);
        if (videoInputError) throw new Error(videoInputError);
        const task = await generateCanvasVideo({
          prompt: draft.prompt, model: resolvedVideoModel.model?.id || "auto", operation: params.operation, inputMode: params.inputMode, duration: params.duration, aspect: params.aspect, resolution: params.resolution,
          references: videoInputs.referenceImages.map((reference) => ({ url: String(reference.data.url), name: String(reference.data.name || "参考图片") })),
          firstFrame: videoInputs.firstFrame?.data.url ? String(videoInputs.firstFrame.data.url) : undefined,
          lastFrame: videoInputs.lastFrame?.data.url ? String(videoInputs.lastFrame.data.url) : undefined,
          referenceVideo: sourceNode?.data.kind === "video" && sourceNode.data.url
            ? String(sourceNode.data.url)
            : videoInputs.referenceVideo?.data.url
              ? String(videoInputs.referenceVideo.data.url)
              : undefined,
          audio: params.audio,
        });
        updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === generator.id ? { ...node, data: { ...node.data, status: "running", statusLabel: "视频生成中" } } : node.id === output.id ? { ...node, data: { ...node.data, jobId: task.id, status: task.status === "done" ? "completed" : "running", progress: Number(task.progress || 0), url: task.videoUrls?.[0] || node.data.url, statusLabel: task.status === "done" ? "视频已完成" : "视频生成中", generation: { kind: "video", prompt: draft.prompt, params: clone(params), operation: draft.operation, referenceIds: resolvedReferenceIds, sourceGeneratorId: generator.id, parentNodeId: source?.id, reuseSourceNodeId: source?.id, taskId: task.id, createdAt: Date.now() } } } : node) }));
        writeSharedCreationSettings(params);
        setReuseDraft(null);
        if (task.status === "done") notify("视频复用生成完成");
        else { void pollVideo(output.id, task.id); notify("视频新分支任务已提交"); }
        addLog(`视频复用任务已提交：${task.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "复用生成失败";
      updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === generator.id || node.id === output.id ? { ...node, data: { ...node.data, status: "failed", statusLabel: message } } : node) }));
      notify(message, "error");
      addLog(`复用生成失败：${message}`);
    } finally {
      generationKeysRef.current.delete(activeKey);
      setGenerationKeys(new Set(generationKeysRef.current));
    }
  }, [addLog, commit, notify, openNodePosition, pollVideo, runImageContinuation, runtime, screenToWorld, selectedSingle]);

  const runGeneration = useCallback(async () => {
    if (reuseDraft) {
      await runReuseGeneration(reuseDraft);
      return;
    }
    const source = deckSource();
    const selectedMediaTarget = selectedSingle?.type === "media" ? selectedSingle : null;
    if (selectedMediaTarget?.data.url) {
      const references = incomingReferences(docRef.current, selectedMediaTarget.id)
        .map(canvasReferenceDraftFromNode)
        .filter((reference): reference is CanvasReferenceDraft => Boolean(reference));
      const draft = reuseDraftFromNode(
        selectedMediaTarget,
        references,
        copyParams(
          selectedMediaTarget.data.generation?.params || selectedMediaTarget.data.params,
          selectedMediaTarget.data.kind || "image",
          runtime,
        ),
      );
      if (!draft) return notify("当前节点没有完整生成参数，无法创建新分支。", "error");
      await runReuseGeneration(draft);
      return;
    }
    const sourceTarget = selectedSingle?.type === "media" ? selectedSingle : null;
    if (source.node?.type === "generator" && mode !== "text")
      return runVariantBatch(source.node.id);
    if (mode === "text") {
      const prompt = source.prompt.trim();
      if (!prompt) return notify("请输入要交给 Agent 的内容。", "error");
      const settings =
        source.params.kind === "text"
          ? source.params
          : normalizeCreationSettings("text", null, runtime);
      const resolved = resolveAvailableCreationModel(settings, runtime);
      const activeKey = generationKey(source);
      if (generationKeysRef.current.has(activeKey))
        return notify("这个 Agent 节点正在回复。", "error");
      generationKeysRef.current.add(activeKey);
      setGenerationKeys(new Set(generationKeysRef.current));
      const incoming = source.node
        ? incomingContext(docRef.current, source.node.id)
        : selectedNodes;
      const contextMessages = incoming
        .filter((node) => node.type === "prompt" && node.data.text)
        .map((node) => ({
          role: String(node.data.role || "").includes("回复")
            ? ("assistant" as const)
            : ("user" as const),
          content: String(node.data.text),
        }));
      const referenceNodes = incoming.filter(
        (node) => isCanvasReferenceableNode(node) && node.data.kind === "image",
      );
      const agentMessages = [
        ...contextMessages,
        { role: "user" as const, content: prompt },
      ];
      const intentDecision = classifyAgentDeliverable(prompt, {
        messages: contextMessages,
        hasReferences: referenceNodes.length > 0,
        hasFiles: false,
      });
      const effectiveSettings: AgentCreationSettings = {
        ...settings,
        // An explicit model chosen on the node is authoritative, including
        // image-backed requests. Only "auto" should use the global default.
        model:
          settings.model === "auto" ? "auto" : resolved.model?.id || "auto",
      };
      let inputNode = source.node;
      if (!inputNode) {
        const seed = screenToWorld(
          window.innerWidth / 2,
          window.innerHeight / 2,
        );
        const draft = createPrompt(seed, prompt);
        inputNode = {
          ...draft,
          data: {
            ...draft.data,
            agentPrompt: prompt,
            agentResponse: undefined,
            role: "Agent 输入",
            params: clone(effectiveSettings),
            status: "running",
            processingStartedAt: Date.now(),
            statusLabel: "Agent 思考中",
          },
        };
        const createdInput = inputNode;
        commit((value) => ({
          ...value,
          nodes: [...value.nodes, createdInput!],
        }));
      } else {
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === inputNode!.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    agentPrompt: prompt,
                    agentResponse: undefined,
                    text: prompt,
                    params: clone(effectiveSettings),
                    role: "Agent 输入",
                    status: "running",
                    processingStartedAt: Date.now(),
                    statusLabel: "Agent 思考中",
                  },
                }
              : node,
          ),
        }));
      }
      const inputId = inputNode.id;
      let streamedText = "";
      let renderedStreamedText = "";
      let streamFrame: number | null = null;
      const flushStreamedText = () => {
        streamFrame = null;
        if (!streamedText || streamedText === renderedStreamedText) return;
        renderedStreamedText = streamedText;
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === inputId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    text: streamedText,
                    agentResponse: streamedText,
                    status: "running" as const,
                    statusLabel: "Agent 正在生成回复…",
                  },
                }
              : node,
          ),
        }));
      };
      const scheduleStreamFlush = () => {
        if (streamFrame !== null) return;
        streamFrame = window.requestAnimationFrame(flushStreamedText);
      };
      try {
        const response = await generateCanvasAgent({
          messages: agentMessages,
          model: effectiveSettings.model,
          webMode: effectiveSettings.webMode,
          task: inferCanvasAgentTask(prompt, referenceNodes.length > 0),
          deliverable: intentDecision.deliverable,
          intentReason: intentDecision.reason,
          references: referenceNodes.map((node) => ({
            url: String(node.data.url),
            name: String(node.data.name || "参考图片"),
          })),
        }, (event) => {
          if (event.type === "status" && event.message) {
            updateDoc((value) => ({
              ...value,
              nodes: value.nodes.map((node) =>
                node.id === inputId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: "running" as const,
                        statusLabel: String(event.message),
                      },
                    }
                  : node,
              ),
            }));
          }
          if (event.type === "delta" && event.text) {
            streamedText += String(event.text);
            scheduleStreamFlush();
          }
        });
        if (streamFrame !== null) window.cancelAnimationFrame(streamFrame);
        flushStreamedText();
        const parent = nodeById(docRef.current, inputId) || inputNode;
        const responseText = response.message || "Agent 没有返回文本。";
        const effectiveModelRecord = runtime?.models.find(
          (model) => model.id === effectiveSettings.model,
        );
        const responseModel =
          response.model ||
          effectiveModelRecord?.displayName ||
          resolved.model?.displayName ||
          effectiveSettings.model;
        const imageSettings = readSharedCreationSettings("image", runtime);
        const responseDeliverable = response.deliverable || intentDecision.deliverable;
        const localAllowsImages = intentDecision.deliverable === "IMAGE" || intentDecision.deliverable === "BOTH";
        const serverAllowsImages = responseDeliverable === "IMAGE" || responseDeliverable === "BOTH";
        const acceptedImages = localAllowsImages && serverAllowsImages
          ? response.images || []
          : [];
        if (response.images?.length && !acceptedImages.length)
          addLog(`Agent 返回了 ${response.images.length} 张非预期图片，已按文字交付规则忽略`);
        const imageNodes = acceptedImages.map((image, index) =>
          createMedia(
            "image",
            image.url,
            `Agent 图片 ${index + 1}`,
            {
              x: parent.x + nodeSize(parent).w + 90 + (index % 2) * 350,
              y: parent.y + Math.floor(index / 2) * 280,
            },
            {
              role: "Agent 生成结果",
              model: response.model,
              generation: {
                kind: "image",
                prompt,
                params: clone(imageSettings),
                referenceIds: referenceNodes.map((node) => node.id),
                parentNodeId: inputId,
                createdAt: Date.now(),
              },
              referenceOrder: referenceNodes.map((node) => node.id),
            },
          ),
        );
        commit((value) => {
          let next = {
            ...value,
            nodes: value.nodes
              .map((node) =>
                node.id === inputId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        text: responseText,
                        agentPrompt: prompt,
                        agentResponse: responseText,
                        role: "Agent 回复",
                        model: responseModel,
                        params: clone(effectiveSettings),
                        status: "completed" as const,
                        statusLabel: "Agent 已回复",
                      },
                    }
                  : node,
              )
              .concat(imageNodes),
          };
          imageNodes.forEach((node) => {
            next = addEdge(
              next,
              inputId,
              node.id,
              "right",
              "left",
              "generated",
            );
          });
          return next;
        });
        setSelectedIds(new Set([inputId]));
        setSelectedGroupId(null);
        if (!source.node) writeSharedCreationSettings(effectiveSettings);
        if (acceptedImages.length)
          void recordCanvasImages(acceptedImages, {
            prompt,
            source: "canvas",
            modelId: imageSettings.model,
            modelName: response.model,
            aspectRatio: imageSettings.aspect,
            outputSize: imageSettings.resolution,
            outputFormat: imageSettings.outputFormat,
            parentId: inputId,
          });
        addLog(`Agent 回复完成：${responseModel}`);
        notify(
          acceptedImages.length
            ? `Agent 已回复并生成 ${acceptedImages.length} 张图片`
            : "Agent 已回复",
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Agent 请求失败";
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === inputId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    status: "failed",
                    statusLabel: message,
                  },
                }
              : node,
          ),
        }));
        notify(message, "error");
      } finally {
        if (streamFrame !== null) window.cancelAnimationFrame(streamFrame);
        generationKeysRef.current.delete(activeKey);
        setGenerationKeys(new Set(generationKeysRef.current));
      }
      return;
    }
    const kind = source.kind as CanvasMediaKind;
    const ownerId = source.node?.id || sourceTarget?.id;
    const incoming = ownerId ? incomingContext(docRef.current, ownerId) : [];
    const baseLinked = ownerId
      ? [
          ...(sourceTarget?.data.url ? [sourceTarget] : []),
          ...incoming.filter((node) => isCanvasReferenceableNode(node)),
        ]
      : selectedNodes.filter((node) => isCanvasReferenceableNode(node));
    const linked = [
      ...new Map(
        [
          ...baseLinked,
          ...mentionedMedia(source.prompt, mentionCandidates),
        ].map((node) => [node.id, node]),
      ).values(),
    ];
    const context = [
      ...incoming.filter((node) => node.type === "prompt"),
      ...linked,
      ...selectedNodes.filter((node) => node.type === "prompt"),
    ];
    const prompt = smartPrompt(
      resolveMentionTokens(source.prompt, mentionCandidates),
      context,
    );
    if (!prompt.trim()) return notify("请输入生成提示词。", "error");
    const inputSemantics = resolveCanvasInputSemantics(
      linked,
      kind === "video" ? "video" : "image",
      kind === "video" ? (source.params as VideoCreationSettings).inputMode : undefined,
    );
    const resolvedModel = resolveAvailableCreationModel(source.params, runtime);
    const effectiveParams = {
      ...source.params,
      model: resolvedModel.model?.id || "auto",
    } as CreationSettings;
    const videoParams = kind === "video" ? effectiveParams as VideoCreationSettings : undefined;
    const videoProvider = runtime?.providers.find((item) => item.id === resolvedModel.model?.providerId);
    const videoLimits = kind === "video" ? getVideoModelLimits(resolvedModel.model || undefined, videoProvider) : undefined;
    const videoInputs = kind === "video" && videoParams && videoLimits
      ? resolveCanvasVideoInputs(
          linked,
          videoParams.inputMode,
          ownerId ? canvasInputRolesForTarget(docRef.current, ownerId) : undefined,
          { maxReferenceImages: videoLimits.maxReferenceImages },
        )
      : undefined;
    if (kind === "video" && videoParams && videoLimits && videoInputs) {
      const videoInputError = canvasVideoInputError(videoInputs, videoParams.inputMode, videoLimits, videoParams.operation);
      if (videoInputError) return notify(videoInputError, "error");
    }
    const refs = (kind === "video" ? videoInputs?.referenceImages || [] : inputSemantics.imageReferences)
      .map((node) => ({
          url: String(node.data.url || ""),
          name: String(node.data.name || "参考素材"),
        }))
      .filter((item) => item.url);
    const sourceNode = source.node;
    let targetId = sourceTarget?.id || "";
    const activeKey = generationKey(source);
    if (generationKeysRef.current.has(activeKey))
      return notify("这个节点正在生成，请稍候。", "error");
    generationKeysRef.current.add(activeKey);
    setGenerationKeys(new Set(generationKeysRef.current));
    let pendingImageId = "";
    try {
      // Draft and completed media cards both own their next generation. A
      // completed card is updated in place so a simple retry does not grow a
      // second branch node; lineage tools (mask/upscale) remain explicit
      // branch operations below.
      const pendingId = sourceNode?.id || sourceTarget?.id;
      if (pendingId)
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === pendingId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    status: "running",
                    processingStartedAt: Date.now(),
                    statusLabel: kind === "video" ? "视频生成中" : "图片生成中",
                    prompt,
                  },
                }
              : node,
          ),
        }));
      if (kind === "image") {
        const imageParams = effectiveParams as ImageCreationSettings;
        const taskId = uid("image-task");
        const base = sourceTarget || sourceNode;
        const maskOwner = sourceTarget?.type === "media" && sourceTarget.data.kind === "image"
          ? sourceTarget
          : sourceNode?.type === "media" && sourceNode.data.kind === "image"
            ? sourceNode
            : undefined;
        const position = base
          ? {
              x:
                base.x +
                  (sourceTarget && !sourceTarget.data.url
                  ? 0
                  : nodeSize(base).w + 90),
              y: base.y,
            }
          : screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        if (!base) {
          const pending = createMedia(
            "image",
            "",
            "图片生成中",
            position,
            {
              role: "生成中",
              status: "running",
              processingStartedAt: Date.now(),
              progress: 0,
              statusLabel: "图片生成中 · 等待结果",
              generation: {
                kind: "image",
                prompt,
                params: clone(imageParams),
                referenceIds: linked.map((node) => node.id),
                taskId,
                createdAt: Date.now(),
              },
              referenceOrder: linked.map((node) => node.id),
            },
          );
          pendingImageId = pending.id;
          commit((value) => ({
            ...value,
            nodes: [...value.nodes, pending],
          }));
        }
        if (imageParams.mask && maskOwner) {
          updateDoc((value) =>
            updateCanvasMaskState(value, maskOwner.id, {
              status: "running",
              taskId,
              error: undefined,
            }),
          );
        }
        const result = await generateCanvasImage({
          taskId,
          prompt,
          model: imageParams.model,
          count: imageParams.count,
          aspect:
            imageParams.aspect === "自定义"
              ? `${imageParams.customAspectWidth}:${imageParams.customAspectHeight}`
              : imageParams.aspect,
          resolution: imageParams.resolution,
          quality: imageParams.quality,
          ...(imageParams.sizeMode === "custom"
            ? { width: imageParams.width, height: imageParams.height }
            : {}),
          outputFormat: imageParams.outputFormat,
          background:
            imageParams.backgroundMode === "api-transparent"
              ? "transparent"
              : imageParams.backgroundMode === "opaque"
                ? "opaque"
                : undefined,
          maskUrl: imageParams.mask?.url,
          references: refs,
        });
        if (!result.images?.length) throw new Error("服务端没有返回图片结果。");
        const outputs = result.images.map((image, index) =>
          createMedia(
            "image",
            image.url,
            `生成图片 ${index + 1}`,
            {
              x: position.x + (index % 2) * 350,
              y: position.y + Math.floor(index / 2) * 280,
            },
            {
              role: "生成结果",
              model: result.model?.name || imageParams.model,
              ...(imageParams.mask
                ? { maskApplied: true, maskSourceNodeId: maskOwner?.id }
                : {}),
              generation: {
                kind: "image",
                prompt,
                params: clone(imageParams),
                referenceIds: linked.map((node) => node.id),
                sourceGeneratorId: sourceNode?.id,
                parentNodeId: undefined,
                taskId,
                createdAt: Date.now(),
              },
              referenceOrder: linked.map((node) => node.id),
            },
          ),
        );
        const fillsTarget = Boolean(sourceTarget) || Boolean(pendingImageId);
        const fillId = sourceTarget?.id || pendingImageId;
        const selectedOutputIds = fillsTarget
          ? [fillId, ...outputs.slice(1).map((output) => output.id)]
          : outputs.map((output) => output.id);
        updateDoc((value) => {
          let next = value;
          if (fillsTarget && fillId) {
            next = {
              ...next,
              nodes: [
                ...next.nodes.map((node) =>
                  node.id === fillId
                    ? {
                        ...node,
                        ...outputs[0],
                        id: fillId,
                        x: node.x,
                        y: node.y,
                        groupId: node.groupId,
                        data: {
                          ...node.data,
                          ...outputs[0].data,
                          status: "completed" as const,
                          statusLabel: "图片已完成",
                        },
                      }
                    : node,
                ),
                ...outputs.slice(1),
              ],
            };
            outputs.slice(1).forEach((output) => {
              if (sourceTarget)
                next = addEdge(
                  next,
                  sourceTarget.id,
                  output.id,
                  "right",
                  "left",
                  "variant",
                );
            });
          } else {
            next = { ...next, nodes: [...next.nodes, ...outputs] };
            if (sourceTarget?.data.url)
              outputs.forEach((output) => {
                next = addEdge(
                  next,
                  sourceTarget.id,
                  output.id,
                  "right",
                  "left",
                  "variant",
                );
              });
            else if (sourceNode)
              outputs.forEach((output) => {
                next = addEdge(
                  next,
                  sourceNode.id,
                  output.id,
                  "right",
                  "left",
                  "generated",
                );
              });
          }
          if (sourceNode)
            next = {
              ...next,
              nodes: next.nodes.map((node) =>
                node.id === sourceNode.id
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: "completed",
                        statusLabel: "图片生成完成",
                      },
                    }
                  : node,
              ),
            };
          if (imageParams.mask && maskOwner)
            next = updateCanvasMaskState(next, maskOwner.id, {
              status: "used",
              taskId,
              error: undefined,
            });
          return next;
        });
        setSelectedIds(new Set(selectedOutputIds));
        setSelectedGroupId(null);
        writeSharedCreationSettings(imageParams);
        void recordCanvasImages(result.images, {
          prompt,
          source: "canvas",
          modelId: imageParams.model,
          modelName: result.model?.name,
          providerName: result.model?.provider,
          aspectRatio: imageParams.aspect,
          outputSize:
            imageParams.sizeMode === "custom"
              ? `${imageParams.width}x${imageParams.height}`
              : imageParams.resolution,
          outputFormat: imageParams.outputFormat,
          parentId: sourceTarget?.data.url ? sourceTarget.id : undefined,
        })
          .then(() => setAssetRefresh((value) => value + 1))
          .catch(() => addLog("图片已生成，但写入主界面历史失败"));
        notify(`已生成 ${result.images.length} 张图片`);
        addLog(`图片生成完成：${result.images.length} 张`);
      } else {
        const videoParams = effectiveParams as VideoCreationSettings;
        const parent = sourceTarget || sourceNode;
        const fillsTarget = Boolean(sourceTarget);
        const position = parent
          ? {
              x: parent.x + (fillsTarget ? 0 : nodeSize(parent).w + 90),
              y: parent.y,
            }
          : screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const target = fillsTarget
          ? sourceTarget!
          : createMedia("video", "", "视频任务", position, {
              role: "生成结果",
              status: "queued",
              processingStartedAt: Date.now(),
              statusLabel: "视频任务提交中",
              generation: {
                kind: "video",
                prompt,
                params: clone(videoParams),
                referenceIds: linked.map((item) => item.id),
                sourceGeneratorId: sourceNode?.id,
                parentNodeId: undefined,
                createdAt: Date.now(),
              },
            });
        targetId = target.id;
        if (!fillsTarget)
          commit((value) => ({
            ...value,
            nodes: [...value.nodes, target],
            edges: parent
              ? [
                  ...value.edges,
                  {
                    id: uid("edge"),
                    source: parent.id,
                    target: target.id,
                    sourcePort: "right",
                    targetPort: "left",
                    kind: sourceTarget?.data.url ? "variant" : "generated",
                  },
                ]
              : value.edges,
          }));
        const referenceVideo =
          videoParams.operation !== "generate"
            ? String(
                (sourceTarget?.data.kind === "video" &&
                  sourceTarget.data.url) ||
                  linked.find((item) => item.data.kind === "video")?.data.url ||
                  "",
              )
            : undefined;
        const task = await generateCanvasVideo({
          prompt,
          model: effectiveParams.model,
          operation: videoParams.operation,
          inputMode: videoParams.inputMode,
          duration: videoParams.duration,
          aspect: videoParams.aspect,
          resolution: videoParams.resolution,
          references: (videoInputs?.referenceImages || [])
            .filter((item) => item.data.url)
            .map((item) => ({
              url: String(item.data.url),
              name: String(item.data.name || "参考图片"),
            })),
          firstFrame: videoInputs?.firstFrame?.data.url ? String(videoInputs.firstFrame.data.url) : undefined,
          lastFrame: videoInputs?.lastFrame?.data.url ? String(videoInputs.lastFrame.data.url) : undefined,
           referenceVideo:
             referenceVideo ||
             (videoParams.inputMode === "reference" && videoInputs?.referenceVideo?.data.url
               ? String(videoInputs.referenceVideo.data.url)
               : undefined),
          audio: videoParams.audio,
        });
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === targetId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    jobId: task.id,
                    status: task.status === "done" ? "completed" : "running",
                    progress: Number(task.progress || 0),
                    url: task.videoUrls?.[0] || node.data.url,
                    statusLabel:
                      task.status === "done" ? "视频已完成" : "视频生成中",
                    generation: {
                      kind: "video",
                      prompt,
                      params: clone(videoParams),
                      referenceIds: linked.map((item) => item.id),
                      sourceGeneratorId: sourceNode?.id,
                      parentNodeId: undefined,
                      taskId: task.id,
                      createdAt: Date.now(),
                    },
                  },
                }
              : node,
          ),
        }));
        writeSharedCreationSettings(videoParams);
        if (task.status === "done") notify("视频生成完成");
        else {
          void pollVideo(targetId, task.id);
          notify("视频任务已提交，结果会自动写入画布");
        }
        addLog(`视频任务已提交：${task.id}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      const failedMaskOwner = sourceTarget?.type === "media" && sourceTarget.data.kind === "image"
        ? sourceTarget
        : sourceNode?.type === "media" && sourceNode.data.kind === "image"
          ? sourceNode
          : undefined;
      if (
        kind === "image" &&
        failedMaskOwner &&
        (effectiveParams as ImageCreationSettings).mask
      ) {
        updateDoc((value) =>
          updateCanvasMaskState(value, failedMaskOwner.id, {
            status: "failed",
            error: message,
          }),
        );
      }
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.id === sourceNode?.id ||
          node.id === targetId ||
          node.id === pendingImageId
            ? {
                ...node,
                data: { ...node.data, status: "failed", statusLabel: message },
              }
            : node,
        ),
      }));
      notify(message, "error");
      addLog(`生成失败：${message}`);
    } finally {
      generationKeysRef.current.delete(activeKey);
      setGenerationKeys(new Set(generationKeysRef.current));
    }
  }, [
    addLog,
    addNode,
    commit,
    deckSource,
    mentionCandidates,
    mode,
    notify,
    pollVideo,
    runVariantBatch,
    runtime,
    screenToWorld,
    selectedNodes,
    selectedSingle,
    updateDoc,
    reuseDraft,
    runReuseGeneration,
  ]);

  runGenerationRef.current = runGeneration;

  const editorPromptFor = useCallback(
    (node: CanvasNode) => {
      const draft = editorDrafts[node.id];
      if (draft) return draft.prompt;
      if (node.type === "prompt") return String(node.data.agentPrompt || node.data.text || "");
      return String(node.data.generation?.prompt || node.data.prompt || "");
    },
    [editorDrafts],
  );

  const editorParamsFor = useCallback(
    (node: CanvasNode): CanvasGenerationParams | undefined => {
      const draft = editorDrafts[node.id];
      if (draft?.params) return draft.params;
      if (node.type === "prompt") return normalizeCreationSettings("text", node.data.params, runtime);
      const kind = node.data.kind === "video" ? "video" : "image";
      return copyParams(node.data.generation?.params || node.data.params, kind, runtime);
    },
    [editorDrafts, runtime],
  );

  const openImageEditor = useCallback(
    (node: CanvasNode, overrides?: { prompt?: string; params?: CanvasGenerationParams }) => {
      if (node.type !== "media" || node.data.kind !== "image") return;
      let params: CanvasGenerationParams | undefined;
      try {
        params = overrides?.params ? clone(overrides.params) : editorParamsFor(node);
      } catch {
        params = undefined;
      }
      setEditorDrafts((current) => ({
        ...current,
        [node.id]: {
          prompt: overrides?.prompt ?? editorPromptFor(node),
          params,
        },
      }));
      if (reuseDraft?.sourceNodeId !== node.id) setReuseDraft(null);
      setExpandedEditorId(node.id);
      setSelectedIds(new Set([node.id]));
      setSelectedGroupId(null);
      setMode("image");
      setLightbox(null);
    },
    [editorParamsFor, editorPromptFor, reuseDraft],
  );

  const toggleEditor = useCallback(
    (node: CanvasNode) => {
      if (expandedEditorId === node.id) {
        setExpandedEditorId(null);
        if (reuseDraft?.sourceNodeId === node.id) setReuseDraft(null);
        return;
      }
      if (node.type === "media" && node.data.url && node.data.kind === "video") {
        openReuseDraft(node);
        return;
      }
      if (node.type === "media" && node.data.kind === "image") {
        openImageEditor(node);
        return;
      }
      // A card can be draggable, so keep editor opening independent from the
      // drag gesture. Some persisted legacy nodes also carry partial params;
      // opening the editor must still work with a safe default in that case.
      let params: CanvasGenerationParams | undefined;
      try {
        params = editorParamsFor(node);
      } catch {
        params = undefined;
      }
      setEditorDrafts((current) => ({
        ...current,
        [node.id]: {
          prompt: editorPromptFor(node),
          params,
        },
      }));
      setExpandedEditorId(node.id);
      setSelectedIds(new Set([node.id]));
      setSelectedGroupId(null);
      setMode(node.type === "prompt" ? "text" : node.data.kind === "video" ? "video" : "image");
    },
    [editorParamsFor, editorPromptFor, expandedEditorId, openImageEditor, openReuseDraft, reuseDraft],
  );

  useEffect(() => {
    if (!pendingClickNodeId) return;
    const node = nodeById(docRef.current, pendingClickNodeId);
    setPendingClickNodeId(null);
    if (node && expandedEditorId !== node.id) toggleEditor(node);
  }, [expandedEditorId, pendingClickNodeId, toggleEditor]);

  const updateEditorPrompt = useCallback(
    (node: CanvasNode, value: string) => {
      setEditorDrafts((current) => ({
        ...current,
        [node.id]: { ...current[node.id], prompt: value },
      }));
      if (reuseDraft?.sourceNodeId === node.id) {
        setReuseDraft((current) =>
          current?.sourceNodeId === node.id
            ? { ...current, prompt: value, dirty: true }
            : current,
        );
        return;
      }
      updateDoc((valueDoc) => ({
        ...valueDoc,
        nodes: valueDoc.nodes.map((item) => {
          if (item.id !== node.id) return item;
          if (item.type === "prompt")
            return {
              ...item,
              data: {
                ...item.data,
                text: value,
                agentPrompt: value,
                agentResponse: undefined,
                role: "Agent 输入",
                status: "idle",
                statusLabel: undefined,
                editor: { ...item.data.editor, draftPrompt: value, dirty: true },
              },
            };
          return {
            ...item,
            data: {
              ...item.data,
              prompt: value,
              ...(item.data.generation
                ? { generation: { ...item.data.generation, prompt: value } }
                : {}),
              editor: { ...item.data.editor, draftPrompt: value, dirty: true },
            },
          };
        }),
      }));
    },
    [reuseDraft, updateDoc],
  );

  const updateEditorParams = useCallback(
    (node: CanvasNode, settings: CreationSettings) => {
      setEditorDrafts((current) => ({
        ...current,
        [node.id]: { ...current[node.id], prompt: editorPromptFor(node), params: clone(settings) },
      }));
      if (reuseDraft?.sourceNodeId === node.id) {
        setReuseDraft((current) =>
          current?.sourceNodeId === node.id
            ? { ...current, params: clone(settings), dirty: true }
            : current,
        );
        return;
      }
      updateDoc((valueDoc) => ({
        ...valueDoc,
        nodes: valueDoc.nodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                data: {
                  ...item.data,
                  params: clone(settings),
                  generation: item.data.generation
                    ? { ...item.data.generation, params: clone(settings) }
                    : item.data.generation,
                  editor: { ...item.data.editor, draftParams: clone(settings), dirty: true },
                },
              }
            : item,
        ),
      }));
      if (node.type !== "prompt") writeSharedCreationSettings(settings);
    },
    [editorPromptFor, reuseDraft, updateDoc],
  );

  const addNodeReference = useCallback(
    (targetId: string, sourceId: string, requestedRole?: CanvasInputRole) => {
      connectCanvasNodes(sourceId, targetId, "right", "left", requestedRole);
    },
    [connectCanvasNodes],
  );

  const removeNodeReference = useCallback(
    (targetId: string, sourceId: string) => {
      const edgeIds = docRef.current.edges
        .filter((edge) => edge.target === targetId && edge.source === sourceId)
        .map((edge) => edge.id);
      if (edgeIds.length) commit((value) => edgeIds.reduce((next, id) => removeEdge(next, id), value));
    },
    [commit],
  );

  const addEditorReferenceFiles = useCallback(
    async (targetId: string, files: File[]) => {
      const target = nodeById(docRef.current, targetId);
      if (!target || !files.length) return;
      const existing = incomingReferences(docRef.current, targetId).length;
      if (existing >= 16) return notify("参考图最多 16 张。", "error");
      const nodes: CanvasNode[] = [];
      let optimizedImageCount = 0;
      for (const [index, file] of files.slice(0, 16 - existing).entries()) {
        try {
          const asset = await uploadCanvasAsset(file);
          if (asset.kind === "image" && asset.optimized) optimizedImageCount += 1;
          if (target.data.kind === "image" && asset.kind !== "image") {
            notify("图片节点只接受图片参考。", "error");
            continue;
          }
          nodes.push(
            createMedia(asset.kind, asset.url, asset.name, {
              x: target.x - nodeSize(target).w - 90,
              y: target.y + index * 230,
            }, {
              role: "参考素材",
              assetId: asset.id,
              params: defaultParams(asset.kind, runtime),
            }),
          );
        } catch (error) {
          notify(error instanceof Error ? error.message : "参考素材上传失败。", "error");
        }
      }
      if (!nodes.length) return;
      const rejected: string[] = [];
      const accepted = new Set<string>();
      commit((value) => {
        let next = { ...value, nodes: [...value.nodes, ...nodes] };
        nodes.forEach((node) => {
          const result = connectCanvasNodesInDocument(next, node.id, targetId, "right", "left", runtime);
          if (result.ok) {
            next = result.document;
            accepted.add(node.id);
          } else rejected.push(result.reason || `${node.data.name || "素材"}无法接入`);
        });
        return {
          ...next,
          nodes: next.nodes.filter((node) => !nodes.some((candidate) => candidate.id === node.id) || accepted.has(node.id)),
        };
      });
      if (rejected.length && !accepted.size) {
        notify(rejected[0], "error");
        return;
      }
      notify(
        optimizedImageCount
          ? `已自动优化 ${optimizedImageCount} 张图片后上传，已添加 ${accepted.size} 张参考素材`
          : `已添加 ${accepted.size} 张参考素材${rejected.length ? `，${rejected.length} 张未接入` : ""}`,
      );
      if (rejected.length) addLog(`有 ${rejected.length} 张上传素材未接入目标节点`);
    },
    [addLog, commit, notify, runtime],
  );

  const runEditorGeneration = useCallback(
    (node: CanvasNode) => {
      if (node.type === "upscale") {
        void runUpscaleNodeRef.current?.(node);
        return;
      }
      if (reuseDraft?.sourceNodeId === node.id) {
        const draft = cloneReuseDraft(reuseDraft);
        setExpandedEditorId(null);
        setReuseDraft(null);
        void runReuseGeneration(draft);
        return;
      }
      const draft = editorDrafts[node.id];
      if (draft) {
        commit((valueDoc) => ({
          ...valueDoc,
          nodes: valueDoc.nodes.map((item) =>
            item.id === node.id
              ? {
                  ...item,
                  data: {
                    ...item.data,
                    ...(item.type === "prompt" ? { text: draft.prompt, agentPrompt: draft.prompt } : { prompt: draft.prompt }),
                    ...(draft.params ? { params: clone(draft.params) } : {}),
                    ...(item.type === "media" && item.data.generation
                      ? {
                          generation: {
                            ...item.data.generation,
                            prompt: draft.prompt,
                            ...(draft.params ? { params: clone(draft.params) } : {}),
                          },
                        }
                      : {}),
                    editor: { ...item.data.editor, dirty: false, draftPrompt: draft.prompt, draftParams: draft.params },
                  },
                }
              : item,
          ),
        }));
      }
      setSelectedIds(new Set([node.id]));
      setSelectedGroupId(null);
      setMode(node.type === "prompt" ? "text" : node.data.kind === "video" ? "video" : "image");
      setExpandedEditorId(null);
      window.setTimeout(() => void runGenerationRef.current?.(), 0);
    },
    [commit, editorDrafts, reuseDraft, runReuseGeneration],
  );

  const updateUpscaleParams = useCallback((node: CanvasNode, params: CanvasUpscaleParams) => {
    if (node.type !== "upscale") return;
    const prompt = params.prompt || "Upscale this image";
    updateDoc((value) => ({ ...value, nodes: value.nodes.map((item) => item.id === node.id ? { ...item, data: { ...item.data, params: clone(params), prompt, generation: item.data.generation ? { ...item.data.generation, params: clone(params), prompt } : item.data.generation } } : item) }));
  }, [updateDoc]);

  const retryVariant = useCallback(
    (generatorId: string, variantIndex: number) => {
      void runVariantBatch(generatorId, [variantIndex]);
    },
    [runVariantBatch],
  );

  const retryFailedVariants = useCallback(
    (generatorId: string) => {
      const generator = nodeById(docRef.current, generatorId);
      if (!generator || generator.type !== "generator") return;
      const failedIndices = variantStatesFor(generator)
        .map((state, index) => (state.status === "failed" ? index : -1))
        .filter((index) => index >= 0);
      void runVariantBatch(generatorId, failedIndices);
    },
    [runVariantBatch],
  );

  const applyCanvasMask = useCallback(
    async (maskDataUrl: string, coverage = 0) => {
      const node = maskNodeId
        ? nodeById(docRef.current, maskNodeId)
        : undefined;
      if (!node || node.type !== "media" || node.data.kind !== "image") {
        setMaskNodeId(null);
        return;
      }
      try {
        const existingDraft =
          reuseDraft?.sourceNodeId === node.id
            ? cloneReuseDraft(reuseDraft)
            : reuseDraftFromNode(
                node,
                incomingReferences(docRef.current, node.id)
                  .map(canvasReferenceDraftFromNode)
                  .filter(
                    (reference): reference is CanvasReferenceDraft =>
                      Boolean(reference),
                  ),
                copyParams(
                  node.data.generation?.params || node.data.params,
                  "image",
                  runtime,
                ),
              );
        if (!existingDraft)
          throw new Error("当前节点没有完整生成参数，无法使用蒙版。");
        const uploaded = await uploadCanvasAsset(
          dataUrlFile(maskDataUrl, `mask-${node.id}.png`),
        );
        const settings = copyParams(
          existingDraft.params,
          "image",
          runtime,
        ) as ImageCreationSettings;
        const params = {
          ...settings,
          mask: { assetId: uploaded.id, url: uploaded.url },
        } satisfies ImageCreationSettings;
        const maskCoverage = Math.max(0, Math.min(1, coverage));
        const mask: CanvasMaskState = {
          assetId: uploaded.id,
          url: uploaded.url,
          status: "pending",
          coverage: maskCoverage,
          createdAt: node.data.mask?.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((item) =>
            item.id === node.id
              ? {
                  ...item,
                  data: {
                    ...item.data,
                    mask,
                    params: clone(params),
                    ...(item.data.generation
                      ? {
                          generation: {
                            ...item.data.generation,
                            params: clone(params),
                          },
                        }
                      : {}),
                  },
                }
              : item,
          ),
        }));
        if (reuseDraft?.sourceNodeId === node.id) {
          setReuseDraft({ ...existingDraft, params, dirty: true });
          setExpandedEditorId(node.id);
          setSelectedIds(new Set([node.id]));
          setSelectedGroupId(null);
          setLightbox(null);
        } else {
          openImageEditor(node, { params });
        }
        setMaskNodeId(null);
        notify(
          `蒙版已保存（覆盖 ${Math.round(maskCoverage * 100)}%），点击生成即可创建右侧新图；原图保持不变`,
          "ok",
        );
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "蒙版保存失败",
          "error",
        );
      }
    },
    [maskNodeId, notify, openImageEditor, reuseDraft, runtime, updateDoc],
  );

  const removeCanvasMask = useCallback(
    (node: CanvasNode) => {
      if (node.type !== "media" || node.data.kind !== "image") return;
      const cleanedParams = maskParamsWithoutMask(
        editorDrafts[node.id]?.params ||
          node.data.generation?.params ||
          node.data.params,
        runtime,
      );
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                data: {
                  ...item.data,
                  mask: undefined,
                  params: clone(cleanedParams),
                  ...(item.data.generation
                    ? {
                        generation: {
                          ...item.data.generation,
                          params: clone(cleanedParams),
                        },
                      }
                    : {}),
                },
              }
            : item,
        ),
      }));
      setEditorDrafts((current) => ({
        ...current,
        [node.id]: {
          ...current[node.id],
          prompt:
            current[node.id]?.prompt ||
            String(node.data.generation?.prompt || node.data.prompt || ""),
          params: clone(cleanedParams),
        },
      }));
      if (reuseDraft?.sourceNodeId === node.id)
        setReuseDraft((current) =>
          current?.sourceNodeId === node.id
            ? { ...current, params: clone(cleanedParams), dirty: true }
            : current,
        );
      notify("蒙版已移除，下一次生成不会再携带蒙版");
    },
    [editorDrafts, notify, reuseDraft, runtime, updateDoc],
  );

  const createUpscaleFromSource = useCallback((sourceOverride?: CanvasNode) => {
    const source = sourceOverride || selectedSingle;
    if (!source || !isCanvasReadyImageSource(source))
      return notify("请先选择一张已完成的图片", "error");
    const draft = createUpscaleNode({ x: source.x + nodeSize(source).w + 90, y: source.y });
    const next = addEdge({ ...docRef.current, nodes: [...docRef.current.nodes, draft] }, source.id, draft.id, "right", "left", "manual", "upscale-image");
    if (next === docRef.current) return notify("无法连接超分节点", "error");
    commit(() => next);
    setSelectedIds(new Set([draft.id]));
    setSelectedGroupId(null);
    setExpandedEditorId(draft.id);
    setLightbox(null);
    notify("已创建超分节点，请设置参数后提交");
  }, [commit, notify, selectedSingle]);

  const runUpscaleNode = useCallback(async (node: CanvasNode) => {
    if (node.type !== "upscale") return;
    const source = canvasUpscaleSource(docRef.current, node.id);
    if (!source?.data.url) return notify("请连接一张已完成的图片", "error");
    const params = (node.data.params && typeof node.data.params === "object" ? node.data.params : {}) as CanvasUpscaleParams;
    const dimensions = await loadImageDimensions(String(source.data.url)).catch(() => null);
    if (!dimensions) return notify("无法读取原图尺寸", "error");
    const requestedCloudModel = params.model !== "auto"
      ? runtime?.upscaleModels?.find((model) => model.id === params.model)
        || getUpscaleCatalogModel(params.model)
      : undefined;
    const selectedLegacyModel = runtime?.models?.find((model) => model.id === params.model && model.enabled && model.published && (model.capabilities || []).includes("upscale"));
    const activeCloudModel = requestedCloudModel || (params.model === "auto"
      ? runtime?.upscaleModels?.find((model) => model.connected && model.id === "tencent-super-resolution")
        || runtime?.upscaleModels?.find((model) => model.connected && model.id === "aliyun-standard-super-resolution")
      : undefined);
    const isCloudModel = Boolean(activeCloudModel);
    const selectedModel = params.model !== "auto" && (requestedCloudModel || selectedLegacyModel) ? params.model : "auto";
    const scale = activeCloudModel?.scales.includes(params.scale) ? params.scale : params.scale || 2;
    const outputFormat = activeCloudModel?.outputFormats?.includes(params.outputFormat || "png") ? params.outputFormat : undefined;
    const outputQuality = outputFormat === "jpg" ? params.outputQuality : undefined;
    const targetDimensions = isCloudModel
      ? { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) }
      : seedVrTargetSize(dimensions.width, dimensions.height, scale, params.target || "auto");
    const size = isCloudModel ? undefined : `${targetDimensions.width}x${targetDimensions.height}`;
    const requestTaskId = node.data.status === "running" && node.data.upscaleRequestId
      ? String(node.data.upscaleRequestId)
      : uid("upscale-task");
    const activeKey = `upscale-node:${node.id}`;
    if (generationKeysRef.current.has(activeKey)) return;
    generationKeysRef.current.add(activeKey); setGenerationKeys(new Set(generationKeysRef.current));
    // Processing belongs to this node. Hide the editor after submission so
    // the canvas stays usable; selecting the node again can reopen it while
    // the card continues to show progress.
    setExpandedEditorId((current) => current === node.id ? null : current);
    updateDoc((value) => ({ ...value, nodes: value.nodes.map((item) => item.id === node.id ? { ...item, data: { ...item.data, status: "running", statusLabel: "超分处理中", progress: undefined, processingStartedAt: Date.now(), upscaleRequestId: requestTaskId } } : item) }));
    try {
      let result = await generateCanvasUpscale({
        taskId: requestTaskId,
        sourceImageId: String(source.data.sourceAssetId || source.id),
        prompt: params.prompt || "Upscale this image",
        model: selectedModel,
        referenceUrl: String(source.data.url),
        scale,
        ...(isCloudModel ? {
          cloud: true,
          ...(outputFormat ? { outputFormat } : {}),
          ...(outputQuality ? { outputQuality } : {}),
        } : {
          size,
          seed: params.seed || 42,
          colorCorrection: params.colorCorrection || "wavelet",
          resizeMethod: params.algorithm || "lanczos",
        }),
      });
      const submittedTaskId = result.taskId;
      if (submittedTaskId && (result.status === "queued" || result.status === "processing")) {
        updateDoc((value) => ({ ...value, nodes: value.nodes.map((item) => item.id === node.id ? {
          ...item,
          data: {
            ...item.data,
            jobId: submittedTaskId,
            upscaleRequestId: requestTaskId,
            generation: item.data.generation ? { ...item.data.generation, taskId: requestTaskId, updatedAt: Date.now() } : item.data.generation,
          },
        } : item) }));
        result = await waitForCanvasUpscaleTask(submittedTaskId);
      }
      if (!result.images?.length) throw new Error("服务端没有返回超分结果");
      const resultCreatedAt = Date.now();
      const resultUrl = String(result.images[0].url || "");
      if (!resultUrl) throw new Error("服务端没有返回超分图片");
      // Keep the upscale node as the output node. The incoming source edge is
      // retained, while the node itself now carries the generated image and
      // an explicit marker for UI/history consumers.
      commit((value) => ({ ...value, nodes: value.nodes.map((item) => item.id === node.id ? {
        ...item,
        data: {
          ...item.data,
          kind: "image",
          url: resultUrl,
          name: `${source.data.name || "图片"} · 超分结果`,
          role: "超分结果",
          resultSource: "upscale-node",
          model: result.model?.name || params.model || "自动超分模型",
           nativeWidth: targetDimensions.width,
           nativeHeight: targetDimensions.height,
          status: "completed",
          statusLabel: "超分节点生成的结果",
          progress: 100,
          processingStartedAt: undefined,
          jobId: submittedTaskId,
          upscaleRequestId: requestTaskId,
          generation: {
            kind: "image",
            prompt: params.prompt || "Upscale this image",
            params: { ...params } as any,
            operation: "upscale",
            referenceIds: [source.id],
            parentNodeId: item.id,
            taskId: requestTaskId,
            createdAt: resultCreatedAt,
          },
        },
      } : item) }));
      setSelectedIds(new Set([node.id])); setSelectedGroupId(null);
      recordModelCall({
        context: "upscale",
        mode: selectedModel === "auto" ? "auto" : "manual",
        modelId: result.model?.id || selectedModel,
        params: {
          scale,
          ...(isCloudModel ? {
            ...(outputFormat ? { outputFormat } : {}),
            ...(outputQuality ? { outputQuality } : {}),
          } : {
            target: params.target || "auto",
            seed: params.seed || 42,
            colorCorrection: params.colorCorrection || "wavelet",
            algorithm: params.algorithm || "lanczos",
          }),
        },
      });
      notify("超分完成，结果已写入当前节点"); addLog(`图片超分完成：${source.data.name || source.id}`);
      const sourceImageId = String(source.data.sourceAssetId || source.id);
      void recordCanvasImages(result.images, {
        prompt: params.prompt || "Upscale this image",
        source: "upscale",
        modelId: result.model?.id || params.model,
        modelName: result.model?.name,
        providerName: result.model?.provider,
        outputSize: `${scale}× 超分`,
        outputFormat: outputFormat === "jpg" ? "jpeg" : outputFormat,
        parentId: sourceImageId,
        sourceImageId,
        upscaleProvider: result.model?.provider,
        upscaleModel: result.model?.id || params.model,
        upscaleScale: scale,
        upscaleOutputFormat: outputFormat,
        upscaleOutputQuality: outputQuality,
        upscaleTaskId: submittedTaskId,
      })
        .then(() => setAssetRefresh((value) => value + 1))
        .catch(() => addLog("图片超分完成，但写入主界面历史失败"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "超分失败";
      updateDoc((value) => ({ ...value, nodes: value.nodes.map((item) => item.id === node.id ? { ...item, data: { ...item.data, status: "failed", statusLabel: message, processingStartedAt: undefined } } : item) }));
      notify(message, "error");
    } finally { generationKeysRef.current.delete(activeKey); setGenerationKeys(new Set(generationKeysRef.current)); }
  }, [addLog, commit, notify, runtime, updateDoc]);
  runUpscaleNodeRef.current = runUpscaleNode;


  const addAssetToCanvas = useCallback(
    (asset: AssetRecord, position?: Point) => {
      const rect = stageRef.current?.getBoundingClientRect();
      const seed =
        position ||
        screenToWorld(
          (rect?.left || 0) + (rect?.width || stageSize.width) / 2,
          (rect?.top || 0) + (rect?.height || stageSize.height) / 2,
        );
      const draft = createMedia(asset.kind, asset.url, asset.name, seed, {
        role: "资产中心",
        sourceAssetId: asset.id,
        params: defaultParams(asset.kind, runtime),
      });
      const targetGroup = position
        ? groupAtPoint(docRef.current, seed)
        : undefined;
      const point = targetGroup ? seed : openNodePosition(seed, draft);
      const node = { ...draft, x: point.x, y: point.y };
      const next = targetGroup
        ? moveNodesToGroup(
            { ...docRef.current, nodes: [...docRef.current.nodes, node] },
            [node.id],
            targetGroup.id,
          )
        : { ...docRef.current, nodes: [...docRef.current.nodes, node] };
      commit(() => next);
      setSelectedIds(
        new Set(
          targetGroup
            ? next.groups.find((group) => group.id === targetGroup.id)
                ?.nodeIds || [node.id]
            : [node.id],
        ),
      );
      setSelectedGroupId(targetGroup?.id || null);
      setMode(asset.kind);
      notify(
        targetGroup
          ? `已将${asset.kind === "video" ? "视频" : "图片"}加入${targetGroup.name}`
          : `已将${asset.kind === "video" ? "视频" : "图片"}添加到画布`,
      );
    },
    [
      commit,
      notify,
      openNodePosition,
      runtime,
      screenToWorld,
      stageSize.height,
      stageSize.width,
    ],
  );

  const addAssetAsReference = useCallback(
    (asset: AssetRecord, ownerOverride?: string) => {
      const ownerId = ownerOverride || selectedGroupId || selectedSingle?.id;
      if (!ownerId) {
        notify("多选内容需要先成组，或明确选中一个目标节点。", "error");
        return;
      }
      const existing = docRef.current.nodes.find(
        (node) =>
          node.type === "media" &&
          node.data.kind === asset.kind &&
          node.data.url === asset.url,
      );
      if (existing?.id === ownerId) {
        notify("素材不能引用自身，请选择另一个目标节点。", "error");
        return;
      }
      const ownerBounds = entityBounds(docRef.current, ownerId);
      const draft = existing
        ? null
        : createMedia(
            asset.kind,
            asset.url,
            asset.name,
            { x: ownerBounds.x - 430, y: ownerBounds.y },
            { role: "参考素材", sourceAssetId: asset.id, params: defaultParams(asset.kind, runtime) },
          );
      const sourceNode =
        existing ||
        (draft
          ? {
              ...draft,
              ...openNodePosition(
                { x: ownerBounds.x - 430, y: ownerBounds.y },
                draft,
              ),
            }
          : null);
      if (!sourceNode) return;
      commit((value) =>
        addEdge(
          draft ? { ...value, nodes: [...value.nodes, sourceNode] } : value,
          sourceNode.id,
          ownerId,
          "right",
          "left",
          "manual",
        ),
      );
      notify(
        existing ? "已复用现有素材并建立参考连线" : "已添加素材并建立参考连线",
      );
    },
    [commit, notify, openNodePosition, runtime, selectedGroupId, selectedSingle?.id],
  );

  const locateAsset = useCallback(
    (asset: AssetRecord) => {
      const matches = docRef.current.nodes.filter(
        (node) =>
          node.type === "media" &&
          node.data.kind === asset.kind &&
          node.data.url === asset.url,
      );
      if (!matches.length)
        return notify("这个资产还没有放入当前画布。", "error");
      setSelectedIds(new Set(matches.map((node) => node.id)));
      setSelectedGroupId(null);
      fitView(matches.map((node) => node.id));
      setActivePanel(null);
    },
    [fitView, notify],
  );

  const addNodeToCollection = useCallback(async (nodeId: string, collectionId: string) => {
    if (!isAssignableCanvasAssetCollection(collectionId)) {
      notify("请先选择未分类或自定义资产集合。", "error");
      return;
    }
    const node = nodeById(docRef.current, nodeId);
    if (!node || node.type !== "media" || !node.data.url) return;
    const asset = (await listUnifiedAssets(canvasAssets)).find(
      (item) => item.url === node.data.url && item.kind === node.data.kind,
    );
    if (!asset) return notify("节点素材尚未登记到资产库。", "error");
    try {
      const currentCollectionIds = asset.collectionIds || [];
      const collectionIds = collectionId === CANVAS_ASSET_UNCATEGORIZED_ID
        ? currentCollectionIds
        : [...new Set([...currentCollectionIds, collectionId])];
      await updateUnifiedAssetMetadata(asset, { collectionIds });
      setAssetRefresh((value) => value + 1);
      notify("节点素材已加入资产集合");
    } catch (error) { notify(error instanceof Error ? error.message : "资产集合保存失败", "error"); }
  }, [canvasAssets, notify]);

  const handleAssetDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const raw = event.dataTransfer.getData("application/x-sanmao-asset");
      if (!raw) return;
      event.preventDefault();
      try {
        const asset = JSON.parse(raw) as AssetRecord;
        if (!asset?.url || (asset.kind !== "image" && asset.kind !== "video"))
          throw new Error("invalid asset");
        const targetNodeId = (event.target as HTMLElement | null)
          ?.closest<HTMLElement>("[data-canvas-node-id]")?.dataset.canvasNodeId;
        if (targetNodeId) addAssetAsReference(asset, targetNodeId);
        else addAssetToCanvas(asset, screenToWorld(event.clientX, event.clientY));
      } catch {
        notify("无法读取拖入的资产。", "error");
      } finally {
        setAssetDropGroupId(null);
      }
    },
    [addAssetAsReference, addAssetToCanvas, notify, screenToWorld],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (window.document.querySelector(".canvas-asset-preview-backdrop")) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(
          ".canvas-node-mention-menu,.canvas-parameter-collection.open,.canvas-parameter-drawer,.select-menu.open,.select-menu-popover,.model-picker-trigger.open,.model-picker-panel,.model-picker-dialog-backdrop,.media-viewer-backdrop,.canvas-asset-preview-backdrop,.mask-editor-backdrop,.canvas-node-editor-popover.is-prompt-expanded",
        )) return;
        event.preventDefault();
        event.stopPropagation();
        if (mentionState) {
          setMentionState(null);
          return;
        }
        if (connectionNodePicker || connectionTargetId) {
          setConnectionNodePicker(null);
          setConnectionTargetId(null);
          return;
        }
        if (expandedEditorId) {
          setExpandedEditorId(null);
          setReuseDraft(null);
          return;
        }
        if (contextMenu || projectMenuOpen) {
          setContextMenu(null);
          setProjectMenuOpen(false);
          return;
        }
        if (reusePreview) {
          setReusePreview(null);
          return;
        }
        if (agentResult) {
          setAgentResult(null);
          return;
        }
        if (lightbox) {
          setLightbox(null);
          return;
        }
        if (textLightboxNodeId) {
          setTextLightboxNodeId(null);
          return;
        }
        if (maskNodeId) {
          setMaskNodeId(null);
          return;
        }
        if (assetCollectionPickerNodeId) {
          setAssetCollectionPickerNodeId(null);
          return;
        }
        if (activePanel) {
          setActivePanel(null);
          return;
        }
        if (editingNodeId) {
          setEditingNodeId(null);
          return;
        }
        interactionRef.current = null;
        setConnection(null);
        clearSelection();
        return;
      }
      if (isEditableTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const isKeyZ = key === "z" || event.code === "KeyZ";
      const isKeyA = key === "a" || event.code === "KeyA";
      const stageRect = stageRef.current?.getBoundingClientRect();
      const centerX =
        (stageRect?.left || 0) + (stageRect?.width || stageSize.width) / 2;
      const centerY =
        (stageRect?.top || 0) + (stageRect?.height || stageSize.height) / 2;
      if (!event.repeat && modifier && isKeyZ) {
        event.preventDefault();
        event.stopPropagation();
        event.shiftKey ? redo() : undo();
      } else if (!event.repeat && modifier && key === "c") {
        event.preventDefault();
        void copySelection();
      } else if (!event.repeat && modifier && key === "v") {
        event.preventDefault();
        void pasteFromClipboard();
      } else if (!event.repeat && modifier && key === "d") {
        event.preventDefault();
        duplicateSelection();
      } else if (!event.repeat && modifier && key === "g") {
        event.preventDefault();
        event.shiftKey ? breakGroup() : makeGroup();
      } else if (!event.repeat && !modifier && isKeyA) {
        event.preventDefault();
        toggleAssetLibrary();
      } else if (!event.repeat && !modifier && isKeyZ) {
        event.preventDefault();
        fitView();
      } else if (
        !event.repeat &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        if (selectedEdgeId) {
          commit((value) => removeEdge(value, selectedEdgeId));
          setSelectedEdgeId(null);
        } else deleteSelection();
      } else if (!event.repeat && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomAt(centerX, centerY, 1.12);
      } else if (!event.repeat && event.key === "-") {
        event.preventDefault();
        zoomAt(centerX, centerY, 0.88);
      } else if (modifier && event.key === "Enter") {
        event.preventDefault();
        void runGeneration();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    breakGroup,
    clearSelection,
    commit,
    contextMenu,
    copySelection,
    deleteSelection,
    editingNodeId,
    expandedEditorId,
    duplicateSelection,
    fitView,
    makeGroup,
    mentionState,
    pasteFromClipboard,
    redo,
    runGeneration,
    activePanel,
    agentResult,
    assetCollectionPickerNodeId,
    connectionNodePicker,
    connectionTargetId,
    lightbox,
    maskNodeId,
    reusePreview,
    selectedEdgeId,
    stageSize.height,
    stageSize.width,
    toggleAssetLibrary,
    textLightboxNodeId,
    undo,
    zoomAt,
  ]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      const element = target instanceof Element ? target : null;
      const nodeElement = element?.closest<HTMLElement>("[data-canvas-node-id]");
      const nodeId = nodeElement?.dataset.canvasNodeId;
      const node = nodeId ? nodeById(docRef.current, nodeId) : undefined;
      const isolatedTarget = element?.closest(
        "button,textarea,input,select,[contenteditable=\"true\"],.canvas-node-editor,.canvas-node-editor-popover,.canvas-node-parameters,.canvas-group,.canvas-edge-layer,.canvas-floating,.canvas-deck,.canvas-selection-toolbar,.canvas-selection-layout-toolbar,.canvas-minimap,.canvas-context-menu,.canvas-connection-picker,.select-menu,.select-menu-popover,.model-picker,.model-picker-panel,.model-picker-dialog-backdrop",
      );
      if (isolatedTarget) {
        if (isolatedTarget.closest(".canvas-context-menu")) event.preventDefault();
        return;
      }
      event.preventDefault();
      const point = stagePoint(event.clientX, event.clientY);
      if (node) {
        if (!selectedIds.has(node.id)) selectNode(node);
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          menu: "node",
          nodeId: node.id,
          world: {
            x: (point.x - document.camera.x) / document.camera.zoom,
            y: (point.y - document.camera.y) / document.camera.zoom,
          },
        });
        return;
      }
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        menu: "tools",
        world: {
          x: (point.x - document.camera.x) / document.camera.zoom,
          y: (point.y - document.camera.y) / document.camera.zoom,
        },
      });
    },
    [document.camera, selectNode, selectedIds, stagePoint],
  );
  const deck = deckSource();
  const deckKind = deck.kind;
  const generationBusy = reuseDraft
    ? generationKeys.has(`reuse:${reuseDraft.sourceNodeId || reuseDraft.kind}`)
    : generationKeys.has(generationKey(deck));
  const deckModelState = resolveAvailableCreationModel(deck.params, runtime);
  const maskNode = maskNodeId ? nodeById(document, maskNodeId) : undefined;
  const maskSettings = maskNode
    ? (copyParams(
        maskNode.data.generation?.params || maskNode.data.params,
        "image",
        runtime,
      ) as ImageCreationSettings)
    : undefined;
  const references = reuseDraft
    ? reuseDraft.references
        .map((reference) => reference.nodeId ? nodeById(document, reference.nodeId) : undefined)
        .filter((node): node is CanvasNode => Boolean(node))
    : referenceOwnerId
    ? incomingReferences(document, referenceOwnerId)
    : selectedNodes.filter((node) => isCanvasReferenceableNode(node));
  const composerReferences = reuseDraft ? reuseDraft.references : references;
  const composerPrompt = reuseDraft ? reuseDraft.prompt : deck.prompt;
  const composerSemanticBadges = useMemo(() => {
    const badges: string[] = [];
    if (reuseDraft) {
      const imageCount = reuseDraft.references.filter((reference) => reference.kind === "image").length;
      const videoCount = reuseDraft.references.filter((reference) => reference.kind === "video").length;
      if (imageCount) badges.push(`图片参考 ${imageCount}`);
      if (videoCount) badges.push(`视频输入 ${videoCount}`);
      if (!badges.length) badges.push("尚未添加参考素材");
      return badges;
    }
    const contextNodes = referenceOwnerId
      ? incomingContext(document, referenceOwnerId)
      : selectedNodes;
    const semantics = resolveCanvasInputSemantics(
      contextNodes,
      mode === "text" ? "agent" : mode,
      mode === "video" ? (deck.params as VideoCreationSettings).inputMode : undefined,
    );
    if (mode === "text") {
      if (semantics.textContext.length) badges.push(`文本上下文 ${semantics.textContext.length}`);
      if (semantics.imageReferences.length) badges.push(`图片参考 ${semantics.imageReferences.length}`);
      if (semantics.videoReferences.length) badges.push(`视频不作图片参考 ${semantics.videoReferences.length}`);
      if (!badges.length) badges.push("输入内容将作为文本上下文");
    } else if (mode === "video") {
      if (semantics.firstFrame) badges.push("首帧 1");
      if (semantics.lastFrame) badges.push("尾帧 1");
      if (semantics.referenceVideo) badges.push("参考视频 1");
      const remainingImages = semantics.imageReferences.length - (semantics.firstFrame ? 1 : 0) - (semantics.lastFrame ? 1 : 0);
      if (remainingImages > 0 && !semantics.firstFrame && !semantics.lastFrame) badges.push(`图片参考 ${semantics.imageReferences.length}`);
      else if (remainingImages > 0) badges.push(`图片参考 ${remainingImages}`);
      if (semantics.textContext.length) badges.push(`文本上下文 ${semantics.textContext.length}`);
      if (!badges.length) badges.push("可添加首帧、尾帧或参考视频");
    } else {
      if (semantics.imageReferences.length) badges.push(`图片参考 ${semantics.imageReferences.length}`);
      if (semantics.videoReferences.length) badges.push(`视频已忽略 ${semantics.videoReferences.length}`);
      if (!badges.length) badges.push("可添加图片参考");
    }
    return badges;
  }, [deck.params, document, mode, referenceOwnerId, reuseDraft, selectedNodes]);
  useEffect(() => {
    const textarea = deckPromptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const minHeight = window.innerWidth <= 720 ? 68 : 72;
    const maxHeight = window.innerWidth <= 720 ? 190 : 320;
    textarea.style.height = `${Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight))}px`;
  }, [composerPrompt, mode, reuseDraft, selectedSingle?.id]);
  const filteredMentionCandidates = mentionCandidates.filter(
    (node, index) =>
      !mentionState?.query ||
      mentionLabel(node, index)
        .toLowerCase()
        .includes(mentionState.query.toLowerCase()),
  );
  const writeViewerPrompt = useCallback((node: CanvasNode, value: string) => {
    if (node.type !== "media") return;
    if (node.data.kind === "image") {
      openImageEditor(node, { prompt: value });
    } else {
      openReuseDraft(node, {
        prompt: value,
        operation: "generate",
        includeSourceReference: true,
      });
    }
    notify("提示词已复制到画布编辑器，原节点保持不变");
  }, [notify, openImageEditor, openReuseDraft]);
  const runOneTakeFromSelection = useCallback(async () => {
    const source = selectedNodes.filter((node) => isCanvasReferenceableNode(node) && node.data.kind === "image");
    if (source.length < 2) return notify("一镜到底至少需要两张图片节点。", "error");
    const model = runtime?.settings.agentModelId || undefined;
    try {
      const value = await runOneTakeVideoPrompt(source.map((node) => ({ url: String(node.data.url), name: String(node.data.name || "参考图") })), model);
      setAgentResult({ value, title: "一镜到底提示词" });
      addLog("Agent 已生成一镜到底提示词");
    } catch (error) { notify(error instanceof Error ? error.message : "一镜到底生成失败", "error"); }
  }, [addLog, notify, runtime?.settings.agentModelId, selectedNodes]);
  const createViewerTextNode = useCallback((node: CanvasNode, value: string) => {
    const draft = createPrompt({ x: node.x + nodeSize(node).w + 90, y: node.y });
    const textNode = { ...draft, data: { ...draft.data, text: value, agentPrompt: value, role: "结果文本" } };
    commit((current) => ({ ...current, nodes: [...current.nodes, textNode] }));
    setSelectedIds(new Set([textNode.id]));
    notify("已创建新的文本节点");
  }, [commit, notify]);
  const createViewerAgentNode = useCallback((node: CanvasNode, value: string) => {
    if (node.type !== "prompt") return;
    const prompt = value.trim();
    if (!prompt) return notify("请先选中一段文本。", "error");
    const params = normalizeCreationSettings("text", null, runtime);
    const seed = { x: node.x + nodeSize(node).w + 90, y: node.y };
    const base = createPrompt(seed, prompt);
    const draft = { ...base, ...openNodePosition(seed, base) };
    const agentNode: CanvasNode = {
      ...draft,
      data: {
        ...draft.data,
        text: prompt,
        agentPrompt: prompt,
        role: "Agent 输入",
        params,
        status: "idle",
        statusLabel: undefined,
      },
    };
    commit((current) =>
      addEdge(
        { ...current, nodes: [...current.nodes, agentNode] },
        node.id,
        agentNode.id,
        "right",
        "left",
        "manual",
        "context",
      ),
    );
    setEditorDrafts((current) => ({
      ...current,
      [agentNode.id]: { prompt, params },
    }));
    setSelectedIds(new Set([agentNode.id]));
    setSelectedGroupId(null);
    setQuickToolbarNodeId(null);
    setTextLightboxNodeId(null);
    setMode("text");
    setExpandedEditorId(agentNode.id);
    notify("已创建 Agent 新节点，请确认提示词后生成");
  }, [commit, notify, openNodePosition, runtime]);
  const updateTextNode = useCallback(
    (node: CanvasNode, value: string) => {
      if (node.type !== "prompt") return;
      if (!value.trim()) {
        notify("回复内容不能为空。", "error");
        return;
      }
      updateDoc((current) => ({
        ...current,
        nodes: current.nodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                data: {
                  ...item.data,
                  text: value,
                  ...(item.data.agentResponse || String(item.data.role || "").includes("回复")
                    ? {
                        agentResponse: value,
                        role: item.data.role || "Agent 回复",
                        status: "completed" as const,
                        statusLabel: "Agent 已回复",
                      }
                    : {
                        agentPrompt: value,
                        agentResponse: undefined,
                        role: "Agent 输入",
                        status: "idle" as const,
                        statusLabel: undefined,
                      }),
                },
              }
            : item,
        ),
      }));
      notify("文本节点已更新");
    },
    [notify, updateDoc],
  );
  const writeTextToPrompt = useCallback(
    (value: string) => {
      setDrafts((current) => ({
        ...current,
        [mode]: { ...current[mode], prompt: value },
      }));
      notify("结果已写入当前创作提示词");
    },
    [mode, notify],
  );
  const continueFromMedia = useCallback(
    (node: CanvasNode) => {
      if (node.type !== "media" || !node.data.kind) return;
      if (node.data.kind === "video") {
        const params = node.data.generation?.params as VideoCreationSettings | undefined;
        openReuseDraft(
          node,
          params
            ? { params: { ...params, operation: "extend" }, operation: "extend" }
            : { operation: "extend" },
        );
      } else openImageEditor(node);
    },
    [openImageEditor, openReuseDraft],
  );
  const updateViewerParams = useCallback(
    (node: CanvasNode, settings: CreationSettings) => {
      if (node.type !== "media" || settings.kind === "text") return;
      if (reuseDraft?.sourceNodeId === node.id) {
        setReuseDraft((current) => current ? { ...current, params: clone(settings), dirty: true } : current);
        setExpandedEditorId(node.id);
        setLightbox(null);
        notify("参数已复制到画布编辑器，原节点保持不变");
        return;
      }
      if (node.data.kind === "image") openImageEditor(node, { params: settings });
      else openReuseDraft(node, { params: settings });
    },
    [notify, openImageEditor, openReuseDraft, reuseDraft],
  );
  const viewerAsset = useCallback((node: CanvasNode): AssetRecord | null => {
    if (!canAddCanvasAsset(node)) return null;
    return {
      id: `canvas:${activeProjectId}:${node.id}`,
      kind: node.data.kind === "video" ? "video" : "image",
      url: String(node.data.url),
      name: String(node.data.name || "画布素材"),
      source: node.data.generation ? "canvas-output" : "canvas-upload",
      createdAt: Number(node.data.generation?.createdAt || Date.now()),
      favorite: false,
      prompt: node.data.generation?.prompt,
      modelId: node.data.generation?.params.model,
      modelName: typeof node.data.model === "string" ? node.data.model : undefined,
      width: Number(node.data.nativeWidth) || undefined,
      height: Number(node.data.nativeHeight) || undefined,
      projectIds: activeProjectId ? [activeProjectId] : [],
      collectionIds: [],
      tags: [],
    };
  }, [activeProjectId]);
  const addViewerAsset = useCallback(async (
    node: CanvasNode,
    collectionId: string,
  ): Promise<boolean> => {
    const asset = viewerAsset(node);
    if (!asset || !isAssignableCanvasAssetCollection(collectionId)) return false;
    try {
      const existing = (await listUnifiedAssets(canvasAssets)).find(
        (item) => item.kind === asset.kind && item.url === asset.url,
      );
      const currentCollectionIds = existing?.collectionIds || [];
      const collectionIds = collectionId === CANVAS_ASSET_UNCATEGORIZED_ID
        ? currentCollectionIds
        : [...new Set([...currentCollectionIds, collectionId])];
      if (existing)
        await updateUnifiedAssetMetadata(existing, { collectionIds });
      else
        await registerCanvasAsset({ ...asset, collectionIds });
      setAssetRefresh((value) => value + 1);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "资产登记失败", "error");
      return false;
    }
  }, [canvasAssets, notify, viewerAsset]);
  const openAssetCollectionPicker = useCallback((node: CanvasNode) => {
    if (!viewerAsset(node)) {
      notify("当前节点没有可加入资产库的媒体。", "error");
      return;
    }
    openCanvasAssetPicker(node.id);
  }, [notify, openCanvasAssetPicker, viewerAsset]);
  const downloadCanvasNode = useCallback((node: CanvasNode) => {
    if ((node.type !== "media" && node.type !== "upscale") || !node.data.url) {
      notify("当前节点还没有可下载的媒体。", "error");
      return;
    }
    const anchor = window.document.createElement("a");
    anchor.href = String(node.data.url);
    anchor.download = `${String(node.data.name || "SANMAO素材")}.${node.data.kind === "video" ? "mp4" : "png"}`;
    anchor.rel = "noreferrer";
    anchor.click();
    notify("已开始下载");
  }, [notify]);
  const downloadCanvasShare = useCallback(async (node: CanvasNode) => {
    if ((node.type !== "media" && node.type !== "upscale") || node.data.kind !== "image" || !node.data.url) {
      notify("分享版目前只支持已完成的图片节点。", "error");
      return;
    }
    const references = incomingReferences(docRef.current, node.id)
      .map((reference) => ({
        id: reference.id,
        name: String(reference.data.name || "参考素材"),
        url: String(reference.data.url || ""),
        kind: reference.data.kind === "video" ? ("video" as const) : ("image" as const),
      }))
      .filter((reference) => Boolean(reference.url));
    try {
      await downloadCanvasShareImage({
        id: node.id,
        url: String(node.data.url),
        name: String(node.data.name || "画布素材"),
        prompt: String(node.data.generation?.prompt || node.data.prompt || ""),
        modelName: String(node.data.model || node.data.generation?.params?.model || "图片模型"),
        createdAt: node.data.generation?.createdAt || node.data.generation?.updatedAt,
        references,
      });
      notify("已下载主界面同款分享版");
    } catch (error) {
      notify(error instanceof Error ? error.message : "分享版下载失败", "error");
    }
  }, [notify]);
  const downloadSelectedImages = useCallback(async () => {
    if (selectedImageDownloads.length < 2 || batchDownloading) return;
    setBatchDownloading(true);
    try {
      const { blob } = await createCanvasImageZip(selectedImageDownloads);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = objectUrl;
      anchor.download = `SANMAO-画布图片-${stamp}.zip`;
      anchor.rel = "noreferrer";
      anchor.style.display = "none";
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      notify(`已开始下载 ${selectedImageDownloads.length} 张图片`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "批量下载图片失败", "error");
    } finally {
      setBatchDownloading(false);
    }
  }, [batchDownloading, notify, selectedImageDownloads]);
  const copyCanvasImage = useCallback(async (node: CanvasNode) => {
    if (node.type !== "media" || node.data.kind !== "image" || !node.data.url) {
      notify("当前节点没有可复制的图片。", "error");
      return;
    }
    try {
      await copyCanvasImageToClipboard(String(node.data.url));
      notify("图片已复制到系统剪贴板");
    } catch (error) {
      notify(error instanceof Error ? error.message : "复制图片失败，请检查浏览器的剪贴板权限。", "error");
    }
  }, [notify]);
  const focusGenerationLog = useCallback(
    (log: CanvasGenerationLog, openMedia = false) => {
      const outputUrls = new Set(generationLogOutputUrls(log));
      const kind = generationLogKind(log);
      const node = docRef.current.nodes.find(
        (item) =>
          (item.type === "media" && item.data.url && outputUrls.has(String(item.data.url))) ||
          (item.data.generation?.prompt === log.prompt &&
            (item.data.kind || "image") === (kind === "audio" ? "image" : kind)),
      );
      if (!node) {
        if (openMedia && outputUrls.size) {
          window.open([...outputUrls][0], "_blank", "noopener,noreferrer");
          return;
        }
        notify("当前任务还没有对应的画布节点。", "error");
        return;
      }
      setSelectedIds(new Set([node.id]));
      setSelectedGroupId(null);
      setActivePanel(null);
      if (openMedia && node.type === "media" && node.data.url)
        openCanvasMediaViewer(node.id);
      else fitView([node.id]);
    },
    [fitView, notify, openCanvasMediaViewer],
  );
  const retryGenerationLog = useCallback(
    (log: CanvasGenerationLog) => {
      const kind = generationLogKind(log);
      if (kind === "audio") {
        notify("音频任务请回到主界面任务日志重试。", "error");
        return;
      }
      const node = docRef.current.nodes.find(
        (item) =>
          item.data.generation?.prompt === log.prompt &&
          (item.data.kind || "image") === kind,
      );
      if (node) {
        setSelectedIds(new Set([node.id]));
        setSelectedGroupId(null);
      } else {
        setSelectedIds(new Set());
        setSelectedGroupId(null);
        setDrafts((current) => ({
          ...current,
          [kind]: { ...current[kind], prompt: log.prompt },
        }));
      }
      setMode(kind);
      setActivePanel(null);
      notify(
        node
          ? "已定位任务节点，请确认参数后点击生成重试。"
          : "已将任务提示词放入生成面板，请确认参数后点击生成。",
      );
    },
    [notify],
  );
  const updateDeckPrompt = useCallback(
    (event: ReactChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      const cursor = event.target.selectionStart;
      if (reuseDraft) {
        setReuseDraft((current) => current ? { ...current, prompt: value, dirty: true } : current);
        setMentionState(mentionStateForValue(value, cursor));
        return;
      }
      if (selectedSingle?.type === "media") {
        if (selectedSingle.data.kind === "image") updatePrompt(value);
        else openReuseDraft(selectedSingle, { prompt: value });
        setMentionState(mentionStateForValue(value, cursor));
        return;
      }
      updatePrompt(value);
      setMentionState(mentionStateForValue(value, cursor));
    },
    [openReuseDraft, reuseDraft, selectedSingle, updatePrompt],
  );
  const chooseMention = useCallback(
    (node: CanvasNode) => {
      if (!mentionState) return;
      const index = mentionCandidates.findIndex((item) => item.id === node.id);
      if (index < 0) return;
      const value = reuseDraft?.prompt || deck.prompt;
      const next = `${value.slice(0, mentionState.start)}@${index + 1} ${value.slice(mentionState.end)}`;
      if (reuseDraft) setReuseDraft((current) => current ? { ...current, prompt: next, dirty: true } : current);
      else if (selectedSingle?.type === "media") {
        if (selectedSingle.data.kind === "image") updatePrompt(next);
        else openReuseDraft(selectedSingle, { prompt: next });
      }
      else updatePrompt(next);
      setMentionState(null);
      window.requestAnimationFrame(() => deckPromptRef.current?.focus());
    },
    [deck.prompt, mentionCandidates, mentionState, openReuseDraft, reuseDraft, selectedSingle, updatePrompt],
  );
  const reorderReference = useCallback(
    (ownerId: string, draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;
      const current = incomingReferences(docRef.current, ownerId).map(
        (node) => node.id,
      );
      const from = current.indexOf(draggedId);
      const to = current.indexOf(targetId);
      if (from < 0 || to < 0) return;
      current.splice(from, 1);
      current.splice(to, 0, draggedId);
      commit((value) => reorderReferences(value, ownerId, current));
    },
    [commit],
  );
  const removeComposerReference = useCallback((nodeId: string) => {
    if (referenceOwnerId) {
      const incoming = docRef.current.edges.filter((edge) => edge.target === referenceOwnerId && edge.source === nodeId);
      if (incoming.length) {
        commit((value) => incoming.reduce((next, edge) => removeEdge(next, edge.id), value));
      }
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
  }, [commit, referenceOwnerId]);
  const clearComposerReferences = useCallback(() => {
    const ownerId = referenceOwnerId;
    const ids = references.map((node) => node.id);
    if (ownerId) {
      const edgeIds = docRef.current.edges
        .filter((edge) => edge.target === ownerId && ids.includes(edge.source))
        .map((edge) => edge.id);
      if (edgeIds.length) commit((value) => edgeIds.reduce((next, id) => removeEdge(next, id), value));
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, [commit, referenceOwnerId, references]);
  const minimapBounds = useMemo(() => {
    if (!document.nodes.length) return { x: -300, y: -200, w: 600, h: 400 };
    const bounds = document.nodes.map((node) =>
      entityBounds(document, node.id),
    );
    const minX = Math.min(...bounds.map((item) => item.x));
    const minY = Math.min(...bounds.map((item) => item.y));
    const maxX = Math.max(...bounds.map((item) => item.x + item.w));
    const maxY = Math.max(...bounds.map((item) => item.y + item.h));
    return {
      x: minX - 120,
      y: minY - 120,
      w: Math.max(480, maxX - minX + 240),
      h: Math.max(320, maxY - minY + 240),
    };
  }, [document]);
  const connectionTargetEntity = connectionTargetId
    ? nodeById(document, connectionTargetId) ||
      groupById(document, connectionTargetId)
    : undefined;
  const connectionTargetBounds = connectionTargetId
    ? entityBounds(document, connectionTargetId)
    : undefined;
  const draftConnection = connection
    ? {
        sourceId: connection.sourceId,
        start: stageToWorld(connection.start),
        end: stageToWorld(connection.end),
        sourcePort: connection.sourcePort,
      }
    : null;
  const connectionTargetScreen = connectionTargetBounds
    ? worldToScreen(connectionTargetBounds.x, connectionTargetBounds.y)
    : null;
  const visibleCanvasEdges = document.edges.filter((edge) => {
    const sourceVisible =
      visibleCanvasNodeIds.has(edge.source) || Boolean(groupById(document, edge.source));
    const targetVisible =
      visibleCanvasNodeIds.has(edge.target) || Boolean(groupById(document, edge.target));
    return sourceVisible && targetVisible;
  });
  const connectionCancelEdge = connectionCancelEdgeId
    ? document.edges.find((edge) => edge.id === connectionCancelEdgeId)
    : undefined;
  const connectionCancelEdgeMidpoint = connectionCancelEdge
    ? canvasEdgeMidpoint(document, connectionCancelEdge)
    : null;
  const connectionCancelScreen = connection
    ? {
        x: (connection.start.x + connection.end.x) / 2,
        y: (connection.start.y + connection.end.y) / 2,
      }
    : connectionCancelEdgeMidpoint
      ? worldToScreen(
          connectionCancelEdgeMidpoint.x,
          connectionCancelEdgeMidpoint.y,
        )
      : null;
  const connectionNodePickerScreen = connectionNodePicker
    ? {
        x: clamp(
          connectionNodePicker.x,
          12,
          Math.max(12, stageSize.width - 268),
        ),
        y: clamp(
          connectionNodePicker.y,
          96,
          Math.max(96, stageSize.height - 248),
        ),
      }
      : null;
  const runButtonLabel = generationBusy
    ? "处理中"
    : reuseDraft
      ? reuseDraft.kind === "image" ? "生成新图" : "生成新分支"
    : mode === "text"
      ? "运行"
      : selectedSingle?.type === "generator"
        ? "生成变体"
      : selectedSingle?.type === "media" && selectedSingle.data.kind === "image" && selectedSingle.data.url
        ? "生成新图"
      : "生成";
  const runButtonTitle = generationBusy
    ? "正在处理中"
    : reuseDraft
      ? reuseDraft.kind === "image"
        ? "以当前图片为参考直接生成右侧新图片，原图保留"
        : "使用当前参数和参考图生成独立新分支"
    : mode === "text"
      ? "运行 Agent"
      : selectedSingle?.type === "generator"
        ? "生成图片/视频变体"
      : selectedSingle?.type === "media" && selectedSingle.data.kind === "image" && selectedSingle.data.url
        ? "以当前图片为参考直接生成右侧新图片，原图保留"
      : deck.target
        ? "生成到此节点"
        : "生成";
  const chatModelsAvailable = Boolean(
    runtime?.models?.some(
      (model) =>
        model.kind === "chat" && model.enabled !== false && model.published !== false,
    ),
  );
  const quickActions = useMemo<CanvasQuickAction[]>(() => {
    const node = selectedSingle;
    if (!node || selectedGroupId || selectedNodes.length !== 1) return [];
    if (node.type === "media" && node.data.kind === "image") {
      const hasMedia = Boolean(node.data.url);
      const canAddAsset = canAddCanvasAsset(node);
      return [
        {
          id: "preview",
          icon: "⤢",
          label: "预览",
          disabled: !hasMedia,
          onClick: () => openCanvasMediaViewer(node.id),
        },
        {
          id: "mask",
          icon: "◌",
          label: node.data.mask ? "查看蒙版" : "绘制蒙版",
          title: node.data.mask
            ? `蒙版 · ${canvasMaskStatusLabel(node.data.mask.status)}`
            : "为当前图片绘制蒙版",
          disabled: !hasMedia,
          onClick: () => openCanvasMaskEditor(node.id),
        },
        {
          id: "upscale",
          icon: "↗",
          label: "超分",
          disabled: !hasMedia,
          onClick: () => createUpscaleFromSource(node),
        },
        {
          id: "regenerate",
          icon: "↻",
          label: "编辑并生成",
          disabled: !hasMedia,
          onClick: () => openImageEditor(node),
        },
        {
          id: "reference",
          icon: "⌁",
          label: "作为参考",
          disabled: !hasMedia,
          onClick: () => addCurrentNodeToReuse(node),
        },
        {
          id: "download",
          icon: "↓",
          label: "下载",
          disabled: !hasMedia,
          onClick: () => downloadCanvasNode(node),
        },
        {
          id: "asset",
          icon: "＋",
          label: "加入资产",
          disabled: !canAddAsset,
          onClick: () => openAssetCollectionPicker(node),
        },
        {
          id: "delete",
          icon: "⌫",
          label: "删除",
          danger: true,
          onClick: deleteSelection,
        },
      ];
    }
    if (node.type === "media" && node.data.kind === "video") {
      const hasMedia = Boolean(node.data.url);
      const canAddAsset = canAddCanvasAsset(node);
      return [
        {
          id: "preview",
          icon: "⤢",
          label: "预览",
          disabled: !hasMedia,
          onClick: () => openCanvasMediaViewer(node.id),
        },
        {
          id: "continue",
          icon: "▶",
          label: "继续生成 / 变体",
          disabled: !hasMedia,
          onClick: () => continueFromMedia(node),
        },
        {
          id: "reference",
          icon: "⌁",
          label: "作为参考",
          disabled: !hasMedia,
          onClick: () => addCurrentNodeToReuse(node),
        },
        {
          id: "download",
          icon: "↓",
          label: "下载",
          disabled: !hasMedia,
          onClick: () => downloadCanvasNode(node),
        },
        {
          id: "asset",
          icon: "＋",
          label: "加入资产",
          disabled: !canAddAsset,
          onClick: () => openAssetCollectionPicker(node),
        },
        {
          id: "delete",
          icon: "⌫",
          label: "删除",
          danger: true,
          onClick: deleteSelection,
        },
      ];
    }
    if (node.type === "prompt") {
      const hasResponse = Boolean(String(node.data.agentResponse || node.data.text || "").trim());
      return [
        { id: "preview", icon: "⤢", label: "放大查看", onClick: () => openCanvasTextViewer(node.id) },
        {
          id: "image",
          icon: "✦",
          label: "转图片",
          disabled: !hasResponse,
          onClick: () => useAgentResponseAsImagePrompt(node),
        },
      ];
    }
    if (node.type === "upscale") {
      const hasResult = Boolean(node.data.url);
      return [
        {
          id: "preview",
          icon: "⤢",
          label: "预览",
          disabled: !hasResult,
          onClick: () => openCanvasMediaViewer(node.id),
        },
        {
          id: "download",
          icon: "↓",
          label: "下载",
          title: "下载超分节点生成的图片",
          disabled: !hasResult,
          onClick: () => downloadCanvasNode(node),
        },
      ];
    }
    const failedCount = variantStatesFor(node).filter((state) => state.status === "failed").length;
    return [
      {
        id: "retry",
        icon: "↻",
        label: failedCount ? `重试失败项 (${failedCount})` : "重试失败项",
        disabled: failedCount === 0 || generationKeys.has(node.id),
        onClick: () => retryFailedVariants(node.id),
      },
      { id: "delete", icon: "⌫", label: "删除", danger: true, onClick: deleteSelection },
    ];
  }, [
    addCurrentNodeToReuse,
    openAssetCollectionPicker,
    openCanvasMaskEditor,
    openCanvasMediaViewer,
    openCanvasTextViewer,
    continueFromMedia,
    deleteSelection,
    downloadCanvasNode,
    generationKeys,
    openImageEditor,
    openReuseDraft,
    retryFailedVariants,
    createUpscaleFromSource,
    selectedGroupId,
    selectedNodes.length,
    selectedSingle,
    useAgentResponseAsImagePrompt,
  ]);

  const contextNode = contextMenu?.menu === "node" && contextMenu.nodeId
    ? nodeById(document, contextMenu.nodeId)
    : undefined;
  const contextMenuGroups = useMemo<CanvasContextMenuGroup[]>(() => {
    const node = contextNode;
    if (!node) return [];
    const hasMedia = node.type === "media" && Boolean(node.data.url);
    const canAddAsset = canAddCanvasAsset(node);
    const close = (action: () => void) => () => {
      setContextMenu(null);
      action();
    };
    const editAction: CanvasQuickAction = {
      id: "adjust",
      icon: "⚙",
      label: "调整参数",
      onClick: close(() => toggleEditor(node)),
    };
    const canvasActions: CanvasQuickAction[] = [
      {
        id: "copy-nodes",
        icon: "⧉",
        label: "复制节点",
        title: "复制当前选中的画布节点",
        onClick: close(() => void copySelection()),
      },
      {
        id: "paste",
        icon: "⌘",
        label: "粘贴",
        title: "粘贴节点或剪贴板图片到右键位置附近",
        onClick: close(() => void pasteFromClipboard(contextMenu?.world)),
      },
      {
        id: "duplicate",
        icon: "＋",
        label: "创建副本",
        title: "在画布中直接创建当前选区的副本",
        onClick: close(duplicateSelection),
      },
    ];
    const layerTargetIds = selectedIds.has(node.id) ? [...selectedIds] : [node.id];
    const layerActions: CanvasQuickAction[] = [
      {
        id: "bring-to-front",
        icon: "⇈",
        label: "置于顶层",
        title: "将选中节点作为连续区块移到最上层",
        onClick: close(() => reorderSelection("bring-to-front", layerTargetIds)),
      },
      {
        id: "bring-to-back",
        icon: "⇊",
        label: "置于底层",
        title: "将选中节点作为连续区块移到最底层",
        onClick: close(() => reorderSelection("bring-to-back", layerTargetIds)),
      },
      {
        id: "raise",
        icon: "↑",
        label: "上移一层",
        onClick: close(() => reorderSelection("raise", layerTargetIds)),
      },
      {
        id: "lower",
        icon: "↓",
        label: "下移一层",
        onClick: close(() => reorderSelection("lower", layerTargetIds)),
      },
    ];
    const layerGroup: CanvasContextMenuGroup = { label: "层级", actions: layerActions };
    const cleanupActions: CanvasQuickAction[] = [
      {
        id: "delete",
        icon: "⌫",
        label: selectedIds.size > 1 ? `删除 ${selectedIds.size} 个对象` : "删除",
        danger: true,
        onClick: close(deleteSelection),
      },
    ];
    if (node.type === "media" && node.data.kind === "image") {
      const mediaActions: CanvasQuickAction[] = [
        {
          id: "preview",
          icon: "⤢",
          label: "预览",
          disabled: !hasMedia,
          onClick: close(() => openCanvasMediaViewer(node.id)),
        },
        editAction,
        {
          id: "mask",
          icon: "◌",
          label: node.data.mask ? "查看蒙版" : "绘制蒙版",
          title: node.data.mask
            ? `蒙版 · ${canvasMaskStatusLabel(node.data.mask.status)}`
            : "为当前图片绘制蒙版",
          disabled: !hasMedia,
          onClick: close(() => openCanvasMaskEditor(node.id)),
        },
        {
          id: "upscale",
          icon: "↗",
          label: "超分",
          disabled: !hasMedia,
          onClick: close(() => createUpscaleFromSource(node)),
        },
        {
          id: "reference",
          icon: "⌁",
          label: "作为参考",
          disabled: !hasMedia,
          onClick: close(() => addCurrentNodeToReuse(node)),
        },
        {
          id: "copy-image",
          icon: "▣",
          label: "复制图片",
          title: "将图片复制到系统图片剪贴板",
          disabled: !hasMedia,
          onClick: close(() => void copyCanvasImage(node)),
        },
        {
          id: "download",
          icon: "↓",
          label: "下载",
          disabled: !hasMedia,
          onClick: close(() => downloadCanvasNode(node)),
        },
        {
          id: "asset",
          icon: "★",
          label: "加入资产",
          disabled: !canAddAsset,
          onClick: close(() => openAssetCollectionPicker(node)),
        },
      ];
      return [
        { label: "快速操作", actions: mediaActions },
        { label: "复制与整理", actions: canvasActions },
        layerGroup,
        { label: "删除", actions: cleanupActions },
      ];
    }
    if (node.type === "media" && node.data.kind === "video") {
      const mediaActions: CanvasQuickAction[] = [
        {
          id: "preview",
          icon: "⤢",
          label: "预览",
          disabled: !hasMedia,
          onClick: close(() => openCanvasMediaViewer(node.id)),
        },
        editAction,
        {
          id: "continue",
          icon: "▶",
          label: "继续生成 / 变体",
          disabled: !hasMedia,
          onClick: close(() => continueFromMedia(node)),
        },
        {
          id: "reference",
          icon: "⌁",
          label: "作为参考",
          disabled: !hasMedia,
          onClick: close(() => addCurrentNodeToReuse(node)),
        },
        {
          id: "download",
          icon: "↓",
          label: "下载",
          disabled: !hasMedia,
          onClick: close(() => downloadCanvasNode(node)),
        },
        {
          id: "asset",
          icon: "★",
          label: "加入资产",
          disabled: !canAddAsset,
          onClick: close(() => openAssetCollectionPicker(node)),
        },
      ];
      return [
        { label: "快速操作", actions: mediaActions },
        { label: "复制与整理", actions: canvasActions },
        layerGroup,
        { label: "删除", actions: cleanupActions },
      ];
    }
    if (node.type === "prompt") {
      const hasResponse = Boolean(String(node.data.agentResponse || node.data.text || "").trim());
      const promptActions: CanvasQuickAction[] = [
        editAction,
        {
          id: "preview",
          icon: "⤢",
          label: "放大查看",
          disabled: !hasResponse,
          onClick: close(() => openCanvasTextViewer(node.id)),
        },
        {
          id: "image",
          icon: "✦",
          label: "转图片",
          disabled: !hasResponse,
          onClick: close(() => useAgentResponseAsImagePrompt(node)),
        },
      ];
      return [
        { label: "快速操作", actions: promptActions },
        { label: "复制与整理", actions: canvasActions },
        layerGroup,
        { label: "删除", actions: cleanupActions },
      ];
    }
    if (node.type === "generator") {
      const failedCount = variantStatesFor(node).filter((state) => state.status === "failed").length;
      return [
        {
          label: "快速操作",
          actions: [
            editAction,
            {
              id: "retry",
              icon: "↻",
              label: failedCount ? `重试失败项 (${failedCount})` : "重试失败项",
              disabled: failedCount === 0 || generationKeys.has(node.id),
              onClick: close(() => retryFailedVariants(node.id)),
            },
          ],
        },
        { label: "复制与整理", actions: canvasActions },
        layerGroup,
        { label: "删除", actions: cleanupActions },
      ];
    }
    if (node.type === "upscale") {
      const hasResult = Boolean(node.data.url);
      return [
        {
          label: "快速操作",
          actions: [
            editAction,
            {
              id: "preview",
              icon: "⤢",
              label: "预览",
              disabled: !hasResult,
              onClick: close(() => openCanvasMediaViewer(node.id)),
            },
            {
              id: "download",
              icon: "↓",
              label: "下载",
              title: "下载超分节点生成的图片",
              disabled: !hasResult,
              onClick: close(() => downloadCanvasNode(node)),
            },
          ],
        },
        { label: "复制与整理", actions: canvasActions },
        layerGroup,
        { label: "删除", actions: cleanupActions },
      ];
    }
    return [
      { label: "快速操作", actions: [editAction] },
      { label: "复制与整理", actions: canvasActions },
      layerGroup,
      { label: "删除", actions: cleanupActions },
    ];
  }, [
    addCurrentNodeToReuse,
    openAssetCollectionPicker,
    openCanvasMaskEditor,
    openCanvasMediaViewer,
    openCanvasTextViewer,
    contextNode,
    contextMenu?.world,
    continueFromMedia,
    copyCanvasImage,
    copySelection,
    createUpscaleFromSource,
    deleteSelection,
    downloadCanvasNode,
    duplicateSelection,
    generationKeys,
    pasteFromClipboard,
    retryFailedVariants,
    selectedIds.size,
    toggleEditor,
    useAgentResponseAsImagePrompt,
    reorderSelection,
    selectedIds,
  ]);

  if (!ready)
    return (
      <section className="canvas-workspace canvas-loading">
        <div className="canvas-loading-card">
          <span className="canvas-logo-mark">
            <img src="/brand-mark.png" alt="SANMAO.AI" />
          </span>
          <strong>正在加载 SANMAO 无限画布</strong>
          <small>恢复本地项目与模型库…</small>
        </div>
      </section>
    );
  return (
    <section
      className="canvas-workspace"
      aria-label="SANMAO 无限画布"
      onClick={() => {
        setContextMenu(null);
        if (projectMenuOpen) setProjectMenuOpen(false);
      }}
    >
      <header className={`canvas-topbar ${topbarCollapsed ? "collapsed" : ""}`}>
        <div className="canvas-topbar-main">
          <button
            type="button"
            className="canvas-brand"
            onClick={(event) => {
              event.stopPropagation();
              setProjectMenuOpen((value) => !value);
            }}
          >
            <span className="canvas-logo-mark">
              <img src="/brand-mark.png" alt="" />
            </span>
            <span>
              <b>SANMAO.AI</b>
              <small>{currentProject?.name || "无限画布"}</small>
            </span>
            <i>⌄</i>
          </button>
          <button
            type="button"
            className="canvas-soft-button canvas-home-button"
            aria-label="返回主界面"
            onClick={() => window.location.assign("/")}
          >
            <span className="canvas-home-icon" aria-hidden="true">
              <svg viewBox="0 0 18 18" focusable="false">
                <path d="M8 4.5 4.5 8 8 11.5" />
                <path d="M4.8 8H13.5" />
              </svg>
            </span>
            <span className="canvas-home-label">主界面</span>
          </button>
          <span className="canvas-separator" />
          <button
            type="button"
            className="canvas-icon-button"
            onClick={undo}
            disabled={!undoStack.length}
          >
            ↶
          </button>
          <button
            type="button"
            className="canvas-icon-button"
            onClick={redo}
            disabled={!redoStack.length}
          >
            ↷
          </button>
          <span className="canvas-separator" />
          <button
            type="button"
            className="canvas-soft-button canvas-import-button"
            onClick={() => openFilePicker()}
          >
            ＋ 导入素材
          </button>
          {!topbarCollapsed && <button
            type="button"
            className="canvas-soft-button canvas-shortcuts-button"
            onClick={() => {
              openCanvasPanel("shortcuts");
            }}
          >
            ⌨ 快捷键
          </button>}
          {!topbarCollapsed && <button
            type="button"
            className="canvas-soft-button canvas-settings-button"
            onClick={() => {
              openCanvasPanel("settings");
            }}
          >
            ⚙ 设置
          </button>}
          {!topbarCollapsed && <>
          <button
            type="button"
            className={`canvas-soft-button canvas-panel-button canvas-assets-button ${activePanel === "assets" ? "active" : ""}`}
            aria-keyshortcuts="A"
            title="资产库（A）"
            onClick={toggleAssetLibrary}
          >
            ◈ 资产
          </button>
          <button
            type="button"
            className={`canvas-soft-button canvas-panel-button canvas-activity-button ${activePanel === "activity" ? "active" : ""}`}
            onClick={() => activePanel === "activity" ? setActivePanel(null) : openCanvasPanel("activity")}
          >
            ≡ 日志
          </button>
          </>}
          {!topbarCollapsed && <button
            type="button"
            className="canvas-soft-button canvas-theme-button"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "切换深色界面" : "切换浅色界面"}
            title={theme === "light" ? "切换深色界面" : "切换浅色界面"}
          >
            {theme === "light" ? "☾ 深色" : "☀ 浅色"}
          </button>}
          <div className="canvas-topbar-spacer" />
          <span
            className={`canvas-save-state ${saving ? "saving" : saveError ? "error" : ""}`}
          >
            <i />
            {saving ? "保存中…" : saveError ? "保存失败" : "已保存"}
          </span>
          <span className={`canvas-workspace-sync-state ${workspaceSyncStatus}`} title="同台电脑跨浏览器工作区同步状态">
            <i />
            {workspaceSyncStatus === "syncing" ? "同步中…" : workspaceSyncStatus === "offline" ? "离线待同步" : workspaceSyncStatus === "error" ? "同步失败" : workspaceSyncStatus === "synced" ? "已同步" : "准备同步"}
          </span>
        </div>
        <button
          type="button"
          className="canvas-topbar-toggle"
          aria-label={topbarCollapsed ? "展开顶部工具栏" : "收起顶部工具栏"}
          title={topbarCollapsed ? "展开顶部工具栏" : "收起顶部工具栏"}
          onClick={() => setTopbarCollapsed((value) => {
            const next = !value;
            try { window.localStorage.setItem("sanmao.canvas.topbar.collapsed", String(next)); } catch { /* optional */ }
            return next;
          })}
        >
          <span className="canvas-topbar-toggle-icon" aria-hidden="true">{topbarCollapsed ? "⌄" : "⌃"}</span>
          <span>{topbarCollapsed ? "展开工具栏" : "收起"}</span>
        </button>
      </header>
      {projectMenuOpen && (
        <div className="canvas-project-popover-wrap">
          <div
            className="canvas-project-popover"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="canvas-popover-title">我的画布项目</div>
            {projects.map((project) => (
              <div
                className={`canvas-project-row ${project.id === activeProjectId ? "active" : ""}`}
                key={project.id}
              >
                <button type="button" onClick={() => openProject(project.id)}>
                  <span className="canvas-project-dot">✦</span>
                  <span>
                    <b>{project.name}</b>
                    <small>{new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
                  </span>
                </button>
                {project.id === activeProjectId && <i>✓</i>}
              </div>
            ))}
            <div className="canvas-popover-actions">
              <button type="button" onClick={newProject}>＋ 新建画布</button>
              <button
                type="button"
                onClick={() => {
                  setProjectRenameValue(currentProject?.name || "");
                  setProjectRename(true);
                }}
              >
                重命名
              </button>
            </div>
            {projectRename && (
              <div className="canvas-rename-row">
                <input
                  value={projectRenameValue}
                  onChange={(event) => setProjectRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveProjectName();
                    if (event.key === "Escape") setProjectRename(false);
                  }}
                  autoFocus
                />
                <button type="button" onClick={saveProjectName}>保存</button>
              </div>
            )}
          </div>
        </div>
      )}
      <div
        ref={stageRef}
        className={`canvas-stage ${panActive ? "is-panning" : ""} ${fileDropActive ? "is-file-drop-target" : ""}`}
        tabIndex={-1}
        aria-keyshortcuts="Delete"
        onPointerDown={handleStagePointerDown}
        onPointerDownCapture={handleStagePointerDownCapture}
        onPointerMove={moveInteraction}
        onPointerUp={finishInteraction}
        onPointerCancel={cancelPointerInteraction}
        onLostPointerCapture={cancelPointerInteraction}
        onDoubleClick={(event) => {
          // Pointer capture used for node dragging can retarget the native
          // dblclick to the stage. Resolve the node from the pointer position
          // so double-clicking a media card always opens its full viewer.
          const target = event.target instanceof Element ? event.target : null;
          const pointTarget = window.document.elementFromPoint(event.clientX, event.clientY);
          const isolatedTarget =
            canvasPointerDownRef.current?.interactive ||
            target?.closest(
              "button,textarea,input,select,[contenteditable=\"true\"],.canvas-node-asset-drag-handle,.canvas-node-resize,.canvas-node-editor,.canvas-node-editor-popover,.canvas-node-parameters,.canvas-node-quick-toolbar,.canvas-group,.canvas-edge-layer,.canvas-floating,.canvas-deck,.canvas-selection-toolbar,.canvas-selection-layout-toolbar,.canvas-minimap,.canvas-context-menu,.canvas-connection-picker,.select-menu,.select-menu-popover,.model-picker,.model-picker-panel,.model-picker-dialog-backdrop",
            ) ||
            pointTarget?.closest(
              "button,textarea,input,select,[contenteditable=\"true\"],.canvas-node-asset-drag-handle,.canvas-node-resize,.canvas-node-editor,.canvas-node-editor-popover,.canvas-node-parameters,.canvas-node-quick-toolbar,.canvas-group,.canvas-edge-layer,.canvas-floating,.canvas-deck,.canvas-selection-toolbar,.canvas-selection-layout-toolbar,.canvas-minimap,.canvas-context-menu,.canvas-connection-picker,.select-menu,.select-menu-popover,.model-picker,.model-picker-panel,.model-picker-dialog-backdrop",
            );
          if (isolatedTarget) return;
          const hit = target?.closest("[data-canvas-node-id]") ||
            pointTarget?.closest("[data-canvas-node-id]");
          const nodeId = hit?.getAttribute("data-canvas-node-id");
          const node = nodeId ? nodeById(docRef.current, nodeId) : undefined;
          if (node && isCanvasReferenceableNode(node)) {
            cancelPendingNodeClick();
            openCanvasMediaViewer(node.id);
          } else if (node?.type === "prompt") {
            cancelPendingNodeClick();
            setEditingNodeId(node.id);
          } else if (node) {
            event.preventDefault();
            return;
          } else {
            event.preventDefault();
            const point = stagePoint(event.clientX, event.clientY);
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              menu: "create",
              world: {
                x: (point.x - document.camera.x) / document.camera.zoom,
                y: (point.y - document.camera.y) / document.camera.zoom,
              },
            });
          }
        }}
        onDragStart={(event) => {
          const target = event.target as HTMLElement;
          const isReferenceDrag = Boolean(
            target.closest(".canvas-reference-item"),
          );
          const isCanvasNodeDrag =
            event.dataTransfer.types.includes("application/x-sanmao-canvas-node") ||
            Boolean(target.closest(".canvas-node"));
          if (!isReferenceDrag && !isCanvasNodeDrag) event.preventDefault();
        }}
        onDragOver={(event) => {
          if (hasExternalFileTransfer(event.dataTransfer)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setFileDropActive(true);
            return;
          }
          if (event.dataTransfer.types.includes("application/x-sanmao-asset")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setAssetDropGroupId(
              groupAtPoint(
                docRef.current,
                screenToWorld(event.clientX, event.clientY),
              )?.id || null,
            );
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setAssetDropGroupId(null);
            setFileDropActive(false);
          }
        }}
        onDrop={(event) => {
          if (hasExternalFileTransfer(event.dataTransfer)) {
            event.preventDefault();
            event.stopPropagation();
            setFileDropActive(false);
            if (event.dataTransfer.files.length) {
              void handleFiles(
                event.dataTransfer.files,
                screenToWorld(event.clientX, event.clientY),
              );
            }
            return;
          }
          handleAssetDrop(event);
        }}
        onContextMenu={handleContextMenu}
        onWheel={(event) => {
          if (isCanvasWheelIsolatedTarget(event.target)) {
            // Do not preventDefault: the nested textarea/list should keep its
            // native scroll. Stopping here only prevents stage zoom.
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          zoomAt(
            event.clientX,
            event.clientY,
            Math.exp(-event.deltaY * 0.0014),
          );
        }}
      >
        {fileDropActive && (
          <div className="canvas-file-drop-hint" aria-hidden="true">
            <span>↥</span>
            <b>松开以导入图片或视频</b>
          </div>
        )}
        <div className="canvas-grid" />
        {snapGuides.length > 0 && (
          <div className="canvas-snap-guides" aria-hidden="true">
            {snapGuides.map((guide) => {
              const zoom = document.camera.zoom;
              if (guide.axis === "x") {
                return (
                  <span
                    className="canvas-snap-guide x"
                    key={`${guide.axis}-${guide.targetId}`}
                    style={{
                      left: document.camera.x + guide.position * zoom,
                      top: document.camera.y + guide.start * zoom,
                      height: Math.max(1, (guide.end - guide.start) * zoom),
                    }}
                  />
                );
              }
              return (
                <span
                  className="canvas-snap-guide y"
                  key={`${guide.axis}-${guide.targetId}`}
                  style={{
                    left: document.camera.x + guide.start * zoom,
                    top: document.camera.y + guide.position * zoom,
                    width: Math.max(1, (guide.end - guide.start) * zoom),
                  }}
                />
              );
            })}
          </div>
        )}
        <div className="canvas-world">
          <div
            className="canvas-world-content"
            style={{
              transform: `translate3d(${document.camera.x}px,${document.camera.y}px,0) scale(${document.camera.zoom})`,
            }}
          >
            <svg
              className="canvas-edge-layer"
              viewBox="-5000 -5000 10000 10000"
            >
              <defs>
                <linearGradient id="canvas-edge-gradient" x1="0" x2="1">
                  <stop offset="0" stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--accent-2)" />
                </linearGradient>
                {CANVAS_NODE_COLOR_KEYS.map((colorKey) => (
                  <marker
                    key={colorKey}
                    id={`canvas-arrow-${colorKey}`}
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path
                      d="M0,0 L8,4 L0,8 z"
                      fill={`var(--canvas-node-${colorKey})`}
                    />
                  </marker>
                ))}
              </defs>
              {visibleCanvasEdges.map((edge) => (
                <CanvasEdgeVisual
                  key={edge.id}
                  document={document}
                  edge={edge}
                  related={relatedConnectionEdgeIds.has(edge.id)}
                  style={connectionStyle}
                  selected={selectedEdgeId === edge.id}
                  onSelect={() => {
                    hideConnectionCancel();
                    setSelectedEdgeId(edge.id);
                    setSelectedIds(new Set());
                    setSelectedGroupId(null);
                  }}
                  onHover={() => handleConnectionHover(edge.id)}
                  onLeave={() => handleConnectionLeave(edge.id)}
                />
              ))}
              {draftConnection && (
                <path
                  className={`canvas-edge canvas-edge-draft node-color-${canvasSourceColorKey(document, draftConnection.sourceId)}`}
                  markerEnd={`url(#canvas-arrow-${canvasSourceColorKey(document, draftConnection.sourceId)})`}
                  d={connectionPath(
                    draftConnection.start,
                    draftConnection.end,
                    connectionStyle,
                    draftConnection.sourcePort,
                    draftConnection.sourcePort === "right" ? "left" : "right",
                  )}
                />
              )}
            </svg>
            <div className="canvas-group-layer">
              {document.groups.map((group) => {
                const bounds = groupBounds(document, group.id);
                return (
                  <div
                    key={group.id}
                    className={`canvas-group ${selectedGroupId === group.id ? "selected" : ""} ${connection?.sourceId === group.id ? "connection-source" : ""} ${connectionTargetId === group.id ? "connection-target" : ""} ${assetDropGroupId === group.id ? "asset-drop-target" : ""}`}
                    data-canvas-connectable-id={group.id}
                    style={{
                      left: bounds.x,
                      top: bounds.y,
                      width: bounds.w,
                      height: bounds.h,
                    }}
                    onPointerDown={(event) => startGroupDrag(event, group)}
                  >
                    <button
                      type="button"
                      className="canvas-group-port left"
                      aria-label={`从${group.name}左侧发起连线`}
                      title={`从${group.name}左侧发起连线`}
                      onPointerDown={(event) =>
                        startConnection(event, group.id, "left")
                      }
                    />
                    <button
                      type="button"
                      className="canvas-group-port right"
                      aria-label={`从${group.name}右侧发起连线`}
                      title={`从${group.name}右侧发起连线`}
                      onPointerDown={(event) =>
                        startConnection(event, group.id, "right")
                      }
                    />
                    <button
                      type="button"
                      className="canvas-group-resize"
                      aria-label="调整对象组大小"
                      onPointerDown={(event) => startGroupResize(event, group)}
                    />
                    <div className="canvas-group-label">
                      <span>⌘</span>
                      <b>{group.name}</b>
                      <small>{group.nodeIds.length} 个对象</small>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="canvas-node-layer">
              {visibleCanvasNodes.map((node) => (
                <CanvasNodeCard
                  key={node.id}
                  node={node}
                  selected={selectedIds.has(node.id)}
                  dragging={draggingNodeIds.has(node.id)}
                  document={document}
                  onPointerDown={startNodeDrag}
                  onResize={startResize}
                   onConnect={startConnection}
                   onSelect={(event) => selectNode(node, event.shiftKey)}
                   onRemoveFromGroup={() => removeNodeFromGroup(node.id)}
                  onPreview={() =>
                    openCanvasMediaViewer(node.id)
                  }
                  onOutputPreview={(output) => openCanvasMediaViewer(output.id)}
                  onMaskEdit={() => openCanvasMaskEditor(node.id)}
                  onTextPreview={() => openCanvasTextViewer(node.id)}
                  onUseAsImagePrompt={() => useAgentResponseAsImagePrompt(node)}
                  onRetryVariant={(variantIndex) =>
                    retryVariant(node.id, variantIndex)
                  }
                  onRetryFailedVariants={() => retryFailedVariants(node.id)}
                  editing={editingNodeId === node.id}
                  onEdit={(value) => setEditingNodeId(value ? node.id : null)}
                  onNaturalSize={setMediaNaturalSize}
                  onPromptChange={(value) => updateEditorPrompt(node, value)}
                  onEditorPromptChange={updateEditorPrompt}
                  onEditorParamsChange={updateEditorParams}
                  onVariantRequirementsChange={(target, value) => {
                    if (target.type !== "generator") return;
                    updateDoc((valueDoc) => ({
                      ...valueDoc,
                      nodes: valueDoc.nodes.map((item) => item.id === target.id ? {
                        ...item,
                        data: {
                          ...item.data,
                          variantRequirementsText: value,
                          variantRequirements: normalizeVariantRequirements(value),
                          variantStates: [],
                          variantBatchId: undefined,
                          variantGroupId: undefined,
                        },
                      } : item),
                    }));
                  }}
                  runtime={runtime}
                  editorPrompt={editorPromptFor(node)}
                  editorParams={editorParamsFor(node)}
                  expanded={expandedEditorId === node.id}
                  onToggleEditor={toggleEditor}
                  onGenerate={runEditorGeneration}
                  onReferenceReorder={reorderReference}
                  onReferenceRemove={removeNodeReference}
                  onReferenceDrop={addNodeReference}
                  onAddReferenceFiles={addEditorReferenceFiles}
                  editorContexts={incomingContext(document, node.id).filter((item) => item.type === "prompt" || item.type === "generator")}
                  mentionCandidates={document.nodes.filter((candidate) => Boolean(candidate.data.url || candidate.data.text || candidate.data.prompt || candidate.data.agentPrompt))}
                />
              ))}
           </div>
          </div>
        </div>
        {selectedSingle &&
          quickToolbarNodeId === selectedSingle.id &&
          !nodeGestureActive &&
          quickActions.length > 0 && (
          <CanvasNodeQuickToolbar
            node={selectedSingle}
            document={document}
            stageRef={stageRef}
            actions={quickActions}
          />
        )}
        {expandedEditorId && !nodeGestureActive && (() => {
          const editorNode = document.nodes.find((item) => item.id === expandedEditorId);
          if (!editorNode) return null;
          return (
            <CanvasNodeEditorPopover
              node={editorNode}
              document={document}
              stageRef={stageRef}
              runtime={runtime}
              editorPrompt={
                reuseDraft?.sourceNodeId === editorNode.id
                  ? reuseDraft.prompt
                  : editorPromptFor(editorNode)
              }
              editorParams={
                reuseDraft?.sourceNodeId === editorNode.id
                  ? reuseDraft.params
                  : editorParamsFor(editorNode)
              }
              onToggleEditor={toggleEditor}
              onGenerate={runEditorGeneration}
              onEditorPromptChange={updateEditorPrompt}
              onEditorParamsChange={updateEditorParams}
              onVariantRequirementsChange={(target, value) => {
                if (target.type !== "generator") return;
                updateDoc((valueDoc) => ({
                  ...valueDoc,
                  nodes: valueDoc.nodes.map((item) => item.id === target.id ? {
                    ...item,
                    data: {
                      ...item.data,
                      variantRequirementsText: value,
                      variantRequirements: normalizeVariantRequirements(value),
                      variantStates: [],
                      variantBatchId: undefined,
                      variantGroupId: undefined,
                    },
                  } : item),
                }));
              }}
              onReferenceReorder={reorderReference}
              onReferenceRemove={removeNodeReference}
              onReferenceDrop={addNodeReference}
              onAddReferenceFiles={addEditorReferenceFiles}
              maskState={maskStateForNode(editorNode)}
              onMaskEdit={() => openCanvasMaskEditor(editorNode.id)}
              onMaskRemove={() => removeCanvasMask(editorNode)}
              branchDraft={reuseDraft?.sourceNodeId === editorNode.id ? reuseDraft : null}
              onDraftReferenceFiles={addReuseFiles}
              onDraftReferenceRemove={removeReuseReference}
              onDraftReferenceReorder={reorderReuseReference}
              onDraftReferenceNodeDrop={addReuseReferenceNode}
              onDraftReferencePreview={previewReuseReference}
              onDraftReferencePaste={pasteReuseReference}
              editorContexts={incomingContext(document, editorNode.id).filter((item) => item.type === "prompt" || item.type === "generator")}
              mentionCandidates={document.nodes.filter((candidate) => Boolean(candidate.data.url || candidate.data.text || candidate.data.prompt || candidate.data.agentPrompt))}
              onOutputPreview={(output) => {
                cancelPendingNodeClick();
                openCanvasMediaViewer(output.id);
              }}
              upscaleParams={editorNode.type === "upscale" ? editorNode.data.params as CanvasUpscaleParams : undefined}
              upscaleSourceUrl={editorNode.type === "upscale" ? canvasUpscaleSource(document, editorNode.id)?.data.url : undefined}
              onUpscaleParamsChange={(params) => updateUpscaleParams(editorNode, params)}
            />
          );
        })()}
        {connectionTargetEntity &&
          connectionTargetBounds &&
          connectionTargetScreen && (
            <div
              className="canvas-connection-target"
              style={{
                left: connectionTargetScreen.x - 8,
                top: connectionTargetScreen.y - 8,
                width: connectionTargetBounds.w * document.camera.zoom + 16,
                height: connectionTargetBounds.h * document.camera.zoom + 16,
              }}
            />
          )}
        {connectionCancelScreen && (
          <button
            type="button"
            className={`canvas-connection-cancel${connectionCancelEdge ? " canvas-connection-remove" : ""}`}
            aria-label={connectionCancelEdge ? "删除此连线" : "取消连线"}
            title={connectionCancelEdge ? "删除此连线" : "取消连线"}
            style={{
              left: connectionCancelScreen.x,
              top: connectionCancelScreen.y,
            }}
            onPointerEnter={() => {
              connectionCancelButtonHoverRef.current = true;
              clearConnectionCancelHideTimer();
            }}
            onPointerLeave={() => {
              connectionCancelButtonHoverRef.current = false;
              if (!connectionCancelEdgeId) return;
              if (!connectionHoverEdgeRef.current)
                scheduleConnectionCancelHide(connectionCancelEdgeId);
            }}
            onPointerDown={(event) =>
              connectionCancelEdge
                ? removeConnection(connectionCancelEdge.id, event)
                : cancelConnection(event)
            }
          >
            ×
          </button>
        )}
        {connectionNodePicker && connectionNodePickerScreen && (
          <div
            className="canvas-connection-picker"
            style={{
              left: connectionNodePickerScreen.x,
              top: connectionNodePickerScreen.y,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="canvas-connection-picker-head">
              <div>
                <b>选择连接节点</b>
                <small>松开后自动创建并连接</small>
              </div>
              <button
                type="button"
                aria-label="关闭节点选择"
                onClick={() => setConnectionNodePicker(null)}
              >
                ×
              </button>
            </div>
            <div className="canvas-connection-picker-options">
              {CONNECTION_NODE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.kind}
                  onClick={() => {
                    if (connectionNodePicker)
                      connectNewNode(option.kind, connectionNodePicker);
                  }}
                >
                  <span>{option.icon}</span>
                  <i>
                    <b>{option.label}</b>
                    <small>{option.description}</small>
                  </i>
                  <em>›</em>
                </button>
              ))}
            </div>
          </div>
        )}
        {marquee && (
          <div
            className="canvas-marquee"
            style={{
              left: Math.min(marquee.x, marquee.x + marquee.w),
              top: Math.min(marquee.y, marquee.y + marquee.h),
              width: Math.abs(marquee.w),
              height: Math.abs(marquee.h),
            }}
          >
            <b>
              {Math.round(Math.abs(marquee.w))} ×{" "}
              {Math.round(Math.abs(marquee.h))} px
            </b>
          </div>
        )}
        {selectedNodes.length >= 2 && (
          <div className="canvas-selection-toolbar">
            <b>
              {selectedGroupId
                ? "已选对象组"
                : `已选 ${selectedNodes.length} 个对象`}
            </b>
            <span />
            {!selectedGroupId && (
              <button type="button" onClick={makeGroup}>
                ⌘ 成组
              </button>
            )}
            {selectedNodes.filter((node) => isCanvasReferenceableNode(node) && node.data.kind === "image").length >= 2 && (
              <button type="button" onClick={() => void runOneTakeFromSelection()}>🎬 一镜到底</button>
            )}
            {selectedImageDownloads.length >= 2 && (
              <button
                type="button"
                title="按选择顺序打包下载图片"
                aria-label={`批量下载 ${selectedImageDownloads.length} 张图片`}
                disabled={batchDownloading}
                onClick={() => void downloadSelectedImages()}
              >
                {batchDownloading ? "⌛ 打包中…" : `↓ 下载 ${selectedImageDownloads.length} 张`}
              </button>
            )}
            {selectedGroupId && (
              <button type="button" onClick={breakGroup}>
                解组
              </button>
            )}
            <button type="button" onClick={arrangeCanvasAction}>
              ⌗ 整理选中
            </button>
            <button type="button" onClick={duplicateSelection}>
              ⧉ 复制
            </button>
            <button type="button" onClick={() => fitView([...selectedIds])}>
              ⌗ 聚焦
            </button>
            <button type="button" className="danger" onClick={deleteSelection}>
              ⌫ 删除
            </button>
          </div>
        )}
        {selectedNodes.length >= 2 && !selectedGroupId && (
          <div
            className="canvas-selection-layout-toolbar"
            aria-label="节点布局工具"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="canvas-selection-layout-group alignment" aria-label="节点对齐">
              {CANVAS_ALIGNMENT_OPTIONS.map((option) => (
                <span
                  className="canvas-selection-layout-tooltip"
                  data-tooltip={option.title}
                  key={option.value}
                >
                  <button
                    type="button"
                    title={option.title}
                    aria-label={option.title}
                    onClick={() => alignSelection(option.value)}
                  >
                    <CanvasLayoutIcon kind={option.icon} />
                  </button>
                </span>
              ))}
            </div>
            <span className="canvas-selection-layout-divider" aria-hidden="true" />
            <div className="canvas-selection-layout-group distribution" aria-label="节点均匀分布">
              {CANVAS_DISTRIBUTION_OPTIONS.map((option) => {
                const disabled = selectedNodes.length < 3;
                const tooltip = disabled
                  ? `至少选择 3 个节点后可${option.label}`
                  : option.title;
                return (
                  <span
                    className="canvas-selection-layout-tooltip"
                    data-tooltip={tooltip}
                    key={option.value}
                  >
                    <button
                      type="button"
                      title={tooltip}
                      aria-label={tooltip}
                      disabled={disabled}
                      onClick={() => distributeSelection(option.value)}
                    >
                      <CanvasLayoutIcon kind={option.icon} />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div ref={deckRef} className={`canvas-deck legacy-deck-hidden ${deckCollapsed ? "collapsed" : ""}`}>
          <div className="canvas-deck-top">
            <div className="canvas-mode-switch">
              <button
                type="button"
                className={mode === "image" ? "active" : ""}
                onClick={() => {
                  if (selectedSingle) clearSelection();
                  setMode("image");
                }}
              >
                ✦ 图片
              </button>
              <button
                type="button"
                className={mode === "video" ? "active" : ""}
                onClick={() => {
                  if (selectedSingle) clearSelection();
                  setMode("video");
                }}
              >
                ▶ 视频
              </button>
              <button
                type="button"
                className={mode === "text" ? "active" : ""}
                onClick={() => {
                  if (selectedSingle) clearSelection();
                  setMode("text");
                }}
              >
                ✦ Agent
              </button>
            </div>
            <div className="canvas-deck-context">
              <i />
              <b>
                {selectedSingle
                  ? nodeLabel(selectedSingle)
                  : selectedGroup
                    ? selectedGroup.name
                    : "智能创作"}
              </b>
              <small>
                {selectedNodes.length > 1 || selectedGroup
                  ? `将所选内容作为参考 · 当前输出 ${mode === "video" ? "视频" : mode === "text" ? "Agent 回复" : "图片"}`
                  : references.length
                    ? reuseDraft
                      ? `复用草稿 · ${composerReferences.length} 个参考素材`
                      : `已连接 ${composerReferences.length} 个参考素材`
                    : selectedSingle?.type === "media" &&
                        selectedSingle.data.url
                      ? "再次生成会创建新分支；原节点和原连线保持不变"
                      : "生成结果直接进入画布卡片"}
              </small>
            </div>
            <button
              type="button"
              className="canvas-deck-collapse"
              aria-label={deckCollapsed ? "展开创作面板" : "收起创作面板"}
              onClick={toggleDeckCollapsed}
            >
              {deckCollapsed ? "⌃" : "⌄"}
            </button>
          </div>
          {!deckCollapsed && (
            <>
              <div
                className="canvas-deck-main"
                onDragOver={(event) => {
                  if (!reuseDraft) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (reuseDraft) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files);
                }}
                onPaste={(event) => {
                  if (reuseDraft) return;
                  const image = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
                  if (image?.getAsFile()) {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleFiles([image.getAsFile()!]);
                  }
                }}
              >
                <div className="canvas-deck-reference-row">
                  {!reuseDraft && (
                    <button
                      type="button"
                      className="canvas-context-add"
                      aria-label="导入参考素材"
                      onClick={() => openFilePicker()}
                    >
                      ＋
                    </button>
                  )}
                  {reuseDraft ? (
                    <CanvasReferenceDraftStrip
                      references={reuseDraft.references}
                      onFiles={(files) => void addReuseFiles(files)}
                      onRemove={removeReuseReference}
                      onReorder={reorderReuseReference}
                      onPaste={() => void pasteReuseReference()}
                      onClear={() => setReuseDraft((current) => current ? { ...current, references: [], dirty: true } : current)}
                      onPreview={setReusePreview}
                      emptyLabel="添加参考图"
                      trailing={
                        <>
                          <button type="button" disabled={!reuseDraft.references.length} onClick={() => void reverseReusePrompt()}>⌁ 反推</button>
                          <button type="button" disabled={!reuseDraft.prompt.trim()} onClick={() => void optimizeReusePrompt()}>✦ 优化</button>
                        </>
                      }
                    />
                  ) : (
                    <CanvasReferenceList
                      document={document}
                      ownerId={referenceOwnerId}
                      nodes={references}
                      onReorder={reorderReference}
                      onRemove={removeComposerReference}
                      onClear={clearComposerReferences}
                      onAdd={() => openFilePicker()}
                      onPaste={() => void pasteFromClipboard()}
                      variant="deck"
                    />
                  )}
                  <div className="canvas-input-semantics" aria-label="引用语义">
                    <span className="canvas-input-semantics-label">引用方式</span>
                    {composerSemanticBadges.map((badge) => (
                      <span key={badge}>{badge}</span>
                    ))}
                  </div>
                </div>
                <div className="canvas-deck-prompt-row">
                  <div className="canvas-prompt-input-wrap">
                  <textarea
                    ref={deckPromptRef}
                    aria-label="创作提示词"
                    value={
                      selectedSingle?.type === "prompt"
                        ? String(
                            selectedSingle.data.agentPrompt ||
                              selectedSingle.data.text ||
                              "",
                          )
                      : composerPrompt
                    }
                    onChange={updateDeckPrompt}
                    onClick={(event) =>
                      setMentionState(
                        mentionStateForValue(
                          event.currentTarget.value,
                          event.currentTarget.selectionStart,
                        ),
                      )
                    }
                    onKeyUp={(event) => {
                      if (event.key === "Escape") return;
                      setMentionState(
                        mentionStateForValue(
                          event.currentTarget.value,
                          event.currentTarget.selectionStart,
                        ),
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setMentionState(null);
                      if (mode === "text" && event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void runGeneration();
                        return;
                      }
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        event.key === "Enter"
                      ) {
                        event.preventDefault();
                        void runGeneration();
                      }
                    }}
                    placeholder={
                      mode === "video"
                        ? "描述视频动作、镜头、节奏和声音… 输入 @ 可调用参考图"
                        : mode === "text"
                          ? "输入要交给 Agent 的任务… 可连接上游文本形成对话上下文"
                          : "描述你想生成的画面… 输入 @ 可调用参考图"
                    }
                    rows={2}
                  />
                  {reuseDraft && composerPrompt && (
                    <button
                      type="button"
                      className="canvas-reuse-prompt-clear"
                      aria-label="清空复用提示词"
                      onClick={() => setReuseDraft((current) => current ? { ...current, prompt: "", dirty: true } : current)}
                    >
                      清空
                    </button>
                  )}
                  {mentionState && filteredMentionCandidates.length > 0 && (
                    <div className="canvas-mention-menu">
                      {filteredMentionCandidates.slice(0, 8).map((node) => (
                        <button
                          type="button"
                          key={node.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseMention(node)}
                        >
                          <b>
                            @
                            {mentionCandidates.findIndex(
                              (item) => item.id === node.id,
                            ) + 1}
                          </b>
                          <span>
                            {mentionLabel(
                              node,
                              mentionCandidates.findIndex(
                                (item) => item.id === node.id,
                              ),
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  </div>
                  <button
                    type="button"
                    className="canvas-run-button"
                    disabled={generationBusy}
                    aria-busy={generationBusy}
                    aria-label={runButtonTitle}
                    title={`${runButtonTitle}（Ctrl + Enter）`}
                    onClick={() => void runGeneration()}
                  >
                    <span aria-hidden="true">✦</span>
                    <b>{runButtonLabel}</b>
                    <small>Ctrl + Enter</small>
                  </button>
                </div>
              </div>
              <div className="canvas-deck-params">
                {selectedSingle?.type === "generator" && (
                  <div className="canvas-variant-editor">
                    <div className="canvas-variant-editor-head">
                      <div>
                        <b>变体要求</b>
                        <small>每行一条要求，空行自动忽略，最多 8 条</small>
                      </div>
                      <span>{variantRequirementsFor(selectedSingle).length}/8</span>
                    </div>
                    <textarea
                      aria-label="变体要求，每行一条"
                      rows={3}
                      value={
                        selectedSingle.data.variantRequirementsText ??
                        variantRequirementsFor(selectedSingle).join("\n")
                      }
                      placeholder="改成夜景\n改为俯拍视角\n替换成红色包装"
                      onChange={(event) => updateVariantRequirements(event.target.value)}
                    />
                    <small className="canvas-variant-editor-note">
                      每条要求都会叠加到共同提示词，并按顺序生成独立结果。
                    </small>
                  </div>
                )}
                <CreationParameterEditor
                  settings={reuseDraft ? reuseDraft.params : deck.params}
                  runtime={runtime}
                  unavailableModelId={deckModelState.unavailableModelId}
                  referenceCount={composerReferences.length}
                  portalZIndex={CANVAS_Z_INDEX.portalPopover}
                  dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
                  onChange={(settings) => {
                    if (reuseDraft) setReuseDraft((current) => current ? { ...current, params: clone(settings), dirty: true } : current);
                    else updateParams(settings);
                  }}
                />
              </div>
            </>
          )}
        </div>
        <CanvasMinimap
          document={document}
          connectionStyle={connectionStyle}
          selectedIds={selectedIds}
          bounds={minimapBounds}
          stageSize={stageSize}
          zoomAt={zoomAt}
          fitView={fitView}
          onNavigate={panToWorld}
          onMoveNodes={moveMinimapNodes}
        />
        {contextNode && contextMenu?.menu === "node" && contextMenu.nodeId ? (
          <CanvasNodeContextMenu
            node={contextNode}
            selectionCount={selectedIds.size}
            groups={contextMenuGroups}
            position={contextMenu}
          />
        ) : contextMenu?.menu === "create" ? (
          <CanvasContextMenuFrame
            className="canvas-create-context-menu"
            position={contextMenu}
            ariaLabel="创建节点菜单"
          >
            <div className="canvas-menu-title">
              <span>创建节点</span>
              <small>选择节点放置到双击位置</small>
            </div>

            <div className="canvas-context-menu-body">

            <button type="button" className="canvas-menu-item canvas-menu-item-tool" onClick={() => addNode("upscale", contextMenu.world)}>
              <span className="canvas-menu-icon" aria-hidden="true">↗</span>
              <span className="canvas-menu-copy"><b>超分节点</b><small>连接图片后在独立面板中提交</small></span>
              <span className="canvas-menu-arrow" aria-hidden="true">›</span>
            </button>
            <div className="canvas-menu-group">
              <div className="canvas-menu-group-title">
                <span className="canvas-menu-group-mark" aria-hidden="true">01</span>
                <span>
                  <b>基础节点</b>
                  <small>从空白开始创建</small>
                </span>
              </div>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-image"
                onClick={() => addNode("image", contextMenu.world)}
              >
                <span className="canvas-menu-icon" aria-hidden="true">▧</span>
                <span className="canvas-menu-copy">
                  <b>空图片节点</b>
                  <small>结果直接写入节点</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-video"
                onClick={() => addNode("video", contextMenu.world)}
              >
                <span className="canvas-menu-icon" aria-hidden="true">▶</span>
                <span className="canvas-menu-copy">
                  <b>空视频节点</b>
                  <small>结果直接写入节点</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-agent"
                onClick={() => addNode("text", contextMenu.world)}
              >
                <span className="canvas-menu-icon" aria-hidden="true">✦</span>
                <span className="canvas-menu-copy">
                  <b>Agent 节点</b>
                  <small>文本驱动智能工作流</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
            </div>

            <div className="canvas-menu-group">
              <div className="canvas-menu-group-title">
                <span className="canvas-menu-group-mark" aria-hidden="true">02</span>
                <span>
                  <b>生成工作流</b>
                  <small>批量生成与变体</small>
                </span>
              </div>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-image"
                onClick={() => addNode("workflowImage", contextMenu.world)}
              >
                <span className="canvas-menu-icon" aria-hidden="true">✦</span>
                <span className="canvas-menu-copy">
                  <b>图片变体生成器</b>
                  <small>多行要求批量生成</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-video"
                onClick={() => addNode("workflowVideo", contextMenu.world)}
              >
                <span className="canvas-menu-icon" aria-hidden="true">▶</span>
                <span className="canvas-menu-copy">
                  <b>视频变体生成器</b>
                  <small>多行要求串行生成</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
            </div>

            </div>
          </CanvasContextMenuFrame>
        ) : contextMenu?.menu === "tools" ? (
          <CanvasContextMenuFrame
            className="canvas-tools-context-menu"
            position={contextMenu}
            ariaLabel="画布操作菜单"
          >
            <div className="canvas-menu-title">
              <span>画布操作</span>
              <small>粘贴、导入与视图工具</small>
            </div>
            <div className="canvas-context-menu-body">
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-tool"
                onClick={() => {
                  const position = contextMenu.world;
                  setContextMenu(null);
                  void pasteFromClipboard(position);
                }}
              >
                <span className="canvas-menu-icon" aria-hidden="true">⌘</span>
                <span className="canvas-menu-copy">
                  <b>粘贴</b>
                  <small>粘贴节点或剪贴板图片</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-tool"
                onClick={() => {
                  const position = contextMenu.world;
                  setContextMenu(null);
                  openFilePicker(position);
                }}
              >
                <span className="canvas-menu-icon" aria-hidden="true">⇧</span>
                <span className="canvas-menu-copy">
                  <b>导入图片 / 视频</b>
                  <small>支持多选，放置到右键位置</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-tool"
                onClick={() => {
                  setContextMenu(null);
                  arrangeCanvasAction();
                }}
              >
                <span className="canvas-menu-icon" aria-hidden="true">⌗</span>
                <span className="canvas-menu-copy">
                  <b>一键整理</b>
                  <small>自动对齐并排列节点</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="canvas-menu-item canvas-menu-item-tool"
                onClick={() => {
                  setContextMenu(null);
                  fitView();
                }}
              >
                <span className="canvas-menu-icon" aria-hidden="true">⌗</span>
                <span className="canvas-menu-copy">
                  <b>适应视图</b>
                  <small>缩放至完整显示画布</small>
                </span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
            </div>
          </CanvasContextMenuFrame>
        ) : null}
      </div>
      {lightbox && (() => {
        const viewerNode = nodeById(document, lightbox.nodeId);
        if (!viewerNode || !isCanvasReferenceableNode(viewerNode)) return null;
        const viewerIsMedia = viewerNode.type === "media";
        const viewerItem: MediaViewerItem = {
          id: viewerNode.id,
          kind: viewerNode.data.kind === "video" ? "video" : "image",
          url: String(viewerNode.data.url),
          name: String(viewerNode.data.name || (viewerNode.type === "upscale" ? "超分结果" : "画布素材")),
          prompt: String(viewerNode.data.generation?.prompt || viewerNode.data.prompt || ""),
          width: Number(viewerNode.data.nativeWidth) || undefined,
          height: Number(viewerNode.data.nativeHeight) || undefined,
        };
        const viewerReferences: MediaViewerReference[] = incomingReferences(document, viewerNode.id).map((reference) => ({
          id: reference.id,
          kind: reference.data.kind === "video" ? ("video" as const) : ("image" as const),
          url: String(reference.data.url || ""),
          name: String(reference.data.name || "参考素材"),
        })).filter((reference) => Boolean(reference.url));
        const removeViewerNode = () => {
          if (!window.confirm("删除这个节点？可以使用撤销恢复。")) return;
          commit((value) => removeNodes(value, [viewerNode.id]));
          setSelectedIds(new Set());
          setSelectedGroupId(null);
          setLightbox(null);
          notify("节点已删除，可用撤销恢复");
        };
        return <MediaViewer
          item={viewerItem}
          references={viewerReferences}
          surface="canvas"
          initialCompare={lightbox.compare}
          model={runtime?.settings.agentModelId || undefined}
          agentAvailable={chatModelsAvailable}
          runtime={runtime}
          parameters={viewerIsMedia && viewerNode.data.kind === "video"
            ? copyParams(viewerNode.data.generation?.params || viewerNode.data.params, "video", runtime) as VideoCreationSettings
            : viewerIsMedia
            ? copyParams(viewerNode.data.generation?.params || viewerNode.data.params, "image", runtime) as ImageCreationSettings
            : undefined}
          onClose={() => setLightbox(null)}
          onParametersChange={viewerIsMedia ? (settings) => updateViewerParams(viewerNode, settings) : undefined}
          onPromptSave={viewerIsMedia ? (value) => writeViewerPrompt(viewerNode, value) : undefined}
          onWriteResult={viewerIsMedia ? (value) => writeViewerPrompt(viewerNode, value) : undefined}
          onCreateTextNode={(value) => createViewerTextNode(viewerNode, value)}
          onNotify={notify}
          onEdit={viewerIsMedia ? () => viewerNode.data.kind === "image" ? openImageEditor(viewerNode) : openReuseDraft(viewerNode) : undefined}
          onMask={viewerIsMedia && viewerNode.data.kind === "image" ? () => openCanvasMaskEditor(viewerNode.id) : undefined}
          onUpscale={viewerIsMedia && viewerNode.data.kind === "image" ? () => createUpscaleFromSource(viewerNode) : undefined}
          onContinue={viewerIsMedia ? () => continueFromMedia(viewerNode) : undefined}
          onReuse={viewerIsMedia ? () => viewerNode.data.kind === "image" ? openImageEditor(viewerNode) : openReuseDraft(viewerNode) : undefined}
          onUseAsReference={viewerIsMedia ? () => addCurrentNodeToReuse(viewerNode) : undefined}
          onAddToAssets={canAddCanvasAsset(viewerNode) ? () => openAssetCollectionPicker(viewerNode) : undefined}
          onDownload={(variant) => {
            if (variant === "share") {
              void downloadCanvasShare(viewerNode);
              return;
            }
            downloadCanvasNode(viewerNode);
          }}
          onDelete={removeViewerNode}
        />;
      })()}
      {reusePreview && (
        <div className="canvas-modal-backdrop canvas-reference-preview-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setReusePreview(null); }}>
          <div className="canvas-reference-preview-modal canvas-draft-reference-preview">
            <header><div><b>{reusePreview.name}</b><small>临时复用参考图 · 不会修改原节点</small></div><button type="button" onClick={() => setReusePreview(null)} aria-label="关闭参考图预览">×</button></header>
            <div className="canvas-reference-preview-stage">{reusePreview.kind === "video" ? <video src={reusePreview.url} controls playsInline /> : <img src={reusePreview.url} alt={reusePreview.name} />}</div>
            <footer><button type="button" onClick={() => { removeReuseReference(reusePreview.id); setReusePreview(null); }}>移除这张参考图</button><button type="button" onClick={() => setReusePreview(null)}>关闭</button></footer>
          </div>
        </div>
      )}
      {textLightboxNodeId && (
        <CanvasTextLightbox
          node={nodeById(document, textLightboxNodeId)}
          onClose={() => setTextLightboxNodeId(null)}
          onNotify={notify}
          onUpdate={updateTextNode}
          onCreateAgentNode={createViewerAgentNode}
          onUseAsImagePrompt={createImageBranchFromText}
        />
      )}
      {maskNode?.data.url && (
        <MaskEditor
          imageUrl={String(maskNode.data.url)}
          initialMaskDataUrl={maskNode.data.mask?.url || maskSettings?.mask?.url}
          onApply={(value, coverage) => applyCanvasMask(value, coverage)}
          onCancel={() => setMaskNodeId(null)}
        />
      )}
      {assetCollectionPickerNodeId && (() => {
        const pickerNode = nodeById(document, assetCollectionPickerNodeId);
        if (!pickerNode || pickerNode.type !== "media" || !pickerNode.data.url)
          return null;
        return (
          <CanvasAssetCollectionPicker
            node={pickerNode}
            preferredCollectionId={assetLibraryCollectionId}
            onClose={() => setAssetCollectionPickerNodeId(null)}
            onConfirm={async (collectionId) => {
              const success = await addViewerAsset(pickerNode, collectionId);
              if (success) setAssetLibraryCollectionId(collectionId);
              return success;
            }}
            onNotify={notify}
          />
        );
      })()}
      {activePanel === "assets" && (
        <CanvasAssetDrawer
          extraAssets={canvasAssets}
          refresh={assetRefresh}
          collectionSelection={assetLibraryCollectionId}
          onCollectionSelectionChange={setAssetLibraryCollectionId}
          canReference={Boolean(selectedGroupId || selectedSingle)}
          onAdd={addAssetToCanvas}
          onReference={addAssetAsReference}
          onLocate={locateAsset}
          onAddNodeToCollection={addNodeToCollection}
          onClose={() => setActivePanel(null)}
          onOpenWorkbench={() => { setActivePanel(null); notify("工作流整理、导入导出已移至画布操作菜单。", "ok"); }}
          onNotify={notify}
        />
      )}
      {activePanel === "activity" && (
        <CanvasActivityDrawer
          taskLogs={generationLogs}
          activityLogs={logs}
          loading={generationLogsLoading}
          onRefresh={() => void refreshGenerationLogs()}
          onFocusTask={focusGenerationLog}
          onRetryTask={retryGenerationLog}
          onClose={() => setActivePanel(null)}
          onNotify={notify}
        />
      )}
      {activePanel === "settings" && (
        <CanvasSettingsPanel
          theme={theme}
          connectionStyle={connectionStyle}
          onTheme={toggleTheme}
          onConnectionStyleChange={setConnectionStyle}
          onClose={() => setActivePanel(null)}
        />
      )}
      {activePanel === "shortcuts" && <CanvasShortcutsPanel onClose={() => setActivePanel(null)} />}
      {agentResult && (
        <div className="canvas-agent-result-float">
          <header><b>{agentResult.title}</b><button type="button" onClick={() => setAgentResult(null)}>×</button></header>
          <p>{agentResult.value}</p>
          <footer>
            <button type="button" onClick={() => { setDrafts((current) => ({ ...current, video: { ...current.video, prompt: agentResult.value } })); setMode("video"); notify("一镜到底提示词已写入视频生成面板"); }}>写入视频面板</button>
            <button type="button" onClick={() => { const draft = createPrompt({ x: document.camera.x + 120, y: document.camera.y + 120 }); const node = { ...draft, data: { ...draft.data, text: agentResult.value, agentPrompt: agentResult.value, role: agentResult.title } }; commit((current) => ({ ...current, nodes: [...current.nodes, node] })); setAgentResult(null); notify("已创建新的文本节点"); }}>创建文本节点</button>
            <button type="button" onClick={() => navigator.clipboard?.writeText(agentResult.value)}>复制</button>
          </footer>
        </div>
      )}
      {notice && (
        <div
          className={`canvas-toast ${notice.kind === "error" ? "error" : ""}`}
        >
          <span>✦</span>
          <b>{notice.message}</b>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) {
            const position = pendingFilePositionRef.current;
            pendingFilePositionRef.current = null;
            void handleFiles(event.target.files, position || undefined);
          }
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={workflowInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importWorkflow(file);
          event.currentTarget.value = "";
        }}
      />
    </section>
  );
}

const ASSET_SOURCE_LABELS: Record<AssetSource, string> = {
  history: "主界面历史",
  "video-task": "视频任务",
  "canvas-upload": "画布导入",
  "canvas-output": "画布生成",
};

const CANVAS_ASSET_LAST_COLLECTION_KEY = "sanmao.canvas.asset.lastCollection";

function CanvasAssetCollectionPicker({
  node,
  preferredCollectionId,
  onClose,
  onConfirm,
  onNotify,
}: {
  node: CanvasNode;
  preferredCollectionId?: string;
  onClose: () => void;
  onConfirm: (collectionId: string) => Promise<boolean>;
  onNotify: (message: string, kind?: Notice["kind"]) => void;
}) {
  const [collections, setCollections] = useState<AssetCollection[]>(
    DEFAULT_ASSET_COLLECTIONS,
  );
  const [collectionId, setCollectionId] = useState(() => {
    if (preferredCollectionId && isAssignableCanvasAssetCollection(preferredCollectionId))
      return preferredCollectionId;
    if (typeof window === "undefined") return CANVAS_ASSET_UNCATEGORIZED_ID;
    try {
      return (
        window.localStorage.getItem(CANVAS_ASSET_LAST_COLLECTION_KEY) ||
        CANVAS_ASSET_UNCATEGORIZED_ID
      );
    } catch {
      return CANVAS_ASSET_UNCATEGORIZED_ID;
    }
  });
  const [newCollectionName, setNewCollectionName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void listAssetCollections()
      .then((items) => {
        if (!active) return;
        setCollections(items);
        const assignableIds = new Set([
          CANVAS_ASSET_UNCATEGORIZED_ID,
          ...items.filter((item) => item.builtin === false).map((item) => item.id),
        ]);
        setCollectionId((current) =>
          assignableIds.has(current)
            ? current
            : CANVAS_ASSET_UNCATEGORIZED_ID,
        );
      })
      .catch(() => {
        if (active) onNotify("资产集合读取失败，请稍后重试。", "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onNotify]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Keep the picker in the same order and vocabulary as the asset drawer.
  // Smart collections are useful filters, but they are derived views rather
  // than writable category assignments, so show them disabled instead of
  // silently hiding them from this selector.
  const collectionOptions = collections.map((item) => ({
    id: item.id,
    name: item.name,
    assignable: isAssignableCanvasAssetCollection(item.id),
  }));
  const selectedCollection =
    collectionOptions.find((item) => item.id === collectionId) ||
    collectionOptions.find((item) => item.id === CANVAS_ASSET_UNCATEGORIZED_ID);

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    if (collections.some((item) => item.name.trim() === name)) {
      onNotify("已经存在同名资产集合。", "error");
      return;
    }
    const now = Date.now();
    const item: AssetCollection = {
      id: `collection_${now.toString(36)}`,
      name,
      createdAt: now,
      updatedAt: now,
      builtin: false,
    };
    const next = [...collections, item];
    try {
      await saveAssetCollections(next);
      setCollections(next);
      setCollectionId(item.id);
      setNewCollectionName("");
      onNotify(`已创建资产集合“${name}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合创建失败。", "error");
    }
  };

  const confirm = async () => {
    if (saving || loading || !selectedCollection) return;
    setSaving(true);
    try {
      const success = await onConfirm(selectedCollection.id);
      if (!success) return;
      try {
        window.localStorage.setItem(
          CANVAS_ASSET_LAST_COLLECTION_KEY,
          selectedCollection.id,
        );
      } catch {
        /* 记忆失败不应阻断资产登记 */
      }
      onNotify(`已加入资产库 · ${selectedCollection.name}`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const menu = (
    <div
      className="canvas-modal-backdrop canvas-asset-collection-picker-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="canvas-asset-target-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-asset-collection-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>＋</span>
            <div>
              <b id="canvas-asset-collection-picker-title">加入资产库</b>
              <small>{String(node.data.name || "画布素材")}</small>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭加入资产弹窗">×</button>
        </header>
        <div className="canvas-asset-collection-picker-body">
          <label>
            <span>选择资产库分类</span>
            <SelectMenu
              value={collectionId}
              onChange={setCollectionId}
              ariaLabel="加入目标资产库分类"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              options={collectionOptions.map((item) => ({
                value: item.id,
                label: item.name,
                disabled: !item.assignable,
                description: item.assignable ? undefined : "智能筛选视图不可直接归类",
              }))}
            />
          </label>
          <small className="canvas-asset-collection-picker-hint">
            加入后可在全局资产中心的“{selectedCollection?.name || "未分类"}”分类中筛选；已有归类会保留。
          </small>
          <div className="canvas-asset-collection-picker-new">
            <input
              value={newCollectionName}
              onChange={(event) => setNewCollectionName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createCollection();
              }}
              placeholder="新建集合…"
              aria-label="新建资产集合"
            />
            <button
              type="button"
              onClick={() => void createCollection()}
              disabled={!newCollectionName.trim()}
            >
              新建
            </button>
          </div>
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="primary" onClick={() => void confirm()} disabled={saving || loading}>
            {saving ? "加入中…" : `加入“${selectedCollection?.name || "未分类"}”分类`}
          </button>
        </footer>
      </div>
    </div>
  );
  return typeof document === "undefined" ? menu : createPortal(menu, document.body);
}

function CanvasAssetDrawer({
  extraAssets,
  refresh,
  collectionSelection,
  onCollectionSelectionChange,
  canReference,
  onAdd,
  onReference,
  onLocate,
  onAddNodeToCollection,
  onClose,
  onOpenWorkbench,
  onNotify,
}: {
  extraAssets: AssetRecord[];
  refresh: number;
  collectionSelection: string;
  onCollectionSelectionChange: (collectionId: string) => void;
  canReference: boolean;
  onAdd: (asset: AssetRecord) => void;
  onReference: (asset: AssetRecord) => void;
  onLocate: (asset: AssetRecord) => void;
  onAddNodeToCollection: (nodeId: string, collectionId: string) => void;
  onClose: () => void;
  onOpenWorkbench: () => void;
  onNotify: (message: string, kind?: Notice["kind"]) => void;
}) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [source, setSource] = useState<"all" | AssetSource>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [preview, setPreview] = useState<AssetRecord | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [collections, setCollections] = useState<AssetCollection[]>(DEFAULT_ASSET_COLLECTIONS);
  const [collection, setCollection] = useState(collectionSelection || "all");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [nodeDropActive, setNodeDropActive] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!preview) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [preview]);

  useEffect(() => {
    let active = true;
    void listAssetCollections().then((items) => {
      if (!active) return;
      setCollections(items);
      const valid = collectionSelection === "all" || items.some((item) => item.id === collectionSelection);
      const next = valid ? collectionSelection : "all";
      setCollection(next);
      onCollectionSelectionChange(next);
    });
    return () => {
      active = false;
    };
  }, [collectionSelection, onCollectionSelectionChange]);

  useEffect(() => {
    setCollection((current) => current === collectionSelection ? current : collectionSelection);
  }, [collectionSelection]);

  const changeCollection = (next: string) => {
    setCollection(next);
    onCollectionSelectionChange(next);
  };

  const reload = useCallback(() => {
    setLoading(true);
    void listUnifiedAssets(extraAssets)
      .then(setAssets)
      .catch(() => onNotify("资产中心读取失败，请稍后重试。", "error"))
      .finally(() => setLoading(false));
  }, [extraAssets, onNotify]);

  useEffect(reload, [refresh, reload]);

  useEffect(() => {
    const clearNodeDropState = () => setNodeDropActive(false);
    window.addEventListener("dragend", clearNodeDropState);
    window.addEventListener("drop", clearNodeDropState);
    return () => {
      window.removeEventListener("dragend", clearNodeDropState);
      window.removeEventListener("drop", clearNodeDropState);
    };
  }, []);

  const setDrawerCollapsed = (value: boolean) => {
    setCollapsed(value);
  };

  const handleCanvasNodeDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (
      !event.dataTransfer.types.includes("application/x-sanmao-canvas-node")
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setNodeDropActive(true);
  };

  const handleCanvasNodeDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setNodeDropActive(false);
  };

  const handleCanvasNodeDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (
      !event.dataTransfer.types.includes("application/x-sanmao-canvas-node")
    )
      return;
    event.preventDefault();
    const nodeId = event.dataTransfer.getData(
      "application/x-sanmao-canvas-node",
    );
    setNodeDropActive(false);
    if (!nodeId) return;
    if (!isAssignableCanvasAssetCollection(collection)) {
      onNotify("请先选择未分类或自定义资产集合，再放入节点。", "error");
      return;
    }
    onAddNodeToCollection(nodeId, collection);
  };

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matchesCollection = (asset: AssetRecord) => {
      if (collection === "all") return true;
      if (collection === "uncategorized") return !asset.collectionIds?.length;
      if (collection === "favorite") return asset.favorite;
      if (collection === "image" || collection === "video") return asset.kind === collection;
      if (collection === "generated") return asset.source === "history" || asset.source === "video-task" || asset.source === "canvas-output";
      if (collection === "reference") return asset.source === "canvas-upload" || asset.tags?.includes("参考");
      if (collection === "recent") return asset.createdAt >= Date.now() - 7 * 24 * 60 * 60 * 1000;
      return asset.collectionIds?.includes(collection);
    };
    const result = assets.filter(
      (asset) =>
        (kind === "all" || asset.kind === kind) &&
        (source === "all" || asset.source === source) &&
        (!favoritesOnly || asset.favorite) &&
        matchesCollection(asset) &&
        (!tagFilter.trim() || asset.tags?.some((tag) => tag.toLowerCase().includes(tagFilter.trim().toLowerCase()))) &&
        (!search ||
          `${asset.name} ${asset.prompt || ""} ${asset.modelName || ""}`
            .toLowerCase()
            .includes(search)),
    );
    return [...result].sort((left, right) =>
      sort === "oldest"
        ? left.createdAt - right.createdAt
        : sort === "name"
          ? left.name.localeCompare(right.name, "zh-CN")
          : right.createdAt - left.createdAt,
    );
  }, [assets, collection, favoritesOnly, kind, query, sort, source, tagFilter]);

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const item: AssetCollection = { id: `collection_${Date.now().toString(36)}`, name, createdAt: Date.now(), updatedAt: Date.now() };
    const next = [...collections, item];
    setCollections(next); setNewCollectionName("");
    await saveAssetCollections(next);
    setCollection(item.id);
    onCollectionSelectionChange(item.id);
  };

  const deleteCollection = async (collectionId: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin) {
      onNotify("内置资产集合不能删除。", "error");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`确定删除资产集合“${target.name}”吗？集合内资产不会被删除。`)) return;
    try {
      const affectedAssets = assets.filter((asset) => asset.collectionIds?.includes(collectionId));
      await Promise.all(
        affectedAssets.map((asset) =>
          updateUnifiedAssetMetadata(asset, {
            collectionIds: asset.collectionIds.filter((id) => id !== collectionId),
          }),
        ),
      );
      const next = collections.filter((item) => item.id !== collectionId);
      await saveAssetCollections(next);
      setCollections(next);
      setAssets((items) =>
        items.map((asset) =>
          asset.collectionIds?.includes(collectionId)
            ? { ...asset, collectionIds: asset.collectionIds.filter((id) => id !== collectionId) }
            : asset,
        ),
      );
      if (collection === collectionId) changeCollection("all");
      onNotify(`已删除资产集合“${target.name}”，其中的资产已保留。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合删除失败。", "error");
    }
  };

  const renameCollection = async (collectionId: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin) {
      onNotify("内置资产集合不能重命名。", "error");
      return;
    }
    const nextName = window.prompt("重命名资产集合", target.name)?.trim();
    if (!nextName || nextName === target.name) return;
    const next = collections.map((item) => item.id === collectionId ? { ...item, name: nextName, updatedAt: Date.now() } : item);
    try {
      await saveAssetCollections(next);
      setCollections(next);
      onNotify(`已将资产集合重命名为“${nextName}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合重命名失败。", "error");
    }
  };

  const addSelectedAssetsToCollection = async () => {
    if (collection === "all" || collection === "uncategorized" || collection === "favorite" || collection === "recent" || collection === "generated" || collection === "reference" || collection === "image" || collection === "video") {
      onNotify("请先在集合筛选中选择一个自定义集合，再批量归类。", "error");
      return;
    }
    const selected = assets.filter((asset) => selectedAssetIds.has(asset.id));
    if (!selected.length) return;
    try {
      await Promise.all(selected.map((asset) => updateUnifiedAssetMetadata(asset, { collectionIds: [...new Set([...(asset.collectionIds || []), collection])] })));
      setAssets((items) => items.map((asset) => selectedAssetIds.has(asset.id) ? { ...asset, collectionIds: [...new Set([...(asset.collectionIds || []), collection])] } : asset));
      setSelectedAssetIds(new Set());
      onNotify(`已将 ${selected.length} 个资产加入“${collections.find((item) => item.id === collection)?.name || "当前集合"}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "批量归类失败。", "error");
    }
  };

  const toggleFavorite = async (asset: AssetRecord) => {
    try {
      await setUnifiedAssetFavorite(asset, !asset.favorite);
      setAssets((items) =>
        items.map((item) =>
          item.id === asset.id ? { ...item, favorite: !item.favorite } : item,
        ),
      );
    } catch {
      onNotify("收藏状态保存失败。", "error");
    }
  };

  const hideAsset = async (asset: AssetRecord) => {
    try {
      await hideUnifiedAsset(asset);
      setAssets((items) => items.filter((item) => item.id !== asset.id));
      if (preview?.id === asset.id) setPreview(null);
      onNotify("已从资产索引隐藏，画布引用和磁盘文件保持不变。");
    } catch {
      onNotify("暂时无法隐藏这个资产。", "error");
    }
  };

  if (collapsed)
    return (
      <button
        type="button"
        className="canvas-asset-drawer-collapsed"
        onClick={() => setDrawerCollapsed(false)}
        aria-label={`展开全局资产中心，共 ${assets.length} 个资产`}
        title="展开全局资产中心"
      >
        <span>◈</span>
        <b>{assets.length}</b>
      </button>
    );

  return (
    <>
      <aside
        className={`canvas-asset-drawer ${nodeDropActive ? "is-node-drop-target" : ""}`}
        aria-label="全局资产中心"
        onDragOver={handleCanvasNodeDragOver}
        onDragLeave={handleCanvasNodeDragLeave}
        onDrop={handleCanvasNodeDrop}
      >
        <header>
          <div>
            <span>◈</span>
            <span>
              <b>全局资产中心</b>
              <small>历史、视频任务与所有画布</small>
            </span>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setDrawerCollapsed(true)}
              aria-label="收起资产中心"
              title="收起为窄轨"
            >
              —
            </button>
            <button type="button" onClick={onClose} aria-label="关闭资产中心">
              ×
            </button>
          </div>
        </header>
        <div className="canvas-asset-toolbar">
          <label className="canvas-asset-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、提示词或模型…"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")}>
                ×
              </button>
            )}
          </label>
          <label className="canvas-asset-search"><span>#</span><input value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} placeholder="按标签筛选…" /></label>
          <div className="canvas-asset-kind" role="group" aria-label="资产类型">
            <button
              type="button"
              className={kind === "all" ? "active" : ""}
              onClick={() => setKind("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={kind === "image" ? "active" : ""}
              onClick={() => setKind("image")}
            >
              图片
            </button>
            <button
              type="button"
              className={kind === "video" ? "active" : ""}
              onClick={() => setKind("video")}
            >
              视频
            </button>
            <button
              type="button"
              className={favoritesOnly ? "active favorite" : ""}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              ★ 收藏
            </button>
          </div>
          <div className="canvas-asset-filters">
            <div className="canvas-asset-collection-picker">
              <SelectMenu
                value={collection}
                portalZIndex={CANVAS_Z_INDEX.assetDrawer}
                onChange={changeCollection}
                onDelete={(id) => void deleteCollection(id)}
                ariaLabel="资产集合"
                options={collections.map((item) => ({
                  value: item.id,
                  label: item.name,
                  deletable: !item.builtin,
                }))}
              />
              <button type="button" disabled={collection === "all" || collections.find((item) => item.id === collection)?.builtin !== false} onClick={() => void renameCollection(collection)} title="重命名当前自定义集合" aria-label="重命名当前资产集合">✎</button>
            </div>
            <SelectMenu
              value={source}
              portalZIndex={CANVAS_Z_INDEX.assetDrawer}
              onChange={setSource}
              ariaLabel="资产来源"
              options={[
                { value: "all", label: "全部来源" },
                ...Object.entries(ASSET_SOURCE_LABELS).map(
                  ([value, label]) => ({ value: value as AssetSource, label }),
                ),
              ]}
            />
            <SelectMenu
              value={sort}
              portalZIndex={CANVAS_Z_INDEX.assetDrawer}
              onChange={setSort}
              ariaLabel="资产排序"
              options={[
                { value: "newest", label: "最新优先" },
                { value: "oldest", label: "最早优先" },
                { value: "name", label: "按名称" },
              ]}
            />
          </div>
        </div>
        {!canReference && (
          <div className="canvas-asset-reference-hint">
            要建立参考关系，请先明确选中一个节点或对象组；多选不会隐式冒充单节点。
          </div>
        )}
        <div className={`canvas-asset-collection-dropzone ${isAssignableCanvasAssetCollection(collection) ? "" : "needs-collection"}`}>
          <span>⌘</span><b>{isAssignableCanvasAssetCollection(collection) ? "把画布节点拖到这里归类" : "先选择未分类或自定义集合"}</b><small>{isAssignableCanvasAssetCollection(collection) ? "拖动节点右上角 ↗，节点不会从画布移除" : "智能筛选视图不能作为归类目标"}</small>
        </div>
        <div className="canvas-asset-new-collection"><input value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="新建集合…" onKeyDown={(event) => { if (event.key === "Enter") void createCollection(); }} /><button type="button" onClick={() => void createCollection()}>＋</button></div>
        {selectedAssetIds.size > 0 && <div className="canvas-asset-bulk-bar"><b>已选 {selectedAssetIds.size} 个</b><button type="button" onClick={() => void addSelectedAssetsToCollection()}>加入当前集合</button><button type="button" onClick={() => setSelectedAssetIds(new Set())}>清除选择</button></div>}
        <div className="canvas-asset-results">
          <div className="canvas-asset-summary">
            <b>{filtered.length} 个资产</b>
            <span>拖到空白画布创建节点，拖到对象组自动加入</span>
          </div>
          {loading ? (
            <div className="canvas-asset-loading">
              <span>✦</span>正在聚合资产…
            </div>
          ) : filtered.length ? (
            <div className="canvas-global-asset-grid">
              {filtered.map((asset) => (
                <article
                  key={asset.id}
                  className="canvas-global-asset-card"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      "application/x-sanmao-asset",
                      JSON.stringify(asset),
                    );
                  }}
                >
                  <button
                    type="button"
                    className="canvas-global-asset-preview"
                    onClick={() => setPreview(asset)}
                  >
                    {asset.kind === "video" ? (
                      <video
                        src={asset.url}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img src={asset.url} alt={asset.name} loading="lazy" />
                    )}
                    <span>{asset.kind === "video" ? "▶ 视频" : "▣ 图片"}</span>
                  </button>
                  <div className="canvas-global-asset-copy">
                    <label className="canvas-asset-select"><input type="checkbox" checked={selectedAssetIds.has(asset.id)} onChange={(event) => setSelectedAssetIds((current) => { const next = new Set(current); if (event.target.checked) next.add(asset.id); else next.delete(asset.id); return next; })} aria-label={`选择资产 ${asset.name}`} /><b title={asset.name}>{asset.name}</b></label>
                    <small>
                      {ASSET_SOURCE_LABELS[asset.source]} ·{" "}
                      {asset.createdAt
                        ? new Date(asset.createdAt).toLocaleDateString("zh-CN")
                        : "当前画布"}
                    </small>
                    {asset.prompt && <p>{asset.prompt}</p>}
                  </div>
                  <div className="canvas-global-asset-actions">
                    <button
                      type="button"
                      title="添加到画布"
                      aria-label={`将${asset.name}添加到画布`}
                      onClick={() => onAdd(asset)}
                    >
                      ＋ 画布
                    </button>
                    <button
                      type="button"
                      disabled={!canReference}
                      title={canReference ? "作为当前节点或对象组的参考素材" : "请先选中一个节点或对象组，再添加参考"}
                      aria-label={canReference ? `将${asset.name}作为参考素材` : "添加参考前请先选择节点或对象组"}
                      onClick={() => onReference(asset)}
                    >
                      ⌁ 参考
                    </button>
                    <button
                      type="button"
                      title="在画布中定位此资产"
                      aria-label={`在画布中定位${asset.name}`}
                      onClick={() => onLocate(asset)}
                    >
                      ⌖
                    </button>
                    <button
                      type="button"
                      title="添加标签"
                      aria-label={`给${asset.name}添加标签`}
                      onClick={async () => {
                        const tag = window.prompt("输入标签");
                        if (!tag?.trim()) return;
                        try { await updateUnifiedAssetMetadata(asset, { tags: [...new Set([...(asset.tags || []), tag.trim()])] }); reload(); }
                        catch { onNotify("标签保存失败", "error"); }
                      }}
                    >#</button>
                    <button
                      type="button"
                      className={asset.favorite ? "active" : ""}
                      title={asset.favorite ? "取消收藏" : "加入收藏"}
                      aria-label={asset.favorite ? `取消收藏${asset.name}` : `收藏${asset.name}`}
                      onClick={() => void toggleFavorite(asset)}
                    >
                      ★
                    </button>
                    <a href={asset.url} download={asset.name} title="下载资产" aria-label={`下载${asset.name}`}>
                      ↓
                    </a>
                    <button
                      type="button"
                      className="danger"
                      title="从资产中心隐藏（不会删除画布节点或磁盘文件）"
                      aria-label={`隐藏${asset.name}`}
                      onClick={() => void hideAsset(asset)}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="canvas-asset-empty">
              <span>◇</span>
              <b>没有匹配的资产</b>
              <small>调整筛选，或从主界面生成、上传素材。</small>
            </div>
          )}
        </div>
      </aside>
      {preview && typeof document !== "undefined" && createPortal(
        <div
          className="canvas-asset-preview-backdrop"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setPreview(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className="canvas-asset-preview-modal">
            <header>
              <div>
                <b>{preview.name}</b>
                <small>
                  {ASSET_SOURCE_LABELS[preview.source]}
                  {preview.modelName ? ` · ${preview.modelName}` : ""}
                </small>
              </div>
              <button type="button" onClick={() => setPreview(null)}>
                ×
              </button>
            </header>
            <div className="canvas-asset-preview-stage">
              {preview.kind === "video" ? (
                <video src={preview.url} controls autoPlay playsInline />
              ) : (
                <img src={preview.url} alt={preview.name} />
              )}
            </div>
            <footer>
              <button type="button" onClick={() => onAdd(preview)}>
                ＋ 添加到画布
              </button>
              <button
                type="button"
                disabled={!canReference}
                onClick={() => onReference(preview)}
              >
                ⌁ 作为参考
              </button>
              <a href={preview.url} download={preview.name}>
                ↓ 下载
              </a>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CanvasReferenceList({
  document,
  ownerId,
  nodes,
  onReorder,
  onRemove,
  onClear,
  onAdd,
  onPaste,
  variant = "card",
}: {
  document: CanvasDocument;
  ownerId?: string;
  nodes?: CanvasNode[];
  onReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onRemove?: (nodeId: string) => void;
  onClear?: () => void;
  onAdd?: () => void;
  onPaste?: () => void;
  variant?: "card" | "deck";
}) {
  const references = ownerId
    ? incomingReferences(document, ownerId)
    : nodes || [];
  return (
    <div className={`canvas-reference-list-shell ${variant}`}>
      <div className={`canvas-reference-list ${variant}`}>
        {references.map((item, index) => (
          <div
            className="canvas-reference-item"
            key={item.id}
            draggable={Boolean(ownerId)}
            title={ownerId ? "拖动调整参考顺序" : item.data.name || "参考素材"}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event: ReactDragEvent<HTMLDivElement>) => {
              if (!ownerId) return;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.id);
            }}
            onDragOver={(event) => {
              if (ownerId) event.preventDefault();
            }}
            onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
              event.preventDefault();
              const draggedId = event.dataTransfer.getData("text/plain");
              if (ownerId && draggedId) onReorder(ownerId, draggedId, item.id);
            }}
          >
            <button
              type="button"
              className="canvas-reference-preview-button"
              aria-label={`预览参考图 ${index + 1}`}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="canvas-reference-index">{index + 1}</span>
              {item.data.kind === "video" ? (
                <video src={item.data.url} muted playsInline />
              ) : (
                <img src={item.data.url} alt={item.data.name || "参考素材"} />
              )}
            </button>
            <b>
              {item.data.name ||
                (item.data.kind === "video" ? "视频素材" : "图片素材")}
            </b>
            {onRemove && (
              <button
                type="button"
                className="canvas-reference-remove"
                aria-label={`移除参考图 ${index + 1}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(item.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!references.length && (
          <small className="canvas-reference-empty">连接素材后显示参考顺序</small>
        )}
      </div>
      {(onAdd || onPaste || (onClear && references.length > 0)) && (
        <div className="canvas-reference-list-actions">
          <span>{references.length}/16</span>
          {onAdd && <button type="button" onClick={onAdd}>＋ 添加</button>}
          {onPaste && <button type="button" onClick={onPaste}>粘贴</button>}
          {onClear && references.length > 0 && <button type="button" className="danger" onClick={onClear}>清空</button>}
        </div>
      )}
    </div>
  );
}

function progressValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function CanvasNodeReferenceStrip({
  target,
  document,
  runtime,
  references,
  contexts,
  onReorder,
  onRemove,
  onDrop,
  onAddFiles,
  onPreview,
}: {
  target: CanvasNode;
  document: CanvasDocument;
  runtime: CanvasRuntimeState | null;
  references: CanvasNode[];
  contexts: CanvasNode[];
  onReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onRemove: (ownerId: string, sourceId: string) => void;
  onDrop: (ownerId: string, sourceId: string, role: CanvasInputRole) => void;
  onAddFiles: (ownerId: string, files: File[]) => void;
  onPreview: (node: CanvasNode) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const isVideoTarget = (target.type === "media" || target.type === "generator") && target.data.kind === "video";
  const videoParams = isVideoTarget && target.data.params && typeof target.data.params === "object" && "inputMode" in target.data.params
    ? target.data.params as VideoCreationSettings
    : undefined;
  const videoModel = videoParams ? resolveAvailableCreationModel(videoParams, runtime).model : null;
  const videoProvider = runtime?.providers.find((item) => item.id === videoModel?.providerId);
  const videoLimits = videoParams ? getVideoModelLimits(videoModel || undefined, videoProvider) : undefined;
  const videoInputs = videoParams
    ? resolveCanvasVideoInputs(
        references,
        videoParams.inputMode,
        canvasInputRolesForTarget(document, target.id),
        { maxReferenceImages: videoLimits?.maxReferenceImages },
      )
    : undefined;
  const modeLabel = videoParams?.inputMode === "reference"
    ? "参考图生视频"
    : videoParams?.inputMode === "first-frame"
      ? "首帧图生视频"
      : videoParams?.inputMode === "frames"
        ? "首尾帧图生视频"
        : "文生视频";

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId?: string, role?: CanvasInputRole) => {
    event.preventDefault();
    event.stopPropagation();
    const fromIndex = Number(event.dataTransfer.getData("application/x-sanmao-reference-index"));
    if (Number.isInteger(fromIndex) && fromIndex >= 0 && fromIndex < references.length && targetId) {
      if (role && role !== "reference-image") onDrop(target.id, references[fromIndex].id, role);
      else onReorder(target.id, references[fromIndex].id, targetId);
      setDraggedId(null);
      return;
    }
    const sourceId = event.dataTransfer.getData("application/x-sanmao-canvas-node");
    if (sourceId) onDrop(target.id, sourceId, role || "reference-image");
    setDraggedId(null);
  };

  const renderItem = (reference: CanvasNode, index: number, extraClass = "", role?: CanvasInputRole) => (
    <div
      key={`${reference.id}-${role || "reference"}`}
      className={`canvas-editor-reference-item${draggedId === reference.id ? " dragging" : ""}${extraClass ? ` ${extraClass}` : ""}`}
      draggable
      onDragStart={(event) => {
        setDraggedId(reference.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-sanmao-canvas-node", reference.id);
        event.dataTransfer.setData("application/x-sanmao-reference-index", String(references.findIndex((item) => item.id === reference.id)));
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => handleDrop(event, reference.id)}
      onDragEnd={() => setDraggedId(null)}
    >
      <button type="button" className="canvas-editor-reference-preview" onClick={() => onPreview(reference)} title={reference.data.name || `引用 ${index + 1}`}>
        <span>{index + 1}</span>
        {reference.data.kind === "video" ? <video src={reference.data.url} muted playsInline /> : <img src={reference.data.url} alt={reference.data.name || `引用 ${index + 1}`} />}
      </button>
      <b className="canvas-editor-reference-name">{reference.data.name || (reference.data.kind === "video" ? "视频素材" : "图片素材")}</b>
      <button type="button" className="canvas-editor-reference-remove" aria-label={`移除引用 ${index + 1}`} onClick={() => onRemove(target.id, reference.id)}>×</button>
    </div>
  );

  const renderSlot = (label: string, slotRole: "first-frame" | "last-frame", reference: CanvasNode | undefined) => (
    <div
      className={`canvas-editor-frame-slot${reference ? " filled" : " empty"}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => handleDrop(event, reference?.id || "__slot__", slotRole)}
    >
      <span className="canvas-editor-slot-label"><b>{label}</b><small>{reference ? "已连接" : "拖入图片"}</small></span>
      {reference ? renderItem(reference, references.findIndex((item) => item.id === reference.id), "slot-item", slotRole) : <span className="canvas-editor-frame-slot-empty">＋ {label}</span>}
    </div>
  );

  const unusedImages = videoInputs?.unused.filter((item) => item.data.kind === "image") || [];
  const connectedVideos = references.filter((item) => item.data.kind === "video");
  const connectedVideo = videoInputs?.referenceVideo || connectedVideos[0];
  const imageWarning = isVideoTarget && videoParams?.inputMode === "text" && references.some((item) => item.data.kind === "image");
  const videoWarning = isVideoTarget && connectedVideos.length > 0 && (
    videoParams?.inputMode === "text" || videoLimits?.maxReferenceVideos === 0
  );

  return (
    <div className="canvas-editor-references" onDragOver={(event) => event.preventDefault()}>
      <div className="canvas-editor-section-head">
        <span><b>输入与引用</b><small>{isVideoTarget ? modeLabel : "拖动缩略图可调整顺序"}</small></span>
        <div>
          <b>{videoLimits ? `图片 ${videoInputs?.referenceImages.length || 0}/${videoLimits.maxReferenceImages}` : `${references.length}/16`}</b>
          {isVideoTarget && connectedVideos.length > 0 && <small>视频输入 {connectedVideos.length}/{videoLimits?.maxReferenceVideos ?? 10}</small>}
          <button type="button" onClick={() => inputRef.current?.click()}>＋ 添加</button>
        </div>
      </div>
      {imageWarning && <div className="canvas-editor-video-warning">已连接图片不会参与本次生成；当前为文生视频模式。</div>}
      {videoWarning && (
        <div className="canvas-editor-video-warning">
          {videoLimits?.maxReferenceVideos === 0
            ? "当前视频模型不支持参考视频；请切换模型或移除视频输入。"
            : "已连接参考视频，但当前为文生视频模式；请切换到参考图/编辑模式后再生成。"}
        </div>
      )}
      {contexts.length > 0 && (
        <div className="canvas-editor-context-slot">
          <span className="canvas-editor-slot-label">文本上下文 <small>来自 @ 引用</small></span>
          <div className="canvas-editor-context-items">
            {contexts.map((context, index) => (
              <div className="canvas-editor-context-item" key={context.id}>
                <span>{index + 1}</span>
                <b>{context.type === "prompt" ? "Agent" : context.data.kind === "video" ? "视频生成器" : "图片生成器"}</b>
                <small>{String(context.data.text || context.data.prompt || "上下文")}</small>
              </div>
            ))}
          </div>
        </div>
      )}
      {isVideoTarget && videoParams?.inputMode !== "reference" && videoParams?.inputMode !== "text" ? (
        <div className="canvas-editor-frame-slots">
          {renderSlot("首帧", "first-frame", videoInputs?.firstFrame)}
          {videoParams?.inputMode === "frames" && renderSlot("尾帧", "last-frame", videoInputs?.lastFrame)}
        </div>
      ) : (
        <div className="canvas-editor-reference-slot" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event)}>
          <span className="canvas-editor-slot-label">{target.type === "prompt" ? "上下文与参考" : "参考图"} <small>按编号提交</small></span>
          <div className="canvas-editor-reference-items">
            {(isVideoTarget ? videoInputs?.referenceImages || [] : references).map((reference, index) => renderItem(reference, index))}
            {!references.length && <small className="canvas-editor-reference-empty">拖入节点，或点击添加本地素材</small>}
          </div>
        </div>
      )}
      {isVideoTarget && connectedVideo && <div className="canvas-editor-video-input">视频输入：{connectedVideo.data.name || "已连接参考视频"}</div>}
      {isVideoTarget && unusedImages.length > 0 && (
        <div className="canvas-editor-unused-inputs">
          <span className="canvas-editor-slot-label">本次未使用 <small>切换生成方式或移除连线后可重新使用</small></span>
          <div className="canvas-editor-reference-items">{unusedImages.map((reference, index) => renderItem(reference, references.findIndex((item) => item.id === reference.id), "unused-item"))}</div>
        </div>
      )}
      <input ref={inputRef} hidden type="file" multiple accept={target.data.kind === "image" ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,video/mp4,video/webm"} onChange={(event) => { if (event.target.files) onAddFiles(target.id, [...event.target.files]); event.currentTarget.value = ""; }} />
    </div>
  );
}

function CanvasUpscaleSettingsPanel({
  params,
  runtime,
  sourceUrl,
  portalZIndex = CANVAS_Z_INDEX.modalPopover,
  onChange,
}: {
  params: CanvasUpscaleParams;
  runtime: CanvasRuntimeState | null;
  sourceUrl?: string;
  portalZIndex?: number;
  onChange: (params: CanvasUpscaleParams) => void;
}) {
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [sourceSizeError, setSourceSizeError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSourceSize(null);
    setSourceSizeError(false);
    if (!sourceUrl) return () => { cancelled = true; };
    void loadImageDimensions(sourceUrl)
      .then((size) => { if (!cancelled) setSourceSize(size); })
      .catch(() => { if (!cancelled) setSourceSizeError(true); });
    return () => { cancelled = true; };
  }, [sourceUrl]);
  const legacyModels = (runtime?.models || []).filter((model) => model.enabled && model.published && (model.capabilities || []).includes("upscale"));
  const cloudModels = runtime?.upscaleModels || [];
  const models = [
    ...legacyModels,
    ...cloudModels.filter((model) => !legacyModels.some((legacy) => legacy.id === model.id)),
  ];
  const selectedModelRecord = params.model !== "auto"
    ? models.find((model) => model.id === params.model)
    : cloudModels.find((model) => model.connected && model.id === "tencent-super-resolution")
      || cloudModels.find((model) => model.connected && model.id === "aliyun-standard-super-resolution")
      || legacyModels[0];
  const selectedCloudModel = selectedModelRecord && "provider" in selectedModelRecord ? selectedModelRecord : null;
  const isCloudModel = selectedCloudModel?.provider === "tencent-ci" || selectedCloudModel?.provider === "aliyun-viapi";
  const supportedScales = selectedCloudModel?.scales || [1, 2, 3, 4] as const;
  const selectedOutputQuality = selectedCloudModel?.outputQuality;
  const target = sourceSize ? isCloudModel
    ? { width: Math.max(1, Math.round(sourceSize.width * params.scale)), height: Math.max(1, Math.round(sourceSize.height * params.scale)) }
    : seedVrTargetSize(sourceSize.width, sourceSize.height, params.scale, params.target) : null;
  const modelOptions = [
    {
      value: "auto",
      label: "自动选择",
      description: "使用默认厂商，失败时自动回退",
    },
    ...models.map((model) => ({
      value: model.id,
      label: model.displayName,
      description: `${model.providerName} · ${model.rawId}`,
    })),
  ];
  const colorCorrectionOptions: Array<{
    value: CanvasUpscaleParams["colorCorrection"];
    label: string;
  }> = [
    { value: "wavelet", label: "wavelet · 接近原图" },
    { value: "none", label: "关闭" },
  ];
  const algorithmOptions: Array<{
    value: CanvasUpscaleParams["algorithm"];
    label: string;
  }> = [
    { value: "lanczos", label: "lanczos · 锐利" },
    { value: "bicubic", label: "bicubic · 平滑" },
    { value: "nearest", label: "nearest · 像素" },
  ];
  return (
    <div className="canvas-upscale-settings" aria-label="超分设置">
      <div className="canvas-upscale-setting-row">
        <div className="canvas-upscale-field">
          <div className="canvas-upscale-field-label"><strong>模型</strong></div>
          <SelectMenu
            value={params.model}
            portalZIndex={portalZIndex}
            onChange={(value) => {
              const next = models.find((model) => model.id === value);
              const nextCloud = next && "provider" in next ? next : null;
              const nextScales = nextCloud?.scales || [1, 2, 3, 4] as const;
              onChange({
                ...params,
                model: value,
                scale: nextScales.includes(params.scale) ? params.scale : nextScales.includes(2) ? 2 : nextScales[0],
                ...(nextCloud?.outputFormats?.includes(params.outputFormat || "png") ? {} : { outputFormat: nextCloud?.outputFormats?.[0] || "png" }),
              });
            }}
            ariaLabel="模型"
            className="canvas-upscale-select"
            menuClassName="canvas-upscale-select-popover"
            options={modelOptions}
          />
        </div>
        <div className="canvas-upscale-field">
          <div className="canvas-upscale-field-label"><strong>放大倍率</strong></div>
          <div className="canvas-upscale-scale-options">{supportedScales.map((scale) => <button key={scale} type="button" className={params.scale === scale ? "active" : ""} aria-pressed={params.scale === scale} aria-label={`${scale}×`} onClick={() => onChange({ ...params, scale: scale as CanvasUpscaleParams["scale"] })}>{scale}×</button>)}</div>
        </div>
      </div>
      <div className="canvas-upscale-size-readout"><span><small>原图</small><strong>{sourceSize ? `${sourceSize.width}×${sourceSize.height}` : sourceSizeError ? "读取失败" : "读取中…"}</strong></span><b>→</b><span><small>{isCloudModel ? "输出" : "目标"}</small><strong>{target ? `${target.width}×${target.height}` : sourceSizeError ? "无法计算" : "计算中…"}</strong></span></div>
      {!isCloudModel && <div className="canvas-upscale-setting-row">
        <label className="canvas-upscale-field"><span className="canvas-upscale-field-label"><strong>随机种子</strong></span><input type="number" min={0} value={params.seed} aria-label="随机种子" onChange={(event) => onChange({ ...params, seed: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
        <div className="canvas-upscale-field">
          <div className="canvas-upscale-field-label"><strong>颜色校正</strong></div>
          <SelectMenu
            value={params.colorCorrection}
            portalZIndex={portalZIndex}
            onChange={(value) => onChange({ ...params, colorCorrection: value })}
            ariaLabel="颜色校正"
            className="canvas-upscale-select"
            menuClassName="canvas-upscale-select-popover"
            options={[...colorCorrectionOptions]}
          />
        </div>
      </div>}
      {!isCloudModel && <div className="canvas-upscale-setting-row">
        <div className="canvas-upscale-field">
          <div className="canvas-upscale-field-label"><strong>缩放算法</strong></div>
          <SelectMenu
            value={params.algorithm}
            portalZIndex={portalZIndex}
            onChange={(value) => onChange({ ...params, algorithm: value })}
            ariaLabel="缩放算法"
            className="canvas-upscale-select"
            menuClassName="canvas-upscale-select-popover"
            options={[...algorithmOptions]}
          />
        </div>
        <label className="canvas-upscale-field"><span className="canvas-upscale-field-label"><strong>可选说明</strong></span><input value={params.prompt || ""} aria-label="可选说明" placeholder="SeedVR2 超分不会根据提示词修改画面…" onChange={(event) => onChange({ ...params, prompt: event.target.value })} /></label>
      </div>}
      {isCloudModel && selectedCloudModel?.outputFormats && <div className="canvas-upscale-setting-row">
        <div className="canvas-upscale-field">
          <div className="canvas-upscale-field-label"><strong>输出格式</strong></div>
          <SelectMenu
            value={params.outputFormat || selectedCloudModel.outputFormats[0]}
            portalZIndex={portalZIndex}
            onChange={(value) => onChange({ ...params, outputFormat: value as CanvasUpscaleParams["outputFormat"] })}
            ariaLabel="输出格式"
            className="canvas-upscale-select"
            menuClassName="canvas-upscale-select-popover"
            options={selectedCloudModel.outputFormats.map((value) => ({ value, label: value.toUpperCase() }))}
          />
        </div>
        {selectedOutputQuality && (params.outputFormat || selectedCloudModel.outputFormats[0]) === "jpg" && <label className="canvas-upscale-field"><span className="canvas-upscale-field-label"><strong>JPG 质量</strong></span><input type="number" min={selectedOutputQuality.min} max={selectedOutputQuality.max} value={params.outputQuality || selectedOutputQuality.default} aria-label="JPG 质量" onChange={(event) => onChange({ ...params, outputQuality: Math.max(selectedOutputQuality.min, Math.min(selectedOutputQuality.max, Math.round(Number(event.target.value) || selectedOutputQuality.default))) })} /></label>}
      </div>}
      {isCloudModel && <small className="canvas-upscale-model-note">{selectedCloudModel?.provider === "tencent-ci" ? "腾讯云官方参数：仅支持 1×、2×、4×，不提供种子、颜色校正或缩放算法。" : selectedCloudModel?.generative ? "阿里云生成式超分：会重新生成部分细节，可能改变原图内容；任务将在后台处理。" : "阿里云标准超分：可选择输出格式，JPG 可调整质量。"}</small>}
      {!sourceUrl && <small className="canvas-upscale-empty-hint">请连接一张已完成的图片后再提交</small>}
    </div>
  );
}

type CanvasNodeEditorPopoverProps = {
  node: CanvasNode;
  document: CanvasDocument;
  stageRef: RefObject<HTMLDivElement | null>;
  runtime: CanvasRuntimeState | null;
  editorPrompt: string;
  editorParams?: CanvasGenerationParams;
  maskState?: CanvasMaskState;
  onMaskEdit?: () => void;
  onMaskRemove?: () => void;
  onToggleEditor: (node: CanvasNode) => void;
  onGenerate: (node: CanvasNode) => void;
  onEditorPromptChange: (node: CanvasNode, value: string) => void;
  onEditorParamsChange: (node: CanvasNode, settings: CreationSettings) => void;
  onVariantRequirementsChange: (node: CanvasNode, value: string) => void;
  onReferenceReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onReferenceRemove: (ownerId: string, sourceId: string) => void;
  onReferenceDrop: (ownerId: string, sourceId: string, role: CanvasInputRole) => void;
  onAddReferenceFiles: (ownerId: string, files: File[]) => void;
  branchDraft?: CanvasReuseDraft | null;
  onDraftReferenceFiles?: (files: File[]) => void;
  onDraftReferenceRemove?: (id: string) => void;
  onDraftReferenceReorder?: (from: number, to: number) => void;
  onDraftReferenceNodeDrop?: (nodeId: string) => void;
  onDraftReferencePreview?: (reference: CanvasReferenceDraft) => void;
  onDraftReferencePaste?: () => void;
  editorContexts: CanvasNode[];
  mentionCandidates: CanvasNode[];
  onOutputPreview: (node: CanvasNode) => void;
  upscaleParams?: CanvasUpscaleParams;
  upscaleSourceUrl?: string;
  onUpscaleParamsChange?: (params: CanvasUpscaleParams) => void;
};

type CanvasQuickAction = {
  id: string;
  icon: string;
  label: string;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

type CanvasContextMenuGroup = {
  label: string;
  actions: CanvasQuickAction[];
};

function CanvasNodeQuickToolbar({
  node,
  document,
  stageRef,
  actions,
}: {
  node: CanvasNode;
  document: CanvasDocument;
  stageRef: RefObject<HTMLDivElement | null>;
  actions: CanvasQuickAction[];
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 10, top: 10 });
  const [isCompact, setIsCompact] = useState(false);

  const reposition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const nodeElement = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-canvas-node-id]"),
    ).find((element) => element.dataset.canvasNodeId === node.id);
    const nodeRect = nodeElement?.getBoundingClientRect();
    const zoom = Math.max(0.12, document.camera.zoom || 1);
    const anchor = nodeRect
      ? {
          left: nodeRect.left - stageRect.left,
          top: nodeRect.top - stageRect.top,
          width: nodeRect.width,
          height: nodeRect.height,
        }
      : {
          left: node.x * zoom + document.camera.x,
          top: node.y * zoom + document.camera.y,
          width: nodeSize(node).w * zoom,
          height: nodeSize(node).h * zoom,
        };
    const stageSize = {
      width: Math.max(1, stage.clientWidth),
      height: Math.max(1, stage.clientHeight),
    };
    const compact = stageSize.width < 760 || zoom < 0.58;
    if (compact !== isCompact) setIsCompact(compact);
    const overlay = {
      width: toolbarRef.current?.offsetWidth || (compact ? 280 : 520),
      height: toolbarRef.current?.offsetHeight || 40,
    };
    setPosition(placeCanvasNodeToolbar(anchor, stageSize, overlay, 10));
  }, [document.camera.x, document.camera.y, document.camera.zoom, isCompact, node, stageRef]);

  useLayoutEffect(() => {
    reposition();
    let frame = 0;
    const handleResize = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reposition);
    };
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(handleResize)
      : null;
    if (observer) {
      if (toolbarRef.current) observer.observe(toolbarRef.current);
      if (stageRef.current) observer.observe(stageRef.current);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [reposition, stageRef]);

  return (
    <div
      ref={toolbarRef}
      className="canvas-node-quick-toolbar"
      data-density={isCompact ? "compact" : "comfortable"}
      data-node-id={node.id}
      aria-label={`${nodeLabel(node)}快捷工具`}
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <span className="canvas-node-quick-title">
        <i aria-hidden="true">{node.type === "upscale" ? "↗" : node.type === "prompt" ? "✦" : node.type === "generator" ? "⌁" : node.data.kind === "video" ? "▶" : "▣"}</i>
        <b>{nodeLabel(node)}</b>
      </span>
      <span className="canvas-node-quick-divider" aria-hidden="true" />
      <div className="canvas-node-quick-actions">
        {actions.map((action) => (
          <button
            type="button"
            key={action.id}
            className={action.danger ? "danger" : ""}
            data-action-id={action.id}
            title={action.title || action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={(event) => {
              event.stopPropagation();
              action.onClick();
            }}
          >
            <span aria-hidden="true">{action.icon}</span>
            <em>{action.label}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function maskParamsWithoutMask(value: unknown, runtime: CanvasRuntimeState | null) {
  const params = copyParams(value, "image", runtime) as ImageCreationSettings;
  const { mask: _mask, ...withoutMask } = params;
  return withoutMask as ImageCreationSettings;
}

function maskStateForNode(node: CanvasNode) {
  if (node.type !== "media" || node.data.kind !== "image") return undefined;
  const legacyMask =
    canvasMaskStateFromParams(node.data.generation?.params) ||
    canvasMaskStateFromParams(node.data.params);
  return normalizeCanvasMaskState(node.data.mask, legacyMask);
}

function CanvasContextMenuFrame({
  position,
  className,
  ariaLabel,
  dataNodeId,
  children,
}: {
  position: { x: number; y: number };
  className?: string;
  ariaLabel: string;
  dataNodeId?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState({
    left: position.x + 10,
    top: position.y + 10,
  });
  const [measured, setMeasured] = useState(false);

  const reposition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, window.visualViewport?.width || window.innerWidth),
      height: Math.max(1, window.visualViewport?.height || window.innerHeight),
    };
    const next = placeCanvasContextMenu(
      { left: position.x, top: position.y },
      viewport,
      { width: rect.width, height: rect.height },
    );
    setPlacement((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
    setMeasured(true);
  }, [position.x, position.y]);

  useLayoutEffect(() => {
    setMeasured(false);
    reposition();
    let frame = 0;
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        reposition();
      });
    };
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedule)
      : null;
    if (observer && menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", schedule);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", schedule);
    visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      visualViewport?.removeEventListener("resize", schedule);
      visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [reposition]);

  const menu = (
    <div
      ref={menuRef}
      className={`canvas-context-menu${className ? ` ${className}` : ""}`}
      data-node-id={dataNodeId}
      role="menu"
      aria-label={ariaLabel}
      style={{
        left: placement.left,
        top: placement.top,
        visibility: measured ? "visible" : "hidden",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
  // Keep the menu inside the canvas React tree. This is still a fixed,
  // screen-space layer, but avoids losing synthetic events when the Next.js
  // app is mounted directly on body and the menu is portaled to body.
  return menu;
}

function CanvasNodeContextMenu({
  node,
  selectionCount,
  groups,
  position,
}: {
  node: CanvasNode;
  selectionCount: number;
  groups: CanvasContextMenuGroup[];
  position: { x: number; y: number };
}) {
  return (
    <CanvasContextMenuFrame
      className="canvas-node-context-menu"
      dataNodeId={node.id}
      ariaLabel={`${nodeLabel(node)}右键菜单`}
      position={position}
    >
      <div className="canvas-menu-title">
        <span>{nodeLabel(node)}</span>
        <small>{selectionCount > 1 ? `已选择 ${selectionCount} 个对象` : "节点操作"}</small>
      </div>
      <div className="canvas-context-menu-body">
        {groups.map((group) => (
          <div className="canvas-menu-group" key={group.label}>
            <div className="canvas-menu-group-title">
              <span className="canvas-menu-group-mark" aria-hidden="true">⌘</span>
              <span>
                <b>{group.label}</b>
                <small>快捷操作</small>
              </span>
            </div>
            {group.actions.map((action) => (
              <button
                type="button"
                role="menuitem"
                key={action.id}
                className={`canvas-menu-item canvas-menu-item-context ${action.danger ? "danger" : ""}`}
                title={action.title || action.label}
                aria-label={action.label}
                disabled={action.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
              >
                <span className="canvas-menu-icon" aria-hidden="true">{action.icon}</span>
                <span className="canvas-menu-copy"><b>{action.label}</b></span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </CanvasContextMenuFrame>
  );
}

function CanvasNodeEditorPopover({
  node,
  document,
  stageRef,
  runtime,
  editorPrompt,
  editorParams,
  maskState,
  onMaskEdit,
  onMaskRemove,
  onToggleEditor,
  onGenerate,
  onEditorPromptChange,
  onEditorParamsChange,
  onVariantRequirementsChange,
  onReferenceReorder,
  onReferenceRemove,
  onReferenceDrop,
  onAddReferenceFiles,
  branchDraft,
  onDraftReferenceFiles,
  onDraftReferenceRemove,
  onDraftReferenceReorder,
  onDraftReferenceNodeDrop,
  onDraftReferencePreview,
  onDraftReferencePaste,
  editorContexts,
  mentionCandidates,
  onOutputPreview,
  upscaleParams,
  upscaleSourceUrl,
  onUpscaleParamsChange,
}: CanvasNodeEditorPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [position, setPosition] = useState({ left: 18, top: 86, maxHeight: 580 });
  const [isCompact, setIsCompact] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [mentionState, setMentionState] = useState<MentionState>(null);
  const data = node.data;
  const size = nodeSize(node);
  const pending = data.status === "queued" || data.status === "running";
  const upscaleMissingInput = node.type === "upscale" && !upscaleSourceUrl;
  const editorReferences = incomingReferences(document, node.id);
  const branchReferences = branchDraft?.references || [];
  const variantRequirements = node.type === "generator" ? variantRequirementsFor(node) : [];
  const visibleMentionCandidates = mentionCandidates.filter((item, index) => {
    if (item.id === node.id) return false;
    if (!mentionState?.query) return true;
    const query = mentionState.query.trim().toLowerCase();
    if (/^\d+$/.test(query)) return String(index + 1).startsWith(query);
    return [
      mentionLabel(item, index),
      nodeLabel(item),
      item.data.name,
      item.data.text,
      item.data.prompt,
      item.data.agentPrompt,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  useEffect(() => {
    setPromptExpanded(false);
    setMentionState(null);
  }, [node.id]);

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    const syncPromptHeight = () => {
      const mobile = window.matchMedia("(max-width: 720px)").matches;
      const minHeight = promptExpanded ? (mobile ? 180 : 220) : (mobile ? 104 : 120);
      const maxHeight = promptExpanded ? (mobile ? 360 : 460) : (mobile ? 220 : 260);
      textarea.style.height = "auto";
      const contentHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(maxHeight, Math.max(minHeight, contentHeight))}px`;
      textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
    };
    syncPromptHeight();
    const frame = window.requestAnimationFrame(syncPromptHeight);
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(syncPromptHeight)
      : null;
    if (observer) observer.observe(textarea.parentElement || textarea);
    window.addEventListener("resize", syncPromptHeight);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", syncPromptHeight);
    };
  }, [editorPrompt, isCompact, node.id, promptExpanded]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mentionState) {
        event.preventDefault();
        event.stopPropagation();
        setMentionState(null);
        return;
      }
      if (promptExpanded) {
        event.preventDefault();
        event.stopPropagation();
        setPromptExpanded(false);
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [mentionState, promptExpanded]);

  const reposition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const zoom = Math.max(0.12, document.camera.zoom || 1);
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const nextCompact = stageWidth < 960 || zoom < 0.58;
    const microEditor = zoom < 0.35;
    if (nextCompact !== isCompact) setIsCompact(nextCompact);
    const popoverWidth = popoverRef.current?.offsetWidth || (microEditor ? 360 : nextCompact ? 510 : 640);
    // Use the density's preferred height instead of the currently rendered
    // height. A previously constrained panel can then grow again after the
    // node is panned upward or the viewport becomes taller.
    const popoverHeight = microEditor ? 400 : nextCompact ? 520 : 580;
    const stageRect = stage.getBoundingClientRect();
    const nodeElement = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-canvas-node-id]"),
    ).find((element) => element.dataset.canvasNodeId === node.id);
    const nodeRect = nodeElement?.getBoundingClientRect();
    const anchor = nodeRect
      ? {
          left: nodeRect.left - stageRect.left,
          top: nodeRect.top - stageRect.top,
          width: nodeRect.width,
          height: nodeRect.height,
        }
      : {
          left: node.x * zoom + document.camera.x,
          top: node.y * zoom + document.camera.y,
          width: size.w * zoom,
          height: size.h * zoom,
        };
    const position = fitCanvasNodeEditorBelow(
      anchor,
      { width: stageWidth, height: stageHeight },
      { width: popoverWidth, height: popoverHeight },
      14,
      12,
    );
    setPosition(position);
  }, [document.camera.x, document.camera.y, document.camera.zoom, isCompact, node.x, node.y, promptExpanded, size.h, size.w, stageRef]);

  useLayoutEffect(() => {
    reposition();
    let frame = 0;
    const handleResize = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reposition);
    };
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(handleResize)
      : null;
    if (observer) {
      if (popoverRef.current) observer.observe(popoverRef.current);
      if (stageRef.current) observer.observe(stageRef.current);
      const nodeElement = Array.from(
        stageRef.current?.querySelectorAll<HTMLElement>("[data-canvas-node-id]") || [],
      ).find((element) => element.dataset.canvasNodeId === node.id);
      if (nodeElement) observer.observe(nodeElement);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [reposition]);

  return (
    <div
      ref={popoverRef}
      className={`canvas-node-editor-popover canvas-node-editor-dock${promptExpanded ? " is-prompt-expanded" : ""}`}
      data-placement="bottom"
      data-density={document.camera.zoom < 0.35 ? "micro" : isCompact ? "compact" : "comfortable"}
      data-node-kind={node.type === "prompt" ? "agent" : node.type === "upscale" ? "upscale" : data.kind === "video" ? "video" : "image"}
      data-prompt-expanded={promptExpanded ? "true" : "false"}
      data-node-id={node.id}
      aria-label={`${nodeLabel(node)}编辑器`}
      style={{
        left: position.left,
        top: position.top,
        maxHeight: promptExpanded ? undefined : position.maxHeight,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="canvas-node-editor-head">
        <div className="canvas-node-editor-identity">
          <span className="canvas-node-editor-status-dot" aria-hidden="true" />
          <div>
            <b>{nodeLabel(node)}</b>
            <small>{promptExpanded ? "文本编辑 · 专注输入" : node.type === "prompt" ? "Agent 节点" : data.kind === "video" ? "视频节点" : "图片节点"} · 节点内编辑</small>
          </div>
        </div>
        <div className="canvas-node-editor-head-actions">
          <span>编辑中</span>
          <button
            type="button"
            className="canvas-node-editor-expand"
            title={promptExpanded ? "收回编辑" : "放大编辑"}
            aria-label={promptExpanded ? "收回编辑" : "放大编辑"}
            aria-expanded={promptExpanded}
            onClick={(event) => {
              event.stopPropagation();
              setPromptExpanded((value) => !value);
            }}
          >
            <span aria-hidden="true">{promptExpanded ? "⤡" : "⤢"}</span>
          </button>
          <button
            type="button"
            className={node.type === "upscale" && pending ? "canvas-node-editor-collapse" : undefined}
            title={node.type === "upscale" && pending ? "收起超分面板" : "关闭节点参数"}
            onClick={() => onToggleEditor(node)}
            aria-label={node.type === "upscale" && pending ? "收起超分面板" : "关闭节点参数"}
          >×</button>
        </div>
      </div>
      <div className="canvas-node-editor-body">
        <div className="canvas-node-editor-columns">
          <div className="canvas-node-editor-copy">
            <div className="canvas-node-editor-prompt-wrap">
              <div className="canvas-node-editor-prompt-label">
                <span>{node.type === "prompt" ? "Agent 任务" : "提示词"}</span>
                <small>@ 引用节点 · {node.type === "prompt" ? "Enter 发送" : "Ctrl/Cmd + Enter 生成"}</small>
              </div>
              <textarea
                ref={promptRef}
                aria-label={`${nodeLabel(node)}提示词`}
                value={editorPrompt}
                placeholder={node.type === "prompt" ? "输入 Agent 任务… 输入 @ 引用节点" : data.kind === "video" ? "描述动作、镜头和声音… 输入 @ 引用节点" : "描述想生成的画面… 输入 @ 引用节点"}
                onChange={(event) => {
                  const value = event.target.value;
                  onEditorPromptChange(node, value);
                  setMentionState(mentionStateForValue(value, event.target.selectionStart));
                }}
                onClick={(event) => setMentionState(mentionStateForValue(event.currentTarget.value, event.currentTarget.selectionStart))}
                onKeyUp={(event) => setMentionState(mentionStateForValue(event.currentTarget.value, event.currentTarget.selectionStart))}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setMentionState(null);
                  if (event.key === "Enter" && (node.type === "prompt" ? !event.shiftKey : (event.ctrlKey || event.metaKey))) {
                    event.preventDefault();
                    onGenerate(node);
                  }
                }}
                rows={3}
              />
              {mentionState && visibleMentionCandidates.length > 0 && (
                <div className="canvas-node-mention-menu">
                  {visibleMentionCandidates.slice(0, 12).map((candidate) => {
                    const candidateIndex = mentionCandidates.findIndex((item) => item.id === candidate.id);
                    return (
                      <button
                        type="button"
                        key={candidate.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          const next = `${editorPrompt.slice(0, mentionState.start)}@${candidateIndex + 1} ${editorPrompt.slice(mentionState.end)}`;
                          onEditorPromptChange(node, next);
                          const role: CanvasInputRole = candidate.type === "prompt" || candidate.type === "generator"
                            ? "context"
                            : candidate.data.kind === "video"
                              ? node.type === "prompt" || node.data.kind === "video" ? "video" : "reference-image"
                              : "reference-image";
                          onReferenceDrop(node.id, candidate.id, role);
                          setMentionState(null);
                        }}
                      >
                        <strong>@{candidateIndex + 1}</strong>
                        <span className="canvas-node-mention-preview">
                          {candidate.type === "prompt" || candidate.type === "generator" ? <i>{candidate.type === "generator" && candidate.data.kind === "video" ? "▶" : "✦"}</i> : candidate.data.kind === "video" ? <video src={candidate.data.url} muted playsInline /> : <img src={candidate.data.url} alt="" />}
                        </span>
                        <span className="canvas-node-mention-copy"><b>{nodeLabel(candidate)}</b><small>{candidate.type === "prompt" || candidate.type === "generator" ? "文本上下文" : candidate.data.kind === "video" ? "视频引用" : "图片参考"}</small></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {node.type === "media" && node.data.kind === "image" && node.data.url && onMaskEdit && maskState && (
              <CanvasMaskSummary
                mask={maskState}
                onEdit={onMaskEdit}
                onRemove={onMaskRemove}
              />
            )}
            {branchDraft ? (
              <CanvasReferenceDraftStrip
                references={branchReferences}
                onFiles={onDraftReferenceFiles || (() => undefined)}
                onRemove={onDraftReferenceRemove || (() => undefined)}
                onReorder={onDraftReferenceReorder || (() => undefined)}
                onNodeDrop={onDraftReferenceNodeDrop}
                onPaste={onDraftReferencePaste}
                onPreview={onDraftReferencePreview}
                emptyLabel="添加画布参考"
              />
            ) : node.type === "upscale" ? (
              <div className="canvas-upscale-input-note">输入：{upscaleSourceUrl ? "已连接一张图片" : "未连接图片"}</div>
            ) : (
              <CanvasNodeReferenceStrip
                target={node}
                document={document}
                runtime={runtime}
                references={editorReferences}
                contexts={editorContexts}
                onReorder={onReferenceReorder}
                onRemove={onReferenceRemove}
                onDrop={onReferenceDrop}
                onAddFiles={onAddReferenceFiles}
                onPreview={onOutputPreview}
              />
            )}
          </div>
          <div className="canvas-node-editor-settings">
            {node.type === "generator" && (
              <div className="canvas-node-variant-editor">
                <label>变体要求 <small>每行一条，最多 8 条</small></label>
                <textarea
                  rows={2}
                  value={data.variantRequirementsText ?? variantRequirements.join("\n")}
                  placeholder="改成夜景\n改为俯拍视角"
                  onChange={(event) => onVariantRequirementsChange(node, event.target.value)}
                />
              </div>
            )}
            {node.type === "upscale" && upscaleParams && onUpscaleParamsChange ? (
              <CanvasUpscaleSettingsPanel params={upscaleParams} runtime={runtime} sourceUrl={upscaleSourceUrl} onChange={onUpscaleParamsChange} />
            ) : editorParams && (
              <CreationParameterEditor
                key={node.id}
                settings={editorParams}
                runtime={runtime}
                referenceCount={branchDraft ? branchReferences.length : editorReferences.length}
                variant="canvas-flat"
                portalZIndex={CANVAS_Z_INDEX.modalPopover}
                dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
                onChange={(settings) => onEditorParamsChange(node, settings)}
              />
            )}
          </div>
        </div>
      </div>
      <div className="canvas-node-editor-actions">
        <span>{node.type === "upscale" ? "连接图片后提交超分" : node.type === "prompt" ? "Enter 发送 · Shift + Enter 换行" : node.type === "media" && data.kind === "image" && data.url ? "当前图片作参考 · 右侧生成新图" : "Ctrl/Cmd + Enter 生成"}</span>
        <button type="button" className="canvas-node-editor-generate" title={upscaleMissingInput ? "请连接一张已完成的图片" : undefined} disabled={pending || upscaleMissingInput} onClick={() => onGenerate(node)}>{pending ? "处理中…" : node.type === "upscale" ? "提交超分" : node.type === "prompt" ? "发送" : node.type === "media" && data.kind === "image" && data.url ? "生成新图" : "生成"}</button>
      </div>
    </div>
  );
}

function CanvasMaskSummary({
  mask,
  onEdit,
  onRemove,
}: {
  mask: CanvasMaskState;
  onEdit: () => void;
  onRemove?: () => void;
}) {
  const coverage = typeof mask.coverage === "number"
    ? `覆盖 ${Math.round(mask.coverage * 100)}%`
    : "覆盖范围待计算";
  return (
    <div className={`canvas-mask-summary ${mask.status}`} data-canvas-wheel-isolate>
      <button type="button" className="canvas-mask-summary-preview" onClick={onEdit} title="查看红色蒙版区域并重新绘制">
        <span className="canvas-mask-thumb"><img src={mask.url} alt="蒙版缩略图" /></span>
        <span>
          <b>蒙版 · {canvasMaskStatusLabel(mask.status)}</b>
          <small>{coverage}{mask.error ? ` · ${mask.error}` : ""}</small>
        </span>
      </button>
      <div className="canvas-mask-summary-actions">
        <button type="button" onClick={onEdit}>{mask.status === "used" ? "再次使用" : "查看 / 重绘"}</button>
        {onRemove && <button type="button" className="danger" onClick={onRemove}>移除</button>}
      </div>
    </div>
  );
}

function CanvasNodeCard({
  node,
  selected,
  dragging,
  document,
  onPointerDown,
  onResize,
  onConnect,
  onSelect,
  onRemoveFromGroup,
  onPreview,
  onTextPreview,
  onMaskEdit,
  onUseAsImagePrompt,
  onRetryVariant,
  onRetryFailedVariants,
  onNaturalSize,
  onPromptChange,
  onEditorPromptChange,
  onEditorParamsChange,
  onVariantRequirementsChange,
  runtime,
  editorPrompt,
  editorParams,
  expanded,
  onToggleEditor,
  onGenerate,
  onReferenceReorder,
  onReferenceRemove,
  onReferenceDrop,
  onAddReferenceFiles,
  editorContexts,
  mentionCandidates,
  onOutputPreview,
  editing,
  onEdit,
}: {
  node: CanvasNode;
  selected: boolean;
  dragging: boolean;
  document: CanvasDocument;
  onPointerDown: (event: ReactPointerEvent, node: CanvasNode) => void;
  onResize: (event: ReactPointerEvent, node: CanvasNode) => void;
  onConnect: (
    event: ReactPointerEvent,
    nodeId: string,
    port: "left" | "right",
  ) => void;
  onSelect: (event: ReactPointerEvent) => void;
  onRemoveFromGroup: () => void;
  onPreview: () => void;
  onTextPreview: () => void;
  onMaskEdit: () => void;
  onUseAsImagePrompt: () => void;
  onRetryVariant: (variantIndex: number) => void;
  onRetryFailedVariants: () => void;
  onNaturalSize: (
    nodeId: string,
    width: number,
    height: number,
    durationSeconds?: number,
  ) => void;
  onPromptChange: (value: string) => void;
  onEditorPromptChange: (node: CanvasNode, value: string) => void;
  onEditorParamsChange: (node: CanvasNode, settings: CreationSettings) => void;
  onVariantRequirementsChange: (node: CanvasNode, value: string) => void;
  runtime: CanvasRuntimeState | null;
  editorPrompt: string;
  editorParams?: CanvasGenerationParams;
  expanded: boolean;
  onToggleEditor: (node: CanvasNode) => void;
  onGenerate: (node: CanvasNode) => void;
  onReferenceReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onReferenceRemove: (ownerId: string, sourceId: string) => void;
  onReferenceDrop: (ownerId: string, sourceId: string, role: CanvasInputRole) => void;
  onAddReferenceFiles: (ownerId: string, files: File[]) => void;
  editorContexts: CanvasNode[];
  mentionCandidates: CanvasNode[];
  onOutputPreview: (node: CanvasNode) => void;
  editing: boolean;
  onEdit: (value: boolean) => void;
}) {
  const size = nodeSize(node);
  const data = node.data;
  const colorKey = canvasNodeColorKey(node);
  const status = data.status || "idle";
  const pending = data.status === "queued" || data.status === "running";
  const imageResolution =
    ((node.type === "media" && data.kind === "image") || node.type === "upscale") &&
    Boolean(data.url) &&
    !pending &&
    data.status !== "failed" &&
    Number(data.nativeWidth) > 0 &&
    Number(data.nativeHeight) > 0
      ? `${Math.round(Number(data.nativeWidth))} × ${Math.round(Number(data.nativeHeight))}`
      : null;
  const hasUpscaleResult = node.type === "upscale" && Boolean(data.url);
  const failed = data.status === "failed" && !data.url;
  const videoDuration =
    node.type === "media" && data.kind === "video" && data.url
      ? formatCanvasVideoDuration(data.durationMs)
      : "";
  const videoResolution =
    node.type === "media" &&
    data.kind === "video" &&
    Boolean(data.url) &&
    !pending &&
    data.status !== "failed" &&
    Number(data.nativeWidth) > 0 &&
    Number(data.nativeHeight) > 0
      ? `${Math.round(Number(data.nativeWidth))} × ${Math.round(Number(data.nativeHeight))}`
      : null;
  const maskState = maskStateForNode(node);
  const agentResponse =
    node.type === "prompt" &&
    (data.agentResponse || String(data.role || "").includes("回复"))
      ? String(data.agentResponse || data.text || "")
      : "";
  const agentInput = String(
    agentResponse ? data.agentPrompt || data.text || "" : data.text || "",
  );
  const variantRequirements =
    node.type === "generator" ? variantRequirementsFor(node) : [];
  const variantStates =
    node.type === "generator" ? variantStatesFor(node) : [];
  const processingProgress = progressValue(data.progress);
  const generatorProgress = variantStates.length
    ? progressValue(
        variantStates.reduce(
          (total, state) =>
            total +
            (state.status === "completed"
              ? 100
              : progressValue(state.progress) || 0),
          0,
        ) / variantStates.length,
      )
    : processingProgress;
  const processingLabel =
    data.status === "queued"
      ? data.statusLabel || "排队等待中"
      : data.statusLabel ||
        (node.type === "prompt"
          ? "Agent 正在思考"
          : node.type === "generator"
            ? "批量处理中"
            : `${data.kind === "video" ? "视频" : "图片"}生成中`);
  const processingKind: CanvasProcessingKind =
    node.type === "prompt"
      ? "agent"
      : node.type === "generator"
        ? "generator"
        : node.type === "upscale"
          ? "upscale"
          : data.kind === "video"
            ? "video"
            : "image";
  const mediaFooterStatus =
    node.type === "media" && data.kind === "video"
      ? pending
        ? processingLabel
        : data.status === "failed"
          ? "视频生成失败"
          : data.url
            ? data.generation
              ? "视频生成结果"
              : "视频素材"
            : "空视频节点"
      : nodeStatus(node);
  const completedVariants = variantStates.filter(
    (state) => state.status === "completed",
  ).length;
  const failedVariants = variantStates.filter(
    (state) => state.status === "failed",
  ).length;
  const imageParams =
    node.type === "generator" && data.kind === "image"
      ? (data.params as ImageCreationSettings | undefined)
      : undefined;
  const perVariantImageCount = Math.max(1, Number(imageParams?.count || 1));
  const estimatedResultCount =
    node.type === "generator" && data.kind === "image"
      ? variantRequirements.length * perVariantImageCount
      : 0;
  const referenceCount =
    node.type === "generator" ? incomingReferences(document, node.id).length : 0;
  const editorReferences = incomingReferences(document, node.id);
  const editorOutputs =
    node.type === "generator"
      ? document.nodes.filter(
          (item) => item.type === "media" && item.data.generation?.sourceGeneratorId === node.id,
        )
      : [];
  const [mentionState, setMentionState] = useState<MentionState>(null);
  const visibleMentionCandidates = mentionCandidates.filter((item, index) => {
    if (item.id === node.id) return false;
    if (!mentionState?.query) return true;
    const query = mentionState.query.trim().toLowerCase();
    // Numeric queries address the visible mention number directly. This keeps
    // “@2” deterministic instead of accidentally matching digits in a UUID.
    if (/^\d+$/.test(query)) return String(index + 1).startsWith(query);
    const search = [
      mentionLabel(item, index),
      nodeLabel(item),
      item.data.name,
      item.data.text,
      item.data.prompt,
      item.data.agentPrompt,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return search.includes(query);
  });
  return (
    <article
      className={`canvas-node node-color-${colorKey} status-${status} ${selected ? "selected" : ""}`}
      data-canvas-node-id={node.id}
      data-canvas-connectable-id={node.id}
      data-node-color={colorKey}
      data-node-kind={node.type === "upscale" ? "upscale" : node.type === "prompt" ? "agent" : data.kind === "video" ? "video" : "image"}
      aria-busy={pending}
      style={{
        left: node.x,
        top: node.y,
        width: size.w,
        height: size.h,
        zIndex: (typeof node.zIndex === "number" && Number.isFinite(node.zIndex) ? Math.trunc(node.zIndex) : CANVAS_Z_INDEX.node) +
          (dragging ? CANVAS_NODE_INTERACTION_OFFSET : 0),
      }}
      // Node movement and typed connections use the canvas pointer model.
      // Do not enable native HTML dragging on the whole card: it steals click
      // events from the editor controls and makes the card feel unresponsive.
      draggable={false}
      onDragStart={(event) => {
        if (!data.url && node.type !== "prompt") return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sanmao-canvas-node", node.id);
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onWheel={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (node.type === "prompt") onEdit(true);
        else if (isCanvasReferenceableNode(node)) onPreview();
        else onToggleEditor(node);
      }}
    >
      {node.groupId && (
        <button
          type="button"
          className="canvas-node-group-remove"
          aria-label="移出对象组"
          title="移出对象组"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveFromGroup();
          }}
        >
          出组
        </button>
      )}
      <button
        type="button"
        className="canvas-port left"
        aria-label="左侧连接端口"
        onPointerDown={(event) => onConnect(event, node.id, "left")}
      />
      {node.type === "media" && (
        <div className={`canvas-media-card${data.kind === "video" ? " video" : ""}`}>
          <div className="canvas-media-stage">
            {pending ? (
              <div className="canvas-media-state pending">
                <CanvasProcessingIndicator
                  label={processingLabel}
                  progress={processingProgress}
                  kind={processingKind}
                  startedAt={
                    data.processingStartedAt || data.generation?.createdAt
                  }
                  waiting={data.status === "queued"}
                  compact
                />
              </div>
            ) : failed ? (
              <div className="canvas-media-state failed">
                <span>!</span>
                <b>生成失败</b>
                <small>{data.statusLabel}</small>
              </div>
            ) : !data.url ? (
              <div className="canvas-media-state draft">
                <span>{data.kind === "video" ? "▶" : "▣"}</span>
                <b>{data.kind === "video" ? "空视频节点" : "空图片节点"}</b>
                <small>选中后在下方生成</small>
              </div>
            ) : data.kind === "video" ? (
              <video
                src={data.url}
                muted
                playsInline
                preload="metadata"
                draggable={false}
                aria-label={`视频预览${videoDuration ? `，时长 ${videoDuration}` : ""}`}
                onLoadedMetadata={(event) =>
                  onNaturalSize(
                    node.id,
                    event.currentTarget.videoWidth,
                    event.currentTarget.videoHeight,
                    event.currentTarget.duration,
                  )
                }
              />
            ) : (
              <img
                src={data.url}
                alt={data.name || "画布素材"}
                draggable={false}
                onLoad={(event) =>
                  onNaturalSize(
                    node.id,
                    event.currentTarget.naturalWidth,
                    event.currentTarget.naturalHeight,
                  )
                }
              />
            )}
            {data.kind === "video" && data.url && (
              <span
                className="canvas-video-mark"
                title={`视频${videoDuration ? ` · ${videoDuration}` : ""}`}
                aria-label={`视频${videoDuration ? `，时长 ${videoDuration}` : ""}`}
              >
                ▶ 视频{videoDuration ? ` · ${videoDuration}` : ""}
              </span>
            )}
            {imageResolution && (
              <span
                className="canvas-image-resolution"
                title={`图片分辨率 ${imageResolution}`}
                aria-label={`图片分辨率 ${imageResolution}`}
              >
                {imageResolution}
              </span>
            )}
            {videoResolution && (
              <span
                className="canvas-image-resolution canvas-video-resolution"
                title={`视频分辨率 ${videoResolution}`}
                aria-label={`视频分辨率 ${videoResolution}`}
              >
                {videoResolution}
              </span>
            )}
            {data.url && (
              <span
                className="canvas-node-asset-drag-handle"
                role="button"
                tabIndex={0}
                draggable
                aria-label="拖到资产中心归类"
                title="拖到资产中心归类"
                onPointerDown={(event) => event.stopPropagation()}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(
                    "application/x-sanmao-canvas-node",
                    node.id,
                  );
                }}
              >
                ↗
              </span>
            )}
            {data.url && data.maskApplied && (
              <span className="canvas-node-mask-badge used" title="本次生成请求使用了蒙版">
                ◌ 本次使用蒙版
              </span>
            )}
            {data.url && maskState && !data.maskApplied && (
              <button
                type="button"
                className={`canvas-node-mask-badge ${maskState.status}`}
                title={`蒙版 · ${canvasMaskStatusLabel(maskState.status)} · 点击查看或重绘`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onMaskEdit();
                }}
              >
                ◌ 蒙版 · {canvasMaskStatusLabel(maskState.status)}
              </button>
            )}
          </div>
          <div className="canvas-node-footer">
            <span className="canvas-type-icon">
              {data.kind === "video" ? "▶" : "▣"}
            </span>
            <span className="canvas-node-title">
              <b>{data.name || (data.kind === "video" ? "视频素材" : "素材")}</b>
              <small>{data.model || (data.kind === "video" ? "视频" : nodeStatus(node))}</small>
            </span>
            <em className={data.kind === "video" ? "video-status" : undefined}>
              {mediaFooterStatus}
            </em>
          </div>
        </div>
      )}
      {node.type === "upscale" && (
        <div className={`canvas-upscale-card${hasUpscaleResult ? " has-result" : ""}`}>
          <div className="canvas-upscale-card-head"><span>↗</span><div><b>图片超分</b><small>{hasUpscaleResult ? "超分节点生成的结果" : "独立超分节点"}</small></div></div>
          {pending ? (
            <div className="canvas-upscale-card-loading">
              <CanvasProcessingIndicator
                label={processingLabel}
                progress={processingProgress}
                kind={processingKind}
                startedAt={data.processingStartedAt || data.generation?.createdAt}
                waiting={data.status === "queued"}
                compact
              />
            </div>
          ) : hasUpscaleResult ? (
            <div className="canvas-upscale-card-result" title="双击查看大图；拖动此节点到其他节点可作为图片参考">
              <img src={String(data.url)} alt={String(data.name || "超分结果")} draggable={false} />
              <span className="canvas-upscale-result-badge"><i>↗</i>{data.status === "failed" ? "上次超分结果" : "超分节点生成的结果"}</span>
              {imageResolution && (
                <span
                  className="canvas-image-resolution canvas-upscale-resolution"
                  title={`图片分辨率 ${imageResolution}`}
                  aria-label={`图片分辨率 ${imageResolution}`}
                >
                  {imageResolution}
                </span>
              )}
            </div>
          ) : (
            <div className="canvas-upscale-card-preview"><strong>{String((data.params as CanvasUpscaleParams | undefined)?.scale || 2)}×</strong><span>{String((data.params as CanvasUpscaleParams | undefined)?.algorithm || "lanczos")}</span></div>
          )}
          <div className="canvas-upscale-card-status">{pending ? processingLabel : data.status === "failed" ? String(data.statusLabel || "超分失败，可重试") : hasUpscaleResult ? "双击预览 · 拖到其他节点作为图片参考" : canvasUpscaleSource(document, node.id) ? "已连接图片 · 选中后打开设置" : "请连接一张已完成的图片"}</div>
        </div>
      )}
      {node.type === "prompt" && (
        <div className="canvas-prompt-card">
          <div className="canvas-node-kicker">
            <span>✦</span>
            <b>{String(data.role || "Agent 节点")}</b>
          </div>
          {pending && (
            <CanvasProcessingIndicator
              label={processingLabel}
              progress={processingProgress}
              kind={processingKind}
              startedAt={
                data.processingStartedAt || data.generation?.createdAt
              }
              waiting={data.status === "queued"}
            />
          )}
          {editing ? (
            <textarea
              value={agentInput}
              placeholder="输入要交给 Agent 的任务…"
              autoFocus
              onChange={(event) => onPromptChange(event.target.value)}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (next instanceof HTMLElement && next.closest(".canvas-node-editor-popover")) return;
                onEdit(false);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="canvas-prompt-preview">
              {String(data.text || "双击输入 Agent 任务…")}
            </div>
          )}
          <small>
            {data.status === "running"
              ? "Agent 正在思考…"
              : data.status === "failed"
                ? String(data.statusLabel || "Agent 请求失败，可在下方重试")
                : data.model
                  ? `对话模型 · ${String(data.model)}`
                  : "可连接为对话上下文，也可作为图片或视频提示词"}
          </small>
          {agentResponse && data.status === "completed" && (
            <div className="canvas-agent-response-tools">
              <span>{agentResponse.length.toLocaleString()} 字</span>
              <button
                type="button"
                title="将 Agent 回复填入图片提示词"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onUseAsImagePrompt();
                }}
              >
                ✦ 转图片
              </button>
              <button
                type="button"
                title="放大查看 Agent 回复"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onTextPreview();
                }}
              >
                ⤢ 放大查看
              </button>
            </div>
          )}
        </div>
      )}
      {node.type === "generator" && (
        <div className="canvas-generator-card">
          <div className="canvas-generator-head">
            <span>{data.kind === "video" ? "▶" : "✦"}</span>
            <div>
              <b>{data.kind === "video" ? "视频变体生成器" : "图片变体生成器"}</b>
              <small>
                {data.status === "running"
                  ? "批量处理中…"
                  : data.status === "failed"
                    ? "有失败变体，可单独重试"
                    : "共同提示词 + 多行变体要求"}
              </small>
            </div>
          </div>
          {pending && (
            <CanvasProcessingIndicator
              label={processingLabel}
              progress={generatorProgress}
              kind={processingKind}
              startedAt={
                data.processingStartedAt || data.generation?.createdAt
              }
              waiting={data.status === "queued"}
            />
          )}
          <div className="canvas-generator-summary">
            <span>参考素材 {referenceCount}</span>
            <span>变体 {variantRequirements.length}</span>
            <span>完成 {completedVariants}/{variantRequirements.length}</span>
            <span>
              {data.kind === "image"
                ? `预计 ${estimatedResultCount} 张`
                : `串行 ${variantRequirements.length} 项`}
            </span>
          </div>
          {failedVariants > 0 && (
            <button
              type="button"
              className="canvas-variant-retry-all"
              title={`重试全部失败变体（${failedVariants} 条）`}
              aria-label={`重试全部失败变体（${failedVariants} 条）`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onRetryFailedVariants();
              }}
            >
              ↻ 重试失败项（{failedVariants}）
            </button>
          )}
          {editorOutputs.length > 0 && (
            <div className="canvas-generator-output-gallery" aria-label="生成结果">
              {editorOutputs.map((output) => (
                <button
                  type="button"
                  key={output.id}
                  className="canvas-generator-output-thumb"
                  draggable={Boolean(output.data.url)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-sanmao-canvas-node", output.id);
                  }}
                  onClick={() => onOutputPreview(output)}
                  title="查看结果；可拖到其他节点作为参考"
                >
                  {output.data.kind === "video" ? <video src={output.data.url} muted playsInline /> : <img src={output.data.url} alt={output.data.name || "生成结果"} />}
                  <span>{output.data.name || "结果"}</span>
                </button>
              ))}
            </div>
          )}
          <div className="canvas-generator-prompt">
            <b>共同提示词</b>
            <span>{String(data.prompt || "点击选中，在下方编辑提示词")}</span>
          </div>
          <div className="canvas-variant-state-list">
            {variantRequirements.map((instruction, index) => {
              const state = variantStates[index];
              return (
                <div className={`canvas-variant-state ${state?.status || "pending"}`} key={`${node.id}-variant-${index}`}>
                  <span>{index + 1}</span>
                  <p title={instruction || "默认变体"}>{instruction || "默认变体"}</p>
                  <small>{variantStatusLabel(state?.status || "pending")}</small>
                  {state?.status === "failed" && (
                    <button
                      type="button"
                      title={`重试第 ${index + 1} 条变体`}
                      aria-label={`重试第 ${index + 1} 条变体`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRetryVariant(index);
                      }}
                    >
                      重试
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="canvas-generator-meta">
            <span>
              {String(
                (data.params as CanvasGenerationParams | undefined)?.model ||
                  "自动模型",
              )}
            </span>
            <span>
              {String(
                data.params && "aspect" in data.params
                  ? data.params.aspect
                  : "自动比例",
              )}
            </span>
          </div>
        </div>
      )}
      {false && expanded && (
        <div
          className="canvas-node-editor"
          aria-label={`${nodeLabel(node)}编辑器`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="canvas-node-editor-head">
            <div>
              <b>{node.type === "prompt" ? "Agent 编辑器" : data.kind === "video" ? "视频编辑器" : "图片编辑器"}</b>
              <small>节点内完成输入、引用、参数和生成</small>
            </div>
            <button type="button" draggable={false} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onToggleEditor(node); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onToggleEditor(node); } }} aria-label="收起节点编辑器">⌃</button>
          </div>
          <div className="canvas-node-editor-prompt-wrap">
            <textarea
              aria-label={`${nodeLabel(node)}提示词`}
              value={editorPrompt}
              placeholder={node.type === "prompt" ? "输入 Agent 任务… 输入 @ 引用节点" : data.kind === "video" ? "描述动作、镜头和声音… 输入 @ 引用节点" : "描述想生成的画面… 输入 @ 引用节点"}
              onChange={(event) => {
                const value = event.target.value;
                onEditorPromptChange(node, value);
                setMentionState(mentionStateForValue(value, event.target.selectionStart));
              }}
              onClick={(event) => setMentionState(mentionStateForValue(event.currentTarget.value, event.currentTarget.selectionStart))}
              onKeyUp={(event) => setMentionState(mentionStateForValue(event.currentTarget.value, event.currentTarget.selectionStart))}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMentionState(null);
                if (event.key === "Enter" && (node.type === "prompt" ? !event.shiftKey : (event.ctrlKey || event.metaKey))) {
                  event.preventDefault();
                  onGenerate(node);
                }
              }}
              rows={3}
            />
            {mentionState && visibleMentionCandidates.length > 0 && (
              <div className="canvas-node-mention-menu">
                {visibleMentionCandidates.slice(0, 12).map((candidate, index) => (
                  <button
                    type="button"
                    key={candidate.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const activeMention = mentionState;
                      if (!activeMention) return;
                      const candidateIndex = mentionCandidates.findIndex((item) => item.id === candidate.id);
                      const next = `${editorPrompt.slice(0, activeMention.start)}@${candidateIndex + 1} ${editorPrompt.slice(activeMention.end)}`;
                      onEditorPromptChange(node, next);
                      const role: CanvasInputRole =
                        candidate.type === "prompt" || candidate.type === "generator"
                          ? "context"
                          : candidate.data.kind === "video"
                            ? node.type === "prompt" || node.data.kind === "video"
                              ? "video"
                              : "reference-image"
                            : "reference-image";
                      onReferenceDrop(node.id, candidate.id, role);
                      setMentionState(null);
                    }}
                  >
                    <strong>@{mentionCandidates.findIndex((item) => item.id === candidate.id) + 1}</strong>
                    <span className="canvas-node-mention-preview">
                      {candidate.type === "prompt" || candidate.type === "generator" ? <i>{candidate.type === "generator" && candidate.data.kind === "video" ? "▶" : "✦"}</i> : candidate.data.kind === "video" ? <video src={candidate.data.url} muted playsInline /> : <img src={candidate.data.url} alt="" />}
                    </span>
                    <span className="canvas-node-mention-copy"><b>{nodeLabel(candidate)}</b><small>{candidate.type === "prompt" || candidate.type === "generator" ? "文本上下文" : candidate.data.kind === "video" ? "视频引用" : "图片参考"}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <CanvasNodeReferenceStrip
            target={node}
            document={document}
            runtime={runtime}
            references={editorReferences}
            contexts={editorContexts}
            onReorder={onReferenceReorder}
            onRemove={onReferenceRemove}
            onDrop={onReferenceDrop}
            onAddFiles={onAddReferenceFiles}
            onPreview={onOutputPreview}
          />
          {node.type === "generator" && (
            <div className="canvas-node-variant-editor">
              <label>变体要求 <small>每行一条，最多 8 条</small></label>
              <textarea
                rows={2}
                value={data.variantRequirementsText ?? variantRequirements.join("\n")}
                placeholder="改成夜景\n改为俯拍视角"
                onChange={(event) => onVariantRequirementsChange(node, event.target.value)}
              />
            </div>
          )}
          {editorParams && (
            <details className="canvas-node-parameters" open={false}>
              <summary>
                参数设置{" "}
                <span>
                  {node.type === "prompt"
                    ? "对话模型和联网方式"
                    : "模型、比例、尺寸和高级选项"}
                </span>
              </summary>
              <CreationParameterEditor
                settings={editorParams!}
                runtime={runtime}
                referenceCount={editorReferences.length}
                portalZIndex={CANVAS_Z_INDEX.modalPopover}
                dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
                onChange={(settings) => onEditorParamsChange(node, settings)}
              />
            </details>
          )}
          <div className="canvas-node-editor-actions">
            <span>{node.type === "prompt" ? "Enter 发送 · Shift + Enter 换行" : "Ctrl/Cmd + Enter 生成"}</span>
            <button type="button" className="canvas-node-editor-generate" disabled={pending} onClick={() => onGenerate(node)}>{pending ? "处理中…" : node.type === "prompt" ? "发送" : "生成"}</button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="canvas-port right"
        aria-label="右侧连接端口"
        onPointerDown={(event) => onConnect(event, node.id, "right")}
      />
      <span
        className="canvas-node-resize"
        onPointerDown={(event) => onResize(event, node)}
        title="调整卡片大小"
      />
    </article>
  );
}

function CanvasMinimap({
  document,
  connectionStyle,
  selectedIds,
  bounds,
  stageSize,
  zoomAt,
  fitView,
  onNavigate,
  onMoveNodes,
}: {
  document: CanvasDocument;
  connectionStyle: ConnectionStyle;
  selectedIds: Set<string>;
  bounds: { x: number; y: number; w: number; h: number };
  stageSize: { width: number; height: number };
  zoomAt: (x: number, y: number, factor: number) => void;
  fitView: (ids?: string[]) => void;
  onNavigate: (x: number, y: number) => void;
  onMoveNodes: (
    positions: Record<string, Point>,
    recordHistory: boolean,
  ) => void;
}) {
  type MinimapInteraction =
    | {
        kind: "viewport";
        pointerId: number;
        offset: Point;
        startClient: Point;
        moved: boolean;
      }
    | {
        kind: "node";
        pointerId: number;
        nodeId: string;
        nodeIds: string[];
        startClient: Point;
        startWorld: Point;
        positions: Record<string, Point>;
        moved: boolean;
      };
  const minimapStageRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<MinimapInteraction | null>(null);
  const clickGuardRef = useRef(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = window.localStorage.getItem(
        "sanmao.canvas.minimap.collapsed.v2",
      );
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(
          "sanmao.canvas.minimap.collapsed.v2",
          String(next),
        );
      } catch {
        /* local storage may be unavailable */
      }
      return next;
    });
  const zoom = Math.max(0.12, document.camera.zoom || 1);
  // A uniform scale keeps nodes, edges and the viewport in the same world space.
  const mapAspect = 16 / 10;
  const mapWidth = mapAspect * 100;
  const mapHeight = 100;
  const mapScale = Math.min(
    mapWidth / Math.max(1, bounds.w),
    mapHeight / Math.max(1, bounds.h),
  );
  const mapOffsetX = (mapWidth - bounds.w * mapScale) / 2;
  const mapOffsetY = (mapHeight - bounds.h * mapScale) / 2;
  const mapRect = (rect: { x: number; y: number; w: number; h: number }) => ({
    left: ((mapOffsetX + (rect.x - bounds.x) * mapScale) / mapWidth) * 100,
    top: ((mapOffsetY + (rect.y - bounds.y) * mapScale) / mapHeight) * 100,
    width: ((rect.w * mapScale) / mapWidth) * 100,
    height: ((rect.h * mapScale) / mapHeight) * 100,
  });
  const mapStyle = (rect: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): CSSProperties => {
    const mapped = mapRect(rect);
    return {
      left: `${mapped.left}%`,
      top: `${mapped.top}%`,
      width: `${mapped.width}%`,
      height: `${mapped.height}%`,
    };
  };
  const mapPosition = (x: number, y: number) => ({
    x: mapOffsetX + (x - bounds.x) * mapScale,
    y: mapOffsetY + (y - bounds.y) * mapScale,
  });
  const nodeStyle = (node: CanvasNode): CSSProperties =>
    mapStyle({
      x: node.x,
      y: node.y,
      w: nodeSize(node).w,
      h: nodeSize(node).h,
    });
  const visible = {
    x: -document.camera.x / zoom,
    y: -document.camera.y / zoom,
    w: stageSize.width / zoom,
    h: stageSize.height / zoom,
  };
  const rawViewport = mapRect(visible);
  const clipAxis = (start: number, size: number) => {
    const end = start + size;
    if (end <= 0) return { start: 0, size: 3 };
    if (start >= 100) return { start: 97, size: 3 };
    const clippedStart = clamp(start, 0, 100);
    const clippedEnd = clamp(end, 0, 100);
    const clippedSize = Math.max(3, clippedEnd - clippedStart);
    return {
      start: Math.min(clippedStart, 100 - clippedSize),
      size: clippedSize,
    };
  };
  const viewportX = clipAxis(rawViewport.left, rawViewport.width);
  const viewportY = clipAxis(rawViewport.top, rawViewport.height);
  const viewportStyle: CSSProperties = {
    left: `${viewportX.start}%`,
    top: `${viewportY.start}%`,
    width: `${viewportX.size}%`,
    height: `${viewportY.size}%`,
  };
  const visibleCenter = {
    x: visible.x + visible.w / 2,
    y: visible.y + visible.h / 2,
  };
  const offscreenDirection = {
    left: visibleCenter.x > bounds.x + bounds.w,
    right: visibleCenter.x < bounds.x,
    top: visibleCenter.y > bounds.y + bounds.h,
    bottom: visibleCenter.y < bounds.y,
  };
  const mapPoint = (clientX: number, clientY: number): Point => {
    const rect = minimapStageRef.current?.getBoundingClientRect();
    if (!rect) return { x: bounds.x, y: bounds.y };
    const px =
      clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * mapWidth;
    const py =
      clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1) * mapHeight;
    return {
      x: clamp(
        bounds.x + (px - mapOffsetX) / mapScale,
        bounds.x,
        bounds.x + bounds.w,
      ),
      y: clamp(
        bounds.y + (py - mapOffsetY) / mapScale,
        bounds.y,
        bounds.y + bounds.h,
      ),
    };
  };
  const capture = (pointerId: number) => {
    minimapStageRef.current?.setPointerCapture(pointerId);
  };
  const startViewportDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = mapPoint(event.clientX, event.clientY);
    const center = {
      x: visible.x + visible.w / 2,
      y: visible.y + visible.h / 2,
    };
    interactionRef.current = {
      kind: "viewport",
      pointerId: event.pointerId,
      offset: { x: point.x - center.x, y: point.y - center.y },
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    clickGuardRef.current = true;
    capture(event.pointerId);
  };
  const startNodeDrag = (
    event: ReactPointerEvent<HTMLElement>,
    node: CanvasNode,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const group = node.groupId
      ? document.groups.find((item) => item.id === node.groupId)
      : undefined;
    const moveIds =
      selectedIds.has(node.id) && selectedIds.size > 1
        ? [...selectedIds]
        : group?.nodeIds || [node.id];
    const nodeIds = [
      ...new Set(
        moveIds.filter((id) => document.nodes.some((item) => item.id === id)),
      ),
    ];
    const positions = Object.fromEntries(
      document.nodes
        .filter((item) => nodeIds.includes(item.id))
        .map((item) => [item.id, { x: item.x, y: item.y }]),
    ) as Record<string, Point>;
    interactionRef.current = {
      kind: "node",
      pointerId: event.pointerId,
      nodeId: node.id,
      nodeIds,
      startClient: { x: event.clientX, y: event.clientY },
      startWorld: mapPoint(event.clientX, event.clientY),
      positions,
      moved: false,
    };
    clickGuardRef.current = true;
    capture(event.pointerId);
  };
  const moveInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = mapPoint(event.clientX, event.clientY);
    const clientDistance =
      Math.abs(event.clientX - interaction.startClient.x) +
      Math.abs(event.clientY - interaction.startClient.y);
    if (interaction.kind === "viewport") {
      if (!interaction.moved && clientDistance > 3) interaction.moved = true;
      onNavigate(
        point.x - interaction.offset.x,
        point.y - interaction.offset.y,
      );
    } else {
      const dx = point.x - interaction.startWorld.x;
      const dy = point.y - interaction.startWorld.y;
      const wasMoved = interaction.moved;
      if (!interaction.moved && clientDistance > 3) interaction.moved = true;
      if (interaction.moved) {
        const next = Object.fromEntries(
          interaction.nodeIds.map((id) => [
            id,
            {
              x: interaction.positions[id].x + dx,
              y: interaction.positions[id].y + dy,
            },
          ]),
        ) as Record<string, Point>;
        onMoveNodes(next, !wasMoved);
      }
    }
  };
  const finishInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === "node" && !interaction.moved) {
      const node = document.nodes.find(
        (item) => item.id === interaction.nodeId,
      );
      if (node) {
        const size = nodeSize(node);
        onNavigate(node.x + size.w / 2, node.y + size.h / 2);
      }
    }
    clickGuardRef.current = true;
    interactionRef.current = null;
    try {
      minimapStageRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer capture already released */
    }
  };
  const cancelInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    clickGuardRef.current = interaction.moved || true;
    interactionRef.current = null;
    try {
      minimapStageRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer capture already released */
    }
  };
  const navigate = (event: React.MouseEvent<HTMLDivElement>) => {
    if (clickGuardRef.current) {
      clickGuardRef.current = false;
      return;
    }
    const point = mapPoint(event.clientX, event.clientY);
    onNavigate(point.x, point.y);
  };
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    zoomAt(
      stageSize.width / 2,
      stageSize.height / 2,
      Math.exp(-event.deltaY * 0.0014),
    );
  };
  if (collapsed)
    return (
      <div className="canvas-minimap is-collapsed">
        <button
          type="button"
          className="canvas-minimap-restore"
          onClick={toggleCollapsed}
          title="展开画布导航"
          aria-label="展开画布导航"
        >
          <span aria-hidden="true">⌖</span>
          {document.nodes.length > 0 && <b>{document.nodes.length}</b>}
        </button>
      </div>
    );
  return (
    <aside
      className="canvas-minimap"
      aria-label="画布导航"
      onWheel={handleWheel}
    >
      <div className="canvas-minimap-head">
        <div className="canvas-minimap-title">
          <span aria-hidden="true">⌖</span>
          <div>
            <b>画布导航</b>
            <small>{document.nodes.length} 个节点 · 拖动视口移动</small>
          </div>
        </div>
        <div className="canvas-minimap-head-actions">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => fitView([...selectedIds])}
              title="聚焦选中节点"
              aria-label="聚焦选中节点"
            >
              ◎
            </button>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title="收起画布导航"
            aria-label="收起画布导航"
          >
            —
          </button>
        </div>
      </div>
      <div
        ref={minimapStageRef}
        className="canvas-minimap-stage"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget)
            clickGuardRef.current = false;
        }}
        onPointerMove={moveInteraction}
        onPointerUp={finishInteraction}
        onPointerCancel={cancelInteraction}
        onLostPointerCapture={cancelInteraction}
        onClick={navigate}
      >
        <svg
          className="canvas-minimap-edges"
          viewBox={`0 0 ${mapWidth} ${mapHeight}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {document.edges.map((edge) => {
            const source = nodeById(document, edge.source);
            const target = nodeById(document, edge.target);
            const sourceGroup = groupById(document, edge.source);
            const targetGroup = groupById(document, edge.target);
            if ((!source && !sourceGroup) || (!target && !targetGroup))
              return null;
            const colorKey = canvasSourceColorKey(document, edge.source);
            const sourcePort = edge.sourcePort || "right";
            const targetPort = edge.targetPort || "left";
            const sourcePoint = entityPortPoint(
              document,
              edge.source,
              sourcePort,
            );
            const targetPoint = entityPortPoint(
              document,
              edge.target,
              targetPort,
            );
            const start = mapPosition(sourcePoint.x, sourcePoint.y);
            const end = mapPosition(targetPoint.x, targetPoint.y);
            return (
              <path
                key={edge.id}
                className={`node-color-${colorKey}`}
                d={connectionPath(
                  start,
                  end,
                  connectionStyle,
                  sourcePort,
                  targetPort,
                  mapScale,
                )}
              />
            );
          })}
        </svg>
        {document.nodes.map((node) => (
          <button
            type="button"
            key={node.id}
            aria-label={`${nodeLabel(node)}：${node.data.name || "未命名节点"}`}
            title={`${nodeLabel(node)} · 点击定位，拖动移动`}
            className={`canvas-minimap-node node-color-${canvasNodeColorKey(node)} type-${node.type} kind-${node.data.kind || "text"} status-${node.data.status || "idle"} ${node.groupId ? "grouped" : ""} ${selectedIds.has(node.id) ? "active" : ""}`}
            data-node-color={canvasNodeColorKey(node)}
            style={nodeStyle(node)}
            onPointerDown={(event) => startNodeDrag(event, node)}
          />
        ))}
        <div
          className="canvas-minimap-viewport"
          style={viewportStyle}
          onPointerDown={startViewportDrag}
          title="当前视口 · 拖动浏览画布"
        >
          <span />
        </div>
        {offscreenDirection.left && (
          <span className="canvas-minimap-direction left" aria-hidden="true">
            ←
          </span>
        )}
        {offscreenDirection.right && (
          <span className="canvas-minimap-direction right" aria-hidden="true">
            →
          </span>
        )}
        {offscreenDirection.top && (
          <span className="canvas-minimap-direction top" aria-hidden="true">
            ↑
          </span>
        )}
        {offscreenDirection.bottom && (
          <span className="canvas-minimap-direction bottom" aria-hidden="true">
            ↓
          </span>
        )}
        {!document.nodes.length && (
          <div className="canvas-minimap-empty">
            <span>＋</span>
            <small>画布还是空的</small>
          </div>
        )}
      </div>
      <div className="canvas-minimap-foot">
        <div
          className="canvas-minimap-legend"
          title="图片 · 视频 · Agent · 图片生成 · 视频生成"
        >
          <i className="image" />
          <i className="video" />
          <i className="agent" />
          <i className="image-generator" />
          <i className="video-generator" />
        </div>
        <div className="canvas-minimap-zoom" role="group" aria-label="画布缩放">
          <button
            type="button"
            onClick={() =>
              zoomAt(stageSize.width / 2, stageSize.height / 2, 0.84)
            }
            aria-label="缩小画布"
          >
            −
          </button>
          <button
            type="button"
            className="zoom-value"
            onClick={() =>
              zoomAt(stageSize.width / 2, stageSize.height / 2, 1 / zoom)
            }
            title="恢复 100% 缩放"
          >
            {formatPercent(document.camera.zoom)}
          </button>
          <button
            type="button"
            onClick={() =>
              zoomAt(stageSize.width / 2, stageSize.height / 2, 1.18)
            }
            aria-label="放大画布"
          >
            ＋
          </button>
        </div>
        <button
          type="button"
          className="canvas-minimap-fit"
          onClick={() => fitView()}
        >
          适应
        </button>
      </div>
    </aside>
  );
}

function CanvasTextLightbox({
  node,
  onClose,
  onNotify,
  onUpdate,
  onCreateAgentNode,
  onUseAsImagePrompt,
}: {
  node?: CanvasNode;
  onClose: () => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  onUpdate: (node: CanvasNode, value: string) => void;
  onCreateAgentNode: (node: CanvasNode, value: string) => void;
  onUseAsImagePrompt: (node: CanvasNode, value: string) => void;
}) {
  const text =
    node?.type === "prompt"
      ? String(node.data.agentResponse || node.data.text || "")
      : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
    placement: "above" | "below";
  } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setDraft(text), [text]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  }, []);

  const updateSelection = useCallback(() => {
    const body = bodyRef.current;
    if (editing || !body) {
      setSelection(null);
      return;
    }
    const current = window.getSelection();
    if (
      !current ||
      current.isCollapsed ||
      !current.rangeCount ||
      !current.anchorNode ||
      !current.focusNode ||
      !body.contains(current.anchorNode) ||
      !body.contains(current.focusNode)
    ) {
      setSelection(null);
      return;
    }
    const selectedText = current.toString().trim();
    const rect = current.getRangeAt(0).getBoundingClientRect();
    if (!selectedText || (!rect.width && !rect.height)) {
      setSelection(null);
      return;
    }
    const toolbarWidth = Math.min(420, Math.max(260, window.innerWidth - 24));
    const halfWidth = toolbarWidth / 2;
    const center = rect.left + rect.width / 2;
    const x = Math.min(
      window.innerWidth - halfWidth - 12,
      Math.max(halfWidth + 12, center),
    );
    const showBelow =
      rect.top < 62 && window.innerHeight - rect.bottom > rect.top;
    setSelection({
      text: selectedText,
      x,
      y: showBelow ? rect.bottom + 10 : rect.top - 10,
      placement: showBelow ? "below" : "above",
    });
  }, [editing]);

  const cancelEdit = useCallback(() => {
    setDraft(text);
    setEditing(false);
    clearSelection();
  }, [clearSelection, text]);

  const saveEdit = useCallback(() => {
    if (!node) return;
    const value = draft;
    if (!value.trim()) {
      onNotify("回复内容不能为空。", "error");
      return;
    }
    onUpdate(node, value);
    setDraft(value);
    setEditing(false);
    clearSelection();
  }, [clearSelection, draft, node, onNotify, onUpdate]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => editRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => {
    if (!node) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [node, onClose]);

  useEffect(() => {
    if (!bodyRef.current || editing) return;
    const handleViewportChange = () => clearSelection();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [clearSelection, editing]);

  useEffect(() => {
    if (!selection || editing) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".canvas-text-selection-toolbar")) return;
      if (!bodyRef.current?.contains(target)) clearSelection();
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [clearSelection, editing, selection]);

  if (!node || node.type !== "prompt" || !text) return null;
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify("Agent 回复已复制");
    } catch {
      onNotify("复制失败，请检查浏览器剪贴板权限", "error");
    }
  };
  const copySelection = async () => {
    const value = selection?.text;
    if (!value) return;
    clearSelection();
    try {
      await navigator.clipboard.writeText(value);
      onNotify("已复制选中的文本");
    } catch {
      onNotify("复制失败，请检查浏览器剪贴板权限", "error");
    }
  };
  const runSelectionAction = (action: (value: string) => void) => {
    const value = selection?.text;
    if (!value) return;
    clearSelection();
    action(value);
  };
  return (
    <div
      className="canvas-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "编辑 Agent 回复" : "Agent 回复"}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`canvas-text-lightbox${editing ? " is-editing" : ""}`}>
        <header>
          <div>
            <b>{editing ? "编辑 Agent 回复" : "Agent 回复"}</b>
            <small>
              {editing
                ? "保存后保留为 Agent 回复"
                : node.data.model
                  ? `对话模型 · ${String(node.data.model)}`
                  : "对话模型"}
              {!editing && node.data.agentPrompt ? " · 已保留原始任务" : ""}
            </small>
          </div>
          <div className="canvas-text-lightbox-actions">
            {!editing && <button className="canvas-text-edit-trigger" type="button" onClick={() => { setDraft(text); clearSelection(); setEditing(true); }}>编辑</button>}
            {!editing && <button type="button" onClick={() => void copyText()}>复制全文</button>}
            <button type="button" onClick={onClose} aria-label="关闭 Agent 回复">
              ×
            </button>
          </div>
        </header>
        {editing ? (
          <div className="canvas-text-edit-stage">
            <div className="canvas-text-edit-heading">
              <span>编辑内容</span>
              <button type="button" onClick={() => setDraft(text)} disabled={draft === text}>恢复原文</button>
            </div>
            <textarea ref={editRef} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="编辑 Agent 文本" />
          </div>
        ) : (
          <>
            {node.data.agentPrompt && (
              <div className="canvas-text-lightbox-prompt">
                <span>任务</span>
                <p>{String(node.data.agentPrompt)}</p>
              </div>
            )}
            <div
              ref={bodyRef}
              className="canvas-text-lightbox-body"
              onMouseUp={updateSelection}
              onKeyUp={updateSelection}
              onTouchEnd={updateSelection}
            >
              {text}
            </div>
            {selection && (
              <div
                className={`canvas-text-selection-toolbar ${selection.placement}`}
                style={{ left: selection.x, top: selection.y }}
                role="toolbar"
                aria-label="选中文本操作"
                onMouseDown={(event) => event.preventDefault()}
                onTouchStart={(event) => event.preventDefault()}
              >
                <span>{selection.text.length.toLocaleString()} 字</span>
                <button type="button" onClick={() => void copySelection()}>复制选段</button>
                <button type="button" className="primary" onClick={() => runSelectionAction((value) => onCreateAgentNode(node, value))}>创建 Agent 节点</button>
                <button type="button" onClick={() => runSelectionAction((value) => onUseAsImagePrompt(node, value))}>转图片</button>
              </div>
            )}
          </>
        )}
        <footer className={editing ? "is-editing" : ""}>
          {editing ? (
            <>
              <span>{draft.length.toLocaleString()} 字 · 修改后仍保留为 Agent 回复</span>
              <div>
                <button type="button" onClick={cancelEdit}>取消编辑</button>
                <button type="button" className="primary" onClick={saveEdit}>保存修改</button>
              </div>
            </>
          ) : (
            <>
              <span>{text.length.toLocaleString()} 字</span>
              <span>选中文字可生成新节点 · 按 Esc 关闭</span>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function CanvasPanelShell({ title, subtitle, onClose, children, className = "" }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; className?: string }) {
  return <div className="canvas-modal-backdrop canvas-panel-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={`canvas-side-panel ${className}`}>
      <header><div><b>{title}</b><small>{subtitle}</small></div><button type="button" onClick={onClose} aria-label={`关闭${title}`}>×</button></header>
      <div className="canvas-side-panel-body">{children}</div>
    </aside>
  </div>;
}

function CanvasActivityDrawer({
  taskLogs,
  activityLogs,
  loading,
  onRefresh,
  onFocusTask,
  onRetryTask,
  onClose,
  onNotify,
}: {
  taskLogs: CanvasGenerationLog[];
  activityLogs: CanvasActivityLog[];
  loading: boolean;
  onRefresh: () => void;
  onFocusTask: (log: CanvasGenerationLog, openMedia?: boolean) => void;
  onRetryTask: (log: CanvasGenerationLog) => void;
  onClose: () => void;
  onNotify: (message: string, kind?: Notice["kind"]) => void;
}) {
  const [tab, setTab] = useState<"tasks" | "activity">("tasks");
  const [status, setStatus] = useState<"all" | CanvasGenerationLog["status"]>("all");
  const [media, setMedia] = useState<"all" | "image" | "video">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return taskLogs.filter((log) => {
      const matchesStatus = status === "all" || log.status === status;
      const kind = generationLogKind(log);
      const matchesMedia = media === "all" || kind === media;
      const matchesQuery =
        !normalized ||
        `${log.prompt} ${log.modelName || ""} ${log.providerName || ""}`
          .toLowerCase()
          .includes(normalized);
      return matchesStatus && matchesMedia && matchesQuery;
    });
  }, [media, query, status, taskLogs]);
  const selected = taskLogs.find((log) => log.id === selectedId);
  const summary = useMemo(
    () => ({
      total: taskLogs.length,
      pending: taskLogs.filter((log) => log.status === "pending").length,
      success: taskLogs.filter((log) => log.status === "success").length,
      error: taskLogs.filter((log) => log.status === "error").length,
    }),
    [taskLogs],
  );

  return (
    <CanvasPanelShell
      title="任务日志"
      subtitle="与主界面统一的生成任务记录"
      onClose={onClose}
      className="canvas-activity-panel canvas-task-log-panel"
    >
      <div className="canvas-log-tabs" role="tablist" aria-label="日志类型">
        <button type="button" className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>任务 <b>{summary.total}</b></button>
        <button type="button" className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>活动 <b>{activityLogs.length}</b></button>
      </div>
      {tab === "tasks" ? (
        <>
          <div className="canvas-log-summary-grid">
            <button type="button" className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}><b>{summary.total}</b><small>全部</small></button>
            <button type="button" className={status === "pending" ? "active pending" : "pending"} onClick={() => setStatus("pending")}><b>{summary.pending}</b><small>进行中</small></button>
            <button type="button" className={status === "success" ? "active success" : "success"} onClick={() => setStatus("success")}><b>{summary.success}</b><small>成功</small></button>
            <button type="button" className={status === "error" ? "active error" : "error"} onClick={() => setStatus("error")}><b>{summary.error}</b><small>失败</small></button>
          </div>
          <div className="canvas-log-toolbar">
            <label className="canvas-log-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、模型或服务商…" /></label>
            <div className="canvas-log-filter-row" role="group" aria-label="任务媒体类型">
              <button type="button" className={media === "all" ? "active" : ""} onClick={() => setMedia("all")}>全部</button>
              <button type="button" className={media === "image" ? "active" : ""} onClick={() => setMedia("image")}>图片</button>
              <button type="button" className={media === "video" ? "active" : ""} onClick={() => setMedia("video")}>视频</button>
              <button type="button" className="refresh" onClick={onRefresh} disabled={loading}>{loading ? "读取中…" : "↻ 刷新"}</button>
            </div>
          </div>
          {loading && !taskLogs.length ? <div className="canvas-side-empty"><span>◌</span><b>正在读取任务日志</b><small>与主界面服务端日志保持同步。</small></div> : filteredTasks.length ? <div className="canvas-task-log-list">
            {filteredTasks.map((log) => {
              const urls = generationLogOutputUrls(log);
              const kind = generationLogKind(log);
              return <article className={`canvas-task-log-card ${log.status} ${selectedId === log.id ? "selected" : ""}`} key={log.id} onClick={() => setSelectedId((value) => value === log.id ? null : log.id)}>
                <div className="canvas-task-log-preview">
                  {kind === "video" && urls[0] ? <video src={urls[0]} muted playsInline preload="metadata" /> : urls.length ? <div className="canvas-task-log-images">{urls.slice(0, 3).map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${generationLogKindLabel(log)}结果 ${index + 1}`} />)}</div> : <span className={log.status === "pending" ? "loading" : "placeholder"}>{log.status === "pending" ? "◌" : kind === "video" ? "▶" : "▣"}</span>}
                </div>
                <div className="canvas-task-log-status">{generationLogStatusLabel(log.status)}</div>
                <div className="canvas-task-log-main"><strong>{log.prompt || "未填写提示词"}</strong><small>{log.source === "agent" ? "Agent" : "画布生成"} · {log.modelName || "自动选择模型"} · {log.providerName || "等待服务商响应"}</small>{log.status === "pending" && <small className="pending-note">任务正在后台生成，可继续使用画布</small>}{log.error && <small className="error-note">{log.error}</small>}</div>
                <div className="canvas-task-log-meta"><span>{kind === "video" ? `${urls.length || (log.status === "pending" ? 1 : 0)} 段视频` : `${log.status === "pending" ? log.count || 1 : log.imageCount || urls.length} 张`}</span><span>{generationLogDuration(log)}</span><span>{kind === "video" ? `${log.operation === "edit" ? "编辑" : log.operation === "extend" ? "扩展" : "生成"} · ${log.resolution || "自动"}` : `${log.outputSize || "自动尺寸"} · ${log.aspectRatio || "自动比例"}`}</span><time>{new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div>
                <div className="canvas-task-log-actions"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(log.id); }}>{selectedId === log.id ? "收起详情" : "查看详情"}</button>{log.status === "error" && <button type="button" onClick={(event) => { event.stopPropagation(); onRetryTask(log); }}>重试</button>}<button type="button" onClick={(event) => { event.stopPropagation(); onFocusTask(log, Boolean(urls.length)); }}>{urls.length ? "打开结果" : "定位节点"}</button></div>
                {selectedId === log.id && <div className="canvas-task-log-detail"><div><b>任务详情</b><small>{log.id}</small></div><p>{log.prompt || "未填写提示词"}</p>{log.references?.length ? <small>参考图：{log.references.map((reference) => reference.name || "参考素材").join("、")}</small> : null}{log.providerTaskId && <small>服务商任务：{log.providerTaskId}</small>}{log.error && <strong className="error-note">失败原因：{log.error}</strong>}</div>}
              </article>;
            })}
          </div> : <div className="canvas-side-empty"><span>▱</span><b>{taskLogs.length ? "没有符合条件的任务" : "还没有生成任务"}</b><small>{taskLogs.length ? "调整状态、媒体类型或搜索条件。" : "从画布生成图片、视频或 Agent 结果后会出现在这里。"}</small></div>}
        </>
      ) : (
        <>
          <div className="canvas-activity-summary"><b>{activityLogs.length}</b><span>条画布操作</span></div>
          {activityLogs.length ? <div className="canvas-activity-list">{activityLogs.map((log) => <button type="button" className={log.status} key={log.id} onClick={() => onNotify("这条活动记录没有可定位的节点或任务详情") }><time>{new Date(log.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><span className="canvas-activity-dot">●</span><p>{log.message}</p><small>{log.type === "generation" ? "生成" : log.type === "agent" ? "Agent" : log.type === "asset" ? "资产" : log.type === "project" ? "项目" : log.type === "canvas" ? "画布" : "系统"}</small></button>)}</div> : <div className="canvas-side-empty"><span>≡</span><b>暂无活动</b><small>生成、导入或整理画布后会记录在这里。</small></div>}
        </>
      )}
    </CanvasPanelShell>
  );
}

function CanvasSettingsPanel({ theme, connectionStyle, onTheme, onConnectionStyleChange, onClose }: { theme: CanvasTheme; connectionStyle: ConnectionStyle; onTheme: () => void; onConnectionStyleChange: (value: ConnectionStyle) => void; onClose: () => void }) {
  return <CanvasPanelShell title="画布设置" subtitle="只保留画布与应用配置" onClose={onClose} className="canvas-settings-panel">
    <section className="canvas-setting-section"><b>界面主题</b><button type="button" onClick={onTheme}>{theme === "light" ? "☾ 切换深色" : "☀ 切换浅色"}</button></section>
    <section className="canvas-setting-section"><b>连线样式</b><SelectMenu value={connectionStyle} portalZIndex={CANVAS_Z_INDEX.modalPopover} onChange={onConnectionStyleChange} ariaLabel="连线样式" options={CONNECTION_STYLE_OPTIONS.map((item) => ({ value: item.value, label: item.label, icon: <ConnectionOptionIcon value={item.value} /> }))} /></section>
    <p className="canvas-setting-note">选中节点后，直接关联的入边和出边会显示细流光。</p>
  </CanvasPanelShell>;
}

function CanvasShortcutsPanel({ onClose }: { onClose: () => void }) {
  return <CanvasPanelShell title="快捷键" subtitle="画布常用操作" onClose={onClose} className="canvas-shortcuts-panel">
    <div className="canvas-shortcuts-list">{CANVAS_SHORTCUTS.map((item, index) => <div key={`${item.label}-${index}`}><span>{item.keys.map((key) => <kbd key={key}>{key}</kbd>)}</span><p>{item.label}</p></div>)}</div>
  </CanvasPanelShell>;
}
