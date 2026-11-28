import type { CanvasNode } from './types';

const CANVAS_INLINE_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|bmp|svg\+xml);base64,/i;

export function canvasInlineImageUrls(nodes: readonly CanvasNode[]) {
  const urls = new Set<string>();
  const seen = new WeakSet<object>();
  const pending: unknown[] = nodes.map((node) => node.data);
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (CANVAS_INLINE_IMAGE_DATA_URL.test(value)) urls.add(value);
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index]);
    } else {
      const values = Object.values(value);
      for (let index = values.length - 1; index >= 0; index -= 1) pending.push(values[index]);
    }
  }
  return [...urls];
}

type ReplaceChild = { key: string | number; value: unknown };
type ReplaceFrame = {
  source: object;
  children: ReplaceChild[];
  nextIndex: number;
  changed: boolean;
  result?: unknown[] | Record<string, unknown>;
  parent?: ReplaceFrame;
  parentChild?: ReplaceChild;
};

function createReplaceFrame(value: object, parent?: ReplaceFrame, parentChild?: ReplaceChild): ReplaceFrame {
  if (Array.isArray(value)) {
    const source = value as unknown[];
    const children: ReplaceChild[] = [];
    for (let index = 0; index < source.length; index += 1) {
      if (Object.prototype.hasOwnProperty.call(source, index)) children.push({ key: index, value: source[index] });
    }
    return { source, children, nextIndex: 0, changed: false, parent, parentChild };
  }
  const source = value as Record<string, unknown>;
  return {
    source,
    children: Object.entries(source).map(([key, child]) => ({ key, value: child })),
    nextIndex: 0,
    changed: false,
    parent,
    parentChild,
  };
}

function ensureReplaceResult(frame: ReplaceFrame) {
  if (frame.result) return;
  frame.result = Array.isArray(frame.source)
    ? (frame.source as unknown[]).slice()
    : { ...(frame.source as Record<string, unknown>) };
}

function setReplaceChild(frame: ReplaceFrame, child: ReplaceChild, next: unknown) {
  if (next === child.value) return;
  frame.changed = true;
  ensureReplaceResult(frame);
  const result = frame.result!;
  if (Array.isArray(result)) {
    result[child.key as number] = next;
  } else {
    result[String(child.key)] = next;
  }
}

function replaceCanvasMediaUrlsIterative(value: unknown, archived: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return archived.get(value) || value;
  if (!value || typeof value !== 'object') return value;

  const ancestors = new WeakSet<object>();
  const root = createReplaceFrame(value);
  const stack: ReplaceFrame[] = [root];
  ancestors.add(root.source);
  let result: unknown = value;

  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.nextIndex >= frame.children.length) {
      const completed = frame.changed ? frame.result : frame.source;
      ancestors.delete(frame.source);
      stack.pop();
      if (frame.parent && frame.parentChild) setReplaceChild(frame.parent, frame.parentChild, completed);
      else result = completed;
      continue;
    }

    const child = frame.children[frame.nextIndex++];
    const valueAtChild = child.value;
    if (typeof valueAtChild === 'string') {
      setReplaceChild(frame, child, archived.get(valueAtChild) || valueAtChild);
    } else if (!valueAtChild || typeof valueAtChild !== 'object') {
      continue;
    } else if (ancestors.has(valueAtChild)) {
      // A back-reference cannot be represented in JSON. Omit only that edge,
      // while leaving the rest of the project metadata intact.
      setReplaceChild(frame, child, undefined);
    } else {
      const childFrame = createReplaceFrame(valueAtChild, frame, child);
      ancestors.add(childFrame.source);
      stack.push(childFrame);
    }
  }

  return result;
}

export function replaceCanvasMediaUrls<T>(value: T, archived: ReadonlyMap<string, string>): T {
  return replaceCanvasMediaUrlsIterative(value, archived) as T;
}
