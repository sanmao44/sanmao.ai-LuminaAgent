export const CANVAS_THREE_D_PREVIEW_ROOT_MARGIN = '280px';

export function observeCanvasThreeDPreview(
  target: Element,
  onVisibilityChange: (visible: boolean) => void,
) {
  if (typeof IntersectionObserver === 'undefined') {
    onVisibilityChange(true);
    return () => undefined;
  }

  const observer = new IntersectionObserver(([entry]) => {
    onVisibilityChange(Boolean(entry?.isIntersecting));
  }, { rootMargin: CANVAS_THREE_D_PREVIEW_ROOT_MARGIN });
  observer.observe(target);
  return () => observer.disconnect();
}
