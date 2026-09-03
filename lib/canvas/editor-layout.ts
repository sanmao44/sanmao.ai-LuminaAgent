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

export type CanvasOverlayFit = CanvasOverlayPosition & {
  maxHeight: number;
};

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

function centeredLeft(
  anchor: CanvasOverlayAnchor,
  _stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
) {
  return anchor.left + anchor.width / 2 - overlay.width / 2;
}

/** Places the compact action rail above a node and keeps it inside the stage horizontally. */
export function placeCanvasNodeToolbar(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 10,
): CanvasOverlayPosition {
  const centered = centeredLeft(anchor, stage, overlay);
  const margin = 10;
  const maxLeft = Math.max(margin, stage.width - overlay.width - margin);
  return {
    left: Math.min(Math.max(centered, margin), maxLeft),
    top: anchor.top - overlay.height - gap,
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

/** Places the editor below the node; it never switches to a side placement. */
export function placeCanvasNodeEditor(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 14,
): CanvasOverlayPosition {
  return {
    left: centeredLeft(anchor, stage, overlay),
    top: anchor.top + anchor.height + gap,
  };
}

/**
 * Keeps the editor attached below its node while fitting its scrollable body
 * into the remaining viewport. Unlike clamping the editor's top edge, this
 * can never move the panel back across the node that owns it.
 */
export function fitCanvasNodeEditorBelow(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 14,
  margin = 12,
): CanvasOverlayFit {
  const position = placeCanvasNodeEditor(anchor, stage, overlay, gap);
  const rightmostLeft = Math.max(margin, stage.width - overlay.width - margin);

  return {
    left: Math.min(Math.max(position.left, margin), rightmostLeft),
    top: position.top,
    maxHeight: Math.max(
      0,
      Math.min(overlay.height, stage.height - position.top - margin),
    ),
  };
}

/**
 * Places a compact editor dock below its node. Unlike the full editor this
 * never constrains the vertical height: the dock is allowed to extend past the
 * bottom of the viewport (it intentionally does not scroll). Only the
 * horizontal position is clamped to the stage margins so the box stays reachable
 * on narrow screens.
 */
export function placeCanvasNodeEditorDock(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 14,
  margin = 12,
): CanvasOverlayPosition {
  const position = placeCanvasNodeEditor(anchor, stage, overlay, gap);
  const rightmostLeft = Math.max(margin, stage.width - overlay.width - margin);
  return {
    left: Math.min(Math.max(position.left, margin), rightmostLeft),
    top: position.top,
  };
}
