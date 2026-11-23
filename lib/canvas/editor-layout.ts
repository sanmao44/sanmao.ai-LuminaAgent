export type CanvasOverlayAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CanvasOverlayStage = {
  width: number;
  height: number;
};

export type CanvasOverlaySize = {
  width: number;
  height: number;
};

export type CanvasOverlayPosition = {
  left: number;
  top: number;
};

export type CanvasGroupToolbarPlacement = CanvasOverlayPosition & {
  placement: "above" | "inside";
};

export type CanvasPopoverPosition = CanvasOverlayPosition & {
  width: number;
};

/** Caps a node editor to the width available beside canvas overlays. */
export function canvasWideNodeEditorWidth(
  viewportWidth: number,
  preferredWidth = 840,
  viewportMargin = 16,
) {
  return Math.max(1, Math.min(
    preferredWidth,
    viewportWidth - viewportMargin * 2,
  ));
}

/** Adapts an editor's width inversely to canvas zoom without shrinking its controls. */
export function canvasZoomResponsiveNodeEditorWidth(
  viewportWidth: number,
  zoom: number,
  baseWidth: number,
  minWidth: number,
  maxWidth: number,
  viewportMargin = 16,
) {
  const safeZoom = Math.max(0.12, Number.isFinite(zoom) ? zoom : 1);
  const zoomAdjustedWidth = baseWidth / Math.sqrt(safeZoom);
  const preferredWidth = Math.max(minWidth, Math.min(maxWidth, zoomAdjustedWidth));
  return canvasWideNodeEditorWidth(viewportWidth, preferredWidth, viewportMargin);
}

/**
 * Places a fixed context menu next to its pointer while keeping it inside the
 * visible viewport. The measured menu size is intentionally supplied by the
 * caller so the same rule works for every menu variant.
 */
export function placeCanvasContextMenu(
  pointer: CanvasOverlayPosition,
  viewport: CanvasOverlayStage,
  menu: CanvasOverlaySize,
  gap = 10,
  margin = 8,
): CanvasOverlayPosition {
  const right = pointer.left + gap;
  const left = pointer.left - menu.width - gap;
  const below = pointer.top + gap;
  const above = pointer.top - menu.height - gap;
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  const fitsRight = right + menu.width <= viewport.width - margin;
  const fitsBelow = below + menu.height <= viewport.height - margin;

  return {
    left: Math.min(Math.max(fitsRight ? right : left, margin), maxLeft),
    top: Math.min(Math.max(fitsBelow ? below : above, margin), maxTop),
  };
}
/** Places a small anchored popover in the viewport and flips it above as needed. */
export function placeCanvasActionPopover(
  anchor: CanvasOverlayAnchor,
  viewport: CanvasOverlayStage,
  size: CanvasOverlaySize,
  gap = 8,
  margin = 12,
): CanvasPopoverPosition {
  const width = Math.min(size.width, Math.max(1, viewport.width - margin * 2));
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - width / 2, margin),
    Math.max(margin, viewport.width - width - margin),
  );
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - size.height - gap;
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  return {
    left,
    top: below + size.height <= viewport.height - margin
      ? below
      : Math.min(Math.max(above, margin), maxTop),
    width,
  };
}

function centeredLeft(
  anchor: CanvasOverlayAnchor,
  _stage: CanvasOverlayStage,
  overlay: Pick<CanvasOverlaySize, "width">,
) {
  return anchor.left + anchor.width / 2 - overlay.width / 2;
}

/** Places the compact action rail above a node and keeps it inside the stage.
 * A tall node (or one scrolled past the top edge) would otherwise push the rail
 * off-screen, so the rail falls back to the node's top edge instead of floating
 * out of reach — same rule the group toolbar already uses. */
export function placeCanvasNodeToolbar(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 10,
): CanvasOverlayPosition {
  const centered = centeredLeft(anchor, stage, overlay);
  const margin = 10;
  const maxLeft = Math.max(margin, stage.width - overlay.width - margin);
  const maxTop = Math.max(margin, stage.height - overlay.height - margin);
  const aboveTop = anchor.top - overlay.height - gap;
  const insideTop = anchor.top + gap;
  return {
    left: Math.min(Math.max(centered, margin), maxLeft),
    top: aboveTop >= margin ? aboveTop : Math.min(Math.max(insideTop, margin), maxTop),
  };
}

/** Places a group selection toolbar at the group's top edge. If the group is
 * too close to the visible top edge, keep the toolbar attached inside it. */
export function placeCanvasGroupToolbar(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 10,
  margin = 10,
): CanvasGroupToolbarPlacement {
  const centered = centeredLeft(anchor, stage, overlay);
  const maxLeft = Math.max(margin, stage.width - overlay.width - margin);
  const aboveTop = anchor.top - overlay.height - gap;
  const placement = aboveTop >= margin ? "above" : "inside";
  const insideTop = anchor.top + gap;
  const maxTop = Math.max(margin, stage.height - overlay.height - margin);

  return {
    left: Math.min(Math.max(centered, margin), maxLeft),
    top: placement === "above"
      ? aboveTop
      : Math.min(Math.max(insideTop, margin), maxTop),
    placement,
  };
}

/** Keeps the editor centered on its node and anchored below it, even past the viewport. */
export function placeCanvasNodeEditor(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 14,
  margin = 12,
  obstacles: CanvasOverlayAnchor[] = [],
): CanvasOverlayPosition {
  const centered = centeredLeft(anchor, stage, overlay);
  const maxLeft = Math.max(margin, stage.width - overlay.width - margin);
  const top = anchor.top + anchor.height + gap;
  const candidates = [centered, anchor.left, anchor.left + anchor.width - overlay.width];

  for (const obstacle of obstacles) {
    candidates.push(
      obstacle.left - overlay.width - margin,
      obstacle.left,
      obstacle.left + obstacle.width - overlay.width,
      obstacle.left + obstacle.width + margin,
    );
  }

  const positions = [...new Set(candidates.map((left) => Math.min(Math.max(left, margin), maxLeft)))];
  const overlapArea = (left: number) => obstacles.reduce((area, obstacle) => {
      const horizontalOverlap = Math.max(
        0,
        Math.min(left + overlay.width, obstacle.left + obstacle.width) - Math.max(left, obstacle.left),
      );
      const obstacleVerticalOverlap = Math.max(
        0,
        Math.min(top + overlay.height, obstacle.top + obstacle.height) - Math.max(top, obstacle.top),
      );
      return area + horizontalOverlap * obstacleVerticalOverlap;
    }, 0);
  const left = positions.reduce((best, candidate) => {
    const candidateOverlap = overlapArea(candidate);
    const bestOverlap = overlapArea(best);
    if (candidateOverlap < bestOverlap) return candidate;
    if (candidateOverlap === bestOverlap && Math.abs(candidate - centered) < Math.abs(best - centered)) return candidate;
    return best;
  }, positions[0] ?? Math.min(Math.max(centered, margin), maxLeft));

  return {
    left,
    top,
  };
}
