"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { canvasNodeColorKey, canvasSourceColorKey } from "@/lib/canvas/appearance";
import {
  canvasEdgeEndpoints,
  connectionPath,
  edgeRouteLaneOffset,
  entityPortPoint,
  groupById,
  isCanvasEdgeVisible,
  nodeById,
  nodeSize,
} from "@/lib/canvas/model";
import type {
  CanvasConnectionStyle,
  CanvasDocument,
  CanvasNode,
} from "@/lib/canvas/types";

type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
export default function CanvasMinimap({
  document,
  connectionStyle,
  selectedIds,
  bounds,
  stageSize,
  zoomAt,
  fitView,
  onNavigate,
  onMoveNodes,
  nodeLabel,
}: {
  document: CanvasDocument;
  connectionStyle: CanvasConnectionStyle;
  selectedIds: Set<string>;
  bounds: { x: number; y: number; w: number; h: number };
  stageSize: { width: number; height: number };
  zoomAt: (x: number, y: number, factor: number) => void;
  fitView: (ids?: string[]) => void;
  onNavigate: (x: number, y: number) => void;
  onMoveNodes: (positions: Record<string, Point>, recordHistory: boolean) => void;
  nodeLabel: (node: CanvasNode) => string;
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
  const navigate = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (clickGuardRef.current) {
      clickGuardRef.current = false;
      return;
    }
    const point = mapPoint(event.clientX, event.clientY);
    onNavigate(point.x, point.y);
  };
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
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
          {document.edges.filter((edge) => isCanvasEdgeVisible(document, edge)).map((edge) => {
            const source = nodeById(document, edge.source);
            const target = nodeById(document, edge.target);
            const sourceGroup = groupById(document, edge.source);
            const targetGroup = groupById(document, edge.target);
            if ((!source && !sourceGroup) || (!target && !targetGroup))
              return null;
            const colorKey = canvasSourceColorKey(document, edge.source);
            const sourcePort = edge.sourcePort || "right";
            const targetPort = edge.targetPort || "left";
            const endpoints = canvasEdgeEndpoints(document, edge);
            const sourcePoint = entityPortPoint(
              document,
              endpoints.source,
              sourcePort,
            );
            const targetPoint = entityPortPoint(
              document,
              endpoints.target,
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
                  edgeRouteLaneOffset(document, edge),
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

