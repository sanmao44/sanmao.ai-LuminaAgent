type MiddleButtonEvent = {
  button: number;
  buttons: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

export function startCanvasMiddleButtonPan(
  event: MiddleButtonEvent,
  startPan: () => boolean,
) {
  if (event.button !== 1 && (event.buttons & 4) === 0) return false;
  if (!startPan()) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function shouldCanvasPanWithWheel(
  deltaMode: number,
  deltaX: number,
  deltaY: number,
) {
  return deltaMode === 0
    && (deltaX !== 0 || deltaY !== 0)
    && (deltaX !== 0 || Math.abs(deltaY) < 100);
}

export function panCanvasCameraByWheel<T extends { x: number; y: number }>(
  camera: T,
  deltaX: number,
  deltaY: number,
): T {
  return { ...camera, x: camera.x - deltaX, y: camera.y - deltaY };
}

type CanvasTrackpadWheelEvent = {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

export function handleCanvasTrackpadPanWheel(
  event: CanvasTrackpadWheelEvent,
  pan: (deltaX: number, deltaY: number) => void,
) {
  if (!shouldCanvasPanWithWheel(event.deltaMode, event.deltaX, event.deltaY))
    return false;
  event.preventDefault();
  event.stopPropagation();
  pan(event.deltaX, event.deltaY);
  return true;
}

export const TRACKPAD_PINCH_ZOOM_SENSITIVITY = 0.0032;

export function trackpadPinchZoomFactor(deltaY: number) {
  return Math.exp(-deltaY * TRACKPAD_PINCH_ZOOM_SENSITIVITY);
}

export function mediaViewerWheelZoom(
  zoom: number,
  deltaY: number,
  pinch: boolean,
) {
  if (pinch) return zoom * trackpadPinchZoomFactor(deltaY);
  return zoom + (deltaY < 0 ? 0.1 : -0.1);
}

type MediaViewerWheelEvent = {
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

export function handleMediaViewerWheel(
  event: MediaViewerWheelEvent,
  zoom: number,
  updateZoom: (value: number, focus: { x: number; y: number }) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  updateZoom(
    mediaViewerWheelZoom(zoom, event.deltaY, event.ctrlKey || event.metaKey),
    { x: event.clientX, y: event.clientY },
  );
}

export function shouldCanvasInterceptModifiedWheel(
  modified: boolean,
  overMediaViewer: boolean,
) {
  return modified && !overMediaViewer;
}
