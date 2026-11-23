export const CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT = "canvas-node-editor:overlay-position-change";

export function notifyCanvasNodeEditorOverlayPositionChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT));
  }
}
