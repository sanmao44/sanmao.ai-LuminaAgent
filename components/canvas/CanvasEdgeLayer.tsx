"use client";

import {
  memo,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  connectionPath,
  edgePath,
  edgeRouteLaneOffset,
} from "@/lib/canvas/model";
import {
  CANVAS_NODE_COLOR_KEYS,
  type CanvasNodeColorKey,
} from "@/lib/canvas/appearance";
import type {
  CanvasConnectionStyle,
  CanvasDocument,
  CanvasEdge,
} from "@/lib/canvas/types";

type Point = { x: number; y: number };
type ConnectionPreview = {
  sourceId: string;
  start: Point;
  end: Point;
  sourcePort: "left" | "right";
};

const CANVAS_EDGE_FLOW_SEGMENTS = [
  { length: 160, width: 0.35, opacity: 0.12 },
  { length: 136, width: 0.5, opacity: 0.18 },
  { length: 112, width: 0.65, opacity: 0.24 },
  { length: 88, width: 0.8, opacity: 0.32 },
  { length: 64, width: 0.95, opacity: 0.42 },
  { length: 40, width: 1.1, opacity: 0.54 },
  { length: 20, width: 1.3, opacity: 0.7 },
  { length: 6, width: 1.3, opacity: 1 },
];

export type CanvasEdgeLayerProps = {
  document: CanvasDocument;
  visibleEdges: CanvasEdge[];
  selectedEdgeId: string | null;
  relatedEdgeIds: ReadonlySet<string>;
  animateRelated: boolean;
  style: CanvasConnectionStyle;
  colorKeyById: ReadonlyMap<string, CanvasNodeColorKey>;
  geometryKeyById: ReadonlyMap<string, string>;
  draftConnection: ConnectionPreview | null;
  onSelect: (edge: CanvasEdge) => void;
  onHover: (edgeId: string, event: ReactPointerEvent<SVGPathElement>) => void;
  onLeave: (edgeId: string) => void;
};

function CanvasEdgeVisual({
  document,
  edge,
  related,
  animateRelated,
  style,
  selected,
  colorKey,
  routeLaneOffset,
  sourceKey,
  targetKey,
  onSelect,
  onHover,
  onLeave,
}: {
  document: CanvasDocument;
  edge: CanvasEdge;
  related: boolean;
  animateRelated: boolean;
  style: CanvasConnectionStyle;
  selected: boolean;
  colorKey: CanvasNodeColorKey;
  routeLaneOffset: number;
  sourceKey: string;
  targetKey: string;
  onSelect: () => void;
  onHover: (event: ReactPointerEvent<SVGPathElement>) => void;
  onLeave: () => void;
}) {
  const path = edgePath(document, edge, style, routeLaneOffset);
  const handlePointerDown = (event: ReactPointerEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0) onSelect();
  };
  const handlePointerEnter = (event: ReactPointerEvent<SVGPathElement>) => {
    event.stopPropagation();
    onHover(event);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGPathElement>) => {
    event.stopPropagation();
    onHover(event);
  };
  return (
    <g className={`canvas-edge-visual node-color-${colorKey}`}>
      <path
        className="canvas-edge-hit"
        d={path}
        aria-hidden="true"
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={onLeave}
        onPointerDown={handlePointerDown}
      />
      <path
        className={`canvas-edge ${related ? "related" : ""} ${selected ? "selected" : ""} ${related && !animateRelated ? "related-static" : ""}`}
        d={path}
        markerEnd={`url(#canvas-arrow-${colorKey})`}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={onLeave}
        onPointerDown={handlePointerDown}
      />
      {related && animateRelated && (
        <g className="canvas-edge-related-flow" aria-hidden="true">
          <path
            className="canvas-edge-flow-stroke canvas-edge-flow-halo"
            d={path}
            pathLength="1000"
            strokeDasharray="136 224"
            style={{ "--edge-flow-offset": "-24px" } as CSSProperties}
          />
          {CANVAS_EDGE_FLOW_SEGMENTS.map(({ length, width, opacity }) => (
            <path
              key={length}
              className={`canvas-edge-flow-stroke${length === 6 ? " canvas-edge-flow-tip" : ""}`}
              d={path}
              pathLength="1000"
              strokeDasharray={`${length} ${360 - length}`}
              strokeWidth={width}
              opacity={opacity}
              style={{ "--edge-flow-offset": `${length - 160}px` } as CSSProperties}
            />
          ))}
        </g>
      )}
    </g>
  );
}

const MemoizedCanvasEdgeVisual = memo(
  CanvasEdgeVisual,
  (previous, next) =>
    previous.edge === next.edge &&
    previous.related === next.related &&
    previous.animateRelated === next.animateRelated &&
    previous.selected === next.selected &&
    previous.style === next.style &&
    previous.routeLaneOffset === next.routeLaneOffset &&
    previous.colorKey === next.colorKey &&
    previous.sourceKey === next.sourceKey &&
    previous.targetKey === next.targetKey,
);

export default function CanvasEdgeLayer({
  document,
  visibleEdges,
  selectedEdgeId,
  relatedEdgeIds,
  animateRelated,
  style,
  colorKeyById,
  geometryKeyById,
  draftConnection,
  onSelect,
  onHover,
  onLeave,
}: CanvasEdgeLayerProps) {
  // Lane assignment depends on endpoint membership and edge order, never on
  // node coordinates. Keep the membership signature stable while dragging so
  // pointer-move frames do not repeat the full edge scan.
  const nodeMembershipKey = useMemo(
    () => document.nodes.map((node) => `${node.id}:${node.groupId || ""}`).join("|"),
    [document.nodes],
  );
  const routeLaneOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    for (const edge of document.edges) {
      offsets.set(edge.id, edgeRouteLaneOffset(document, edge));
    }
    return offsets;
  }, [document.edges, document.groups, nodeMembershipKey]);

  return (
    <svg className="canvas-edge-layer" viewBox="-5000 -5000 10000 10000">
      <defs>
        {CANVAS_NODE_COLOR_KEYS.map((colorKey) => (
          <marker
            key={colorKey}
            id={`canvas-arrow-${colorKey}`}
            markerWidth="6"
            markerHeight="6"
            refX="5.5"
            refY="3"
            orient="auto"
          >
            <path
              d="M0,0.35 L5.7,3 L0,5.65 z"
              fill={`var(--canvas-node-${colorKey})`}
            />
          </marker>
        ))}
      </defs>
      {visibleEdges.map((edge) => (
        <MemoizedCanvasEdgeVisual
          key={edge.id}
          document={document}
          edge={edge}
          related={relatedEdgeIds.has(edge.id)}
          animateRelated={animateRelated}
          style={style}
          selected={selectedEdgeId === edge.id}
          colorKey={colorKeyById.get(edge.source) ?? "image"}
          routeLaneOffset={routeLaneOffsets.get(edge.id) ?? 0}
          sourceKey={geometryKeyById.get(edge.source) ?? edge.source}
          targetKey={geometryKeyById.get(edge.target) ?? edge.target}
          onSelect={() => onSelect(edge)}
          onHover={(event) => onHover(edge.id, event)}
          onLeave={() => onLeave(edge.id)}
        />
      ))}
      {draftConnection && (
        <path
          className={`canvas-edge canvas-edge-draft node-color-${colorKeyById.get(draftConnection.sourceId) ?? "image"}`}
          markerEnd={`url(#canvas-arrow-${colorKeyById.get(draftConnection.sourceId) ?? "image"})`}
          d={connectionPath(
            draftConnection.start,
            draftConnection.end,
            style,
            draftConnection.sourcePort,
            draftConnection.sourcePort === "right" ? "left" : "right",
          )}
        />
      )}
    </svg>
  );
}
