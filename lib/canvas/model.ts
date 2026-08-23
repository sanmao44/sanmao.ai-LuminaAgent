import type {
  CanvasCamera,
  CanvasDocument,
  CanvasEdge,
  CanvasGenerationParams,
  CanvasGroup,
  CanvasMediaKind,
  CanvasNode,
  CanvasNodeData,
  CanvasSnapshot,
} from './types';

export const CANVAS_VERSION = 'sanmao-canvas-1';

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultCamera(width = 1200, height = 760): CanvasCamera {
  return { x: width / 2, y: height / 2, zoom: 1 };
}

export function normalizeCamera(value: unknown, fallback = defaultCamera()): CanvasCamera {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<CanvasCamera>;
  return {
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : fallback.x,
    y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : fallback.y,
    zoom: Math.max(0.12, Math.min(3, Number.isFinite(Number(raw.zoom)) ? Number(raw.zoom) : fallback.zoom)),
  };
}

function nodeType(value: unknown): CanvasNode['type'] {
  return value === 'prompt' || value === 'generator' ? value : 'media';
}

function mediaKind(value: unknown): CanvasMediaKind {
  return value === 'video' ? 'video' : 'image';
}

function normalizeNode(value: unknown): CanvasNode | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CanvasNode> & { data?: unknown };
  if (!raw.id || !Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y))) return null;
  const data = raw.data && typeof raw.data === 'object' ? clone(raw.data as CanvasNodeData) : {};
  const type = nodeType(raw.type);
  if (type === 'media') data.kind = mediaKind(data.kind);
  return {
    id: String(raw.id),
    type,
    x: Number(raw.x),
    y: Number(raw.y),
    ...(Number.isFinite(Number(raw.w)) ? { w: Number(raw.w) } : {}),
    ...(Number.isFinite(Number(raw.h)) ? { h: Number(raw.h) } : {}),
    ...(raw.groupId ? { groupId: String(raw.groupId) } : {}),
    data,
  };
}

function withoutGroupId(node: CanvasNode): CanvasNode {
  const { groupId: _groupId, ...rest } = node;
  return rest;
}

function normalizeEdge(value: unknown): CanvasEdge | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CanvasEdge>;
  if (!raw.id || !raw.source || !raw.target) return null;
  return {
    id: String(raw.id),
    source: String(raw.source),
    target: String(raw.target),
    sourcePort: raw.sourcePort === 'left' ? 'left' : 'right',
    targetPort: raw.targetPort === 'right' ? 'right' : 'left',
    kind: raw.kind === 'generated' || raw.kind === 'variant' || raw.kind === 'lineage' ? raw.kind : 'manual',
  };
}

export function normalizeDocument(value: unknown, width = 1200, height = 760): CanvasDocument {
  const raw = value && typeof value === 'object' ? value as Partial<CanvasDocument> : {};
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode).filter(Boolean) as CanvasNode[] : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const groups = Array.isArray(raw.groups)
    ? raw.groups
      .filter((group): group is CanvasGroup => Boolean(group && typeof group === 'object'))
      .map((group) => ({
        id: String(group.id || uid('group')),
        name: String(group.name || '对象组'),
        nodeIds: Array.isArray(group.nodeIds) ? [...new Set(group.nodeIds.map(String))].filter((id) => nodeIds.has(id)) : [],
      }))
      .filter((group, index, all) => group.nodeIds.length >= 2 && all.findIndex((item) => item.id === group.id) === index)
    : [];
  const groupIds = new Set(groups.map((group) => group.id));
  const groupMembership = new Map<string, string>();
  groups.forEach((group) => group.nodeIds.forEach((id) => { if (!groupMembership.has(id)) groupMembership.set(id, group.id); }));
  const normalizedNodes = nodes.map((node) => groupMembership.has(node.id) ? { ...node, groupId: groupMembership.get(node.id) } : withoutGroupId(node));
  const edges = Array.isArray(raw.edges)
    ? raw.edges.map(normalizeEdge).filter(Boolean).filter((edge) => nodeIds.has(edge!.source) || groupIds.has(edge!.source))
      .filter((edge) => nodeIds.has(edge!.target) || groupIds.has(edge!.target)) as CanvasEdge[]
    : [];
  return {
    version: CANVAS_VERSION,
    nodes: normalizedNodes,
    edges,
    groups,
    camera: normalizeCamera(raw.camera, defaultCamera(width, height)),
  };
}

export function snapshot(document: CanvasDocument): CanvasSnapshot {
  return clone({ nodes: document.nodes, edges: document.edges, groups: document.groups, camera: document.camera });
}

export function restoreSnapshot(document: CanvasDocument, value: CanvasSnapshot): CanvasDocument {
  return normalizeDocument(value, document.camera.x * 2, document.camera.y * 2);
}

export function nodeSize(node: Pick<CanvasNode, 'type' | 'w' | 'h'>) {
  return {
    w: node.w || (node.type === 'media' ? 320 : node.type === 'prompt' ? 270 : 306),
    h: node.h || (node.type === 'media' ? 220 : node.type === 'prompt' ? 170 : 238),
  };
}

export function nodeById(document: CanvasDocument, id: string | undefined) {
  return document.nodes.find((node) => node.id === id);
}

export function groupById(document: CanvasDocument, id: string | undefined) {
  return document.groups.find((group) => group.id === id);
}

export function groupNodes(document: CanvasDocument, groupId: string) {
  const group = groupById(document, groupId);
  return group ? group.nodeIds.map((id) => nodeById(document, id)).filter(Boolean) as CanvasNode[] : [];
}

export function groupContentBounds(document: CanvasDocument, groupId: string) {
  const nodes = groupNodes(document, groupId);
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + nodeSize(node).w));
  const maxY = Math.max(...nodes.map((node) => node.y + nodeSize(node).h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function groupBounds(document: CanvasDocument, groupId: string) {
  const content = groupContentBounds(document, groupId);
  return { x: content.x - 30, y: content.y - 48, w: content.w + 60, h: content.h + 78 };
}

export function entityBounds(document: CanvasDocument, id: string) {
  const group = groupById(document, id);
  if (group) return groupBounds(document, group.id);
  const node = nodeById(document, id);
  if (!node) return { x: 0, y: 0, w: 0, h: 0 };
  const size = nodeSize(node);
  return { x: node.x, y: node.y, w: size.w, h: size.h };
}

export function entityPortPoint(document: CanvasDocument, id: string, port: 'left' | 'right') {
  const bounds = entityBounds(document, id);
  return { x: bounds.x + (port === 'right' ? bounds.w : 0), y: bounds.y + bounds.h / 2 };
}

export function edgePath(document: CanvasDocument, edge: CanvasEdge) {
  const a = entityPortPoint(document, edge.source, edge.sourcePort || 'right');
  const b = entityPortPoint(document, edge.target, edge.targetPort || 'left');
  const sourceDirection = (edge.sourcePort || 'right') === 'right' ? 1 : -1;
  const targetDirection = (edge.targetPort || 'left') === 'left' ? -1 : 1;
  const dx = Math.max(72, Math.abs(b.x - a.x) * 0.42);
  return `M ${a.x} ${a.y} C ${a.x + dx * sourceDirection} ${a.y}, ${b.x + dx * targetDirection} ${b.y}, ${b.x} ${b.y}`;
}

export function mediaCardSizeForRatio(ratio = 1, kind: CanvasMediaKind = 'image') {
  if (kind === 'video') return { w: 420, h: 290 };
  const safeRatio = Number(ratio) || 1;
  const footer = 48;
  let width = 380;
  let stage = width / safeRatio;
  if (stage > 520) { stage = 520; width = stage * safeRatio; }
  if (width > 480) { width = 480; stage = width / safeRatio; }
  if (width < 280) { width = 280; stage = width / safeRatio; }
  if (stage < 180) { stage = 180; width = stage * safeRatio; }
  return { w: Math.round(width), h: Math.round(stage + footer) };
}

export function smartMediaSize(kind: CanvasMediaKind, params: CanvasGenerationParams = {}) {
  if (kind === 'video') return mediaCardSizeForRatio(16 / 9, kind);
  const [a, b] = String(params.aspect || '1:1').split(':').map(Number);
  return mediaCardSizeForRatio((a || 1) / (b || 1), kind);
}

export function createMedia(kind: CanvasMediaKind, url: string, name: string, position: { x: number; y: number }, data: CanvasNodeData = {}): CanvasNode {
  return {
    id: uid('node'), type: 'media', x: position.x, y: position.y,
    w: kind === 'video' ? 420 : 380, h: kind === 'video' ? 290 : 270,
    data: { kind, url, name: name || (kind === 'video' ? '视频素材' : '图片素材'), role: '参考', autoFit: true, ...data },
  };
}

export function createPrompt(position: { x: number; y: number }, text = ''): CanvasNode {
  return { id: uid('node'), type: 'prompt', x: position.x, y: position.y, w: 270, h: 170, data: { text } };
}

export function createGenerator(kind: CanvasMediaKind, position: { x: number; y: number }, params: CanvasGenerationParams = {}): CanvasNode {
  return { id: uid('node'), type: 'generator', x: position.x, y: position.y, w: 306, h: 238, data: { kind, params, prompt: '', status: 'idle' } };
}

export function createEmptyMedia(kind: CanvasMediaKind, position: { x: number; y: number }, params: CanvasGenerationParams = {}): CanvasNode {
  const size = smartMediaSize(kind, params);
  return {
    ...createMedia(kind, '', kind === 'video' ? '空视频节点' : '空图片节点', position, {
      role: '待生成', status: 'draft', statusLabel: kind === 'video' ? '等待生成视频' : '等待生成图片',
      generation: { kind, prompt: '', params, referenceIds: [], createdAt: Date.now() }, referenceOrder: [],
    }),
    ...size,
  };
}

export function addEdge(document: CanvasDocument, source: string, target: string, sourcePort: 'left' | 'right' = 'right', targetPort: 'left' | 'right' = 'left', kind: CanvasEdge['kind'] = 'manual') {
  const sourceExists = Boolean(nodeById(document, source) || groupById(document, source));
  const targetExists = Boolean(nodeById(document, target) || groupById(document, target));
  if (!sourceExists || !targetExists || source === target || document.edges.some((edge) => edge.source === source && edge.target === target && edge.sourcePort === sourcePort && edge.targetPort === targetPort)) return document;
  return { ...document, edges: [...document.edges, { id: uid('edge'), source, target, sourcePort, targetPort, kind }] };
}

export function removeEdge(document: CanvasDocument, id: string) {
  return { ...document, edges: document.edges.filter((edge) => edge.id !== id) };
}

export function createGroup(document: CanvasDocument, ids: string[]) {
  const valid = [...new Set(ids)].filter((id) => nodeById(document, id));
  if (valid.length < 2) return document;
  const groupId = uid('group');
  const selected = new Set(valid);
  const groups = document.groups
    .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !selected.has(id)) }))
    .filter((group) => group.nodeIds.length >= 2);
  const survivingMembership = new Map(groups.flatMap((group) => group.nodeIds.map((id) => [id, group.id] as const)));
  const nodes = document.nodes.map((node) => selected.has(node.id) ? { ...node, groupId } : node.groupId && survivingMembership.has(node.id) ? { ...node, groupId: survivingMembership.get(node.id) } : { ...node, groupId: undefined });
  groups.push({ id: groupId, name: `对象组 ${document.groups.length + 1}`, nodeIds: valid });
  return { ...document, nodes, groups };
}

export function ungroup(document: CanvasDocument, groupId: string) {
  const group = groupById(document, groupId);
  if (!group) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) => group.nodeIds.includes(node.id) ? { ...node, groupId: undefined } : node),
    groups: document.groups.filter((item) => item.id !== groupId),
    edges: document.edges.filter((edge) => edge.source !== groupId && edge.target !== groupId),
  };
}

export function removeNodes(document: CanvasDocument, ids: string[]) {
  const set = new Set(ids);
  const groupIds = new Set(document.groups.filter((group) => group.nodeIds.some((id) => set.has(id))).map((group) => group.id));
  const groups = document.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !set.has(id)) })).filter((group) => group.nodeIds.length >= 2);
  const survivingMembership = new Map(groups.flatMap((group) => group.nodeIds.map((id) => [id, group.id] as const)));
  return {
    ...document,
    nodes: document.nodes.filter((node) => !set.has(node.id)).map((node) => node.groupId && survivingMembership.has(node.id) ? { ...node, groupId: survivingMembership.get(node.id) } : { ...node, groupId: undefined }),
    groups,
    edges: document.edges.filter((edge) => !set.has(edge.source) && !set.has(edge.target) && !groupIds.has(edge.source) && !groupIds.has(edge.target)),
  };
}

export function incomingReferences(document: CanvasDocument, entityId: string) {
  const entity = nodeById(document, entityId) || groupById(document, entityId);
  if (!entity) return [];
  const direct = document.edges.filter((edge) => edge.target === entityId && !['generated', 'variant', 'lineage'].includes(edge.kind || ''))
    .flatMap((edge) => groupById(document, edge.source)?.nodeIds.map((id) => nodeById(document, id)) || [nodeById(document, edge.source)])
    .filter((node): node is CanvasNode => node?.type === 'media' && Boolean(node.data.url));
  const virtualIds = 'nodeIds' in entity ? [] : [...(entity.data.generation?.referenceIds || []), ...(entity.data.referenceOrder || [])];
  const virtual = virtualIds.map((id) => nodeById(document, id)).filter((node): node is CanvasNode => node?.type === 'media' && Boolean(node.data.url));
  const seen = new Set<string>();
  return [...direct, ...virtual].filter((node) => !seen.has(node.id) && Boolean(seen.add(node.id)));
}

export function reorderReferences(document: CanvasDocument, ownerId: string, ids: string[]) {
  const owner = nodeById(document, ownerId) || groupById(document, ownerId);
  if (!owner || 'nodeIds' in owner) return document;
  const valid = incomingReferences(document, ownerId).map((node) => node.id);
  const next = ids.filter((id) => valid.includes(id));
  valid.forEach((id) => { if (!next.includes(id)) next.push(id); });
  return {
    ...document,
    nodes: document.nodes.map((node) => node.id === ownerId ? { ...node, data: { ...node.data, referenceOrder: next, generation: node.data.generation ? { ...node.data.generation, referenceIds: next } : node.data.generation } } : node),
  };
}

export function smartPrompt(prompt: string, context: CanvasNode[]) {
  const texts = context.filter((node) => node.type === 'prompt').map((node) => node.data.text?.trim()).filter(Boolean) as string[];
  const output = [prompt.trim(), ...texts].filter(Boolean).join('\n');
  const refs = context.filter((node) => node.type === 'media' && node.data.url);
  if (refs.length > 1 && /(融合|合并|组合|结合|一张图|共同|全部参考|merge|combine|blend|composite|all references)/i.test(output)) {
    return `你将按顺序收到 ${refs.length} 张参考图（图1到图${refs.length}）。请同时使用全部参考图，不要忽略其中任何一张；把参考图的主体或视觉元素合理融合到同一张新画面中。\n用户指令：${output}`;
  }
  return output;
}
