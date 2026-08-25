export type CanvasSnapPoint = {
  x: number;
  y: number;
};

export type CanvasSnapNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CanvasSnapGuide = {
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
  targetId: string;
};

export type CanvasSnapResult = {
  positions: Record<string, CanvasSnapPoint>;
  guides: CanvasSnapGuide[];
};

export type CanvasSnapOptions = {
  releaseThreshold?: number;
  previousGuides?: readonly CanvasSnapGuide[];
  visibleNodeIds?: ReadonlySet<string>;
};

type Anchor = {
  value: number;
};

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Target = {
  position: number;
  targetId: string;
};

type Match = {
  distance: number;
  perpendicularDistance: number;
  position: number;
  targetId: string;
  anchorValue: number;
};

function boundsFor(
  node: CanvasSnapNode,
  position: CanvasSnapPoint,
): Bounds {
  return {
    left: position.x,
    top: position.y,
    right: position.x + node.w,
    bottom: position.y + node.h,
  };
}

function selectionBounds(
  nodes: CanvasSnapNode[],
  positions: Record<string, CanvasSnapPoint>,
): Bounds | null {
  if (!nodes.length) return null;
  return nodes.reduce<Bounds>(
    (result, node, index) => {
      const bounds = boundsFor(node, positions[node.id] || node);
      if (index === 0) return bounds;
      return {
        left: Math.min(result.left, bounds.left),
        top: Math.min(result.top, bounds.top),
        right: Math.max(result.right, bounds.right),
        bottom: Math.max(result.bottom, bounds.bottom),
      };
    },
    {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity,
    },
  );
}

function intervalGap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
) {
  return Math.max(0, startB - endA, startA - endB);
}

function closestCandidate(
  anchors: Anchor[],
  targets: Target[],
  threshold: number,
  axis: "x" | "y",
  moving: Bounds,
  targetBounds: Map<string, Bounds>,
  targetId?: string,
): Match | null {
  let best: Match | null = null;
  for (const anchor of anchors) {
    for (const target of targets) {
      if (targetId && target.targetId !== targetId) continue;
      const distance = Math.abs(anchor.value - target.position);
      if (distance > threshold) continue;
      const targetRect = targetBounds.get(target.targetId);
      if (!targetRect) continue;
      const candidate = {
        distance,
        perpendicularDistance:
          axis === "x"
            ? intervalGap(
                moving.top,
                moving.bottom,
                targetRect.top,
                targetRect.bottom,
              )
            : intervalGap(
                moving.left,
                moving.right,
                targetRect.left,
                targetRect.right,
              ),
        position: target.position,
        targetId: target.targetId,
        anchorValue: anchor.value,
      };
      if (
        !best ||
        candidate.distance < best.distance ||
        (candidate.distance === best.distance &&
          (candidate.perpendicularDistance < best.perpendicularDistance ||
            (candidate.perpendicularDistance === best.perpendicularDistance &&
              (candidate.targetId.localeCompare(best.targetId) < 0 ||
                (candidate.targetId === best.targetId &&
                  candidate.position < best.position)))))
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function lockedCandidate(
  anchors: Anchor[],
  targets: Target[],
  guide: CanvasSnapGuide | undefined,
  releaseThreshold: number,
  axis: "x" | "y",
  moving: Bounds,
  targetBounds: Map<string, Bounds>,
) {
  if (!guide || guide.axis !== axis) return null;
  return closestCandidate(
    anchors,
    targets.filter(
      (target) =>
        target.targetId === guide.targetId &&
        Math.abs(target.position - guide.position) < 0.001,
    ),
    releaseThreshold,
    axis,
    moving,
    targetBounds,
  );
}

function localGuideRange(
  movingStart: number,
  movingEnd: number,
  targetStart: number,
  targetEnd: number,
  threshold: number,
) {
  const padding = threshold * 0.8;
  const maxLength = threshold * 18;
  const start = Math.min(movingStart, targetStart) - padding;
  const end = Math.max(movingEnd, targetEnd) + padding;
  if (end - start <= maxLength) return { start, end };

  const center = (movingStart + movingEnd) / 2;
  return {
    start: center - maxLength / 2,
    end: center + maxLength / 2,
  };
}

function guideFor(
  axis: "x" | "y",
  position: number,
  targetId: string,
  moving: Bounds,
  target: Bounds,
  threshold: number,
): CanvasSnapGuide {
  const range =
    axis === "x"
      ? localGuideRange(
          moving.top,
          moving.bottom,
          target.top,
          target.bottom,
          threshold,
        )
      : localGuideRange(
          moving.left,
          moving.right,
          target.left,
          target.right,
          threshold,
        );
  return { axis, position, ...range, targetId };
}

export function snapCanvasNodePositions(
  nodes: readonly CanvasSnapNode[],
  draggedIds: readonly string[],
  proposedPositions: Record<string, CanvasSnapPoint>,
  threshold: number,
  options: CanvasSnapOptions = {},
): CanvasSnapResult {
  const positions = { ...proposedPositions };
  const draggedIdSet = new Set(draggedIds);
  const candidateNodes = nodes.filter(
    (node) => !options.visibleNodeIds || options.visibleNodeIds.has(node.id),
  );
  const draggedNodes = candidateNodes.filter((node) =>
    draggedIdSet.has(node.id),
  );
  const stationaryNodes = candidateNodes.filter(
    (node) => !draggedIdSet.has(node.id),
  );
  const moving = selectionBounds(draggedNodes, positions);
  if (!moving || !Number.isFinite(threshold) || threshold < 0) {
    return { positions, guides: [] };
  }

  const releaseThreshold = Math.max(
    threshold,
    Number.isFinite(options.releaseThreshold || NaN)
      ? Number(options.releaseThreshold)
      : threshold * 1.4,
  );
  const xAnchors: Anchor[] = [
    { value: moving.left },
    { value: (moving.left + moving.right) / 2 },
    { value: moving.right },
  ];
  const yAnchors: Anchor[] = [
    { value: moving.top },
    { value: (moving.top + moving.bottom) / 2 },
    { value: moving.bottom },
  ];
  const xTargets: Target[] = [];
  const yTargets: Target[] = [];
  const targetBounds = new Map<string, Bounds>();

  stationaryNodes.forEach((node) => {
    const target = boundsFor(node, node);
    targetBounds.set(node.id, target);
    xTargets.push(
      { position: target.left, targetId: node.id },
      { position: (target.left + target.right) / 2, targetId: node.id },
      { position: target.right, targetId: node.id },
    );
    yTargets.push(
      { position: target.top, targetId: node.id },
      { position: (target.top + target.bottom) / 2, targetId: node.id },
      { position: target.bottom, targetId: node.id },
    );
  });

  const previousXGuide = options.previousGuides?.find(
    (guide) => guide.axis === "x",
  );
  const previousYGuide = options.previousGuides?.find(
    (guide) => guide.axis === "y",
  );
  const lockedXMatch = lockedCandidate(
    xAnchors,
    xTargets,
    previousXGuide,
    releaseThreshold,
    "x",
    moving,
    targetBounds,
  );
  const lockedYMatch = lockedCandidate(
    yAnchors,
    yTargets,
    previousYGuide,
    releaseThreshold,
    "y",
    moving,
    targetBounds,
  );
  let xMatch =
    lockedXMatch ||
    closestCandidate(
      xAnchors,
      xTargets,
      threshold,
      "x",
      moving,
      targetBounds,
    );
  let yMatch =
    lockedYMatch ||
    closestCandidate(
      yAnchors,
      yTargets,
      threshold,
      "y",
      moving,
      targetBounds,
    );

  const pairBias = threshold * 0.2;
  let bestPair: { x: Match; y: Match; score: number } | null = null;
  for (const node of stationaryNodes) {
    const pairX = closestCandidate(
      xAnchors,
      xTargets,
      threshold,
      "x",
      moving,
      targetBounds,
      node.id,
    );
    const pairY = closestCandidate(
      yAnchors,
      yTargets,
      threshold,
      "y",
      moving,
      targetBounds,
      node.id,
    );
    if (!pairX || !pairY) continue;
    const candidate = {
      x: pairX,
      y: pairY,
      score: pairX.distance + pairY.distance,
    };
    if (
      !bestPair ||
      candidate.score < bestPair.score ||
      (candidate.score === bestPair.score &&
        node.id.localeCompare(bestPair.x.targetId) < 0)
    ) {
      bestPair = candidate;
    }
  }
  const independentScore =
    (xMatch?.distance ?? Infinity) + (yMatch?.distance ?? Infinity);
  if (bestPair && bestPair.score <= independentScore + pairBias) {
    if (!lockedXMatch) xMatch = bestPair.x;
    if (!lockedYMatch) yMatch = bestPair.y;
  }

  const xSnapDelta = xMatch ? xMatch.position - xMatch.anchorValue : 0;
  const ySnapDelta = yMatch ? yMatch.position - yMatch.anchorValue : 0;
  const snappedMoving = {
    left: moving.left + xSnapDelta,
    right: moving.right + xSnapDelta,
    top: moving.top + ySnapDelta,
    bottom: moving.bottom + ySnapDelta,
  };

  draggedNodes.forEach((node) => {
    const current = positions[node.id] || node;
    positions[node.id] = {
      x: current.x + xSnapDelta,
      y: current.y + ySnapDelta,
    };
  });

  const guides: CanvasSnapGuide[] = [];
  if (xMatch) {
    const target = targetBounds.get(xMatch.targetId);
    if (target) {
      guides.push(
        guideFor(
          "x",
          xMatch.position,
          xMatch.targetId,
          snappedMoving,
          target,
          threshold,
        ),
      );
    }
  }
  if (yMatch) {
    const target = targetBounds.get(yMatch.targetId);
    if (target) {
      guides.push(
        guideFor(
          "y",
          yMatch.position,
          yMatch.targetId,
          snappedMoving,
          target,
          threshold,
        ),
      );
    }
  }

  return { positions, guides };
}
