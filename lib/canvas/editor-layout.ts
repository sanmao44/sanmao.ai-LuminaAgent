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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function centeredLeft(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  edge: number,
) {
  const maxLeft = Math.max(edge, stage.width - overlay.width - edge);
  return clamp(
    anchor.left + anchor.width / 2 - overlay.width / 2,
    edge,
    maxLeft,
  );
}

/** Places the compact action rail above a node while keeping it in the stage. */
export function placeCanvasNodeToolbar(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 10,
  edge = 10,
): CanvasOverlayPosition {
  const maxTop = Math.max(edge, stage.height - overlay.height - edge);
  return {
    left: centeredLeft(anchor, stage, overlay, edge),
    top: clamp(anchor.top - overlay.height - gap, edge, maxTop),
  };
}

/** Places the editor below the node; it never switches to a side placement. */
export function placeCanvasNodeEditor(
  anchor: CanvasOverlayAnchor,
  stage: CanvasOverlayStage,
  overlay: CanvasOverlaySize,
  gap = 14,
  edge = 10,
): CanvasOverlayPosition {
  const maxTop = Math.max(edge, stage.height - overlay.height - edge);
  return {
    left: centeredLeft(anchor, stage, overlay, edge),
    top: clamp(anchor.top + anchor.height + gap, edge, maxTop),
  };
}
