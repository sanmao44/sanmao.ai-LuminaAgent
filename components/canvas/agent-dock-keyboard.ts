type CanvasAgentDockNativeKeyboardEvent = Pick<KeyboardEvent, "isComposing" | "keyCode">;

export function isCanvasAgentDockCompositionEvent(event: CanvasAgentDockNativeKeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}

export function shouldSubmitCanvasAgentDockEnter(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode">,
) {
  return event.key === "Enter" && !event.shiftKey && !isCanvasAgentDockCompositionEvent(event);
}
