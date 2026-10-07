export function canvasRightOverlayInset(stage: HTMLElement | null) {
  const stageRect = stage?.getBoundingClientRect();
  const panel = typeof window === "undefined" ? null : window.document.querySelector(".canvas-agent-dock");
  if (!stageRect || !(panel instanceof HTMLElement)) return 0;
  const rect = panel.getBoundingClientRect();
  if (rect.width <= 0 || rect.left <= stageRect.left + stageRect.width / 2) return 0;
  return Math.max(0, stageRect.right - rect.left + 16);
}

export function canvasVisibleStageWidth(stage: HTMLElement | null) {
  const width = Math.max(1, stage?.clientWidth || 1);
  const inset = Math.min(canvasRightOverlayInset(stage), Math.max(0, width - 240));
  return Math.max(1, width - inset);
}