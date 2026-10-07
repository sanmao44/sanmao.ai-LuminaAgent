export function canvasConnectableId(target: EventTarget | null) {
  return (target as HTMLElement | null)
    ?.closest<HTMLElement>("[data-canvas-connectable-id]")
    ?.dataset.canvasConnectableId;
}

export const CANVAS_CREATE_MENU_INTERACTIVE_SELECTOR =
  "button,textarea,input,select,[contenteditable=\"true\"],.canvas-node,.canvas-node-asset-drag-handle,.canvas-node-resize,.canvas-node-editor,.canvas-node-editor-popover,.canvas-node-parameters,.canvas-node-quick-toolbar,.canvas-group,.canvas-edge-layer,.canvas-floating,.canvas-deck,.canvas-selection-toolbar,.canvas-selection-layout-toolbar,.canvas-minimap,.canvas-agent-dock,.canvas-agent-dock-rail,.canvas-context-menu,.canvas-connection-picker,.canvas-angle-workbench,.select-menu,.select-menu-popover,.model-picker,.model-picker-panel,.model-picker-dialog-backdrop";

/** Keep wheel scrolling inside controls from becoming a canvas zoom gesture. */
export function isCanvasWheelIsolatedTarget(target: EventTarget | null) {
  return isCanvasWheelIsolatedTargetWithOptions(target, false);
}

export function isCanvasWheelIsolatedTargetWithOptions(
  target: EventTarget | null,
  allowNodeSurface: boolean,
) {
  if (!(target instanceof Element)) return false;
  const selector = [
    "textarea",
    "input",
    "select",
    "[contenteditable=\"true\"]",
    !allowNodeSurface ? ".canvas-node" : "",
    ".canvas-node-editor-popover",
    ".canvas-node-quick-toolbar",
    ".canvas-minimap",
    ".canvas-agent-dock",
    ".canvas-agent-dock-rail",
    ".canvas-workbench",
    ".canvas-context-menu",
    ".canvas-modal-backdrop",
    "[data-canvas-wheel-isolate]",
  ].filter(Boolean).join(", ");
  if (target.closest(selector)) return true;

  for (
    let element: HTMLElement | null =
      target instanceof HTMLElement ? target : target.parentElement;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = window.getComputedStyle(element);
    const vertical =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight + 1;
    const horizontal =
      /(auto|scroll|overlay)/.test(style.overflowX) &&
      element.scrollWidth > element.clientWidth + 1;
    if (vertical || horizontal) return true;
  }
  return false;
}

export function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
  );
}
