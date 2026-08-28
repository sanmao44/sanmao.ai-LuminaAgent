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

export type CanvasOverlayFit = CanvasOverlayPosition & {
  maxHeight: number;
};

function centeredLeft(
  anchor: CanvasOverlayAnchor,
  _stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
) {
  return anchor.left + anchor.width / 2 - overlay.width / 2;
}

/** Places the compact action rail above a node at a stable screen offset. */
export function placeCanvasNodeToolbar(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 10,
): CanvasOverlayPosition {
  return {
    left: centeredLeft(anchor, stage, overlay),
    top: anchor.top - overlay.height - gap,
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
