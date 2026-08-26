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
