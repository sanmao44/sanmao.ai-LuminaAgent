"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent as ReactChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  addEdge,
  arrangeCanvas,
  clone,
  createEmptyMedia,
  createGenerator,
  createGroup,
  createMedia,
  createPrompt,
  edgePath,
  entityBounds,
  entityPortPoint,
  groupAtPoint,
  groupBounds,
  groupById,
  groupNodes,
  incomingContext,
  incomingReferences,
  mediaCardSizeForRatio,
  nodeById,
  nodeSize,
  normalizeDocument,
  removeEdge,
  removeNodes,
  moveNodesToGroup,
  reorderReferences,
  smartPrompt,
  snapshot,
  uid,
} from "@/lib/canvas/model";
import {
  getCanvasVideoTask,
  generateCanvasAgent,
  generateCanvasImage,
  generateCanvasUpscale,
  generateCanvasVideo,
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
import { recordCanvasImages } from "@/lib/creation/history";
import {
  hideUnifiedAsset,
  listUnifiedAssets,
  registerCanvasAsset,
  setUnifiedAssetFavorite,
  type AssetRecord,
  type AssetSource,
} from "@/lib/assets";
import CreationParameterEditor from "@/components/CreationParameterEditor";
import MaskEditor from "@/components/MaskEditor";
import SelectMenu from "@/components/SelectMenu";
import type {
  CanvasCamera,
  CanvasConnectionStyle,
  CanvasDocument,
  CanvasEdge,
  CanvasGenerationParams,
  CanvasGroup,
  CanvasMediaKind,
  CanvasNode,
  CanvasProject,
  CanvasRuntimeState,
  CanvasSnapshot,
} from "@/lib/canvas/types";

type Mode = CanvasMediaKind | "text";
type ConnectionStyle = CanvasConnectionStyle;
type CanvasTheme = "light" | "dark";
type Point = { x: number; y: number };
type Notice = { message: string; kind: "ok" | "error" };
type WorkbenchTab =
  | "assets"
  | "workflow"
  | "logs"
  | "shortcuts"
  | "project"
  | "settings";
type ConnectionAnimation = "none" | "flow" | "pulse" | "dash";
type CanvasClipboardPayload = {
  type: "sanmao-canvas-nodes";
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
};
type MentionState = { start: number; end: number; query: string } | null;
type CanvasDrafts = {
  image: { prompt: string; params: ImageCreationSettings };
  video: { prompt: string; params: VideoCreationSettings };
  text: { prompt: string; params: AgentCreationSettings };
};
type Interaction =
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      camera: CanvasCamera;
      changed: boolean;
    }
  | {
      kind: "drag";
      pointerId: number;
      startX: number;
      startY: number;
      nodeIds: string[];
      positions: Record<string, Point>;
      changed: boolean;
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
  | "workflowVideo";
type ConnectionNodePicker = {
  x: number;
  y: number;
  world: Point;
  sourceId: string;
  sourcePort: "left" | "right";
};

const CANVAS_SETTINGS_KEY = "sanmao.canvas.settings";
const CONNECTION_ANIMATION_OPTIONS: Array<{
  value: ConnectionAnimation;
  label: string;
  description: string;
}> = [
  {
    value: "none",
    label: "关闭动态",
    description: "保持连线静态，减少视觉干扰",
  },
  { value: "flow", label: "流光", description: "沿连线方向持续流动" },
  { value: "pulse", label: "呼吸", description: "连线亮度与光晕缓慢变化" },
  { value: "dash", label: "行进", description: "短线段沿连线方向行进" },
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
    label: "图片工作流",
    description: "连接高级图片工作流",
  },
  {
    kind: "workflowVideo",
    icon: "◆",
    label: "视频工作流",
    description: "连接高级视频工作流",
  },
];
const CANVAS_SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["左键"], label: "拖动空白区域平移画布" },
  { keys: ["中键"], label: "拖动平移画布" },
  { keys: ["Space", "左键"], label: "按住 Space 拖动空白区域平移画布" },
  { keys: ["Ctrl"], label: "按住并拖拽框选节点" },
  { keys: ["Ctrl"], label: "悬停连线显示取消按钮" },
  { keys: ["Ctrl", "G"], label: "合并选中的图片为组" },
  { keys: ["Ctrl", "Shift", "G"], label: "释放选中的分组" },
  { keys: ["Ctrl", "Z"], label: "撤销上一步操作" },
  { keys: ["Ctrl", "Shift", "Z"], label: "恢复上一步操作" },
  { keys: ["Ctrl", "C"], label: "复制选中的节点" },
  { keys: ["Ctrl", "V"], label: "粘贴节点或剪贴板图片" },
  { keys: ["Alt"], label: "按住并拖动复制节点" },
  { keys: ["Alt", "Shift"], label: "复制节点并保留输入连线" },
  { keys: ["A"], label: "打开/关闭资产库" },
  { keys: ["Z"], label: "缩小画布视图" },
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
  if (node.type === "prompt") return "Agent 节点";
  if (node.type === "generator")
    return node.data.kind === "video" ? "视频生成节点" : "图片生成节点";
  return node.data.kind === "video" ? "视频卡片" : "图片卡片";
}

function canvasConnectableId(target: EventTarget | null) {
  return (target as HTMLElement | null)
    ?.closest<HTMLElement>("[data-canvas-connectable-id]")
    ?.dataset.canvasConnectableId;
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
  animation,
  style,
  selected,
  onSelect,
  onCtrlClick,
  onHover,
  onLeave,
}: {
  document: CanvasDocument;
  edge: CanvasEdge;
  animation: ConnectionAnimation;
  style: ConnectionStyle;
  selected: boolean;
  onSelect: () => void;
  onCtrlClick: () => void;
  onHover: (event: ReactPointerEvent<SVGPathElement>) => void;
  onLeave: () => void;
}) {
  const path = edgePath(document, edge, style);
  const colorKey = canvasSourceColorKey(document, edge.source);
  const handlePointerDown = (event: ReactPointerEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0 && (event.ctrlKey || event.metaKey)) onCtrlClick();
    else if (event.button === 0) onSelect();
  };
  const handlePointerEnter = (event: ReactPointerEvent<SVGPathElement>) => {
    event.stopPropagation();
    onHover(event);
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
        className={`canvas-edge canvas-edge-${animation} ${selected ? "selected" : ""}`}
        d={path}
        markerEnd={`url(#canvas-arrow-${colorKey})`}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      />
      {animation === "flow" && (
        <g className="canvas-edge-flow-light" aria-hidden="true">
          <path className="canvas-edge-flow-glow" d={path} pathLength="1000" />
          <path className="canvas-edge-flow-mid" d={path} pathLength="1000" />
          <path className="canvas-edge-flow-core" d={path} pathLength="1000" />
        </g>
      )}
    </g>
  );
}

export default function SuperCanvas() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workflowInputRef = useRef<HTMLInputElement | null>(null);
  const deckPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const canvasClipboardRef = useRef<CanvasClipboardPayload | null>(null);
  const docRef = useRef<CanvasDocument>(normalizeDocument(null));
  const saveTimerRef = useRef<number | null>(null);
  const pollTimersRef = useRef<Set<number>>(new Set());
  const pollAttemptsRef = useRef<Map<string, number>>(new Map());
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
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const [mode, setMode] = useState<Mode>("image");
  const [drafts, setDrafts] = useState<CanvasDrafts>({
    image: { prompt: "", params: readSharedCreationSettings("image") },
    video: { prompt: "", params: readSharedCreationSettings("video") },
    text: { prompt: "", params: readSharedCreationSettings("text") },
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [generationKeys, setGenerationKeys] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    world: Point;
  } | null>(null);
  const [lightbox, setLightbox] = useState<{
    nodeId: string;
    compare: boolean;
  } | null>(null);
  const [textLightboxNodeId, setTextLightboxNodeId] = useState<string | null>(
    null,
  );
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("assets");
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
  const modifierHeldRef = useRef(false);
  const [logs, setLogs] = useState<string[]>([]);
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
  const [connectionAnimation, setConnectionAnimation] =
    useState<ConnectionAnimation>("none");
  const [connectionStyle, setConnectionStyle] =
    useState<ConnectionStyle>("curve");
  const [theme, setTheme] = useState<CanvasTheme>("light");
  const [mentionState, setMentionState] = useState<MentionState>(null);
  const [panActive, setPanActive] = useState(false);
  const [maskNodeId, setMaskNodeId] = useState<string | null>(null);
  const [assetRefresh, setAssetRefresh] = useState(0);
  const [assetDropGroupId, setAssetDropGroupId] = useState<string | null>(
    null,
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
  const selectedSingle = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedGroup = selectedGroupId
    ? groupById(document, selectedGroupId)
    : undefined;
  const mediaNodes = useMemo(
    () => document.nodes.filter((node) => node.type === "media"),
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
        })),
    [activeProjectId, document.nodes],
  );
  const referenceOwnerId = selectedGroupId || selectedSingle?.id;
  const mentionCandidates = useMemo(
    () =>
      selectedGroupId
        ? groupNodes(document, selectedGroupId).filter(
            (node) => node.type === "media" && Boolean(node.data.url),
          )
        : referenceOwnerId
          ? incomingReferences(document, referenceOwnerId)
          : mediaNodes.filter((node) => Boolean(node.data.url)),
    [document, mediaNodes, referenceOwnerId, selectedGroupId],
  );

  const setDoc = useCallback((next: CanvasDocument) => {
    docRef.current = next;
    setDocument(next);
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
    (message: string) => setLogs((items) => [message, ...items].slice(0, 120)),
    [],
  );
  const notify = useCallback((message: string, kind: Notice["kind"] = "ok") => {
    setNotice({ message, kind });
    window.setTimeout(
      () => setNotice((value) => (value?.message === message ? null : value)),
      kind === "error" ? 5200 : 2800,
    );
  }, []);

  useEffect(() => {
    const storage = ensureCanvasStorage();
    const initial = loadCanvasDocument(storage.activeId);
    docRef.current = initial;
    setDocument(initial);
    setProjects(storage.projects);
    setActiveProjectId(storage.activeId);
    setReady(true);
    if (storage.migrated) notify("已将 NOVA 画布项目迁移到 SANMAO.AI");
    void loadCanvasRuntime()
      .then((value) => {
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
    return () => {
      mountedRef.current = false;
      pollTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      pollTimersRef.current.clear();
      pollAttemptsRef.current.clear();
    };
  }, [notify]);

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
      selectedSingle?.type === "generator"
    )
      setMode(selectedSingle.data.kind === "video" ? "video" : "image");
  }, [selectedSingle?.id, selectedSingle?.type, selectedSingle?.data.kind]);

  useEffect(() => {
    try {
      const raw = JSON.parse(
        window.localStorage.getItem(CANVAS_SETTINGS_KEY) || "null",
      ) as {
        connectionAnimation?: unknown;
        connectionStyle?: unknown;
      } | null;
      if (
        CONNECTION_ANIMATION_OPTIONS.some(
          (item) => item.value === raw?.connectionAnimation,
        )
      )
        setConnectionAnimation(raw!.connectionAnimation as ConnectionAnimation);
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
        JSON.stringify({ connectionAnimation, connectionStyle }),
      );
    } catch {
      /* 设置保存失败不应阻断画布 */
    }
  }, [connectionAnimation, connectionStyle, ready]);

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

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedGroupId(null);
    setSelectedEdgeId(null);
    setConnectionCancelEdgeId(null);
    setEditingNodeId(null);
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
    (edgeId: string, event: ReactPointerEvent<SVGPathElement>) => {
      connectionHoverEdgeRef.current = edgeId;
      clearConnectionCancelHideTimer();
      if (modifierHeldRef.current || event.ctrlKey || event.metaKey)
        showConnectionCancel(edgeId);
    },
    [clearConnectionCancelHideTimer, showConnectionCancel],
  );
  const handleConnectionLeave = useCallback(
    (edgeId: string) => {
      if (connectionHoverEdgeRef.current === edgeId)
        connectionHoverEdgeRef.current = null;
      if (modifierHeldRef.current && !connectionCancelButtonHoverRef.current)
        scheduleConnectionCancelHide(edgeId);
      else if (!modifierHeldRef.current) hideConnectionCancel();
    },
    [hideConnectionCancel, scheduleConnectionCancelHide],
  );

  useEffect(() => {
    const handleModifierDown = (event: KeyboardEvent) => {
      if (event.key !== "Control" && event.key !== "Meta") return;
      modifierHeldRef.current = true;
      if (connectionHoverEdgeRef.current)
        showConnectionCancel(connectionHoverEdgeRef.current);
    };
    const handleModifierUp = (event: KeyboardEvent) => {
      if (event.key !== "Control" && event.key !== "Meta") return;
      const stillHeld = event.ctrlKey || event.metaKey;
      modifierHeldRef.current = stillHeld;
      if (!stillHeld) hideConnectionCancel();
    };
    const handleWindowBlur = () => {
      modifierHeldRef.current = false;
      hideConnectionCancel();
    };
    window.addEventListener("keydown", handleModifierDown);
    window.addEventListener("keyup", handleModifierUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleModifierDown);
      window.removeEventListener("keyup", handleModifierUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [hideConnectionCancel, showConnectionCancel]);
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
  const openNodePosition = useCallback((position: Point, node: CanvasNode) => {
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
    const occupied = docRef.current.nodes.map((item) => {
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
  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 1) return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          ".canvas-node,.canvas-group,.canvas-floating,.canvas-deck,.canvas-selection-toolbar,.canvas-minimap,.canvas-context-menu,.canvas-connection-picker,.select-menu,.select-menu-popover,.model-picker,.model-picker-panel,.model-picker-dialog-backdrop",
        )
      )
        return;
      setContextMenu(null);
      setConnectionNodePicker(null);
      hideConnectionCancel();
      if (
        event.button === 0 &&
        (event.ctrlKey || event.metaKey) &&
        !spaceHeldRef.current
      )
        return startMarquee(event);
      event.preventDefault();
      if (event.button === 0 && !event.shiftKey && !spaceHeldRef.current)
        clearSelection();
      interactionRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        camera: document.camera,
        changed: false,
      };
      setPanActive(true);
      capture(event);
    },
    [
      capture,
      clearSelection,
      document.camera,
      hideConnectionCancel,
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
      hideConnectionCancel();
      connectionHoverEdgeRef.current = null;
      if (event.ctrlKey || event.metaKey) return startMarquee(event);
      event.preventDefault();
      event.stopPropagation();
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
        copyOnMove: event.altKey,
        preserveInputConnections: event.altKey && event.shiftKey,
      };
      capture(event);
    },
    [
      capture,
      hideConnectionCancel,
      selectNode,
      selectedGroupId,
      selectedIds,
      startMarquee,
    ],
  );

  const startGroupDrag = useCallback(
    (event: ReactPointerEvent, group: CanvasGroup) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      hideConnectionCancel();
      connectionHoverEdgeRef.current = null;
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
      setSelectedEdgeId(null);
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
        copyOnMove: event.altKey,
        preserveInputConnections: event.altKey && event.shiftKey,
      };
      capture(event);
    },
    [capture, hideConnectionCancel, selectedIds, startMarquee],
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
      hideConnectionCancel();
      connectionHoverEdgeRef.current = null;
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
    [capture, hideConnectionCancel],
  );
  const startConnection = useCallback(
    (event: ReactPointerEvent, nodeId: string, port: "left" | "right") => {
      event.preventDefault();
      event.stopPropagation();
      hideConnectionCancel();
      connectionHoverEdgeRef.current = null;
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
    [capture, hideConnectionCancel, stagePoint],
  );

  const cancelConnection = useCallback(
    (event?: ReactPointerEvent<HTMLButtonElement>) => {
      event?.preventDefault();
      event?.stopPropagation();
      interactionRef.current = null;
      setConnection(null);
      setConnectionNodePicker(null);
      setConnectionTargetId(null);
      hideConnectionCancel();
      connectionHoverEdgeRef.current = null;
      setMarquee(null);
      try {
        if (event) stageRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture already released */
      }
    },
    [hideConnectionCancel],
  );

  const removeConnection = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!connectionCancelEdgeId) return cancelConnection(event);
      const edgeId = connectionCancelEdgeId;
      commit((value) => removeEdge(value, edgeId));
      setSelectedEdgeId(null);
      hideConnectionCancel();
      connectionHoverEdgeRef.current = null;
      addLog("已取消连线");
      try {
        stageRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture already released */
      }
    },
    [
      addLog,
      cancelConnection,
      commit,
      connectionCancelEdgeId,
      hideConnectionCancel,
    ],
  );

  const moveInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      const dx =
        "startX" in interaction ? event.clientX - interaction.startX : 0;
      const dy =
        "startY" in interaction ? event.clientY - interaction.startY : 0;
      const zoom = docRef.current.camera.zoom;
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
            setDoc({
              ...docRef.current,
              nodes: [...docRef.current.nodes, ...copies.nodes],
              edges: [...docRef.current.edges, ...copies.edges],
              groups: [...docRef.current.groups, ...copies.groups],
            });
            setSelectedIds(new Set(copies.ids));
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
        if (interaction.changed)
          updateDoc((value) => ({
            ...value,
            nodes: value.nodes.map((node) =>
              interaction.nodeIds.includes(node.id)
                ? {
                    ...node,
                    x: interaction.positions[node.id].x + dx / zoom,
                    y: interaction.positions[node.id].y + dy / zoom,
                  }
                : node,
            ),
          }));
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
    [notify, setDoc, stagePoint, updateDoc],
  );

  const finishInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
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
          commit((value) =>
            addEdge(
              value,
              interaction.sourceId,
              target,
              interaction.sourcePort,
              interaction.sourcePort === "right" ? "left" : "right",
              "manual",
            ),
          );
          addLog(`已连接 ${interaction.sourceId} → ${target}`);
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
          const target = groupAtPoint(docRef.current, {
            x: Number.isFinite(bounds.left)
              ? (bounds.left + bounds.right) / 2
              : point.x,
            y: Number.isFinite(bounds.top)
              ? (bounds.top + bounds.bottom) / 2
              : point.y,
          });
          if (target) {
            const before = docRef.current;
            const after = moveNodesToGroup(
              before,
              draggedNodes.map((node) => node.id),
              target.id,
            );
            if (after !== before) {
              updateDoc(() => after);
              setSelectedGroupId(target.id);
              setSelectedIds(
                new Set(
                  after.groups.find((group) => group.id === target.id)
                    ?.nodeIds || [],
                ),
              );
              notify(`已将 ${draggedNodes.length} 个节点加入${target.name}`);
            }
          }
        }
      }
      interactionRef.current = null;
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
      connectionTargetId,
      notify,
      stagePoint,
      stageToWorld,
      updateDoc,
    ],
  );

  const cancelPointerInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      interactionRef.current = null;
      setPanActive(false);
      setMarquee(null);
      setConnection(null);
      setConnectionNodePicker(null);
      setConnectionTargetId(null);
      hideConnectionCancel();
      try {
        stageRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture already released */
      }
    },
    [hideConnectionCancel],
  );

  useEffect(() => {
    const handleWindowBlur = () => {
      interactionRef.current = null;
      setPanActive(false);
      setMarquee(null);
      setConnection(null);
      setConnectionNodePicker(null);
      setConnectionTargetId(null);
      hideConnectionCancel();
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [hideConnectionCancel]);

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
      kind: "image" | "video" | "text" | "workflowImage" | "workflowVideo",
      position?: Point,
    ) => {
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
        `已添加${kind === "text" ? "Agent" : mediaKind === "video" ? "视频" : "图片"}节点`,
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
  const connectNewNode = useCallback(
    (kind: ConnectableNodeKind, picker: ConnectionNodePicker) => {
      if (
        !nodeById(docRef.current, picker.sourceId) &&
        !groupById(docRef.current, picker.sourceId)
      ) {
        setConnectionNodePicker(null);
        return notify("源节点已不存在，请重新发起连线。", "error");
      }
      const mediaKind =
        kind === "workflowVideo" || kind === "video" ? "video" : "image";
      const params = defaultParams(mediaKind, runtime);
      const draft =
        kind === "text"
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
      commit((value) =>
        addEdge(
          { ...value, nodes: [...value.nodes, node] },
          picker.sourceId,
          node.id,
          picker.sourcePort,
          targetPort,
          "manual",
        ),
      );
      setConnectionNodePicker(null);
      setSelectedIds(new Set([node.id]));
      setSelectedGroupId(null);
      setMode(kind === "text" ? "text" : mediaKind);
      notify(
        `已添加并连接${kind === "text" ? "Agent" : mediaKind === "video" ? "视频" : "图片"}节点`,
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
    const copies = duplicateNodes(docRef.current, [...selectedIds]);
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
    notify(`已复制 ${copies.nodes.length} 个对象`);
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

  const openProject = useCallback(
    (id: string) => {
      if (id === activeProjectId) {
        setProjectMenuOpen(false);
        return;
      }
      saveCanvasDocument(activeProjectId, docRef.current);
      const next = loadCanvasDocument(id);
      setDoc(next);
      setActiveProjectId(id);
      clearSelection();
      setUndoStack([]);
      setRedoStack([]);
      setProjectMenuOpen(false);
      addLog(
        `已打开项目：${projects.find((project) => project.id === id)?.name || "未命名画布"}`,
      );
    },
    [activeProjectId, addLog, clearSelection, projects, setDoc],
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
        setDoc(loadCanvasDocument(replacement.id));
        setActiveProjectId(replacement.id);
        clearSelection();
        setUndoStack([]);
        setRedoStack([]);
        setProjectMenuOpen(false);
      }
      notify("画布项目已删除");
    },
    [activeProjectId, clearSelection, notify, projects, setDoc],
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
      for (const [index, file] of list.entries()) {
        try {
          const asset = await uploadCanvasAsset(file);
          nodes.push(
            createMedia(
              asset.kind,
              asset.url,
              asset.name,
              {
                x: base.x + (index % 3) * 350,
                y: base.y + Math.floor(index / 3) * 270,
              },
              { role: "参考素材" },
            ),
          );
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
        notify(`已导入 ${nodes.length} 个素材`);
      }
    },
    [addLog, commit, notify, screenToWorld, stageSize.height, stageSize.width],
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
    (payload: CanvasClipboardPayload) => {
      const source = payload.nodes;
      if (!source.length) return notify("剪贴板中没有可粘贴的节点。", "error");
      const minX = Math.min(...source.map((node) => node.x));
      const minY = Math.min(...source.map((node) => node.y));
      const rect = stageRef.current?.getBoundingClientRect();
      const center = {
        x: (rect?.left || 0) + (rect?.width || stageSize.width) / 2,
        y: (rect?.top || 0) + (rect?.height || stageSize.height) / 2,
      };
      const target = screenToWorld(center.x, center.y);
      const idMap = new Map(source.map((node) => [node.id, uid("node")]));
      const groupMap = new Map(
        payload.groups.map((group) => [group.id, uid("group")]),
      );
      const nodes = source.map((node) => {
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
    [commit, notify, screenToWorld, stageSize.height, stageSize.width],
  );

  const pasteFromClipboard = useCallback(async () => {
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
            ]);
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
            return pasteCanvasPayload(parsed);
        }
      }
      if (!clipboardText)
        clipboardText = (await navigator.clipboard?.readText()) || "";
      if (clipboardText) {
        const parsed: unknown = JSON.parse(clipboardText);
        if (isCanvasClipboardPayload(parsed)) return pasteCanvasPayload(parsed);
      }
      if (canvasClipboardRef.current)
        pasteCanvasPayload(canvasClipboardRef.current);
    } catch {
      if (!clipboardText && canvasClipboardRef.current)
        pasteCanvasPayload(canvasClipboardRef.current);
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
    if (workbenchOpen && workbenchTab === "assets")
      return setWorkbenchOpen(false);
    setWorkbenchTab("assets");
    setWorkbenchOpen(true);
  }, [workbenchOpen, workbenchTab]);

  const setMediaNaturalSize = useCallback(
    (nodeId: string, width: number, height: number) => {
      if (!width || !height) return;
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== "media") return node;
          if (node.data.autoFit === false)
            return {
              ...node,
              data: { ...node.data, nativeWidth: width, nativeHeight: height },
            };
          return {
            ...node,
            ...mediaCardSizeForRatio(width / height, node.data.kind || "image"),
            data: { ...node.data, nativeWidth: width, nativeHeight: height },
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
                    generation: {
                      kind: node.data.kind === "video" ? "video" : "image",
                      params: copyParams(
                        node.data.generation?.params || node.data.params,
                        node.data.kind === "video" ? "video" : "image",
                        runtime,
                      ),
                      referenceIds: node.data.referenceOrder || [],
                      createdAt: node.data.generation?.createdAt || Date.now(),
                      ...node.data.generation,
                      prompt: value,
                    },
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
    [mode, runtime, selectedSingle, updateDoc],
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
        const mediaSettings = settings;
        updateDoc((valueDoc) => ({
          ...valueDoc,
          nodes: valueDoc.nodes.map((node) =>
            node.id === source.target!.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    generation: {
                      kind: mediaSettings.kind,
                      prompt: source.prompt,
                      referenceIds: node.data.referenceOrder || [],
                      createdAt: node.data.generation?.createdAt || Date.now(),
                      ...node.data.generation,
                      params: clone(mediaSettings),
                    },
                  },
                }
              : node,
          ),
        }));
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
    [deckSource, updateDoc],
  );

  const pollVideo = useCallback(
    async (nodeId: string, taskId: string) => {
      if (!mountedRef.current || !nodeById(docRef.current, nodeId)) return;
      const attempts = (pollAttemptsRef.current.get(taskId) || 0) + 1;
      pollAttemptsRef.current.set(taskId, attempts);
      if (attempts > 40) {
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    status: "failed",
                    statusLabel: "视频任务查询超时，请重试",
                  },
                }
              : node,
          ),
        }));
        addLog(`视频任务查询超时：${taskId}`);
        pollAttemptsRef.current.delete(taskId);
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
        updateDoc((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    status:
                      task.status === "done"
                        ? "completed"
                        : terminal
                          ? "failed"
                          : "running",
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
        }));
        if (!terminal) {
          const timer = window.setTimeout(() => {
            pollTimersRef.current.delete(timer);
            void pollVideo(nodeId, taskId);
          }, 3000);
          pollTimersRef.current.add(timer);
        } else {
          pollAttemptsRef.current.delete(taskId);
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

  const runGeneration = useCallback(async () => {
    const source = deckSource();
    if (mode === "text") {
      const prompt = source.prompt.trim();
      if (!prompt) return notify("请输入要交给 Agent 的内容。", "error");
      const settings =
        source.params.kind === "text"
          ? source.params
          : normalizeCreationSettings("text", null, runtime);
      const resolved = resolveAvailableCreationModel(settings, runtime);
      const effectiveSettings: AgentCreationSettings = {
        ...settings,
        model: resolved.model?.id || "auto",
      };
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
        (node) =>
          node.type === "media" &&
          node.data.kind === "image" &&
          Boolean(node.data.url),
      );
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
                    statusLabel: "Agent 思考中",
                  },
                }
              : node,
          ),
        }));
      }
      const inputId = inputNode.id;
      try {
        const response = await generateCanvasAgent({
          messages: [...contextMessages, { role: "user", content: prompt }],
          model: effectiveSettings.model,
          webMode: effectiveSettings.webMode,
          references: referenceNodes.map((node) => ({
            url: String(node.data.url),
            name: String(node.data.name || "参考图片"),
          })),
        });
        const parent = nodeById(docRef.current, inputId) || inputNode;
        const responseText = response.message || "Agent 没有返回文本。";
        const responseModel =
          response.model || resolved.model?.displayName || effectiveSettings.model;
        const imageSettings = readSharedCreationSettings("image", runtime);
        const imageNodes = (response.images || []).map((image, index) =>
          createMedia(
            "image",
            image.url,
            `Agent 图片 ${index + 1}`,
            {
              x: parent.x + nodeSize(parent).w + 90 + (index % 2) * 350,
              y: parent.y + 240 + Math.floor(index / 2) * 280,
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
        writeSharedCreationSettings(effectiveSettings);
        if (response.images?.length)
          void recordCanvasImages(response.images, {
            prompt,
            modelId: imageSettings.model,
            modelName: response.model,
            aspectRatio: imageSettings.aspect,
            outputSize: imageSettings.resolution,
            outputFormat: imageSettings.outputFormat,
            parentId: inputId,
          });
        addLog(`Agent 回复完成：${responseModel}`);
        notify(
          response.images?.length
            ? `Agent 已回复并生成 ${response.images.length} 张图片`
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
        generationKeysRef.current.delete(activeKey);
        setGenerationKeys(new Set(generationKeysRef.current));
      }
      return;
    }
    const ownerId = source.node?.id || source.target?.id;
    const incoming = ownerId ? incomingContext(docRef.current, ownerId) : [];
    const baseLinked = ownerId
      ? [
          ...(source.target?.data.url ? [source.target] : []),
          ...incoming.filter((node) => node.type === "media" && node.data.url),
        ]
      : selectedNodes.filter((node) => node.type === "media" && node.data.url);
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
    const refs = linked
      .map((node) => ({
        url: String(node.data.url || ""),
        name: String(node.data.name || "参考素材"),
      }))
      .filter((item) => item.url);
    const kind = source.kind as CanvasMediaKind;
    const sourceNode = source.node;
    const resolvedModel = resolveAvailableCreationModel(source.params, runtime);
    const effectiveParams = {
      ...source.params,
      model: resolvedModel.model?.id || "auto",
    } as CreationSettings;
    let targetId = source.target?.id || "";
    const activeKey = generationKey(source);
    if (generationKeysRef.current.has(activeKey))
      return notify("这个节点正在生成，请稍候。", "error");
    generationKeysRef.current.add(activeKey);
    setGenerationKeys(new Set(generationKeysRef.current));
    try {
      // Draft and completed media cards both own their next generation. A
      // completed card is updated in place so a simple retry does not grow a
      // second branch node; lineage tools (mask/upscale) remain explicit
      // branch operations below.
      const pendingId = sourceNode?.id || source.target?.id;
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
        const base = source.target || sourceNode;
        const position = base
          ? {
              x:
                base.x +
                (source.target && !source.target.data.url
                  ? 0
                  : nodeSize(base).w + 90),
              y: base.y,
            }
          : screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
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
        const fillsTarget = Boolean(source.target);
        const selectedOutputIds = fillsTarget
          ? [source.target!.id, ...outputs.slice(1).map((output) => output.id)]
          : outputs.map((output) => output.id);
        updateDoc((value) => {
          let next = value;
          if (fillsTarget && source.target) {
            next = {
              ...next,
              nodes: [
                ...next.nodes.map((node) =>
                  node.id === source.target!.id
                    ? {
                        ...node,
                        ...outputs[0],
                        id: node.id,
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
              next = addEdge(
                next,
                source.target!.id,
                output.id,
                "right",
                "left",
                "variant",
              );
            });
          } else {
            next = { ...next, nodes: [...next.nodes, ...outputs] };
            if (source.target?.data.url)
              outputs.forEach((output) => {
                next = addEdge(
                  next,
                  source.target!.id,
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
          return next;
        });
        setSelectedIds(new Set(selectedOutputIds));
        setSelectedGroupId(null);
        writeSharedCreationSettings(imageParams);
        void recordCanvasImages(result.images, {
          prompt,
          modelId: imageParams.model,
          modelName: result.model?.name,
          providerName: result.model?.provider,
          aspectRatio: imageParams.aspect,
          outputSize:
            imageParams.sizeMode === "custom"
              ? `${imageParams.width}x${imageParams.height}`
              : imageParams.resolution,
          outputFormat: imageParams.outputFormat,
          parentId: source.target?.data.url ? source.target.id : undefined,
        })
          .then(() => setAssetRefresh((value) => value + 1))
          .catch(() => addLog("图片已生成，但写入主界面历史失败"));
        notify(`已生成 ${result.images.length} 张图片`);
        addLog(`图片生成完成：${result.images.length} 张`);
      } else {
        const videoParams = effectiveParams as VideoCreationSettings;
        const parent = source.target || sourceNode;
        const fillsTarget = Boolean(source.target);
        const position = parent
          ? {
              x: parent.x + (fillsTarget ? 0 : nodeSize(parent).w + 90),
              y: parent.y,
            }
          : screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const target = fillsTarget
          ? source.target!
          : createMedia("video", "", "视频任务", position, {
              role: "生成结果",
              status: "queued",
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
                    kind: source.target?.data.url ? "variant" : "generated",
                  },
                ]
              : value.edges,
          }));
        const referenceVideo =
          videoParams.operation !== "generate"
            ? String(
                (source.target?.data.kind === "video" &&
                  source.target.data.url) ||
                  linked.find((item) => item.data.kind === "video")?.data.url ||
                  "",
              )
            : undefined;
        const task = await generateCanvasVideo({
          prompt,
          model: videoParams.model,
          operation: videoParams.operation,
          inputMode: videoParams.inputMode,
          duration: videoParams.duration,
          aspect: videoParams.aspect,
          resolution: videoParams.resolution,
          references: linked
            .filter((item) => item.data.kind === "image" && item.data.url)
            .map((item) => ({
              url: String(item.data.url),
              name: String(item.data.name || "参考图片"),
            })),
          referenceVideo,
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
      updateDoc((value) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.id === sourceNode?.id || node.id === targetId
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
    runtime,
    screenToWorld,
    selectedNodes,
    selectedSingle,
    updateDoc,
  ]);

  const applyCanvasMask = useCallback(
    async (maskDataUrl: string) => {
      const node = maskNodeId
        ? nodeById(docRef.current, maskNodeId)
        : undefined;
      if (!node || node.type !== "media" || node.data.kind !== "image") {
        setMaskNodeId(null);
        return;
      }
      try {
        const uploaded = await uploadCanvasAsset(
          dataUrlFile(maskDataUrl, `mask-${node.id}.png`),
        );
        const settings = copyParams(
          node.data.generation?.params || node.data.params,
          "image",
          runtime,
        ) as ImageCreationSettings;
        commit((value) => ({
          ...value,
          nodes: value.nodes.map((item) =>
            item.id === node.id
              ? {
                  ...item,
                  data: {
                    ...item.data,
                    generation: {
                      kind: "image",
                      prompt: String(item.data.generation?.prompt || ""),
                      referenceIds: item.data.referenceOrder || [],
                      createdAt: item.data.generation?.createdAt || Date.now(),
                      ...item.data.generation,
                      params: {
                        ...settings,
                        mask: { assetId: uploaded.id, url: uploaded.url },
                      },
                    },
                  },
                }
              : item,
          ),
        }));
        setMaskNodeId(null);
        notify("蒙版已保存到节点快照，下一次生成会自动使用", "ok");
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "蒙版保存失败",
          "error",
        );
      }
    },
    [commit, maskNodeId, notify, runtime],
  );

  const runUpscale = useCallback(async () => {
    const source = selectedSingle;
    if (
      !source ||
      source.type !== "media" ||
      source.data.kind !== "image" ||
      !source.data.url
    )
      return notify("请先选择一张已完成的图片。", "error");
    const activeKey = `upscale:${source.id}`;
    if (generationKeysRef.current.has(activeKey)) return;
    const settings = copyParams(
      source.data.generation?.params || source.data.params,
      "image",
      runtime,
    ) as ImageCreationSettings;
    generationKeysRef.current.add(activeKey);
    setGenerationKeys(new Set(generationKeysRef.current));
    try {
      const result = await generateCanvasUpscale({
        prompt: source.data.generation?.prompt || "Upscale this image",
        model: settings.model,
        referenceUrl: String(source.data.url),
        scale: settings.upscaleScale,
        size:
          settings.upscaleTarget === "auto"
            ? undefined
            : settings.upscaleTarget,
        seed: settings.upscaleSeed,
        colorCorrection: settings.upscaleColorCorrection,
        resizeMethod: settings.upscaleAlgorithm,
      });
      if (!result.images?.length) throw new Error("服务端没有返回超分结果。");
      const output = createMedia(
        "image",
        result.images[0].url,
        `${source.data.name || "图片"} · 超分`,
        { x: source.x + nodeSize(source).w + 90, y: source.y },
        {
          role: "超分结果",
          model: result.model?.name || settings.model,
          generation: {
            kind: "image",
            prompt: source.data.generation?.prompt || "Upscale this image",
            params: clone(settings),
            referenceIds: [source.id],
            parentNodeId: source.id,
            createdAt: Date.now(),
          },
          referenceOrder: [source.id],
        },
      );
      commit((value) =>
        addEdge(
          { ...value, nodes: [...value.nodes, output] },
          source.id,
          output.id,
          "right",
          "left",
          "lineage",
        ),
      );
      setSelectedIds(new Set([output.id]));
      setSelectedGroupId(null);
      writeSharedCreationSettings(settings);
      void recordCanvasImages(result.images, {
        prompt: source.data.generation?.prompt || "Upscale this image",
        modelId: settings.model,
        modelName: result.model?.name,
        providerName: result.model?.provider,
        aspectRatio: settings.aspect,
        outputSize: settings.upscaleTarget,
        outputFormat: settings.outputFormat,
        parentId: source.id,
      }).then(() => setAssetRefresh((value) => value + 1));
      notify("超分完成，已创建右侧分支");
      addLog(`图片超分完成：${source.data.name || source.id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "超分失败", "error");
    } finally {
      generationKeysRef.current.delete(activeKey);
      setGenerationKeys(new Set(generationKeysRef.current));
    }
  }, [addLog, commit, notify, runtime, selectedSingle]);

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
      screenToWorld,
      stageSize.height,
      stageSize.width,
    ],
  );

  const addAssetAsReference = useCallback(
    (asset: AssetRecord) => {
      const ownerId = selectedGroupId || selectedSingle?.id;
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
            { role: "参考素材", sourceAssetId: asset.id },
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
    [commit, notify, openNodePosition, selectedGroupId, selectedSingle?.id],
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
      setWorkbenchOpen(false);
    },
    [fitView, notify],
  );

  const handleAssetDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const raw = event.dataTransfer.getData("application/x-sanmao-asset");
      if (!raw) return;
      event.preventDefault();
      try {
        const asset = JSON.parse(raw) as AssetRecord;
        if (!asset?.url || (asset.kind !== "image" && asset.kind !== "video"))
          throw new Error("invalid asset");
        addAssetToCanvas(asset, screenToWorld(event.clientX, event.clientY));
      } catch {
        notify("无法读取拖入的资产。", "error");
      } finally {
        setAssetDropGroupId(null);
      }
    },
    [addAssetToCanvas, notify, screenToWorld],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const stageRect = stageRef.current?.getBoundingClientRect();
      const centerX =
        (stageRect?.left || 0) + (stageRect?.width || stageSize.width) / 2;
      const centerY =
        (stageRect?.top || 0) + (stageRect?.height || stageSize.height) / 2;
      if (event.key === "Escape") {
        setContextMenu(null);
        setLightbox(null);
        setWorkbenchOpen(false);
        interactionRef.current = null;
        setConnection(null);
        setConnectionNodePicker(null);
        setConnectionTargetId(null);
        hideConnectionCancel();
        connectionHoverEdgeRef.current = null;
        clearSelection();
      } else if (!event.repeat && modifier && key === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (!event.repeat && modifier && key === "y") {
        event.preventDefault();
        redo();
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
      } else if (!event.repeat && !modifier && key === "a") {
        event.preventDefault();
        toggleAssetLibrary();
      } else if (!event.repeat && !modifier && key === "z") {
        event.preventDefault();
        zoomAt(centerX, centerY, 0.84);
      } else if (
        !event.repeat &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        if (selectedEdgeId) {
          commit((value) => removeEdge(value, selectedEdgeId));
          setSelectedEdgeId(null);
        } else deleteSelection();
      } else if (!event.repeat && !modifier && key === "f") {
        event.preventDefault();
        fitView();
      } else if (!event.repeat && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomAt(centerX, centerY, 1.12);
      } else if (!event.repeat && event.key === "-") {
        event.preventDefault();
        zoomAt(centerX, centerY, 0.88);
      } else if (!event.repeat && event.key === "0") {
        event.preventDefault();
        fitView();
      } else if (modifier && event.key === "Enter") {
        event.preventDefault();
        void runGeneration();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    breakGroup,
    clearSelection,
    commit,
    copySelection,
    deleteSelection,
    duplicateSelection,
    fitView,
    hideConnectionCancel,
    makeGroup,
    pasteFromClipboard,
    redo,
    runGeneration,
    selectedEdgeId,
    stageSize.height,
    stageSize.width,
    toggleAssetLibrary,
    undo,
    zoomAt,
  ]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const point = stagePoint(event.clientX, event.clientY);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        world: {
          x: (point.x - document.camera.x) / document.camera.zoom,
          y: (point.y - document.camera.y) / document.camera.zoom,
        },
      });
    },
    [document.camera, stagePoint],
  );
  const deck = deckSource();
  const deckKind = deck.kind;
  const generationBusy = generationKeys.has(generationKey(deck));
  const deckModelState = resolveAvailableCreationModel(deck.params, runtime);
  const maskNode = maskNodeId ? nodeById(document, maskNodeId) : undefined;
  const maskSettings = maskNode
    ? (copyParams(
        maskNode.data.generation?.params || maskNode.data.params,
        "image",
        runtime,
      ) as ImageCreationSettings)
    : undefined;
  const references = referenceOwnerId
    ? incomingReferences(document, referenceOwnerId)
    : selectedNodes.filter((node) => node.type === "media" && node.data.url);
  const filteredMentionCandidates = mentionCandidates.filter(
    (node, index) =>
      !mentionState?.query ||
      mentionLabel(node, index)
        .toLowerCase()
        .includes(mentionState.query.toLowerCase()),
  );
  const updateDeckPrompt = useCallback(
    (event: ReactChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      const cursor = event.target.selectionStart;
      updatePrompt(value);
      const before = value.slice(0, cursor);
      const match = before.match(/(?:^|[\s])@([^\s@]*)$/);
      if (!match) return setMentionState(null);
      setMentionState({
        start: cursor - match[0].length + (match[0].startsWith(" ") ? 1 : 0),
        end: cursor,
        query: match[1],
      });
    },
    [updatePrompt],
  );
  const chooseMention = useCallback(
    (node: CanvasNode) => {
      if (!mentionState) return;
      const index = mentionCandidates.findIndex((item) => item.id === node.id);
      if (index < 0) return;
      const value = deck.prompt;
      const next = `${value.slice(0, mentionState.start)}@${index + 1} ${value.slice(mentionState.end)}`;
      updatePrompt(next);
      setMentionState(null);
      window.requestAnimationFrame(() => deckPromptRef.current?.focus());
    },
    [deck.prompt, mentionCandidates, mentionState, updatePrompt],
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
  const connectionCancelEdge = connectionCancelEdgeId
    ? document.edges.find((edge) => edge.id === connectionCancelEdgeId)
    : undefined;
  const connectionCancelEdgeMidpoint = connectionCancelEdge
    ? (() => {
        const start = entityPortPoint(
          document,
          connectionCancelEdge.source,
          connectionCancelEdge.sourcePort || "right",
        );
        const end = entityPortPoint(
          document,
          connectionCancelEdge.target,
          connectionCancelEdge.targetPort || "left",
        );
        const sourceDirection =
          (connectionCancelEdge.sourcePort || "right") === "right" ? 1 : -1;
        const targetDirection =
          (connectionCancelEdge.targetPort || "left") === "left" ? -1 : 1;
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
      })()
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
    : mode === "text"
      ? "运行"
      : "生成";
  const runButtonTitle = generationBusy
    ? "正在处理中"
    : mode === "text"
      ? "运行 Agent"
      : deck.target
        ? "生成到此节点"
        : "生成";

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
      onClick={() => projectMenuOpen && setProjectMenuOpen(false)}
    >
      <header className="canvas-topbar">
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
            ← <span>主界面</span>
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
            className="canvas-soft-button"
            onClick={() => fileInputRef.current?.click()}
          >
            ＋ 导入素材
          </button>
          <button
            type="button"
            className="canvas-soft-button canvas-shortcuts-button"
            onClick={() => {
              setWorkbenchTab("shortcuts");
              setWorkbenchOpen(true);
            }}
          >
            ⌨ 快捷键
          </button>
          <button
            type="button"
            className="canvas-soft-button canvas-settings-button"
            onClick={() => {
              setWorkbenchTab("settings");
              setWorkbenchOpen(true);
            }}
          >
            ⚙ 设置
          </button>
          <button
            type="button"
            className="canvas-soft-button canvas-theme-button"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "切换深色界面" : "切换浅色界面"}
            title={theme === "light" ? "切换深色界面" : "切换浅色界面"}
          >
            {theme === "light" ? "☾ 深色" : "☀ 浅色"}
          </button>
          <div className="canvas-topbar-spacer" />
          <span
            className={`canvas-save-state ${saving ? "saving" : saveError ? "error" : ""}`}
          >
            <i />
            {saving ? "保存中…" : saveError ? "保存失败" : "已保存"}
          </span>
          <button
            type="button"
            className="canvas-workbench-button"
            onClick={() => setWorkbenchOpen(true)}
          >
            <span>◈</span>
            <b>工作台</b>
            <small>资产 · 工作流</small>
          </button>
        </div>
        <div className="canvas-project-popover-wrap">
          {projectMenuOpen && (
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
                      <small>
                        {new Date(project.updatedAt).toLocaleDateString(
                          "zh-CN",
                        )}
                      </small>
                    </span>
                  </button>
                  {project.id === activeProjectId && <i>✓</i>}
                </div>
              ))}
              <div className="canvas-popover-actions">
                <button type="button" onClick={newProject}>
                  ＋ 新建画布
                </button>
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
                    onChange={(event) =>
                      setProjectRenameValue(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveProjectName();
                      if (event.key === "Escape") setProjectRename(false);
                    }}
                    autoFocus
                  />
                  <button type="button" onClick={saveProjectName}>
                    保存
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <div
        ref={stageRef}
        className={`canvas-stage ${panActive ? "is-panning" : ""}`}
        onPointerDown={handleStagePointerDown}
        onPointerMove={moveInteraction}
        onPointerUp={finishInteraction}
        onPointerCancel={cancelPointerInteraction}
        onLostPointerCapture={cancelPointerInteraction}
        onDragStart={(event) => {
          if (!(event.target as HTMLElement).closest(".canvas-reference-item"))
            event.preventDefault();
        }}
        onDragOver={(event) => {
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
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setAssetDropGroupId(null);
        }}
        onDrop={handleAssetDrop}
        onContextMenu={handleContextMenu}
        onWheel={(event) => {
          if ((event.target as HTMLElement).closest(".canvas-minimap")) return;
          event.preventDefault();
          zoomAt(
            event.clientX,
            event.clientY,
            Math.exp(-event.deltaY * 0.0014),
          );
        }}
      >
        <div className="canvas-grid" />
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
              {document.edges.map((edge) => (
                <CanvasEdgeVisual
                  key={edge.id}
                  document={document}
                  edge={edge}
                  animation={connectionAnimation}
                  style={connectionStyle}
                  selected={selectedEdgeId === edge.id}
                  onSelect={() => {
                    hideConnectionCancel();
                    setSelectedEdgeId(edge.id);
                    setSelectedIds(new Set());
                    setSelectedGroupId(null);
                  }}
                  onCtrlClick={() => {
                    if (!connection) showConnectionCancel(edge.id);
                    setSelectedEdgeId(edge.id);
                    setSelectedIds(new Set());
                    setSelectedGroupId(null);
                  }}
                  onHover={(event) => handleConnectionHover(edge.id, event)}
                  onLeave={() => handleConnectionLeave(edge.id)}
                />
              ))}
              {draftConnection && (
                <path
                  className={`canvas-edge canvas-edge-draft node-color-${canvasSourceColorKey(document, draftConnection.sourceId)}`}
                  markerEnd={`url(#canvas-arrow-${canvasSourceColorKey(document, draftConnection.sourceId)})`}
                  d={(() => {
                    const dx =
                      Math.max(
                        72,
                        Math.abs(
                          draftConnection.end.x - draftConnection.start.x,
                        ) * 0.42,
                      ) * (draftConnection.sourcePort === "right" ? 1 : -1);
                    return `M ${draftConnection.start.x} ${draftConnection.start.y} C ${draftConnection.start.x + dx} ${draftConnection.start.y}, ${draftConnection.end.x - dx} ${draftConnection.end.y}, ${draftConnection.end.x} ${draftConnection.end.y}`;
                  })()}
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
              {document.nodes.map((node) => (
                <CanvasNodeCard
                  key={node.id}
                  node={node}
                  selected={selectedIds.has(node.id)}
                  document={document}
                  onPointerDown={startNodeDrag}
                  onResize={startResize}
                  onConnect={startConnection}
                  onSelect={(event) => selectNode(node, event.shiftKey)}
                  onPreview={() =>
                    setLightbox({ nodeId: node.id, compare: false })
                  }
                  onTextPreview={() => setTextLightboxNodeId(node.id)}
                  editing={editingNodeId === node.id}
                  onEdit={(value) => setEditingNodeId(value ? node.id : null)}
                  onNaturalSize={setMediaNaturalSize}
                  onPromptChange={(value) =>
                    updateDoc((valueDoc) => ({
                      ...valueDoc,
                      nodes: valueDoc.nodes.map((item) =>
                        item.id === node.id
                          ? { ...item, data: { ...item.data, text: value } }
                          : item,
                      ),
                    }))
                  }
                  onReorderReferences={reorderReference}
                />
              ))}
            </div>
          </div>
        </div>
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
            className="canvas-connection-cancel"
            aria-label="取消连线"
            title="取消连线"
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
              if (modifierHeldRef.current && connectionCancelEdgeId)
                scheduleConnectionCancelHide(connectionCancelEdgeId);
              else if (!modifierHeldRef.current) hideConnectionCancel();
            }}
            onPointerDown={
              connectionCancelEdge ? removeConnection : cancelConnection
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
        <div className={`canvas-deck ${deckCollapsed ? "collapsed" : ""}`}>
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
                    ? `已连接 ${references.length} 个参考素材`
                    : selectedSingle?.type === "media" &&
                        selectedSingle.data.url
                      ? "再次生成会回写当前节点；蒙版、超分仍创建独立分支"
                      : "生成结果直接进入画布卡片"}
              </small>
            </div>
            {selectedSingle?.type === "media" &&
              selectedSingle.data.kind === "image" &&
              selectedSingle.data.url && (
                <div className="canvas-deck-node-tools" aria-label="图片工具">
                  <button
                    type="button"
                    title="绘制蒙版；结果会创建新分支"
                    onClick={() => setMaskNodeId(selectedSingle.id)}
                  >
                    <span>◌</span> 蒙版
                  </button>
                  <button
                    type="button"
                    title="超分；结果会创建新分支"
                    disabled={generationKeys.has(
                      `upscale:${selectedSingle.id}`,
                    )}
                    onClick={() => void runUpscale()}
                  >
                    <span>↗</span>{" "}
                    {generationKeys.has(`upscale:${selectedSingle.id}`)
                      ? "处理中"
                      : "超分"}
                  </button>
                </div>
              )}
            <button
              type="button"
              className="canvas-deck-collapse"
              aria-label={deckCollapsed ? "展开创作工作台" : "收起创作工作台"}
              onClick={toggleDeckCollapsed}
            >
              {deckCollapsed ? "⌃" : "⌄"}
            </button>
          </div>
          {!deckCollapsed && (
            <>
              <div className="canvas-deck-main">
                <button
                  type="button"
                  className="canvas-context-add"
                  aria-label="导入参考素材"
                  onClick={() => fileInputRef.current?.click()}
                >
                  ＋
                </button>
                <CanvasReferenceList
                  document={document}
                  ownerId={referenceOwnerId}
                  nodes={references}
                  onReorder={reorderReference}
                  variant="deck"
                />
                <div className="canvas-prompt-input-wrap">
                  <textarea
                    ref={deckPromptRef}
                    value={
                      selectedSingle?.type === "prompt"
                        ? String(
                            selectedSingle.data.agentPrompt ||
                              selectedSingle.data.text ||
                              "",
                          )
                        : deck.prompt
                    }
                    onChange={updateDeckPrompt}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setMentionState(null);
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
              <div className="canvas-deck-params">
                <CreationParameterEditor
                  settings={deck.params}
                  runtime={runtime}
                  unavailableModelId={deckModelState.unavailableModelId}
                  referenceCount={references.length}
                  onChange={updateParams}
                />
              </div>
            </>
          )}
        </div>
        <CanvasMinimap
          document={document}
          selectedIds={selectedIds}
          bounds={minimapBounds}
          stageSize={stageSize}
          zoomAt={zoomAt}
          fitView={fitView}
          onNavigate={panToWorld}
          onMoveNodes={moveMinimapNodes}
        />
        {contextMenu && (
          <div
            className="canvas-context-menu"
            style={{
              left: clamp(contextMenu.x, 8, window.innerWidth - 250),
              top: clamp(contextMenu.y, 8, window.innerHeight - 330),
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="canvas-menu-title">添加节点</div>
            <button
              type="button"
              onClick={() => addNode("image", contextMenu.world)}
            >
              ✦ 空图片节点 <small>结果直接写入节点</small>
            </button>
            <button
              type="button"
              onClick={() => addNode("video", contextMenu.world)}
            >
              ▶ 空视频节点 <small>结果直接写入节点</small>
            </button>
            <button
              type="button"
              onClick={() => addNode("text", contextMenu.world)}
            >
              ✦ Agent 节点
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                fileInputRef.current?.click();
              }}
            >
              ＋ 导入图片 / 视频
            </button>
            <hr />
            <button
              type="button"
              onClick={() => addNode("workflowImage", contextMenu.world)}
            >
              ✦ 高级图片工作流节点
            </button>
            <button
              type="button"
              onClick={() => addNode("workflowVideo", contextMenu.world)}
            >
              ▶ 高级视频工作流节点
            </button>
            <hr />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                arrangeCanvasAction();
              }}
            >
              ⌗ 一键整理
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                fitView();
              }}
            >
              ⌗ 适应全部
            </button>
          </div>
        )}
      </div>
      {lightbox && (
        <CanvasLightbox
          node={nodeById(document, lightbox.nodeId)}
          compare={lightbox.compare}
          references={
            nodeById(document, lightbox.nodeId)
              ? incomingReferences(document, lightbox.nodeId)
              : []
          }
          onClose={() => setLightbox(null)}
          onCompare={() =>
            setLightbox((value) =>
              value ? { ...value, compare: !value.compare } : value,
            )
          }
        />
      )}
      {textLightboxNodeId && (
        <CanvasTextLightbox
          node={nodeById(document, textLightboxNodeId)}
          onClose={() => setTextLightboxNodeId(null)}
          onNotify={notify}
        />
      )}
      {maskNode?.data.url && (
        <MaskEditor
          imageUrl={String(maskNode.data.url)}
          initialMaskDataUrl={maskSettings?.mask?.url}
          onApply={(value) => void applyCanvasMask(value)}
          onCancel={() => setMaskNodeId(null)}
        />
      )}
      {workbenchOpen && workbenchTab === "assets" && (
        <CanvasAssetDrawer
          extraAssets={canvasAssets}
          refresh={assetRefresh}
          canReference={Boolean(selectedGroupId || selectedSingle)}
          onAdd={addAssetToCanvas}
          onReference={addAssetAsReference}
          onLocate={locateAsset}
          onClose={() => setWorkbenchOpen(false)}
          onOpenWorkbench={() => setWorkbenchTab("workflow")}
          onNotify={notify}
        />
      )}
      {workbenchOpen && workbenchTab !== "assets" && (
        <CanvasWorkbench
          tab={workbenchTab}
          setTab={setWorkbenchTab}
          nodes={document.nodes}
          groups={document.groups}
          edges={document.edges}
          projects={projects}
          activeProjectId={activeProjectId}
          logs={logs}
          connectionAnimation={connectionAnimation}
          onConnectionAnimationChange={setConnectionAnimation}
          connectionStyle={connectionStyle}
          onConnectionStyleChange={setConnectionStyle}
          onClose={() => setWorkbenchOpen(false)}
          onExport={exportWorkflow}
          onImport={() => workflowInputRef.current?.click()}
          onArrange={arrangeCanvasAction}
          onDeleteProject={deleteProject}
        />
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
          if (event.target.files) void handleFiles(event.target.files);
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

function CanvasAssetDrawer({
  extraAssets,
  refresh,
  canReference,
  onAdd,
  onReference,
  onLocate,
  onClose,
  onOpenWorkbench,
  onNotify,
}: {
  extraAssets: AssetRecord[];
  refresh: number;
  canReference: boolean;
  onAdd: (asset: AssetRecord) => void;
  onReference: (asset: AssetRecord) => void;
  onLocate: (asset: AssetRecord) => void;
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

  const reload = useCallback(() => {
    setLoading(true);
    void listUnifiedAssets(extraAssets)
      .then(setAssets)
      .catch(() => onNotify("资产中心读取失败，请稍后重试。", "error"))
      .finally(() => setLoading(false));
  }, [extraAssets, onNotify]);

  useEffect(reload, [refresh, reload]);

  const setDrawerCollapsed = (value: boolean) => {
    setCollapsed(value);
  };

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const result = assets.filter(
      (asset) =>
        (kind === "all" || asset.kind === kind) &&
        (source === "all" || asset.source === source) &&
        (!favoritesOnly || asset.favorite) &&
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
  }, [assets, favoritesOnly, kind, query, sort, source]);

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
      <aside className="canvas-asset-drawer" aria-label="全局资产中心">
        <header>
          <div>
            <span>◈</span>
            <span>
              <b>全局资产中心</b>
              <small>历史、视频任务与所有画布</small>
            </span>
          </div>
          <div>
            <button type="button" onClick={onOpenWorkbench}>
              工作流
            </button>
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
            <SelectMenu
              value={source}
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
                    <b title={asset.name}>{asset.name}</b>
                    <small>
                      {ASSET_SOURCE_LABELS[asset.source]} ·{" "}
                      {asset.createdAt
                        ? new Date(asset.createdAt).toLocaleDateString("zh-CN")
                        : "当前画布"}
                    </small>
                    {asset.prompt && <p>{asset.prompt}</p>}
                  </div>
                  <div className="canvas-global-asset-actions">
                    <button type="button" onClick={() => onAdd(asset)}>
                      ＋ 画布
                    </button>
                    <button
                      type="button"
                      disabled={!canReference}
                      onClick={() => onReference(asset)}
                    >
                      ⌁ 参考
                    </button>
                    <button type="button" onClick={() => onLocate(asset)}>
                      ⌖
                    </button>
                    <button
                      type="button"
                      className={asset.favorite ? "active" : ""}
                      onClick={() => void toggleFavorite(asset)}
                    >
                      ★
                    </button>
                    <a href={asset.url} download={asset.name} title="下载">
                      ↓
                    </a>
                    <button
                      type="button"
                      className="danger"
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
      {preview && (
        <div
          className="canvas-asset-preview-backdrop"
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
        </div>
      )}
    </>
  );
}

function CanvasReferenceList({
  document,
  ownerId,
  nodes,
  onReorder,
  variant = "card",
}: {
  document: CanvasDocument;
  ownerId?: string;
  nodes?: CanvasNode[];
  onReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  variant?: "card" | "deck";
}) {
  const references = ownerId
    ? incomingReferences(document, ownerId)
    : nodes || [];
  if (!references.length)
    return (
      <small className="canvas-reference-empty">连接素材后显示参考顺序</small>
    );
  return (
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
          <span className="canvas-reference-index">{index + 1}</span>
          {item.data.kind === "video" ? (
            <video src={item.data.url} muted playsInline />
          ) : (
            <img src={item.data.url} alt={item.data.name || "参考素材"} />
          )}
          <b>
            {item.data.name ||
              (item.data.kind === "video" ? "视频素材" : "图片素材")}
          </b>
        </div>
      ))}
    </div>
  );
}

function CanvasNodeCard({
  node,
  selected,
  document,
  onPointerDown,
  onResize,
  onConnect,
  onSelect,
  onPreview,
  onTextPreview,
  onNaturalSize,
  onPromptChange,
  onReorderReferences,
  editing,
  onEdit,
}: {
  node: CanvasNode;
  selected: boolean;
  document: CanvasDocument;
  onPointerDown: (event: ReactPointerEvent, node: CanvasNode) => void;
  onResize: (event: ReactPointerEvent, node: CanvasNode) => void;
  onConnect: (
    event: ReactPointerEvent,
    nodeId: string,
    port: "left" | "right",
  ) => void;
  onSelect: (event: ReactPointerEvent) => void;
  onPreview: () => void;
  onTextPreview: () => void;
  onNaturalSize: (nodeId: string, width: number, height: number) => void;
  onPromptChange: (value: string) => void;
  onReorderReferences: (
    ownerId: string,
    draggedId: string,
    targetId: string,
  ) => void;
  editing: boolean;
  onEdit: (value: boolean) => void;
}) {
  const size = nodeSize(node);
  const data = node.data;
  const colorKey = canvasNodeColorKey(node);
  const status = data.status || "idle";
  const pending = data.status === "queued" || data.status === "running";
  const failed = data.status === "failed" && !data.url;
  const agentResponse =
    node.type === "prompt" &&
    (data.agentResponse || String(data.role || "").includes("回复"))
      ? String(data.agentResponse || data.text || "")
      : "";
  return (
    <article
      className={`canvas-node node-color-${colorKey} status-${status} ${selected ? "selected" : ""}`}
      data-canvas-node-id={node.id}
      data-canvas-connectable-id={node.id}
      data-node-color={colorKey}
      style={{ left: node.x, top: node.y, width: size.w, height: size.h }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={() => {
        if (node.type === "prompt") onEdit(true);
        else if (node.type === "media" && data.url) onPreview();
      }}
    >
      <button
        type="button"
        className="canvas-port left"
        aria-label="左侧连接端口"
        onPointerDown={(event) => onConnect(event, node.id, "left")}
      />
      {node.type === "media" && (
        <div className="canvas-media-card">
          <div className="canvas-media-stage">
            {pending ? (
              <div className="canvas-media-state pending">
                <span>✦</span>
                <b>{data.statusLabel || "生成中"}</b>
                <small>{Number(data.progress || 0)}%</small>
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
                onLoadedMetadata={(event) =>
                  onNaturalSize(
                    node.id,
                    event.currentTarget.videoWidth,
                    event.currentTarget.videoHeight,
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
              <span className="canvas-video-mark">▶</span>
            )}
          </div>
          <div className="canvas-node-footer">
            <span className="canvas-type-icon">
              {data.kind === "video" ? "▶" : "▣"}
            </span>
            <span className="canvas-node-title">
              <b>{data.name || "素材"}</b>
              <small>{data.model || nodeStatus(node)}</small>
            </span>
            <em>{nodeStatus(node)}</em>
          </div>
        </div>
      )}
      {node.type === "prompt" && (
        <div className="canvas-prompt-card">
          <div className="canvas-node-kicker">
            <span>✦</span>
            <b>{String(data.role || "Agent 节点")}</b>
          </div>
          {editing ? (
            <textarea
              value={String(data.text || "")}
              placeholder="输入要交给 Agent 的任务…"
              autoFocus
              onChange={(event) => onPromptChange(event.target.value)}
              onBlur={() => onEdit(false)}
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
              <b>{data.kind === "video" ? "视频生成" : "图片生成"}</b>
              <small>
                {data.status === "running" ? "生成中…" : "高级工作流节点"}
              </small>
            </div>
          </div>
          <CanvasReferenceList
            document={document}
            ownerId={node.id}
            onReorder={onReorderReferences}
            variant="card"
          />
          <div className="canvas-generator-prompt">
            {String(data.prompt || "点击选中，在下方编辑提示词")}
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
  selectedIds,
  bounds,
  stageSize,
  zoomAt,
  fitView,
  onNavigate,
  onMoveNodes,
}: {
  document: CanvasDocument;
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
            if (!source || !target) return null;
            const colorKey = canvasSourceColorKey(document, edge.source);
            const sourceSize = nodeSize(source);
            const targetSize = nodeSize(target);
            const start = mapPosition(
              source.x + sourceSize.w / 2,
              source.y + sourceSize.h / 2,
            );
            const end = mapPosition(
              target.x + targetSize.w / 2,
              target.y + targetSize.h / 2,
            );
            const curve = Math.max(5, Math.abs(end.x - start.x) * 0.38);
            return (
              <path
                key={edge.id}
                className={`node-color-${colorKey}`}
                d={`M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`}
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
}: {
  node?: CanvasNode;
  onClose: () => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
}) {
  const text =
    node?.type === "prompt"
      ? String(node.data.agentResponse || node.data.text || "")
      : "";

  useEffect(() => {
    if (!node) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [node, onClose]);

  if (!node || node.type !== "prompt" || !text) return null;
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify("Agent 回复已复制");
    } catch {
      onNotify("复制失败，请检查浏览器剪贴板权限", "error");
    }
  };
  return (
    <div
      className="canvas-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Agent 回复"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="canvas-text-lightbox">
        <header>
          <div>
            <b>Agent 回复</b>
            <small>
              {node.data.model ? `对话模型 · ${String(node.data.model)}` : "对话模型"}
              {node.data.agentPrompt ? " · 已保留原始任务" : ""}
            </small>
          </div>
          <div className="canvas-text-lightbox-actions">
            <button type="button" onClick={() => void copyText()}>
              复制全文
            </button>
            <button type="button" onClick={onClose} aria-label="关闭 Agent 回复">
              ×
            </button>
          </div>
        </header>
        {node.data.agentPrompt && (
          <div className="canvas-text-lightbox-prompt">
            <span>任务</span>
            <p>{String(node.data.agentPrompt)}</p>
          </div>
        )}
        <div className="canvas-text-lightbox-body">{text}</div>
        <footer>
          <span>{text.length.toLocaleString()} 字</span>
          <span>按 Esc 关闭</span>
        </footer>
      </div>
    </div>
  );
}

function CanvasLightbox({
  node,
  compare,
  references,
  onClose,
  onCompare,
}: {
  node?: CanvasNode;
  compare: boolean;
  references: CanvasNode[];
  onClose: () => void;
  onCompare: () => void;
}) {
  if (!node || node.type !== "media" || !node.data.url) return null;
  const reference = references[0];
  return (
    <div
      className="canvas-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="canvas-lightbox">
        <header>
          <div>
            <b>{node.data.name || "素材预览"}</b>
            <small>
              {node.data.nativeWidth && node.data.nativeHeight
                ? `${node.data.nativeWidth} × ${node.data.nativeHeight}`
                : "画布媒体预览"}
            </small>
          </div>
          <div>
            <button type="button" onClick={onCompare} disabled={!reference}>
              {compare ? "单图预览" : "前后对比"}
            </button>
            <button type="button" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        <div
          className={`canvas-lightbox-stage ${compare && reference ? "compare" : ""}`}
        >
          {compare && reference?.data.url && (
            <div className="canvas-lightbox-before">
              <span>参考图</span>
              <img src={reference.data.url} alt="参考图" />
            </div>
          )}
          <div className="canvas-lightbox-after">
            <span>{compare ? "生成结果" : ""}</span>
            {node.data.kind === "video" ? (
              <video src={node.data.url} controls playsInline />
            ) : (
              <img src={node.data.url} alt={node.data.name || "预览"} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CanvasWorkbench({
  tab,
  setTab,
  nodes,
  groups,
  edges,
  projects,
  activeProjectId,
  logs,
  connectionAnimation,
  onConnectionAnimationChange,
  connectionStyle,
  onConnectionStyleChange,
  onClose,
  onExport,
  onImport,
  onArrange,
  onDeleteProject,
}: {
  tab: WorkbenchTab;
  setTab: (tab: WorkbenchTab) => void;
  nodes: CanvasNode[];
  groups: CanvasGroup[];
  edges: CanvasEdge[];
  projects: CanvasProject[];
  activeProjectId: string;
  logs: string[];
  connectionAnimation: ConnectionAnimation;
  onConnectionAnimationChange: (value: ConnectionAnimation) => void;
  connectionStyle: ConnectionStyle;
  onConnectionStyleChange: (value: ConnectionStyle) => void;
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
  onArrange: () => void;
  onDeleteProject: (id: string) => void;
}) {
  const media = nodes.filter(
    (node) => node.type === "media" && Boolean(node.data.url),
  );
  const tabs = [
    "assets",
    "workflow",
    "logs",
    "shortcuts",
    "project",
    "settings",
  ] as const;
  const tabLabels: Record<WorkbenchTab, string> = {
    assets: "资产",
    workflow: "工作流",
    logs: "日志",
    shortcuts: "快捷键",
    project: "项目",
    settings: "设置",
  };
  return (
    <div
      className="canvas-modal-backdrop workbench-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="canvas-workbench">
        <header>
          <div>
            <span className="canvas-logo-mark small">
              <img src="/brand-mark.png" alt="" />
            </span>
            <span>
              <b>统一工作台</b>
              <small>资产、工作流与画布项目</small>
            </span>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </header>
        <nav>
          {tabs.map((item) => (
            <button
              type="button"
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {tabLabels[item]}
            </button>
          ))}
        </nav>
        <div className="canvas-workbench-content">
          {tab === "assets" && (
            <div className="canvas-workbench-section">
              <div className="canvas-workbench-heading">
                <span>
                  <b>画布资产</b>
                  <small>{media.length} 个媒体节点</small>
                </span>
              </div>
              {media.length ? (
                <div className="canvas-asset-grid">
                  {media.map((node) => (
                    <div className="canvas-asset-card" key={node.id}>
                      {node.data.kind === "video" ? (
                        <video src={node.data.url} muted />
                      ) : (
                        <img src={node.data.url} alt="" />
                      )}
                      <span>{node.data.name || "素材"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="canvas-empty-panel">
                  导入的图片和视频会集中显示在这里。
                </div>
              )}
            </div>
          )}
          {tab === "workflow" && (
            <div className="canvas-workbench-section">
              <div className="canvas-workbench-heading">
                <span>
                  <b>工作流</b>
                  <small>
                    {nodes.length} 个节点 · {edges.length} 条连线 ·{" "}
                    {groups.length} 个对象组
                  </small>
                </span>
              </div>
              <div className="canvas-workbench-actions">
                <button type="button" className="primary" onClick={onArrange}>
                  ⌗ 一键整理
                </button>
                <button type="button" onClick={onExport}>
                  ↓ 导出 JSON
                </button>
                <button type="button" onClick={onImport}>
                  ↑ 导入 JSON
                </button>
              </div>
              <div className="canvas-empty-panel">
                通过节点端口连接图片、视频和文本，生成结果会自动保留引用关系。
              </div>
            </div>
          )}
          {tab === "logs" && (
            <div className="canvas-workbench-section">
              <div className="canvas-workbench-heading">
                <span>
                  <b>操作日志</b>
                  <small>最近 {logs.length} 条操作</small>
                </span>
              </div>
              {logs.length ? (
                <div className="canvas-log-list">
                  {logs.map((log, index) => (
                    <div key={`${log}-${index}`}>
                      <time>{index + 1}</time>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="canvas-empty-panel">还没有操作日志。</div>
              )}
            </div>
          )}
          {tab === "shortcuts" && (
            <div className="canvas-workbench-section">
              <div className="canvas-workbench-heading">
                <span>
                  <b>快捷键</b>
                  <small>这些按键可直接操作当前画布</small>
                </span>
              </div>
              <div className="canvas-shortcut-list">
                {CANVAS_SHORTCUTS.map((shortcut) => (
                  <div key={`${shortcut.keys.join("+")}-${shortcut.label}`}>
                    <kbd>
                      {shortcut.keys.map((key) => (
                        <span key={key}>{key}</span>
                      ))}
                    </kbd>
                    <span>{shortcut.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "project" && (
            <div className="canvas-workbench-section">
              <div className="canvas-workbench-heading">
                <span>
                  <b>项目管理</b>
                  <small>本地优先保存 · 支持 JSON 备份</small>
                </span>
              </div>
              {projects.map((project) => (
                <div
                  className={`canvas-project-manage-row ${project.id === activeProjectId ? "active" : ""}`}
                  key={project.id}
                >
                  <span className="canvas-project-dot">✦</span>
                  <div>
                    <b>{project.name}</b>
                    <small>
                      {new Date(project.updatedAt).toLocaleString("zh-CN")}
                    </small>
                  </div>
                  {projects.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteProject(project.id)}
                    >
                      删除
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab === "settings" && (
            <div className="canvas-workbench-section">
              <div className="canvas-workbench-heading">
                <span>
                  <b>画布设置</b>
                  <small>调整画布交互与显示效果</small>
                </span>
              </div>
              <div className="canvas-settings-card">
                <div>
                  <b>节点连线动态</b>
                  <small>
                    选择连线在画布中的显示方式，设置会自动保存到本机。
                  </small>
                </div>
                <div className="canvas-settings-options">
                  {CONNECTION_ANIMATION_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={
                        connectionAnimation === option.value ? "active" : ""
                      }
                      aria-pressed={connectionAnimation === option.value}
                      onClick={() => onConnectionAnimationChange(option.value)}
                    >
                      <span
                        className="canvas-settings-option-icon"
                        data-animation={option.value}
                      >
                        ⌁
                      </span>
                      <span>
                        <b>{option.label}</b>
                        <small>{option.description}</small>
                      </span>
                      <i>{connectionAnimation === option.value ? "✓" : ""}</i>
                    </button>
                  ))}
                </div>
              </div>
              <div className="canvas-settings-card">
                <div>
                  <b>节点连线形式</b>
                  <small>
                    切换曲线、直线或流程图式折线，设置会自动保存到本机。
                  </small>
                </div>
                <div className="canvas-settings-options">
                  {CONNECTION_STYLE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={
                        connectionStyle === option.value ? "active" : ""
                      }
                      aria-pressed={connectionStyle === option.value}
                      onClick={() => onConnectionStyleChange(option.value)}
                    >
                      <span
                        className="canvas-settings-option-icon"
                        data-style={option.value}
                      >
                        {option.value === "curve"
                          ? "⌒"
                          : option.value === "straight"
                            ? "╱"
                            : "┘"}
                      </span>
                      <span>
                        <b>{option.label}</b>
                        <small>{option.description}</small>
                      </span>
                      <i>{connectionStyle === option.value ? "✓" : ""}</i>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
