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

function closestCandidate(
  anchors: Anchor[],
  targets: Target[],
  threshold: number,
): Match | null {
  let best: Match | null = null;
  for (const anchor of anchors) {
    for (const target of targets) {
      const distance = Math.abs(anchor.value - target.position);
      if (distance > threshold) continue;
      const candidate = {
        distance,
        position: target.position,
        targetId: target.targetId,
        anchorValue: anchor.value,
      };
      if (
        !best ||
        candidate.distance < best.distance ||
        (candidate.distance === best.distance &&
          candidate.targetId.localeCompare(best.targetId) < 0)
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function guideFor(
  axis: "x" | "y",
  position: number,
  targetId: string,
  moving: Bounds,
  target: Bounds,
): CanvasSnapGuide {
  return axis === "x"
    ? {
        axis,
        position,
        start: Math.min(moving.top, target.top) - 12,
        end: Math.max(moving.bottom, target.bottom) + 12,
        targetId,
      }
    : {
        axis,
        position,
        start: Math.min(moving.left, target.left) - 12,
        end: Math.max(moving.right, target.right) + 12,
        targetId,
      };
}

export function snapCanvasNodePositions(
  nodes: readonly CanvasSnapNode[],
  draggedIds: readonly string[],
  proposedPositions: Record<string, CanvasSnapPoint>,
  threshold: number,
): CanvasSnapResult {
  const positions = { ...proposedPositions };
  const draggedIdSet = new Set(draggedIds);
  const draggedNodes = nodes.filter((node) => draggedIdSet.has(node.id));
  const stationaryNodes = nodes.filter((node) => !draggedIdSet.has(node.id));
  const moving = selectionBounds(draggedNodes, positions);
  if (!moving || !Number.isFinite(threshold) || threshold < 0) {
    return { positions, guides: [] };
  }

  const xAnchors: Anchor[] = [
    { value: moving.left },
    {
      value: (moving.left + moving.right) / 2,
    },
    { value: moving.right },
  ];
  const yAnchors: Anchor[] = [
    { value: moving.top },
    {
      value: (moving.top + moving.bottom) / 2,
    },
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

  const xMatch = closestCandidate(xAnchors, xTargets, threshold);
  const yMatch = closestCandidate(yAnchors, yTargets, threshold);
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
        ),
      );
    }
  }

  return { positions, guides };
}
