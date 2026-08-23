'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addEdge, clone, createEmptyMedia, createGenerator, createGroup, createMedia, createPrompt,
  edgePath, entityBounds, groupBounds, groupById, groupNodes, incomingReferences, mediaCardSizeForRatio,
  nodeById, nodeSize, normalizeDocument, removeEdge, removeNodes, smartPrompt, snapshot, uid,
} from '@/lib/canvas/model';
import { getCanvasVideoTask, generateCanvasImage, generateCanvasVideo, loadCanvasRuntime, uploadCanvasAsset } from '@/lib/canvas/api';
import { canvasProjectFromDocument, deleteCanvasProject, ensureCanvasStorage, loadCanvasDocument, saveCanvasDocument, saveCanvasProjects } from '@/lib/canvas/storage';
import type { CanvasCamera, CanvasDocument, CanvasEdge, CanvasGenerationParams, CanvasGroup, CanvasMediaKind, CanvasNode, CanvasProject, CanvasRuntimeState, CanvasSnapshot } from '@/lib/canvas/types';

type Mode = CanvasMediaKind | 'text';
type Point = { x: number; y: number };
type Notice = { message: string; kind: 'ok' | 'error' };
type WorkbenchTab = 'assets' | 'workflow' | 'logs' | 'shortcuts' | 'project' | 'settings';
type ConnectionAnimation = 'none' | 'flow' | 'pulse' | 'dash';
type Interaction =
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; camera: CanvasCamera; changed: boolean }
  | { kind: 'drag'; pointerId: number; startX: number; startY: number; nodeIds: string[]; positions: Record<string, Point>; changed: boolean }
  | { kind: 'resize'; pointerId: number; startX: number; startY: number; nodeId: string; width: number; height: number; changed: boolean }
  | { kind: 'resizeGroup'; pointerId: number; startX: number; startY: number; groupId: string; bounds: { x: number; y: number; w: number; h: number }; origin: Point; nodes: Record<string, { x: number; y: number; w: number; h: number }>; changed: boolean }
  | { kind: 'marquee'; pointerId: number; startX: number; startY: number; changed: boolean }
  | { kind: 'connect'; pointerId: number; sourceId: string; sourcePort: 'left' | 'right'; end: Point; start: Point };
type ConnectionPreview = { start: Point; end: Point; sourcePort: 'left' | 'right' };

const IMAGE_ASPECTS = ['自动', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'];
const VIDEO_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'];
const IMAGE_RESOLUTIONS = ['自动', '1K', '2K', '4K'];
const VIDEO_RESOLUTIONS = ['自动', '480P', '720P', '1080P'];
const CANVAS_SETTINGS_KEY = 'sanmao.canvas.settings';
const CONNECTION_ANIMATION_OPTIONS: Array<{ value: ConnectionAnimation; label: string; description: string }> = [
  { value: 'none', label: '关闭动态', description: '保持连线静态，减少视觉干扰' },
  { value: 'flow', label: '流光', description: '沿连线方向持续流动' },
  { value: 'pulse', label: '呼吸', description: '连线亮度与光晕缓慢变化' },
  { value: 'dash', label: '行进', description: '短线段沿连线方向行进' },
];

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function formatPercent(value: number) { return `${Math.round(value * 100)}%`; }

function defaultParams(kind: CanvasMediaKind, runtime: CanvasRuntimeState | null): CanvasGenerationParams {
  const models = runtime?.models.filter((model) => model.kind === kind && model.enabled && model.published) || [];
  return {
    model: kind === 'image' ? runtime?.settings.defaultImageModelId || models[0]?.id || '' : runtime?.settings.defaultVideoModelId || models[0]?.id || '',
    aspect: kind === 'image' ? '自动' : '16:9', resolution: kind === 'image' ? '1K' : '720P', quality: '自动', count: 1, duration: 5, audio: false,
  };
}

function copyParams(value: unknown, kind: CanvasMediaKind, runtime: CanvasRuntimeState | null) {
  return { ...defaultParams(kind, runtime), ...(value && typeof value === 'object' ? clone(value as CanvasGenerationParams) : {}) };
}

function nodeLabel(node: CanvasNode) {
  if (node.type === 'prompt') return '文本节点';
  if (node.type === 'generator') return node.data.kind === 'video' ? '视频生成节点' : '图片生成节点';
  return node.data.kind === 'video' ? '视频卡片' : '图片卡片';
}

function nodeStatus(node: CanvasNode) {
  if (node.data.status === 'queued' || node.data.status === 'running') return node.data.statusLabel || '生成中';
  if (node.data.status === 'failed') return node.data.statusLabel || '生成失败，可重试';
  if (!node.data.url && node.data.status === 'draft') return node.data.statusLabel || '选中后在下方生成';
  return node.data.role || '参考素材';
}

function rectanglesOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap = 28) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

function CanvasEdgeVisual({ document, edge, animation, selected, onSelect }: { document: CanvasDocument; edge: CanvasEdge; animation: ConnectionAnimation; selected: boolean; onSelect: () => void }) {
  const path = edgePath(document, edge);
  const motionPathId = `canvas-edge-motion-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return <g>
    <defs><path id={motionPathId} d={path} /></defs>
    <path className={`canvas-edge canvas-edge-${animation} ${selected ? 'selected' : ''}`} d={path} markerEnd="url(#canvas-arrow)" onPointerDown={(event) => { event.stopPropagation(); onSelect(); }} />
    {animation === 'flow' && <g className="canvas-edge-flow-light" aria-hidden="true">
      <animateMotion dur="1.45s" repeatCount="indefinite" rotate="auto"><mpath href={`#${motionPathId}`} /></animateMotion>
      <path className="canvas-edge-flow-shape" d="M -26 0 L 0 -6 L 26 0 L 0 6 Z" />
      <path className="canvas-edge-flow-core" d="M -14 0 L 0 -3.2 L 14 0 L 0 3.2 Z" />
    </g>}
  </g>;
}

export default function SuperCanvas() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workflowInputRef = useRef<HTMLInputElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const docRef = useRef<CanvasDocument>(normalizeDocument(null));
  const saveTimerRef = useRef<number | null>(null);
  const pollTimersRef = useRef<Set<number>>(new Set());
  const pollAttemptsRef = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);
  const generationBusyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [runtime, setRuntime] = useState<CanvasRuntimeState | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [document, setDocument] = useState<CanvasDocument>(docRef.current);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const [mode, setMode] = useState<Mode>('image');
  const [drafts, setDrafts] = useState<Record<Mode, { prompt: string; params: CanvasGenerationParams }>>({ image: { prompt: '', params: defaultParams('image', null) }, video: { prompt: '', params: defaultParams('video', null) }, text: { prompt: '', params: {} } });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; world: Point } | null>(null);
  const [lightbox, setLightbox] = useState<{ nodeId: string; compare: boolean } | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('assets');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectRename, setProjectRename] = useState(false);
  const [projectRenameValue, setProjectRenameValue] = useState('');
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [connection, setConnection] = useState<ConnectionPreview | null>(null);
  const [connectionTargetId, setConnectionTargetId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [deckCollapsed, setDeckCollapsed] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1200, height: 760 });
  const [connectionAnimation, setConnectionAnimation] = useState<ConnectionAnimation>('flow');

  const currentProject = projects.find((project) => project.id === activeProjectId);
  const selectedNodes = useMemo(() => document.nodes.filter((node) => selectedIds.has(node.id)), [document.nodes, selectedIds]);
  const selectedSingle = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedGroup = selectedGroupId ? groupById(document, selectedGroupId) : undefined;
  const models = useMemo(() => runtime?.models.filter((model) => model.enabled && model.published) || [], [runtime]);
  const imageModels = useMemo(() => models.filter((model) => model.kind === 'image'), [models]);
  const videoModels = useMemo(() => models.filter((model) => model.kind === 'video'), [models]);
  const mediaNodes = useMemo(() => document.nodes.filter((node) => node.type === 'media'), [document.nodes]);

  const setDoc = useCallback((next: CanvasDocument) => { docRef.current = next; setDocument(next); }, []);
  const updateDoc = useCallback((updater: (value: CanvasDocument) => CanvasDocument) => setDoc(updater(docRef.current)), [setDoc]);
  const commit = useCallback((updater: (value: CanvasDocument) => CanvasDocument) => { setUndoStack((items) => [...items, snapshot(docRef.current)].slice(-60)); setRedoStack([]); updateDoc(updater); }, [updateDoc]);
  const addLog = useCallback((message: string) => setLogs((items) => [message, ...items].slice(0, 120)), []);
  const notify = useCallback((message: string, kind: Notice['kind'] = 'ok') => { setNotice({ message, kind }); window.setTimeout(() => setNotice((value) => value?.message === message ? null : value), kind === 'error' ? 5200 : 2800); }, []);

  useEffect(() => {
    const storage = ensureCanvasStorage();
    const initial = loadCanvasDocument(storage.activeId);
    docRef.current = initial; setDocument(initial); setProjects(storage.projects); setActiveProjectId(storage.activeId); setReady(true);
    if (storage.migrated) notify('已将 NOVA 画布项目迁移到 SANMAO.AI');
    void loadCanvasRuntime().then((value) => { setRuntime(value); setDrafts((current) => ({ ...current, image: { ...current.image, params: { ...defaultParams('image', value), ...current.image.params } }, video: { ...current.video, params: { ...defaultParams('video', value), ...current.video.params } } })); }).catch((error: unknown) => setRuntimeError(error instanceof Error ? error.message : '模型库读取失败'));
    return () => { mountedRef.current = false; pollTimersRef.current.forEach((timer) => window.clearTimeout(timer)); pollTimersRef.current.clear(); pollAttemptsRef.current.clear(); };
  }, [notify]);

  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(CANVAS_SETTINGS_KEY) || 'null') as { connectionAnimation?: unknown } | null;
      if (CONNECTION_ANIMATION_OPTIONS.some((item) => item.value === raw?.connectionAnimation)) setConnectionAnimation(raw!.connectionAnimation as ConnectionAnimation);
    } catch { /* 使用默认设置 */ }
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(CANVAS_SETTINGS_KEY, JSON.stringify({ connectionAnimation })); } catch { /* 设置保存失败不应阻断画布 */ }
  }, [connectionAnimation, ready]);

  useEffect(() => {
    if (!ready || !activeProjectId) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaving(true); setSaveError(false); saveTimerRef.current = window.setTimeout(() => { const ok = saveCanvasDocument(activeProjectId, document); setSaving(false); setSaveError(!ok); if (ok) setProjects((items) => items.map((project) => project.id === activeProjectId ? { ...project, updatedAt: Date.now() } : project)); else notify('画布保存失败，请先导出工作流 JSON。', 'error'); }, 350);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [activeProjectId, document, notify, ready]);

  useEffect(() => {
    if (!ready || !stageRef.current || typeof ResizeObserver === 'undefined') return;
    const stage = stageRef.current;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => { if (ready && activeProjectId) saveCanvasProjects(projects, activeProjectId); }, [activeProjectId, projects, ready]);

  const stagePoint = useCallback((clientX: number, clientY: number) => { const rect = stageRef.current?.getBoundingClientRect(); return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) }; }, []);
  const screenToWorld = useCallback((clientX: number, clientY: number) => { const point = stagePoint(clientX, clientY); return { x: (point.x - document.camera.x) / document.camera.zoom, y: (point.y - document.camera.y) / document.camera.zoom }; }, [document.camera, stagePoint]);
  const stageToWorld = useCallback((point: Point) => ({ x: (point.x - document.camera.x) / document.camera.zoom, y: (point.y - document.camera.y) / document.camera.zoom }), [document.camera]);
  const worldToScreen = useCallback((x: number, y: number) => ({ x: x * document.camera.zoom + document.camera.x, y: y * document.camera.zoom + document.camera.y }), [document.camera]);

  const clearSelection = useCallback(() => { setSelectedIds(new Set()); setSelectedGroupId(null); setSelectedEdgeId(null); setEditingNodeId(null); }, []);
  const openNodePosition = useCallback((position: Point, node: CanvasNode) => {
    const size = nodeSize(node); const candidates: Point[] = [{ x: position.x, y: position.y }];
    for (let ring = 1; ring <= 8; ring += 1) {
      const distance = 70 + ring * 30;
      candidates.push(
        { x: position.x + distance, y: position.y }, { x: position.x - distance, y: position.y },
        { x: position.x, y: position.y + distance }, { x: position.x, y: position.y - distance },
        { x: position.x + distance, y: position.y + distance }, { x: position.x - distance, y: position.y + distance },
      );
    }
    const occupied = docRef.current.nodes.map((item) => { const metric = nodeSize(item); return { x: item.x, y: item.y, w: metric.w, h: metric.h }; });
    return candidates.find((candidate) => !rectanglesOverlap({ ...candidate, w: size.w, h: size.h }, occupied[0] || { x: Infinity, y: Infinity, w: 0, h: 0 }) && occupied.every((item) => !rectanglesOverlap({ ...candidate, w: size.w, h: size.h }, item))) || position;
  }, []);
  const selectNode = useCallback((node: CanvasNode, additive = false) => {
    setSelectedEdgeId(null);
    if (node.groupId) {
      const group = groupById(docRef.current, node.groupId);
      if (group) { setSelectedIds(additive && selectedGroupId === group.id ? new Set() : new Set(group.nodeIds)); setSelectedGroupId(additive && selectedGroupId === group.id ? null : group.id); return; }
    }
    setSelectedGroupId(null); setSelectedIds((current) => { if (!additive) return new Set([node.id]); const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
  }, [selectedGroupId]);

  const startMarquee = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const point = stagePoint(event.clientX, event.clientY);
    setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
    interactionRef.current = { kind: 'marquee', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, changed: false };
    stageRef.current?.setPointerCapture(event.pointerId);
  }, [stagePoint]);
  const capture = useCallback((event: ReactPointerEvent) => { stageRef.current?.setPointerCapture(event.pointerId); }, []);
  const handleStagePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('.canvas-node,.canvas-group,.canvas-floating,.canvas-deck,.canvas-minimap,.canvas-context-menu')) return;
    setContextMenu(null);
    if (event.button === 0 && (event.ctrlKey || event.metaKey)) return startMarquee(event);
    clearSelection(); interactionRef.current = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, camera: document.camera, changed: false };
    capture(event);
  }, [capture, clearSelection, document.camera, startMarquee]);

  const startNodeDrag = useCallback((event: ReactPointerEvent, node: CanvasNode) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('textarea,button,.canvas-node-resize')) return;
    if (event.ctrlKey || event.metaKey) return startMarquee(event);
    event.preventDefault(); event.stopPropagation(); selectNode(node, event.shiftKey);
    const ids = node.groupId && selectedGroupId === node.groupId ? groupNodes(docRef.current, node.groupId).map((item) => item.id) : selectedIds.has(node.id) && selectedIds.size > 1 ? [...selectedIds] : [node.id];
    const positions = Object.fromEntries(ids.map((id) => { const item = nodeById(docRef.current, id); return [id, { x: item?.x || 0, y: item?.y || 0 }]; }));
    interactionRef.current = { kind: 'drag', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, nodeIds: ids, positions, changed: false }; capture(event);
  }, [capture, selectNode, selectedGroupId, selectedIds, startMarquee]);

  const startGroupDrag = useCallback((event: ReactPointerEvent, group: CanvasGroup) => {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); setSelectedGroupId(group.id); setSelectedIds(new Set(group.nodeIds)); setSelectedEdgeId(null);
    if (event.ctrlKey || event.metaKey) return startMarquee(event);
    const positions = Object.fromEntries(group.nodeIds.map((id) => { const item = nodeById(docRef.current, id); return [id, { x: item?.x || 0, y: item?.y || 0 }]; })); interactionRef.current = { kind: 'drag', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, nodeIds: group.nodeIds, positions, changed: false }; capture(event);
  }, [capture, startMarquee]);

  const startGroupResize = useCallback((event: ReactPointerEvent, group: CanvasGroup) => {
    event.preventDefault(); event.stopPropagation();
    const bounds = groupBounds(docRef.current, group.id);
    const origin = { x: bounds.x + 30, y: bounds.y + 48 };
    const nodes = Object.fromEntries(group.nodeIds.flatMap((id) => {
      const node = nodeById(docRef.current, id);
      if (!node) return [];
      const size = nodeSize(node);
      return [[id, { x: node.x, y: node.y, w: size.w, h: size.h }]];
    }));
    setSelectedGroupId(group.id); setSelectedIds(new Set(group.nodeIds)); setSelectedEdgeId(null);
    interactionRef.current = { kind: 'resizeGroup', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, groupId: group.id, bounds, origin, nodes, changed: false };
    capture(event);
  }, [capture]);

  const startResize = useCallback((event: ReactPointerEvent, node: CanvasNode) => { event.preventDefault(); event.stopPropagation(); const size = nodeSize(node); interactionRef.current = { kind: 'resize', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, nodeId: node.id, width: size.w, height: size.h, changed: false }; capture(event); }, [capture]);
  const startConnection = useCallback((event: ReactPointerEvent, nodeId: string, port: 'left' | 'right') => { event.preventDefault(); event.stopPropagation(); const point = stagePoint(event.clientX, event.clientY); setConnection({ start: point, end: point, sourcePort: port }); setConnectionTargetId(null); setSelectedEdgeId(null); interactionRef.current = { kind: 'connect', pointerId: event.pointerId, sourceId: nodeId, sourcePort: port, end: point, start: point }; capture(event); }, [capture, stagePoint]);

  const moveInteraction = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current; if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = 'startX' in interaction ? event.clientX - interaction.startX : 0; const dy = 'startY' in interaction ? event.clientY - interaction.startY : 0; const zoom = docRef.current.camera.zoom;
    if (interaction.kind === 'pan') updateDoc((value) => ({ ...value, camera: { ...interaction.camera, x: interaction.camera.x + dx, y: interaction.camera.y + dy } }));
    if (interaction.kind === 'drag') { if (!interaction.changed && Math.abs(dx) + Math.abs(dy) > 2) { interaction.changed = true; setUndoStack((items) => [...items, snapshot(docRef.current)].slice(-60)); setRedoStack([]); } if (interaction.changed) updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => interaction.nodeIds.includes(node.id) ? { ...node, x: interaction.positions[node.id].x + dx / zoom, y: interaction.positions[node.id].y + dy / zoom } : node) })); }
    if (interaction.kind === 'resize') { if (!interaction.changed && Math.abs(dx) + Math.abs(dy) > 2) { interaction.changed = true; setUndoStack((items) => [...items, snapshot(docRef.current)].slice(-60)); setRedoStack([]); } if (interaction.changed) updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === interaction.nodeId ? { ...node, w: Math.max(190, interaction.width + dx / zoom), h: Math.max(130, interaction.height + dy / zoom), data: { ...node.data, autoFit: false } } : node) })); }
    if (interaction.kind === 'resizeGroup') { if (!interaction.changed && Math.abs(dx) + Math.abs(dy) > 2) { interaction.changed = true; setUndoStack((items) => [...items, snapshot(docRef.current)].slice(-60)); setRedoStack([]); } if (interaction.changed) { const baseWidth = Math.max(1, interaction.bounds.w - 60); const baseHeight = Math.max(1, interaction.bounds.h - 78); const nextWidth = Math.max(240, baseWidth + dx / zoom); const nextHeight = Math.max(180, baseHeight + dy / zoom); const scaleX = nextWidth / baseWidth; const scaleY = nextHeight / baseHeight; updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => { const metric = interaction.nodes[node.id]; if (!metric) return node; return { ...node, x: interaction.origin.x + (metric.x - interaction.origin.x) * scaleX, y: interaction.origin.y + (metric.y - interaction.origin.y) * scaleY, w: Math.max(190, metric.w * scaleX), h: Math.max(130, metric.h * scaleY), data: { ...node.data, autoFit: false } }; }) })); } }
    if (interaction.kind === 'marquee') { const start = stagePoint(interaction.startX, interaction.startY); const point = stagePoint(event.clientX, event.clientY); const left = Math.min(start.x, point.x); const right = Math.max(start.x, point.x); const top = Math.min(start.y, point.y); const bottom = Math.max(start.y, point.y); const camera = docRef.current.camera; const ids = docRef.current.nodes.filter((node) => { const x = node.x * camera.zoom + camera.x; const y = node.y * camera.zoom + camera.y; const size = nodeSize(node); return x < right && x + size.w * camera.zoom > left && y < bottom && y + size.h * camera.zoom > top; }).map((node) => node.id); interaction.changed = true; setSelectedIds(new Set(ids)); setSelectedGroupId(null); setMarquee({ x: start.x, y: start.y, w: point.x - start.x, h: point.y - start.y }); }
    if (interaction.kind === 'connect') { const point = stagePoint(event.clientX, event.clientY); interaction.end = point; setConnection({ start: interaction.start, end: point, sourcePort: interaction.sourcePort }); const target = (window.document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-canvas-node-id]')?.dataset.canvasNodeId; setConnectionTargetId(target && target !== interaction.sourceId ? target : null); }
  }, [stagePoint, updateDoc]);

  const finishInteraction = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current; if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'marquee') {
      const start = stagePoint(interaction.startX, interaction.startY); const point = stagePoint(event.clientX, event.clientY);
      const left = Math.min(start.x, point.x); const right = Math.max(start.x, point.x); const top = Math.min(start.y, point.y); const bottom = Math.max(start.y, point.y); const camera = docRef.current.camera;
      const ids = docRef.current.nodes.filter((node) => { const x = node.x * camera.zoom + camera.x; const y = node.y * camera.zoom + camera.y; const size = nodeSize(node); return x < right && x + size.w * camera.zoom > left && y < bottom && y + size.h * camera.zoom > top; }).map((node) => node.id); setSelectedIds(new Set(ids)); setSelectedGroupId(null);
    }
    if (interaction.kind === 'connect') { const target = connectionTargetId || (window.document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-canvas-node-id]')?.dataset.canvasNodeId; if (target && target !== interaction.sourceId) { commit((value) => addEdge(value, interaction.sourceId, target, interaction.sourcePort, interaction.sourcePort === 'right' ? 'left' : 'right', 'manual')); addLog(`已连接 ${interaction.sourceId} → ${target}`); } setConnection(null); setConnectionTargetId(null); }
    interactionRef.current = null; setMarquee(null); try { stageRef.current?.releasePointerCapture(event.pointerId); } catch { /* pointer capture already released */ }
  }, [addLog, commit, connectionTargetId, stagePoint]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => { const point = stagePoint(clientX, clientY); const before = { x: (point.x - document.camera.x) / document.camera.zoom, y: (point.y - document.camera.y) / document.camera.zoom }; const zoom = clamp(document.camera.zoom * factor, .12, 3); updateDoc((value) => ({ ...value, camera: { x: point.x - before.x * zoom, y: point.y - before.y * zoom, zoom } })); }, [document.camera, stagePoint, updateDoc]);
  const panToWorld = useCallback((x: number, y: number) => { updateDoc((value) => ({ ...value, camera: { ...value.camera, x: stageSize.width / 2 - x * value.camera.zoom, y: stageSize.height / 2 - y * value.camera.zoom } })); }, [stageSize.height, stageSize.width, updateDoc]);
  const fitView = useCallback((ids?: string[]) => { const targets = ids?.length ? ids : docRef.current.nodes.map((node) => node.id); const rect = stageRef.current?.getBoundingClientRect(); const width = rect?.width || 1200; const height = rect?.height || 760; if (!targets.length) { updateDoc((value) => ({ ...value, camera: { x: width / 2, y: height / 2, zoom: 1 } })); return; } const bounds = targets.map((id) => entityBounds(docRef.current, id)); const minX = Math.min(...bounds.map((item) => item.x)); const minY = Math.min(...bounds.map((item) => item.y)); const maxX = Math.max(...bounds.map((item) => item.x + item.w)); const maxY = Math.max(...bounds.map((item) => item.y + item.h)); const zoom = clamp(Math.min((width - 180) / Math.max(1, maxX - minX), (height - 320) / Math.max(1, maxY - minY)), .12, 1.25); updateDoc((value) => ({ ...value, camera: { x: width / 2 - (minX + (maxX - minX) / 2) * zoom, y: (height - 120) / 2 - (minY + (maxY - minY) / 2) * zoom, zoom } })); }, [updateDoc]);

  const undo = useCallback(() => { const previous = undoStack.at(-1); if (!previous) return; setRedoStack((items) => [...items, snapshot(docRef.current)]); setUndoStack((items) => items.slice(0, -1)); setDoc(normalizeDocument(previous)); clearSelection(); }, [clearSelection, setDoc, undoStack]);
  const redo = useCallback(() => { const next = redoStack.at(-1); if (!next) return; setUndoStack((items) => [...items, snapshot(docRef.current)]); setRedoStack((items) => items.slice(0, -1)); setDoc(normalizeDocument(next)); clearSelection(); }, [clearSelection, redoStack, setDoc]);

  const addNode = useCallback((kind: 'image' | 'video' | 'text' | 'workflowImage' | 'workflowVideo', position?: Point) => { const mediaKind = kind === 'workflowVideo' || kind === 'video' ? 'video' : 'image'; const params = defaultParams(mediaKind, runtime); const seed = position || screenToWorld(stageSize.width / 2, stageSize.height / 2); const draft = kind === 'text' ? createPrompt(seed) : kind === 'workflowImage' || kind === 'workflowVideo' ? createGenerator(mediaKind, seed, params) : createEmptyMedia(mediaKind, seed, params); const point = position ? seed : openNodePosition(seed, draft); const node = { ...draft, x: point.x, y: point.y }; commit((value) => ({ ...value, nodes: [...value.nodes, node] })); setSelectedIds(new Set([node.id])); setSelectedGroupId(null); setMode(kind === 'text' ? 'text' : mediaKind); setContextMenu(null); notify(`已添加${kind === 'text' ? '文本' : mediaKind === 'video' ? '视频' : '图片'}节点`); }, [commit, notify, openNodePosition, runtime, screenToWorld, stageSize.height, stageSize.width]);
  const deleteSelection = useCallback(() => { if (!selectedIds.size) return; const count = selectedIds.size; commit((value) => removeNodes(value, [...selectedIds])); clearSelection(); notify(`已删除 ${count} 个对象`); }, [clearSelection, commit, notify, selectedIds]);
  const duplicateSelection = useCallback(() => { if (!selectedIds.size) return; const selected = document.nodes.filter((node) => selectedIds.has(node.id)); const map = new Map(selected.map((node) => [node.id, uid('node')])); const copies = selected.map((node) => ({ ...clone(node), id: map.get(node.id)!, x: node.x + 48, y: node.y + 48, groupId: undefined })); commit((value) => ({ ...value, nodes: [...value.nodes, ...copies] })); setSelectedIds(new Set(copies.map((node) => node.id))); setSelectedGroupId(null); notify(`已复制 ${copies.length} 个对象`); }, [commit, document.nodes, notify, selectedIds]);
  const makeGroup = useCallback(() => { if (selectedIds.size < 2) return notify('请先选择至少 2 个对象再成组。', 'error'); const next = createGroup(docRef.current, [...selectedIds]); const group = next.groups.at(-1); commit(() => next); if (group) { setSelectedGroupId(group.id); setSelectedIds(new Set(group.nodeIds)); } notify('已创建对象组'); }, [commit, notify, selectedIds]);
  const breakGroup = useCallback(() => { if (!selectedGroupId) return; const id = selectedGroupId; commit((value) => { const group = groupById(value, id); if (!group) return value; return { ...value, nodes: value.nodes.map((node) => group.nodeIds.includes(node.id) ? { ...node, groupId: undefined } : node), groups: value.groups.filter((item) => item.id !== id), edges: value.edges.filter((edge) => edge.source !== id && edge.target !== id) }; }); clearSelection(); notify('已解散对象组'); }, [clearSelection, commit, notify, selectedGroupId]);

  const openProject = useCallback((id: string) => { if (id === activeProjectId) { setProjectMenuOpen(false); return; } saveCanvasDocument(activeProjectId, docRef.current); const next = loadCanvasDocument(id); setDoc(next); setActiveProjectId(id); clearSelection(); setUndoStack([]); setRedoStack([]); setProjectMenuOpen(false); addLog(`已打开项目：${projects.find((project) => project.id === id)?.name || '未命名画布'}`); }, [activeProjectId, addLog, clearSelection, projects, setDoc]);
  const newProject = useCallback(() => { const project: CanvasProject = { id: `canvas_${Date.now().toString(36)}`, name: `新画布 ${projects.length + 1}`, createdAt: Date.now(), updatedAt: Date.now() }; const next = [project, ...projects]; saveCanvasProjects(next, project.id); saveCanvasDocument(project.id, normalizeDocument(null)); setProjects(next); setActiveProjectId(project.id); setDoc(normalizeDocument(null)); clearSelection(); setUndoStack([]); setRedoStack([]); setProjectMenuOpen(false); notify('已新建画布'); }, [clearSelection, notify, projects, setDoc]);
  const saveProjectName = useCallback(() => { const name = projectRenameValue.trim(); if (!name || !currentProject) return; setProjects((items) => items.map((project) => project.id === currentProject.id ? { ...project, name: name.slice(0, 60), updatedAt: Date.now() } : project)); setProjectRename(false); notify('项目名称已更新'); }, [currentProject, notify, projectRenameValue]);
  const deleteProject = useCallback((id: string) => { if (projects.length <= 1) return notify('至少保留一个画布。', 'error'); const project = projects.find((item) => item.id === id); if (!window.confirm(`删除“${project?.name || '这个画布'}”？本地内容会被移除。`)) return; const next = projects.filter((item) => item.id !== id); deleteCanvasProject(id); setProjects(next); if (id === activeProjectId) { const replacement = next[0]; setDoc(loadCanvasDocument(replacement.id)); setActiveProjectId(replacement.id); clearSelection(); setUndoStack([]); setRedoStack([]); setProjectMenuOpen(false); } notify('画布项目已删除'); }, [activeProjectId, clearSelection, notify, projects, setDoc]);

  const exportWorkflow = useCallback(() => { const blob = new Blob([canvasProjectFromDocument(currentProject?.name || 'SANMAO 无限画布', document)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = `${currentProject?.name || 'SANMAO画布'}.json`; anchor.click(); URL.revokeObjectURL(url); addLog('已导出工作流 JSON'); notify('工作流已导出'); }, [addLog, currentProject?.name, document, notify]);
  const importWorkflow = useCallback(async (file: File) => { try { const next = normalizeDocument(JSON.parse(await file.text())); commit(() => next); clearSelection(); fitView(); addLog(`已导入工作流：${file.name}`); notify('工作流已导入'); } catch (error) { notify(error instanceof Error ? error.message : '工作流 JSON 无效。', 'error'); } }, [addLog, clearSelection, commit, fitView, notify]);

  const handleFiles = useCallback(async (files: FileList | File[], position?: Point) => { const list = [...files].filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/')); if (!list.length) return notify('请选择图片或视频素材。', 'error'); const base = position || screenToWorld(window.innerWidth / 2, window.innerHeight / 2); const nodes: CanvasNode[] = []; for (const [index, file] of list.entries()) { try { const asset = await uploadCanvasAsset(file); nodes.push(createMedia(asset.kind, asset.url, asset.name, { x: base.x + (index % 3) * 350, y: base.y + Math.floor(index / 3) * 270 }, { role: '参考素材' })); addLog(`已导入${asset.kind === 'video' ? '视频' : '图片'}：${file.name}`); } catch (error) { notify(error instanceof Error ? error.message : '素材上传失败。', 'error'); } } if (nodes.length) { commit((value) => ({ ...value, nodes: [...value.nodes, ...nodes] })); setSelectedIds(new Set(nodes.map((node) => node.id))); setSelectedGroupId(null); notify(`已导入 ${nodes.length} 个素材`); } }, [addLog, commit, notify, screenToWorld]);

  const setMediaNaturalSize = useCallback((nodeId: string, width: number, height: number) => { if (!width || !height) return; updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => { if (node.id !== nodeId || node.type !== 'media') return node; if (node.data.autoFit === false) return { ...node, data: { ...node.data, nativeWidth: width, nativeHeight: height } }; return { ...node, ...mediaCardSizeForRatio(width / height, node.data.kind || 'image'), data: { ...node.data, nativeWidth: width, nativeHeight: height } }; }) })); }, [updateDoc]);

  const deckSource = useCallback(() => {
    if (selectedSingle?.type === 'generator') { const kind = selectedSingle.data.kind || 'image'; return { kind, prompt: String(selectedSingle.data.prompt || ''), params: copyParams(selectedSingle.data.params, kind, runtime), node: selectedSingle, target: null as CanvasNode | null }; }
    if (selectedSingle?.type === 'media') { const kind = selectedSingle.data.kind || 'image'; if (selectedSingle.data.generation || !selectedSingle.data.url) return { kind, prompt: selectedSingle.data.generation?.prompt || '', params: copyParams(selectedSingle.data.generation?.params, kind, runtime), node: null, target: selectedSingle }; }
    const kind = mode === 'video' ? 'video' : 'image'; return { kind, prompt: mode === 'text' ? drafts.text.prompt : drafts[mode].prompt, params: copyParams(mode === 'text' ? {} : drafts[mode].params, kind, runtime), node: null, target: null as CanvasNode | null };
  }, [drafts, mode, runtime, selectedSingle]);

  const updatePrompt = useCallback((value: string) => { if (selectedSingle?.type === 'prompt') return updateDoc((documentValue) => ({ ...documentValue, nodes: documentValue.nodes.map((node) => node.id === selectedSingle.id ? { ...node, data: { ...node.data, text: value } } : node) })); if (selectedSingle?.type === 'generator') return updateDoc((documentValue) => ({ ...documentValue, nodes: documentValue.nodes.map((node) => node.id === selectedSingle.id ? { ...node, data: { ...node.data, prompt: value } } : node) })); if (selectedSingle?.type === 'media' && selectedSingle.data.generation) return updateDoc((documentValue) => ({ ...documentValue, nodes: documentValue.nodes.map((node) => node.id === selectedSingle.id ? { ...node, data: { ...node.data, generation: { ...node.data.generation!, prompt: value } } } : node) })); setDrafts((current) => ({ ...current, [mode]: { ...current[mode], prompt: value } })); }, [mode, selectedSingle, updateDoc]);
  const updateParam = useCallback((field: keyof CanvasGenerationParams, value: string | number | boolean) => { const source = deckSource(); if (source.node) updateDoc((valueDoc) => ({ ...valueDoc, nodes: valueDoc.nodes.map((node) => node.id === source.node!.id ? { ...node, data: { ...node.data, params: { ...source.params, [field]: value } } } : node) })); else if (source.target?.data.generation) updateDoc((valueDoc) => ({ ...valueDoc, nodes: valueDoc.nodes.map((node) => node.id === source.target!.id ? { ...node, data: { ...node.data, generation: { ...node.data.generation!, params: { ...source.params, [field]: value } } } } : node) })); else setDrafts((current) => ({ ...current, [mode]: { ...current[mode], params: { ...current[mode].params, [field]: value } } })); }, [deckSource, mode, updateDoc]);

  const pollVideo = useCallback(async (nodeId: string, taskId: string) => {
    if (!mountedRef.current || !nodeById(docRef.current, nodeId)) return;
    const attempts = (pollAttemptsRef.current.get(taskId) || 0) + 1;
    pollAttemptsRef.current.set(taskId, attempts);
    if (attempts > 40) {
      updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, status: 'failed', statusLabel: '视频任务查询超时，请重试' } } : node) }));
      addLog(`视频任务查询超时：${taskId}`); pollAttemptsRef.current.delete(taskId); return;
    }
    try {
      const result = await getCanvasVideoTask(taskId); if (!mountedRef.current) return;
      const task = result.task; const terminal = task.status === 'done' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'canceled';
      updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, status: task.status === 'done' ? 'completed' : terminal ? 'failed' : 'running', progress: Number(task.progress || (task.status === 'done' ? 100 : 0)), url: task.videoUrls?.[0] || node.data.url, statusLabel: task.error || (task.status === 'done' ? '视频已完成' : terminal ? '视频任务已中断' : '视频生成中') } } : node) }));
      if (!terminal) { const timer = window.setTimeout(() => { pollTimersRef.current.delete(timer); void pollVideo(nodeId, taskId); }, 3000); pollTimersRef.current.add(timer); } else { pollAttemptsRef.current.delete(taskId); addLog(task.status === 'done' ? '视频生成完成' : `视频任务失败：${task.error || '任务已中断'}`); }
    } catch (error) {
      if (!mountedRef.current) return;
      addLog(`视频进度查询失败：${error instanceof Error ? error.message : '网络错误'}`);
      const timer = window.setTimeout(() => { pollTimersRef.current.delete(timer); void pollVideo(nodeId, taskId); }, 5000); pollTimersRef.current.add(timer);
    }
  }, [addLog, updateDoc]);

  const runGeneration = useCallback(async () => {
    if (mode === 'text') { if (selectedSingle?.type === 'prompt') return notify('文本节点已保存'); addNode('text'); return; }
    const source = deckSource(); const ownerId = source.node?.id || source.target?.id; const linked = ownerId ? incomingReferences(docRef.current, ownerId) : selectedNodes.filter((node) => node.type === 'media' && node.data.url); const context = [...linked, ...selectedNodes.filter((node) => node.type === 'prompt')]; const prompt = smartPrompt(source.prompt, context); if (!prompt.trim()) return notify('请输入生成提示词。', 'error'); const refs = linked.map((node) => ({ url: String(node.data.url || ''), name: String(node.data.name || '参考素材') })).filter((item) => item.url); const kind = source.kind as CanvasMediaKind; const sourceNode = source.node; let targetId = source.target?.id || '';
    if (generationBusyRef.current) return notify('已有生成请求，请稍候。', 'error');
    generationBusyRef.current = true; setGenerationBusy(true);
    try {
      const pendingId = sourceNode?.id || source.target?.id;
      if (pendingId) updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === pendingId ? { ...node, data: { ...node.data, status: 'running', statusLabel: kind === 'video' ? '视频生成中' : '图片生成中', prompt } } : node) }));
      if (kind === 'image') {
        const result = await generateCanvasImage({ prompt, model: source.params.model, count: source.params.count, aspect: source.params.aspect, resolution: source.params.resolution, quality: source.params.quality, references: refs }); if (!result.images?.length) throw new Error('服务端没有返回图片结果。');
        const base = source.target || sourceNode; const position = base ? { x: base.x + (source.target ? 0 : nodeSize(base).w + 90), y: base.y } : screenToWorld(window.innerWidth / 2, window.innerHeight / 2); const outputs = result.images.map((image, index) => createMedia('image', image.url, `生成图片 ${index + 1}`, { x: position.x + (index % 2) * 350, y: position.y + Math.floor(index / 2) * 280 }, { role: '生成结果', model: result.model?.name || source.params.model, generation: { kind: 'image', prompt, params: source.params, referenceIds: linked.map((node) => node.id), sourceGeneratorId: sourceNode?.id, createdAt: Date.now() }, referenceOrder: linked.map((node) => node.id) }));
        updateDoc((value) => { let next = value; if (source.target && outputs.length === 1) { next = { ...next, nodes: next.nodes.map((node) => node.id === source.target!.id ? { ...node, ...outputs[0], id: node.id, data: { ...node.data, ...outputs[0].data, status: 'completed', statusLabel: '图片已完成' } } : node) }; if (sourceNode) next = addEdge(next, sourceNode.id, source.target.id, 'right', 'left', 'generated'); } else { next = { ...next, nodes: [...next.nodes, ...outputs] }; if (sourceNode) outputs.forEach((output) => { next = addEdge(next, sourceNode.id, output.id, 'right', 'left', 'generated'); }); } if (sourceNode) next = { ...next, nodes: next.nodes.map((node) => node.id === sourceNode.id ? { ...node, data: { ...node.data, status: 'completed', statusLabel: '图片生成完成' } } : node) }; return next; }); setSelectedIds(new Set(outputs.map((output) => output.id))); setSelectedGroupId(null); notify(`已生成 ${result.images.length} 张图片`); addLog(`图片生成完成：${result.images.length} 张`);
      } else {
        const position = sourceNode ? { x: sourceNode.x + nodeSize(sourceNode).w + 90, y: sourceNode.y } : screenToWorld(window.innerWidth / 2, window.innerHeight / 2); const target = source.target || createMedia('video', '', '视频任务', position, { role: '生成结果', status: 'queued', statusLabel: '视频任务提交中' }); targetId = target.id; if (!source.target) commit((value) => ({ ...value, nodes: [...value.nodes, target], edges: sourceNode ? [...value.edges, { id: uid('edge'), source: sourceNode.id, target: target.id, sourcePort: 'right', targetPort: 'left', kind: 'generated' }] : value.edges }));
        const task = await generateCanvasVideo({ prompt, model: source.params.model, duration: source.params.duration, aspect: source.params.aspect, resolution: source.params.resolution, references: refs, audio: source.params.audio }); updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => node.id === targetId ? { ...node, data: { ...node.data, jobId: task.id, status: task.status === 'done' ? 'completed' : 'running', progress: Number(task.progress || 0), url: task.videoUrls?.[0] || node.data.url, statusLabel: task.status === 'done' ? '视频已完成' : '视频生成中', generation: { kind: 'video', prompt, params: source.params, referenceIds: linked.map((item) => item.id), sourceGeneratorId: sourceNode?.id, createdAt: Date.now() } } } : node) })); if (task.status === 'done') notify('视频生成完成'); else { void pollVideo(targetId, task.id); notify('视频任务已提交，结果会自动写入画布'); } addLog(`视频任务已提交：${task.id}`);
      }
      } catch (error) { const message = error instanceof Error ? error.message : '生成失败'; updateDoc((value) => ({ ...value, nodes: value.nodes.map((node) => (node.id === sourceNode?.id || node.id === targetId) ? { ...node, data: { ...node.data, status: 'failed', statusLabel: message } } : node) })); notify(message, 'error'); addLog(`生成失败：${message}`); } finally { generationBusyRef.current = false; setGenerationBusy(false); }
  }, [addLog, addNode, commit, deckSource, mode, notify, pollVideo, screenToWorld, selectedNodes, selectedSingle, updateDoc]);

  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.target as HTMLElement | null)?.matches('input,textarea,select')) return; if (event.key === 'Escape') { setContextMenu(null); setLightbox(null); setWorkbenchOpen(false); interactionRef.current = null; setConnection(null); setConnectionTargetId(null); clearSelection(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); } else if (!event.repeat && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); } else if (!event.repeat && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? breakGroup() : makeGroup(); } else if (!event.repeat && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); if (selectedEdgeId) { commit((value) => removeEdge(value, selectedEdgeId)); setSelectedEdgeId(null); } else deleteSelection(); } else if (!event.repeat && event.key.toLowerCase() === 'f') { event.preventDefault(); fitView(); } else if (!event.repeat && (event.key === '+' || event.key === '=')) { event.preventDefault(); zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.12); } else if (!event.repeat && event.key === '-') { event.preventDefault(); zoomAt(window.innerWidth / 2, window.innerHeight / 2, .88); } else if (!event.repeat && event.key === '0') { event.preventDefault(); fitView(); } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void runGeneration(); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [breakGroup, clearSelection, commit, deleteSelection, duplicateSelection, fitView, makeGroup, redo, runGeneration, selectedEdgeId, undo, zoomAt]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => { event.preventDefault(); const point = stagePoint(event.clientX, event.clientY); setContextMenu({ x: event.clientX, y: event.clientY, world: { x: (point.x - document.camera.x) / document.camera.zoom, y: (point.y - document.camera.y) / document.camera.zoom } }); }, [document.camera, stagePoint]);
  const deck = deckSource(); const deckKind = deck.kind; const deckModels = deckKind === 'video' ? videoModels : imageModels; const referenceOwnerId = selectedGroupId || selectedSingle?.id; const references = referenceOwnerId ? incomingReferences(document, referenceOwnerId) : selectedNodes.filter((node) => node.type === 'media' && node.data.url);
  const minimapBounds = useMemo(() => { if (!document.nodes.length) return { x: -300, y: -200, w: 600, h: 400 }; const bounds = document.nodes.map((node) => entityBounds(document, node.id)); const minX = Math.min(...bounds.map((item) => item.x)); const minY = Math.min(...bounds.map((item) => item.y)); const maxX = Math.max(...bounds.map((item) => item.x + item.w)); const maxY = Math.max(...bounds.map((item) => item.y + item.h)); return { x: minX - 120, y: minY - 120, w: Math.max(480, maxX - minX + 240), h: Math.max(320, maxY - minY + 240) }; }, [document]);
  const connectionTargetNode = connectionTargetId ? nodeById(document, connectionTargetId) : undefined;
  const connectionTargetSize = connectionTargetNode ? nodeSize(connectionTargetNode) : undefined;
  const draftConnection = connection ? { start: stageToWorld(connection.start), end: stageToWorld(connection.end), sourcePort: connection.sourcePort } : null;
  const connectionTargetScreen = connectionTargetNode ? worldToScreen(connectionTargetNode.x, connectionTargetNode.y) : null;
  const connectionCancelScreen = connection ? { x: (connection.start.x + connection.end.x) / 2, y: (connection.start.y + connection.end.y) / 2 } : null;

  if (!ready) return <section className="canvas-workspace canvas-loading"><div className="canvas-loading-card"><span className="canvas-logo-mark">✦</span><strong>正在加载 SANMAO 无限画布</strong><small>恢复本地项目与模型库…</small></div></section>;
  return <section className="canvas-workspace" aria-label="SANMAO 无限画布" onClick={() => projectMenuOpen && setProjectMenuOpen(false)}>
      <header className="canvas-topbar"><div className="canvas-topbar-main"><button type="button" className="canvas-brand" onClick={(event) => { event.stopPropagation(); setProjectMenuOpen((value) => !value); }}><span className="canvas-logo-mark">✦</span><span><b>SANMAO.AI</b><small>{currentProject?.name || '无限画布'}</small></span><i>⌄</i></button><button type="button" className="canvas-soft-button canvas-home-button" aria-label="返回主界面" onClick={() => window.location.assign('/')}>← <span>主界面</span></button><span className="canvas-separator" /><button type="button" className="canvas-icon-button" onClick={undo} disabled={!undoStack.length}>↶</button><button type="button" className="canvas-icon-button" onClick={redo} disabled={!redoStack.length}>↷</button><span className="canvas-separator" /><button type="button" className="canvas-soft-button" onClick={() => fileInputRef.current?.click()}>＋ 导入素材</button><button type="button" className="canvas-soft-button canvas-shortcuts-button" onClick={() => { setWorkbenchTab('shortcuts'); setWorkbenchOpen(true); }}>⌨ 快捷键</button><button type="button" className="canvas-soft-button canvas-settings-button" onClick={() => { setWorkbenchTab('settings'); setWorkbenchOpen(true); }}>⚙ 设置</button><div className="canvas-topbar-spacer" /><span className={`canvas-save-state ${saving ? 'saving' : saveError ? 'error' : ''}`}><i />{saving ? '保存中…' : saveError ? '保存失败' : '已保存'}</span><button type="button" className="canvas-workbench-button" onClick={() => setWorkbenchOpen(true)}><span>◈</span><b>工作台</b><small>资产 · 工作流</small></button></div><div className="canvas-project-popover-wrap">{projectMenuOpen && <div className="canvas-project-popover" onClick={(event) => event.stopPropagation()}><div className="canvas-popover-title">我的画布项目</div>{projects.map((project) => <div className={`canvas-project-row ${project.id === activeProjectId ? 'active' : ''}`} key={project.id}><button type="button" onClick={() => openProject(project.id)}><span className="canvas-project-dot">✦</span><span><b>{project.name}</b><small>{new Date(project.updatedAt).toLocaleDateString('zh-CN')}</small></span></button>{project.id === activeProjectId && <i>✓</i>}</div>)}<div className="canvas-popover-actions"><button type="button" onClick={newProject}>＋ 新建画布</button><button type="button" onClick={() => { setProjectRenameValue(currentProject?.name || ''); setProjectRename(true); }}>重命名</button></div>{projectRename && <div className="canvas-rename-row"><input value={projectRenameValue} onChange={(event) => setProjectRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveProjectName(); if (event.key === 'Escape') setProjectRename(false); }} autoFocus /><button type="button" onClick={saveProjectName}>保存</button></div>}</div>}</div></header>
     <div ref={stageRef} className="canvas-stage" onPointerDown={handleStagePointerDown} onPointerMove={moveInteraction} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} onContextMenu={handleContextMenu} onWheel={(event) => { if ((event.target as HTMLElement).closest('.canvas-minimap')) return; event.preventDefault(); zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * .0014)); }}>
        <div className="canvas-grid" /><div className="canvas-world"><div className="canvas-world-content" style={{ transform: `translate3d(${document.camera.x}px,${document.camera.y}px,0) scale(${document.camera.zoom})` }}><svg className="canvas-edge-layer" viewBox="-5000 -5000 10000 10000"><defs><linearGradient id="canvas-edge-gradient" x1="0" x2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient><marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" /></marker></defs>{document.edges.map((edge) => <path key={edge.id} className={`canvas-edge canvas-edge-${connectionAnimation} ${selectedEdgeId === edge.id ? 'selected' : ''}`} d={edgePath(document, edge)} markerEnd="url(#canvas-arrow)" onPointerDown={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedIds(new Set()); setSelectedGroupId(null); }} />)}{draftConnection && <path className="canvas-edge canvas-edge-draft" d={(() => { const dx = Math.max(72, Math.abs(draftConnection.end.x - draftConnection.start.x) * .42) * (draftConnection.sourcePort === 'right' ? 1 : -1); return `M ${draftConnection.start.x} ${draftConnection.start.y} C ${draftConnection.start.x + dx} ${draftConnection.start.y}, ${draftConnection.end.x - dx} ${draftConnection.end.y}, ${draftConnection.end.x} ${draftConnection.end.y}`; })()} />}</svg><div className="canvas-group-layer">{document.groups.map((group) => { const bounds = groupBounds(document, group.id); return <div key={group.id} className={`canvas-group ${selectedGroupId === group.id ? 'selected' : ''}`} style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }} onPointerDown={(event) => startGroupDrag(event, group)}><button type="button" className="canvas-group-resize" aria-label="调整对象组大小" onPointerDown={(event) => startGroupResize(event, group)} /><div className="canvas-group-label"><span>⌘</span><b>{group.name}</b><small>{group.nodeIds.length} 个对象</small></div></div>; })}</div><div className="canvas-node-layer">{document.nodes.map((node) => <CanvasNodeCard key={node.id} node={node} selected={selectedIds.has(node.id)} document={document} onPointerDown={startNodeDrag} onResize={startResize} onConnect={startConnection} onSelect={(event) => selectNode(node, event.shiftKey)} onPreview={() => setLightbox({ nodeId: node.id, compare: false })} editing={editingNodeId === node.id} onEdit={(value) => setEditingNodeId(value ? node.id : null)} onNaturalSize={setMediaNaturalSize} onPromptChange={(value) => updateDoc((valueDoc) => ({ ...valueDoc, nodes: valueDoc.nodes.map((item) => item.id === node.id ? { ...item, data: { ...item.data, text: value } } : item) }))} />)}</div></div></div>{connectionTargetNode && connectionTargetSize && connectionTargetScreen && <div className="canvas-connection-target" style={{ left: connectionTargetScreen.x - 8, top: connectionTargetScreen.y - 8, width: connectionTargetSize.w * document.camera.zoom + 16, height: connectionTargetSize.h * document.camera.zoom + 16 }} />}{connectionCancelScreen && <button type="button" className="canvas-connection-cancel" aria-label="取消连线" title="取消连线" style={{ left: connectionCancelScreen.x, top: connectionCancelScreen.y }} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); interactionRef.current = null; setConnection(null); setConnectionTargetId(null); try { stageRef.current?.releasePointerCapture(event.pointerId); } catch { /* pointer capture already released */ } }}>×</button>}{marquee && <div className="canvas-marquee" style={{ left: Math.min(marquee.x, marquee.x + marquee.w), top: Math.min(marquee.y, marquee.y + marquee.h), width: Math.abs(marquee.w), height: Math.abs(marquee.h) }}><b>{Math.round(Math.abs(marquee.w))} × {Math.round(Math.abs(marquee.h))} px</b></div>}
        <div className="canvas-status-chip"><span className={runtimeError ? 'error' : 'online'} />{runtimeError || (runtime ? `${models.length} 个可用模型` : '正在读取模型库…')}</div>
      {selectedNodes.length >= 2 && <div className="canvas-selection-toolbar"><b>{selectedGroupId ? '已选对象组' : `已选 ${selectedNodes.length} 个对象`}</b><span />{!selectedGroupId && <button type="button" onClick={makeGroup}>⌘ 成组</button>}{selectedGroupId && <button type="button" onClick={breakGroup}>解组</button>}<button type="button" onClick={duplicateSelection}>⧉ 复制</button><button type="button" onClick={() => fitView([...selectedIds])}>⌗ 聚焦</button><button type="button" className="danger" onClick={deleteSelection}>⌫ 删除</button></div>}
      <div className={`canvas-deck ${deckCollapsed ? 'collapsed' : ''}`}>
        <div className="canvas-deck-top">
          <div className="canvas-mode-switch"><button type="button" className={mode === 'image' ? 'active' : ''} onClick={() => setMode('image')}>✦ 图片</button><button type="button" className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>▶ 视频</button><button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>T 文本</button></div>
          <div className="canvas-deck-context"><i /><b>{selectedSingle ? nodeLabel(selectedSingle) : selectedGroup ? selectedGroup.name : '智能创作'}</b><small>{references.length ? `已连接 ${references.length} 个参考素材` : '生成结果直接进入画布卡片'}</small></div>
          <button type="button" className="canvas-deck-collapse" aria-label={deckCollapsed ? '展开创作工作台' : '收起创作工作台'} onClick={() => setDeckCollapsed((value) => !value)}>{deckCollapsed ? '⌃' : '⌄'}</button>
        </div>
        {!deckCollapsed && <>
          <div className="canvas-deck-main">
            <button type="button" className="canvas-context-add" aria-label="导入参考素材" onClick={() => fileInputRef.current?.click()}>＋</button>
            <div className="canvas-reference-preview">{references.slice(0, 6).map((node, index) => <div className="canvas-reference-chip" key={node.id}><span>{index + 1}</span>{node.data.kind === 'video' ? <video src={node.data.url} muted playsInline /> : <img src={node.data.url} alt="" />}</div>)}</div>
            <textarea value={deck.prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void runGeneration(); } }} placeholder={mode === 'video' ? '描述视频动作、镜头、节奏和声音…' : mode === 'text' ? '编辑文本节点或输入新的文本内容…' : '描述你想生成的画面…'} rows={2} />
            <button type="button" className="canvas-run-button" disabled={generationBusy} aria-busy={generationBusy} onClick={() => void runGeneration()}><span>✦</span><b>{generationBusy ? '处理中…' : mode === 'text' ? '保存' : deck.target ? '生成到此节点' : '生成'}</b><small>Ctrl + Enter</small></button>
          </div>
          <div className="canvas-deck-params">{mode !== 'text' && <>
            <label><small>模型</small><select value={deck.params.model || ''} onChange={(event) => updateParam('model', event.target.value)}><option value="">自动模型</option>{deckModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label>
            <label><small>比例</small><select value={deck.params.aspect || ''} onChange={(event) => updateParam('aspect', event.target.value)}>{(deckKind === 'video' ? VIDEO_ASPECTS : IMAGE_ASPECTS).map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><small>清晰度</small><select value={deck.params.resolution || ''} onChange={(event) => updateParam('resolution', event.target.value)}>{(deckKind === 'video' ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS).map((value) => <option key={value}>{value}</option>)}</select></label>
            {deckKind === 'image' ? <label><small>数量</small><select value={String(deck.params.count || 1)} onChange={(event) => updateParam('count', Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value}>{value} 张</option>)}</select></label> : <label><small>时长</small><select value={String(deck.params.duration || 5)} onChange={(event) => updateParam('duration', Number(event.target.value))}>{[3, 4, 5, 6, 8, 10, 12, 15].map((value) => <option key={value}>{value} 秒</option>)}</select></label>}
          </>}</div>
          <div className="canvas-deck-bottom"><span><kbd>左键</kbd> 平移 <i>·</i> <kbd>Ctrl</kbd> 框选 <i>·</i> <kbd>Ctrl+G</kbd> 成组 <i>·</i> <kbd>右键</kbd> 添加节点</span><div><button type="button" onClick={clearSelection}>清空选择</button><button type="button" onClick={() => fitView()}>适应全部</button></div></div>
        </>}
      </div>
      <CanvasMinimap document={document} selectedIds={selectedIds} bounds={minimapBounds} stageSize={stageSize} zoomAt={zoomAt} fitView={fitView} onNavigate={panToWorld} />
      {contextMenu && <div className="canvas-context-menu" style={{ left: clamp(contextMenu.x, 8, window.innerWidth - 250), top: clamp(contextMenu.y, 8, window.innerHeight - 330) }} onClick={(event) => event.stopPropagation()}><div className="canvas-menu-title">添加节点</div><button type="button" onClick={() => addNode('image', contextMenu.world)}>✦ 空图片节点 <small>结果直接写入节点</small></button><button type="button" onClick={() => addNode('video', contextMenu.world)}>▶ 空视频节点 <small>结果直接写入节点</small></button><button type="button" onClick={() => addNode('text', contextMenu.world)}>T 文本节点</button><button type="button" onClick={() => { setContextMenu(null); fileInputRef.current?.click(); }}>＋ 导入图片 / 视频</button><hr /><button type="button" onClick={() => addNode('workflowImage', contextMenu.world)}>✦ 高级图片工作流节点</button><button type="button" onClick={() => addNode('workflowVideo', contextMenu.world)}>▶ 高级视频工作流节点</button><hr /><button type="button" onClick={() => { setContextMenu(null); fitView(); }}>⌗ 适应全部</button></div>}
    </div>
    {lightbox && <CanvasLightbox node={nodeById(document, lightbox.nodeId)} compare={lightbox.compare} references={nodeById(document, lightbox.nodeId) ? incomingReferences(document, lightbox.nodeId) : []} onClose={() => setLightbox(null)} onCompare={() => setLightbox((value) => value ? { ...value, compare: !value.compare } : value)} />}
     {workbenchOpen && <CanvasWorkbench tab={workbenchTab} setTab={setWorkbenchTab} nodes={document.nodes} groups={document.groups} edges={document.edges} projects={projects} activeProjectId={activeProjectId} logs={logs} connectionAnimation={connectionAnimation} onConnectionAnimationChange={setConnectionAnimation} onClose={() => setWorkbenchOpen(false)} onExport={exportWorkflow} onImport={() => workflowInputRef.current?.click()} onArrange={() => { fitView(); notify('已聚焦全部画布内容'); }} onDeleteProject={deleteProject} />}
    {notice && <div className={`canvas-toast ${notice.kind === 'error' ? 'error' : ''}`}><span>✦</span><b>{notice.message}</b></div>}
    <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); event.currentTarget.value = ''; }} /><input ref={workflowInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkflow(file); event.currentTarget.value = ''; }} />
  </section>;
}

function CanvasNodeCard({ node, selected, document, onPointerDown, onResize, onConnect, onSelect, onPreview, onNaturalSize, onPromptChange, editing, onEdit }: { node: CanvasNode; selected: boolean; document: CanvasDocument; onPointerDown: (event: ReactPointerEvent, node: CanvasNode) => void; onResize: (event: ReactPointerEvent, node: CanvasNode) => void; onConnect: (event: ReactPointerEvent, nodeId: string, port: 'left' | 'right') => void; onSelect: (event: ReactPointerEvent) => void; onPreview: () => void; onNaturalSize: (nodeId: string, width: number, height: number) => void; onPromptChange: (value: string) => void; editing: boolean; onEdit: (value: boolean) => void }) {
  const size = nodeSize(node); const data = node.data; const pending = data.status === 'queued' || data.status === 'running'; const failed = data.status === 'failed' && !data.url;
  return <article className={`canvas-node ${selected ? 'selected' : ''}`} data-canvas-node-id={node.id} style={{ left: node.x, top: node.y, width: size.w, height: size.h }} onPointerDown={(event) => onPointerDown(event, node)} onDoubleClick={() => { if (node.type === 'prompt') onEdit(true); else if (node.type === 'media' && data.url) onPreview(); }}>
    <button type="button" className="canvas-port left" aria-label="左侧连接端口" onPointerDown={(event) => onConnect(event, node.id, 'left')} />
    {node.type === 'media' && <div className="canvas-media-card"><div className="canvas-media-stage">{pending ? <div className="canvas-media-state pending"><span>✦</span><b>{data.statusLabel || '生成中'}</b><small>{Number(data.progress || 0)}%</small></div> : failed ? <div className="canvas-media-state failed"><span>!</span><b>生成失败</b><small>{data.statusLabel}</small></div> : !data.url ? <div className="canvas-media-state draft"><span>{data.kind === 'video' ? '▶' : '▣'}</span><b>{data.kind === 'video' ? '空视频节点' : '空图片节点'}</b><small>选中后在下方生成</small></div> : data.kind === 'video' ? <video src={data.url} muted playsInline preload="metadata" onLoadedMetadata={(event) => onNaturalSize(node.id, event.currentTarget.videoWidth, event.currentTarget.videoHeight)} /> : <img src={data.url} alt={data.name || '画布素材'} draggable={false} onLoad={(event) => onNaturalSize(node.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />}{data.kind === 'video' && data.url && <span className="canvas-video-mark">▶</span>}</div><div className="canvas-node-footer"><span className="canvas-type-icon">{data.kind === 'video' ? '▶' : '▣'}</span><span className="canvas-node-title"><b>{data.name || '素材'}</b><small>{data.model || nodeStatus(node)}</small></span><em>{nodeStatus(node)}</em></div></div>}
    {node.type === 'prompt' && <div className="canvas-prompt-card"><div className="canvas-node-kicker"><span>T</span><b>文本节点</b></div>{editing ? <textarea value={String(data.text || '')} placeholder="输入提示词或备注…" autoFocus onChange={(event) => onPromptChange(event.target.value)} onBlur={() => onEdit(false)} onPointerDown={(event) => event.stopPropagation()} /> : <div className="canvas-prompt-preview">{String(data.text || '双击编辑文本…')}</div>}<small>可连接到图片或视频生成节点</small></div>}
    {node.type === 'generator' && <div className="canvas-generator-card"><div className="canvas-generator-head"><span>{data.kind === 'video' ? '▶' : '✦'}</span><div><b>{data.kind === 'video' ? '视频生成' : '图片生成'}</b><small>{data.status === 'running' ? '生成中…' : '高级工作流节点'}</small></div></div><div className="canvas-generator-refs">{incomingReferences(document, node.id).length ? incomingReferences(document, node.id).map((item, index) => <span key={item.id}>{index + 1}{item.data.kind === 'video' ? '▶' : '▣'}</span>) : <small>连接素材后显示参考顺序</small>}</div><div className="canvas-generator-prompt">{String(data.prompt || '点击选中，在下方编辑提示词')}</div><div className="canvas-generator-meta"><span>{String((data.params as CanvasGenerationParams | undefined)?.model || '自动模型')}</span><span>{String((data.params as CanvasGenerationParams | undefined)?.aspect || '自动比例')}</span></div></div>}
    <button type="button" className="canvas-port right" aria-label="右侧连接端口" onPointerDown={(event) => onConnect(event, node.id, 'right')} /><span className="canvas-node-resize" onPointerDown={(event) => onResize(event, node)} title="调整卡片大小" />
  </article>;
}

function CanvasMinimap({ document, selectedIds, bounds, stageSize, zoomAt, fitView, onNavigate }: { document: CanvasDocument; selectedIds: Set<string>; bounds: { x: number; y: number; w: number; h: number }; stageSize: { width: number; height: number }; zoomAt: (x: number, y: number, factor: number) => void; fitView: () => void; onNavigate: (x: number, y: number) => void }) {
  const zoom = Math.max(.12, document.camera.zoom || 1);
  // The minimap is a 16:9 viewport. Use one uniform map scale so the
  // wireframe and nodes always describe the same visible canvas area.
  const mapAspect = 16 / 9;
  const mapWidth = mapAspect * 100;
  const mapHeight = 100;
  const mapScale = Math.min(mapWidth / Math.max(1, bounds.w), mapHeight / Math.max(1, bounds.h));
  const mapOffsetX = (mapWidth - bounds.w * mapScale) / 2;
  const mapOffsetY = (mapHeight - bounds.h * mapScale) / 2;
  const mapStyle = (rect: { x: number; y: number; w: number; h: number }): CSSProperties => ({
    left: `${((mapOffsetX + (rect.x - bounds.x) * mapScale) / mapWidth) * 100}%`,
    top: `${((mapOffsetY + (rect.y - bounds.y) * mapScale) / mapHeight) * 100}%`,
    width: `${(rect.w * mapScale / mapWidth) * 100}%`,
    height: `${(rect.h * mapScale / mapHeight) * 100}%`,
  });
  const style = (node: CanvasNode): CSSProperties => mapStyle({ x: node.x, y: node.y, w: nodeSize(node).w, h: nodeSize(node).h });
  const visible = { x: -document.camera.x / zoom, y: -document.camera.y / zoom, w: stageSize.width / zoom, h: stageSize.height / zoom };
  const viewportStyle: CSSProperties = mapStyle(visible);
  const navigate = (event: React.MouseEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); const px = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1); const py = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1); const x = bounds.x + (px * mapWidth - mapOffsetX) / mapScale; const y = bounds.y + (py * mapHeight - mapOffsetY) / mapScale; onNavigate(x, y); };
  return <div className="canvas-minimap" onWheel={(event) => event.stopPropagation()}><div className="canvas-minimap-head"><b>导航小地图</b><button type="button" onClick={fitView}>全览</button></div><div className="canvas-minimap-stage" onClick={navigate}><i className="canvas-minimap-viewport" style={viewportStyle} />{document.nodes.map((node) => <i key={node.id} className={selectedIds.has(node.id) ? 'active' : ''} style={style(node)} />)}</div><div className="canvas-minimap-foot"><span>{formatPercent(document.camera.zoom)}</span><button type="button" onClick={() => zoomAt(stageSize.width / 2, stageSize.height / 2, .84)}>−</button><button type="button" onClick={() => zoomAt(stageSize.width / 2, stageSize.height / 2, 1.18)}>＋</button><button type="button" onClick={fitView}>适应</button></div></div>;
}

function CanvasLightbox({ node, compare, references, onClose, onCompare }: { node?: CanvasNode; compare: boolean; references: CanvasNode[]; onClose: () => void; onCompare: () => void }) {
  if (!node || node.type !== 'media' || !node.data.url) return null; const reference = references[0];
  return <div className="canvas-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="canvas-lightbox"><header><div><b>{node.data.name || '素材预览'}</b><small>{node.data.nativeWidth && node.data.nativeHeight ? `${node.data.nativeWidth} × ${node.data.nativeHeight}` : '画布媒体预览'}</small></div><div><button type="button" onClick={onCompare} disabled={!reference}>{compare ? '单图预览' : '前后对比'}</button><button type="button" onClick={onClose}>×</button></div></header><div className={`canvas-lightbox-stage ${compare && reference ? 'compare' : ''}`}>{compare && reference?.data.url && <div className="canvas-lightbox-before"><span>参考图</span><img src={reference.data.url} alt="参考图" /></div>}<div className="canvas-lightbox-after"><span>{compare ? '生成结果' : ''}</span>{node.data.kind === 'video' ? <video src={node.data.url} controls playsInline /> : <img src={node.data.url} alt={node.data.name || '预览'} />}</div></div></div></div>;
}

function CanvasWorkbench({ tab, setTab, nodes, groups, edges, projects, activeProjectId, logs, connectionAnimation, onConnectionAnimationChange, onClose, onExport, onImport, onArrange, onDeleteProject }: { tab: WorkbenchTab; setTab: (tab: WorkbenchTab) => void; nodes: CanvasNode[]; groups: CanvasGroup[]; edges: CanvasEdge[]; projects: CanvasProject[]; activeProjectId: string; logs: string[]; connectionAnimation: ConnectionAnimation; onConnectionAnimationChange: (value: ConnectionAnimation) => void; onClose: () => void; onExport: () => void; onImport: () => void; onArrange: () => void; onDeleteProject: (id: string) => void }) {
  const media = nodes.filter((node) => node.type === 'media' && Boolean(node.data.url)); const tabs = ['assets', 'workflow', 'logs', 'shortcuts', 'project', 'settings'] as const;
  const tabLabels: Record<WorkbenchTab, string> = { assets: '资产', workflow: '工作流', logs: '日志', shortcuts: '快捷键', project: '项目', settings: '设置' };
  return <div className="canvas-modal-backdrop workbench-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="canvas-workbench"><header><div><span className="canvas-logo-mark small">✦</span><span><b>统一工作台</b><small>资产、工作流与画布项目</small></span></div><button type="button" onClick={onClose}>×</button></header><nav>{tabs.map((item) => <button type="button" key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabLabels[item]}</button>)}</nav><div className="canvas-workbench-content">{tab === 'assets' && <div className="canvas-workbench-section"><div className="canvas-workbench-heading"><span><b>画布资产</b><small>{media.length} 个媒体节点</small></span></div>{media.length ? <div className="canvas-asset-grid">{media.map((node) => <div className="canvas-asset-card" key={node.id}>{node.data.kind === 'video' ? <video src={node.data.url} muted /> : <img src={node.data.url} alt="" />}<span>{node.data.name || '素材'}</span></div>)}</div> : <div className="canvas-empty-panel">导入的图片和视频会集中显示在这里。</div>}</div>}{tab === 'workflow' && <div className="canvas-workbench-section"><div className="canvas-workbench-heading"><span><b>工作流</b><small>{nodes.length} 个节点 · {edges.length} 条连线 · {groups.length} 个对象组</small></span></div><div className="canvas-workbench-actions"><button type="button" className="primary" onClick={onArrange}>⌗ 适应全部</button><button type="button" onClick={onExport}>↓ 导出 JSON</button><button type="button" onClick={onImport}>↑ 导入 JSON</button></div><div className="canvas-empty-panel">通过节点端口连接图片、视频和文本，生成结果会自动保留引用关系。</div></div>}{tab === 'logs' && <div className="canvas-workbench-section"><div className="canvas-workbench-heading"><span><b>操作日志</b><small>最近 {logs.length} 条操作</small></span></div>{logs.length ? <div className="canvas-log-list">{logs.map((log, index) => <div key={`${log}-${index}`}><time>{index + 1}</time><span>{log}</span></div>)}</div> : <div className="canvas-empty-panel">还没有操作日志。</div>}</div>}{tab === 'shortcuts' && <div className="canvas-workbench-section"><div className="canvas-workbench-heading"><span><b>快捷键</b><small>画布常用操作</small></span></div><div className="canvas-shortcut-list">{[['Ctrl + Z', '撤销'], ['Ctrl + Y', '恢复'], ['Ctrl + G', '创建对象组'], ['Ctrl + Shift + G', '解散对象组'], ['Ctrl + D', '复制选中对象'], ['Delete', '删除选中对象'], ['F', '适应全部画布'], ['Ctrl + Enter', '提交生成']].map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}</div></div>}{tab === 'project' && <div className="canvas-workbench-section"><div className="canvas-workbench-heading"><span><b>项目管理</b><small>本地优先保存 · 支持 JSON 备份</small></span></div>{projects.map((project) => <div className={`canvas-project-manage-row ${project.id === activeProjectId ? 'active' : ''}`} key={project.id}><span className="canvas-project-dot">✦</span><div><b>{project.name}</b><small>{new Date(project.updatedAt).toLocaleString('zh-CN')}</small></div>{projects.length > 1 && <button type="button" onClick={() => onDeleteProject(project.id)}>删除</button>}</div>)}</div>}{tab === 'settings' && <div className="canvas-workbench-section"><div className="canvas-workbench-heading"><span><b>画布设置</b><small>调整画布交互与显示效果</small></span></div><div className="canvas-settings-card"><div><b>节点连线动态</b><small>选择连线在画布中的显示方式，设置会自动保存到本机。</small></div><div className="canvas-settings-options">{CONNECTION_ANIMATION_OPTIONS.map((option) => <button type="button" key={option.value} className={connectionAnimation === option.value ? 'active' : ''} aria-pressed={connectionAnimation === option.value} onClick={() => onConnectionAnimationChange(option.value)}><span className="canvas-settings-option-icon" data-animation={option.value}>⌁</span><span><b>{option.label}</b><small>{option.description}</small></span><i>{connectionAnimation === option.value ? '✓' : ''}</i></button>)}</div></div></div>}</div></aside></div>;
}
