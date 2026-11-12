import type { CanvasNode } from './types';

const CANVAS_INLINE_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|bmp);base64,/i;

export function canvasInlineImageUrls(nodes: readonly CanvasNode[]) {
  const urls = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (CANVAS_INLINE_IMAGE_DATA_URL.test(value)) urls.add(value);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  nodes.forEach((node) => visit(node.data));
  return [...urls];
}

export function replaceCanvasMediaUrls<T>(value: T, archived: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (archived.get(value) || value) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const next = replaceCanvasMediaUrls(item, archived);
      changed ||= next !== item;
      return next;
    });
    return (changed ? result : value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const next = replaceCanvasMediaUrls(item, archived);
    changed ||= next !== item;
    result[key] = next;
  }
  return (changed ? result : value) as T;
}
